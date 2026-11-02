import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Download, Plus, ShoppingBasket, Trash2, ArrowRightLeft, Check, X, Loader2 } from "lucide-react";
import RecipeTile from "@/components/RecipeTile";
import type { GymPlan, Recipe } from "@/types/recipe";
import { ApiError, applyChatPlanAction, calculateMealPlate } from "@/lib/api";
import type { PlanMealSelection } from "@/types/chat";
import type { FoodSwapPlanDraft } from "@/types/foodswap";
import { createId, localDate, readMealLogs, type MealLog, type MealLogStatus, writeMealLogs } from "@/lib/mealLogs";

const PLAN_KEY = "nutriplan.savedPlan";
const RECIPES_KEY = "nutriplan.savedRecipes";
const DRAFT_KEY = "nutriplan.foodSwapDraft";

export default function MyPlan() {
  const [plan, setPlan] = useState<GymPlan | null>(() => read<GymPlan>(PLAN_KEY, null));
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>(() => read<Recipe[]>(RECIPES_KEY, []));
  const [selection, setSelection] = useState<Record<string, number>>(() => read("nutriplan.selectedMeals", {}));
  const [complete, setComplete] = useState<string[]>(() => read("nutriplan.completeMeals", []));
  const [checkedShopping, setCheckedShopping] = useState<string[]>(() => read("nutriplan.shoppingChecked", []));
  const [mealLogs, setMealLogs] = useState<MealLog[]>(() => readMealLogs());
  const [customMeal, setCustomMeal] = useState("");
  const [customDate, setCustomDate] = useState(localDate());
  const [logError, setLogError] = useState("");
  const [foodSwapDraft, setFoodSwapDraft] = useState<FoodSwapPlanDraft | null>(() => read<FoodSwapPlanDraft | null>(DRAFT_KEY, null));
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [prepQueue, setPrepQueue] = useState<string[]>(() => read("nutriplan.prepQueue", []));
  const [challengeActive, setChallengeActive] = useState(() => localStorage.getItem("nutriplan.oneMealChallenge") === "active");

  useEffect(() => {
    const refresh = () => {
      setPlan(read<GymPlan>(PLAN_KEY, null));
      setSavedRecipes(read<Recipe[]>(RECIPES_KEY, []));
      setSelection(read("nutriplan.selectedMeals", {}));
      setFoodSwapDraft(read<FoodSwapPlanDraft | null>(DRAFT_KEY, null));
    };
    window.addEventListener("nutriplan:updated", refresh);
    return () => window.removeEventListener("nutriplan:updated", refresh);
  }, []);

  useEffect(() => {
    const refresh = () => setMealLogs(readMealLogs());
    window.addEventListener("nutriplan:meal-logs-updated", refresh);
    return () => window.removeEventListener("nutriplan:meal-logs-updated", refresh);
  }, []);

  const selectedMeals = useMemo(() => (plan?.meals || []).map((meal) => {
    const recipe = meal.recipes.find((item) => (item.recipe_id ?? 0) === (selection[meal.meal_name] ?? meal.recipes[0]?.recipe_id)) ?? meal.recipes[0];
    return { meal, recipe };
  }), [plan, selection]);
  const shoppingList = useMemo(() => Array.from(new Set(selectedMeals.flatMap(({ recipe }) => recipe?.RecipeIngredientParts || []).map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [selectedMeals]);
  const totals = useMemo(() => selectedMeals.filter(({ meal }) => complete.includes(meal.meal_name)).reduce((sum, { recipe }) => {
    if (!recipe) return sum;
    sum.calories += recipe.Calories; sum.protein += recipe.ProteinContent; sum.carbs += recipe.CarbohydrateContent; sum.fat += recipe.FatContent;
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 }), [selectedMeals, complete]);

  function markComplete(name: string) {
    const next = complete.includes(name) ? complete.filter((item) => item !== name) : [...complete, name];
    setComplete(next); localStorage.setItem("nutriplan.completeMeals", JSON.stringify(next)); window.dispatchEvent(new Event("nutriplan:updated"));
  }
  function updateSelection(name: string, recipeId: number) {
    const next = { ...selection, [name]: recipeId }; setSelection(next); localStorage.setItem("nutriplan.selectedMeals", JSON.stringify(next));
  }
  function toggleShopping(item: string) {
    const next = checkedShopping.includes(item) ? checkedShopping.filter((value) => value !== item) : [...checkedShopping, item];
    setCheckedShopping(next); localStorage.setItem("nutriplan.shoppingChecked", JSON.stringify(next));
  }
  function removeSaved(id?: number) {
    const next = savedRecipes.filter((recipe) => recipe.recipe_id !== id);
    setSavedRecipes(next); localStorage.setItem(RECIPES_KEY, JSON.stringify(next)); window.dispatchEvent(new Event("nutriplan:updated"));
  }

  async function acceptFoodSwapDraft() {
    if (!foodSwapDraft?.recipe.recipe_id) return;
    setSavingDraft(true); setDraftError("");
    const currentMeals: PlanMealSelection[] = (plan?.meals ?? []).map((group) => {
      const recipeIds = group.recipes.map((recipe) => recipe.recipe_id ?? recipe.RecipeId).filter((id): id is number => Number.isFinite(id));
      const selectedRecipeId = selection[group.meal_name] ?? recipeIds[0];
      return { meal_name: group.meal_name, recommended_calories: group.recommended_calories, recipe_ids: recipeIds, selected_recipe_id: selectedRecipeId };
    }).filter((group) => group.recipe_ids.length > 0);
    try {
      const validated = await applyChatPlanAction({
        action: "add", recipe_id: foodSwapDraft.recipe.recipe_id, meal_name: "FoodSwap choice",
        dietary_preference: foodSwapDraft.dietary_preference, allergies: foodSwapDraft.exclusions,
        disliked_foods: [], current_meals: currentMeals,
      });
      const nextPlan: GymPlan = {
        ...(plan ?? { available: true, estimated: true, limitations: [], nutrition_source: validated.nutrition_source }),
        meals: validated.meals.map((group) => ({ meal_name: group.meal_name, recommended_calories: group.recommended_calories, recipes: group.recipes })),
        nutrition_source: validated.nutrition_source,
      };
      localStorage.setItem(PLAN_KEY, JSON.stringify(nextPlan));
      const nextSelection = { ...selection, ...validated.selected_recipe_ids };
      localStorage.setItem("nutriplan.selectedMeals", JSON.stringify(nextSelection));
      localStorage.removeItem(DRAFT_KEY);
      setPlan(nextPlan); setSelection(nextSelection); setFoodSwapDraft(null); setConfirmDraft(false);
      window.dispatchEvent(new Event("nutriplan:updated"));
    } catch (error) {
      setDraftError(error instanceof ApiError ? `Could not add this recipe (${error.status}): ${error.message}` : "The backend could not validate this recipe. Your saved plan was left unchanged.");
    } finally { setSavingDraft(false); }
  }

  function discardFoodSwapDraft() {
    if (!window.confirm("Discard this FoodSwap draft from this device?")) return;
    localStorage.removeItem(DRAFT_KEY); setFoodSwapDraft(null); setConfirmDraft(false); setDraftError("");
  }

  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - 6);
  const weekStartKey = localDate(weekStart);
  const thisWeek = mealLogs.filter((entry) => entry.date >= weekStartKey && entry.date <= localDate());
  const countedLogs = thisWeek.filter((entry) => entry.status === "eaten" && entry.totals);
  const weekTotals = countedLogs.reduce((sum, entry) => {
    sum.calories += entry.totals?.Calories ?? 0; sum.protein += entry.totals?.ProteinContent ?? 0;
    sum.carbs += entry.totals?.CarbohydrateContent ?? 0; sum.fat += entry.totals?.FatContent ?? 0;
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const prepSelected = selectedMeals.filter(({ meal }) => prepQueue.includes(meal.meal_name));
  const prepIngredients = Array.from(new Set(prepSelected.flatMap(({ recipe }) => recipe?.RecipeIngredientParts || []).map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const prepMinutes = prepSelected.reduce((total, { recipe }) => total + durationMinutes(recipe?.TotalTime), 0);

  function togglePrep(mealName: string) {
    const next = prepQueue.includes(mealName) ? prepQueue.filter((name) => name !== mealName) : [...prepQueue, mealName];
    setPrepQueue(next); localStorage.setItem("nutriplan.prepQueue", JSON.stringify(next));
  }

  function toggleChallenge() {
    const next = !challengeActive;
    setChallengeActive(next);
    if (next) localStorage.setItem("nutriplan.oneMealChallenge", "active");
    else localStorage.removeItem("nutriplan.oneMealChallenge");
  }

  function addCustomMeal(event: FormEvent) {
    event.preventDefault(); setLogError("");
    const name = customMeal.trim();
    if (!name) return;
    const entry: MealLog = { id: createId(), date: customDate, name, status: "eaten", items: [], totals: null, notes: "Custom meal name entered by user; nutrition was not provided." };
    const next = [entry, ...readMealLogs()]; setMealLogs(next); writeMealLogs(next); setCustomMeal("");
  }

  function updateLog(id: string, change: Partial<MealLog>) {
    const next = readMealLogs().map((entry) => entry.id === id ? { ...entry, ...change } : entry);
    setMealLogs(next); writeMealLogs(next);
  }

  async function changeLoggedServings(entry: MealLog, recipeId: number, servings: number) {
    if (servings < 0.25 || servings > 3) return;
    const items = entry.items.map((item) => item.recipe_id === recipeId ? { ...item, servings } : item);
    try {
      const result = await calculateMealPlate(items.map(({ recipe_id, servings: amount }) => ({ recipe_id, servings: amount })));
      updateLog(entry.id, { items, totals: result.totals }); setLogError("");
    } catch { setLogError("Could not recalculate this meal. Check that the backend is running; the saved entry was left unchanged."); }
  }

  function removeLog(id: string) {
    const next = readMealLogs().filter((entry) => entry.id !== id); setMealLogs(next); writeMealLogs(next);
  }

  async function downloadWeekCard() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" rx="64" fill="#f7f4eb"/><text x="88" y="150" fill="#246044" font-family="Arial" font-size="36" font-weight="700">NUTRIPLAN · YOUR WEEK</text><text x="88" y="360" fill="#183b2b" font-family="Arial" font-size="64" font-weight="700">${thisWeek.length} meals logged</text><text x="88" y="500" fill="#183b2b" font-family="Arial" font-size="42">${countedLogs.length} logs with recipe nutrition</text><text x="88" y="620" fill="#183b2b" font-family="Arial" font-size="42">${Math.round(weekTotals.calories)} kcal · ${Math.round(weekTotals.protein)} g protein</text><text x="88" y="720" fill="#52665a" font-family="Arial" font-size="28">Recorded dataset estimates only. Custom meals without values are excluded.</text><text x="88" y="930" fill="#246044" font-family="Arial" font-size="32" font-weight="700">Eat smarter. Spend less. Waste less.</text></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = document.createElement("a"); link.href = url; link.download = "nutriplan-weekly-recap.svg"; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  return (
    <main className="container space-y-8 py-8">
      <header className="space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Stored only in this browser</p><h1 className="font-display text-3xl font-bold md:text-4xl">My Diet Plan</h1><p className="max-w-2xl text-muted-foreground">Saved plan results, recipe bookmarks, completion ticks, and the shopping checklist stay in this browser’s local storage. Your profile inputs are not saved.</p></header>

      {foodSwapDraft && <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary"><ArrowRightLeft className="h-4 w-4"/>FoodSwap temporary draft</p><h2 className="mt-1 font-display text-2xl font-bold">{foodSwapDraft.recipe.Name}</h2><p className="text-sm text-muted-foreground">Compared with {foodSwapDraft.baseline_name || "your selected meal"} · created {new Date(foodSwapDraft.created_at).toLocaleString()}</p></div><button type="button" onClick={discardFoodSwapDraft} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"><Trash2 className="h-4 w-4"/>Discard draft</button></div><div className="grid gap-2 text-sm sm:grid-cols-4"><Stat label="Calories / dataset serving" value={`${foodSwapDraft.recipe.Calories} kcal`}/><Stat label="Protein" value={`${foodSwapDraft.recipe.ProteinContent} g`}/><Stat label="Carbs" value={`${foodSwapDraft.recipe.CarbohydrateContent} g`}/><Stat label="Price" value={foodSwapDraft.price_inr === null ? "Unknown" : `₹${foodSwapDraft.price_inr.toFixed(2)}`}/></div><p className="text-xs text-muted-foreground">{foodSwapDraft.nutrition_note} Your current plan changes only after you confirm below. Recipe and exclusions are revalidated by the backend.</p>{draftError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{draftError}</p>}{!confirmDraft ? <button type="button" onClick={() => setConfirmDraft(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Check className="h-4 w-4"/>Review adding to My Plan</button> : <div className="rounded-xl border bg-card p-4"><p className="text-sm font-semibold">Add this recipe as a selectable “FoodSwap choice” meal in your saved plan on this device?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={savingDraft} onClick={() => void acceptFoodSwapDraft()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{savingDraft ? <Loader2 className="h-4 w-4 animate-spin"/> : <Check className="h-4 w-4"/>}{savingDraft ? "Validating…" : "Confirm & add to My Plan"}</button><button type="button" disabled={savingDraft} onClick={() => setConfirmDraft(false)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 py-2 text-sm"><X className="h-4 w-4"/>Cancel</button></div></div>}</section>}

      <section className="space-y-4 rounded-2xl border bg-card p-5 md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">My meals · local only</p><h2 className="font-display text-2xl font-bold">What I actually ate</h2><p className="text-sm text-muted-foreground">Log recipes or add a custom meal name. Nutrition is shown only when it comes from a selected recipe; no values are invented.</p></div><button type="button" onClick={() => void downloadWeekCard()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"><Download className="h-4 w-4" />Download weekly recap</button></div>
        <form onSubmit={addCustomMeal} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><label className="sr-only" htmlFor="custom-meal-name">Custom meal name</label><input id="custom-meal-name" value={customMeal} onChange={(event) => setCustomMeal(event.target.value)} maxLength={100} placeholder="Add a custom meal name (nutrition unavailable)" className="rounded-lg border bg-background px-3 py-2 text-sm"/><label className="sr-only" htmlFor="custom-meal-date">Meal date</label><input id="custom-meal-date" type="date" value={customDate} max={localDate()} onChange={(event) => setCustomDate(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm"/><button className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Log meal</button></form>
        {logError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{logError}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Meals, last 7 days" value={String(thisWeek.length)} detail="Includes custom entries"/><Stat label="Logged recipe nutrition" value={`${Math.round(weekTotals.calories)} kcal`} detail={`${Math.round(weekTotals.protein)} g protein · ${Math.round(weekTotals.carbs)} g carbs`}/><Stat label="Recipe logs with estimates" value={String(countedLogs.length)} detail="Eaten entries with dataset nutrition"/><Stat label="Recipes logged" value={String(thisWeek.reduce((total, entry) => total + entry.items.length, 0))} detail="From the recipe dataset"/></div>
        {thisWeek.length === 0 && <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">No meals logged in the last seven days. You can log a recipe from Recipe Explorer or add a custom meal name above.</p>}
        {mealLogs.length > 0 && <div className="space-y-3">{mealLogs.map((entry) => <article key={entry.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{entry.name}</h3><p className="mt-1 text-xs text-muted-foreground"><CalendarDays className="mr-1 inline h-3 w-3"/>{entry.date}{entry.nutrition_basis ? ` · ${entry.nutrition_basis}` : " · nutrition unavailable"}</p></div><div className="flex items-center gap-2"><label className="sr-only" htmlFor={`log-status-${entry.id}`}>Status for {entry.name}</label><select id={`log-status-${entry.id}`} value={entry.status} onChange={(event) => updateLog(entry.id, { status: event.target.value as MealLogStatus })} className="rounded-md border bg-background px-2 py-1.5 text-xs"><option value="eaten">Eaten</option><option value="partial">Partially eaten</option><option value="replaced">Replaced</option><option value="skipped">Skipped</option></select><button type="button" aria-label={`Delete ${entry.name} log`} onClick={() => removeLog(entry.id)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4"/></button></div></div>
          {entry.items.length > 0 ? <div className="mt-3 space-y-2">{entry.items.map((item) => <label key={item.recipe_id} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-40 flex-1">{item.name}</span><span className="text-xs text-muted-foreground">servings</span><input aria-label={`Servings of ${item.name} in ${entry.name}`} type="number" min="0.25" max="3" step="0.25" value={item.servings} onChange={(event) => { const amount = Number(event.target.value); if (amount >= 0.25 && amount <= 3) void changeLoggedServings(entry, item.recipe_id, amount); }} className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm"/></label>)}</div> : <p className="mt-3 text-xs text-muted-foreground">Custom meal name only. Add nutrition values by logging a dataset recipe when available.</p>}
          {entry.totals && <p className="mt-3 text-sm">{Math.round(entry.totals.Calories)} kcal · {Math.round(entry.totals.ProteinContent)} g protein · {Math.round(entry.totals.CarbohydrateContent)} g carbs · {Math.round(entry.totals.FatContent)} g fat {entry.status !== "eaten" ? <span className="text-xs text-muted-foreground">(not included in eaten totals)</span> : null}</p>}
        </article>)}</div>}
        <p className="text-xs text-muted-foreground">The seven-day recap includes only entries marked Eaten with recipe-backed nutrition. Custom meal names are excluded from nutrition totals. Logs are not sent to the backend account or synced to another device.</p>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-primary/5 p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Optional · local challenge</p><h2 className="font-display text-xl font-bold">Try one recipe-backed meal this week</h2><p className="text-sm text-muted-foreground">A small check-in, no streak pressure or social comparison. Progress is based only on your recipe-backed meal logs.</p>{challengeActive && <p role="status" className="mt-2 text-sm font-semibold text-primary">{countedLogs.length >= 1 ? "🥗 Badge earned: First dish logged this week" : "0/1 recipe-backed meal logged so far"}</p>}</div><button type="button" onClick={toggleChallenge} className="min-h-10 rounded-lg border bg-card px-4 py-2 text-sm font-semibold">{challengeActive ? "Leave challenge" : "Join this week"}</button></section>

      {plan?.targets && <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Daily calorie estimate" value={`${plan.targets.target_calories?.[0]}–${plan.targets.target_calories?.[1]} kcal`} />
        <Stat label="Protein target" value={`${plan.targets.protein_g_target} g`} detail={`${plan.targets.protein_g_range?.[0]}–${plan.targets.protein_g_range?.[1]} g estimated range`} />
        <Stat label="Logged from completed meals" value={`${Math.round(totals.calories)} kcal`} detail={`${Math.round(totals.protein)} g protein · ${Math.round(totals.carbs)} g carbs`} />
        <Stat label="Meal completion" value={`${complete.length}/${plan.meals.length}`} detail="Optional meal check-ins" />
      </section>}

      {plan?.meals?.length ? <section className="space-y-4">
        <div><h2 className="font-display text-2xl font-bold">Today’s meal plan</h2><p className="text-sm text-muted-foreground">Select one suggestion per meal and optionally mark it complete. Logged nutrition uses the chosen dataset estimate.</p></div>
        {selectedMeals.map(({ meal, recipe }) => <article key={meal.meal_name} className="rounded-xl border bg-card p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-xl font-semibold capitalize">{meal.meal_name}</h3><p className="text-sm text-muted-foreground">Plan share estimate: about {meal.recommended_calories} kcal</p></div><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={complete.includes(meal.meal_name)} onChange={() => markComplete(meal.meal_name)} /> Mark completed</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prepQueue.includes(meal.meal_name)} onChange={() => togglePrep(meal.meal_name)} /> Add to prep queue</label></div></div>
          {meal.recipes.length > 1 && <label className="mt-3 block max-w-xl space-y-1 text-sm">Choose a recipe<select className="w-full rounded-lg border bg-background px-3 py-2" value={recipe?.recipe_id ?? ""} onChange={(e) => updateSelection(meal.meal_name, +e.target.value)}>{meal.recipes.map((item) => <option key={item.recipe_id} value={item.recipe_id}>{item.Name} · {Math.round(item.Calories)} kcal · {Math.round(item.ProteinContent)} g protein</option>)}</select></label>}
          {recipe && <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"><div className="grid grid-cols-2 gap-2 self-start text-sm"><Stat label="Calories" value={`${Math.round(recipe.Calories)} kcal`} /><Stat label="Protein" value={`${recipe.ProteinContent} g`} /><Stat label="Carbs" value={`${recipe.CarbohydrateContent} g`} /><Stat label="Fat" value={`${recipe.FatContent} g`} /></div><RecipeTile recipe={recipe} /></div>}
        </article>)}
        <div className="grid gap-4 md:grid-cols-2"><Workout title="Pre-workout suggestions" timing={plan.pre_workout?.timing} recipes={plan.pre_workout?.recipes || []} /><Workout title="Post-workout suggestions" timing={plan.post_workout?.timing} recipes={plan.post_workout?.recipes || []} /></div>
      </section> : <section className="rounded-2xl border border-dashed p-8 text-center"><h2 className="font-display text-2xl font-semibold">No plan saved on this device yet</h2><p className="mt-2 text-muted-foreground">Build a plan and choose “Save on this device” to see your meal schedule and shopping list here.</p><Link to="/gym" className="mt-4 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Open Gym Planner</Link></section>}

      {plan?.meals?.length ? <section className="space-y-3 rounded-2xl border bg-card p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Meal Prep Buddy · saved locally</p><h2 className="font-display text-2xl font-bold">Prep queue</h2><p className="text-sm text-muted-foreground">Select meals above to build a batch-prep checklist. Listed recipe times are added together; overlap is not estimated.</p></div>{prepSelected.length ? <><ul className="space-y-2">{prepSelected.map(({ meal, recipe }) => <li key={meal.meal_name} className="rounded-lg bg-muted/50 p-3 text-sm"><strong className="capitalize">{meal.meal_name}:</strong> {recipe?.Name || "No selected recipe"} · {durationMinutes(recipe?.TotalTime)} min listed time</li>)}</ul><p className="text-sm font-semibold">Sum of listed times: {prepMinutes} min</p><p className="text-xs text-muted-foreground">Ingredients to gather: {prepIngredients.length ? prepIngredients.join(", ") : "No ingredient names available"}. Ingredient quantities are not included in the dataset.</p><button type="button" onClick={() => { setPrepQueue([]); localStorage.removeItem("nutriplan.prepQueue"); }} className="rounded-lg border px-3 py-2 text-sm">Clear prep queue</button></> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Select “Add to prep queue” on one or more planned meals to get a prep checklist.</p>}</section> : null}

      {plan?.meals?.length ? <section className="rounded-2xl border bg-card p-5"><div className="mb-4 flex items-center gap-2"><ShoppingBasket className="h-5 w-5 text-primary" /><div><h2 className="font-display text-2xl font-bold">Shopping list</h2><p className="text-sm text-muted-foreground">Unique ingredient names from the currently selected meals. Quantities aren’t present in the recipe dataset.</p></div></div>{shoppingList.length ? <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{shoppingList.map((item) => <li key={item}><label className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${checkedShopping.includes(item) ? "text-muted-foreground line-through" : ""}`}><input type="checkbox" checked={checkedShopping.includes(item)} onChange={() => toggleShopping(item)} />{item}</label></li>)}</ul> : <p className="text-sm text-muted-foreground">No ingredient list is available for the selected meals.</p>}</section> : null}

      <section className="space-y-4"><div><h2 className="font-display text-2xl font-bold">Saved recipes</h2><p className="text-sm text-muted-foreground">Bookmarks are stored locally in this browser. Recipe nutrition is dataset-reported.</p></div>{savedRecipes.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{savedRecipes.map((recipe) => <div key={recipe.recipe_id} className="space-y-2"><RecipeTile recipe={recipe} /><button type="button" onClick={() => removeSaved(recipe.recipe_id)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Trash2 className="h-4 w-4" />Remove bookmark</button></div>)}</div> : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No saved recipes yet. Bookmark recipes from Gym Planner or Recipe Explorer.</p>}</section>
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold text-primary">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>; }
function Workout({ title, timing, recipes }: { title: string; timing?: string; recipes: Recipe[] }) { return <div className="rounded-xl border bg-card p-4"><h3 className="font-display text-lg font-semibold">{title}</h3><p className="my-2 text-xs text-muted-foreground">{timing}</p>{recipes.slice(0, 1).map((recipe) => <p key={recipe.recipe_id} className="text-sm">{recipe.Name} · {Math.round(recipe.Calories)} kcal · {Math.round(recipe.ProteinContent)} g protein</p>)}</div>; }
function read<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function durationMinutes(raw?: string) { const match = raw?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/); return match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : 0; }
