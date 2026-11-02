import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Loader2, Plus, Scale, Trash2 } from "lucide-react";
import RecipeCard from "@/components/RecipeCard";
import { ApiError, applyChatPlanAction, compareFoodSwap, searchRecipes, type FoodSwapInput, type FoodSwapPrice, type FoodSwapResponse } from "@/lib/api";
import { localDate } from "@/lib/mealLogs";
import type { DietaryPreference, Recipe, RecipeSearchResponse } from "@/types/recipe";
import type { FoodSwapPlanDraft } from "@/types/foodswap";

const DRAFT_KEY = "nutriplan.foodSwapDraft";
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const split = (raw: string) => raw.split(",").map((value) => value.trim()).filter(Boolean);
type MealItem = { recipe: Recipe; servings: number };
type PriceDraft = { cost: string; source: string; checked_on: string };

export default function FoodSwap() {
  const [form, setForm] = useState({ query: "", diet: "omnivore" as DietaryPreference, exclusions: "", available: "", priority: "balanced" as FoodSwapInput["priority"], budget: "", protein: "", calories: "", minutes: "" });
  const [searchResults, setSearchResults] = useState<RecipeSearchResponse | null>(null);
  const [meal, setMeal] = useState<MealItem[]>([]);
  const [comparison, setComparison] = useState<FoodSwapResponse | null>(null);
  const [prices, setPrices] = useState<Record<number, PriceDraft>>({});
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comparisonError, setComparisonError] = useState("");

  const exclusions = useMemo(() => split(form.exclusions), [form.exclusions]);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value })); setComparison(null);
  }

  async function searchCurrentMeal(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      setSearchResults(await searchRecipes({ q: form.query || undefined, dietary_preference: form.diet, exclude_ingredients: exclusions, page: 1, page_size: 12 }));
    } catch (err) { setError(err instanceof ApiError ? `Recipe search failed (${err.status}): ${err.message}` : "Could not reach recipe search. Check that the backend is running."); }
    finally { setBusy(false); }
  }

  function addCurrentRecipe(recipe: Recipe) {
    if (!recipe.recipe_id) return;
    const existing = meal.find((item) => item.recipe.recipe_id === recipe.recipe_id);
    if (existing) {
      setMeal((items) => items.map((item) => item.recipe.recipe_id === recipe.recipe_id ? { ...item, servings: Math.min(3, item.servings + 0.25) } : item));
    } else setMeal((items) => [...items, { recipe, servings: 1 }]);
    setComparison(null); setMessage("");
  }

  function priceList(): FoodSwapPrice[] {
    return Object.entries(prices).flatMap(([recipeId, value]) => {
      const cost = Number(value.cost);
      return Number.isFinite(cost) && cost > 0 && value.source.trim().length >= 3 && value.checked_on
        ? [{ recipe_id: Number(recipeId), cost_inr: cost, source: value.source.trim(), checked_on: value.checked_on }]
        : [];
    });
  }

  async function compare(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError(""); setMessage(""); setComparisonError("");
    try {
      const input: FoodSwapInput = {
        current_meal: meal.map(({ recipe, servings }) => ({ recipe_id: recipe.recipe_id!, servings })),
        dietary_preference: form.diet, exclusions, available_ingredients: split(form.available),
        priority: form.priority, prices: priceList(), result_limit: 6,
        ...(form.budget !== "" ? { budget_inr: Number(form.budget) } : {}),
        ...(form.protein !== "" ? { minimum_protein_g: Number(form.protein) } : {}),
        ...(form.calories !== "" ? { maximum_calories: Number(form.calories) } : {}),
        ...(form.minutes !== "" ? { maximum_minutes: Number(form.minutes) } : {}),
      };
      const result = await compareFoodSwap(input);
      setComparison(result);
      setPrices((current) => {
        const next = { ...current };
        for (const alternative of result.alternatives) {
          if (!(alternative.recipe_id in next)) next[alternative.recipe_id] = { cost: "", source: "", checked_on: localDate() };
        }
        for (const item of meal) {
          const id = item.recipe.recipe_id!;
          if (!(id in next)) next[id] = { cost: "", source: "", checked_on: localDate() };
        }
        return next;
      });
    } catch (err) { setComparisonError(err instanceof ApiError ? `FoodSwap failed (${err.status}): ${err.message}` : "FoodSwap is unavailable. Check the backend connection and retry."); }
    finally { setBusy(false); }
  }

  function updatePrice(recipeId: number, field: keyof PriceDraft, value: string) {
    setPrices((current) => ({ ...current, [recipeId]: { cost: "", source: "", checked_on: localDate(), ...current[recipeId], [field]: value } }));
  }

  async function addToDraft(alternative: FoodSwapResponse["alternatives"][number]) {
    setSavingId(alternative.recipe_id); setError(""); setMessage("");
    try {
      const validated = await applyChatPlanAction({
        action: "add", recipe_id: alternative.recipe_id, meal_name: "FoodSwap choice",
        dietary_preference: form.diet, allergies: exclusions, disliked_foods: [], current_meals: [],
      });
      const checkedRecipe = validated.meals.flatMap((group) => group.recipes).find((recipe) => recipe.recipe_id === alternative.recipe_id);
      if (!checkedRecipe) throw new Error("Backend validation did not return the selected recipe.");
      const draft: FoodSwapPlanDraft = {
        recipe: checkedRecipe, dietary_preference: form.diet, exclusions,
        baseline_name: meal.map((item) => item.recipe.Name).join(" + "), created_at: new Date().toISOString(),
        nutrition_note: validated.nutrition_note, price_inr: alternative.cost_inr,
      };
      if (localStorage.getItem(DRAFT_KEY) && !window.confirm("Replace the existing FoodSwap draft on this device?")) return;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      window.dispatchEvent(new Event("nutriplan:updated"));
      setMessage(`${checkedRecipe.Name} was checked by the backend and added to a temporary plan draft. Open My Plan to review it.`);
    } catch (err) { setError(err instanceof ApiError ? `Plan validation failed (${err.status}): ${err.message}` : err instanceof Error ? err.message : "Could not create the plan draft."); }
    finally { setSavingId(null); }
  }

  return <main className="container space-y-8 py-8 pb-24 md:pb-10">
    <header className="max-w-3xl space-y-3"><p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"><Scale className="h-4 w-4"/>FOODSWAP · compare with context</p><h1 className="font-display text-3xl font-bold md:text-4xl">Make a meal swap that makes sense</h1><p className="text-muted-foreground">Start with recipes that describe your current meal. FoodSwap ranks real alternatives using the priorities, ingredients, and constraints you choose.</p></header>

    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
      <form onSubmit={searchCurrentMeal} className="space-y-4 rounded-2xl border bg-card p-5 md:p-6">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Step 1</p><h2 className="font-display text-2xl font-semibold">Build your current meal</h2><p className="text-sm text-muted-foreground">Use dataset recipes that reasonably represent what you ate; serving quantities are approximate multipliers.</p></div>
        <label className="block space-y-1.5 text-sm font-medium">Search a dish or ingredient<input className={inputClass} value={form.query} onChange={(event) => update("query", event.target.value)} placeholder="Try dal, paneer, oats, chicken…" maxLength={100}/></label>
        <div className="flex gap-2"><button disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4"/>Search recipe data</button><button type="button" onClick={() => { setMeal([]); setComparison(null); }} className="rounded-lg border px-3 py-2 text-sm">Clear meal</button></div>
        {searchResults && <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">{searchResults.items.map((recipe) => <article key={recipe.recipe_id} className="space-y-2 rounded-xl border p-3"><RecipeCard recipe={recipe}/><button type="button" onClick={() => addCurrentRecipe(recipe)} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary"><Plus className="h-4 w-4"/>Add to current meal</button></article>)}{!searchResults.items.length && <p className="rounded-lg bg-muted p-3 text-sm">No matches. Try a shorter term or change your dietary preference.</p>}</div>}
        {meal.length > 0 && <div className="space-y-2 border-t pt-4"><h3 className="font-semibold">Current meal items</h3>{meal.map(({ recipe, servings }) => <div key={recipe.recipe_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3"><span className="min-w-32 flex-1 text-sm font-medium">{recipe.Name}</span><label className="text-xs">Recorded servings<input aria-label={`Servings of ${recipe.Name}`} className="ml-2 w-20 rounded-md border bg-background px-2 py-1.5 text-sm" type="number" min="0.25" max="3" step="0.25" value={servings} onChange={(event) => { const amount = Number(event.target.value); if (amount >= 0.25 && amount <= 3) { setMeal((items) => items.map((item) => item.recipe.recipe_id === recipe.recipe_id ? { ...item, servings: amount } : item)); setComparison(null); } }}/></label><button type="button" aria-label={`Remove ${recipe.Name}`} onClick={() => { setMeal((items) => items.filter((item) => item.recipe.recipe_id !== recipe.recipe_id)); setComparison(null); }} className="rounded-md p-2 hover:bg-background"><Trash2 className="h-4 w-4"/></button><PriceFields recipeId={recipe.recipe_id!} value={prices[recipe.recipe_id!] ?? { cost: "", source: "", checked_on: localDate() }} onChange={updatePrice}/></div>)}</div>}
      </form>

      <form onSubmit={compare} className="h-fit space-y-4 rounded-2xl border bg-card p-5 md:p-6">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Step 2</p><h2 className="font-display text-2xl font-semibold">Choose what matters</h2><p className="text-sm text-muted-foreground">Your comparison filters apply to alternatives. Cost only uses prices you enter with a source and date.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium">Diet preference<select className={inputClass} value={form.diet} onChange={(event) => update("diet", event.target.value as DietaryPreference)}><option value="omnivore">Any recipe</option><option value="vegetarian">Vegetarian, no eggs</option><option value="egg-inclusive">Egg-inclusive vegetarian</option><option value="vegan">Vegan</option></select></label>
          <label className="space-y-1.5 text-sm font-medium">Ranking priority<select className={inputClass} value={form.priority} onChange={(event) => update("priority", event.target.value as FoodSwapInput["priority"])}><option value="balanced">Balanced trade-offs</option><option value="higher_protein">More protein</option><option value="lower_calories">Fewer calories</option><option value="lower_cost">Lower user-entered cost</option></select></label>
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Avoid ingredients / allergens<input className={inputClass} value={form.exclusions} onChange={(event) => update("exclusions", event.target.value)} placeholder="e.g. peanut, sesame"/></label>
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Ingredients available to you<input className={inputClass} value={form.available} onChange={(event) => update("available", event.target.value)} placeholder="e.g. rice, yogurt, spinach"/></label>
          <label className="space-y-1.5 text-sm font-medium">Meal budget (₹)<input className={inputClass} type="number" min="0" max="50000" step="1" value={form.budget} onChange={(event) => update("budget", event.target.value)} placeholder="Optional"/></label>
          <label className="space-y-1.5 text-sm font-medium">Minimum protein (g)<input className={inputClass} type="number" min="0" max="500" value={form.protein} onChange={(event) => update("protein", event.target.value)} placeholder="Any"/></label>
          <label className="space-y-1.5 text-sm font-medium">Maximum calories<input className={inputClass} type="number" min="0" max="5000" value={form.calories} onChange={(event) => update("calories", event.target.value)} placeholder="Any"/></label>
          <label className="space-y-1.5 text-sm font-medium">Maximum total time<input className={inputClass} type="number" min="1" max="1440" value={form.minutes} onChange={(event) => update("minutes", event.target.value)} placeholder="Any minutes"/></label>
        </div>
        <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">FoodSwap uses a documented weighted percentile score across protein, calorie fit, preparation time, user-listed ingredients, and user-entered cost. Ingredient text matching and diet screening are heuristic; inspect recipes and food labels.</p>
        <button disabled={busy || meal.length === 0} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <ArrowRightLeft className="h-4 w-4"/>}Compare meal alternatives</button>
        {meal.length === 0 && <p className="text-xs text-muted-foreground">Add at least one dataset recipe in Step 1 to start a comparison.</p>}
      </form>
    </section>

    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-primary/10 p-4 text-sm text-primary">{message} <Link to="/my-plan" className="font-semibold underline">Review in My Plan</Link></p>}
    {comparisonError && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{comparisonError}</p>}

    {comparison && <section className="space-y-5" aria-live="polite">
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]"><article className="rounded-2xl border bg-card p-5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your current meal</p><h2 className="mt-1 font-display text-xl font-bold">{comparison.current_meal.items.map((item) => item.recipe.Name).join(" + ")}</h2><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Summary label="Calories" value={`${comparison.current_meal.totals.Calories} kcal`}/><Summary label="Protein" value={`${comparison.current_meal.totals.ProteinContent} g`}/><Summary label="Carbs" value={`${comparison.current_meal.totals.CarbohydrateContent} g`}/><Summary label="Fat" value={`${comparison.current_meal.totals.FatContent} g`}/></div><p className="mt-3 text-sm">Meal cost: {comparison.current_meal.cost_inr === null ? "not entered" : `₹${comparison.current_meal.cost_inr.toFixed(2)}`}</p>{comparison.current_meal.warnings.map((warning) => <p key={warning} className="mt-2 rounded-md bg-amber-100 p-2 text-xs text-amber-900">{warning}</p>)}</article><div className="space-y-3 rounded-2xl border bg-card p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Step 3</p><h2 className="font-display text-2xl font-bold">Swap options</h2><p className="text-sm text-muted-foreground">{comparison.eligible_count} recipes met hard constraints; ranked by {comparison.ranking_priority.replaceAll("_", " ")}.</p></div><button type="button" disabled={busy} onClick={() => void compare()} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">{busy ? "Updating…" : "Recalculate ranking"}</button></div></div></div>
      {comparison.notes.map((note) => <p key={note} className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{note}</p>)}
      {comparison.alternatives.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{comparison.alternatives.map((alternative) => <article key={alternative.recipe_id} className="space-y-3 rounded-2xl border bg-card p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Match score {alternative.score}/100</p><h3 className="mt-1 font-display text-xl font-semibold">{alternative.recipe.Name}</h3></div><span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">#{comparison.alternatives.indexOf(alternative) + 1}</span></div><div className="grid grid-cols-2 gap-2 text-xs"><Summary label="Calories / serving" value={`${alternative.recipe.Calories} kcal`}/><Summary label="Protein / serving" value={`${alternative.recipe.ProteinContent} g`}/><Summary label="Total prep" value={alternative.prep_minutes === null ? "Unavailable" : `${alternative.prep_minutes} min`}/><Summary label="Cost / serving" value={alternative.cost_inr === null ? "Unknown" : `₹${alternative.cost_inr.toFixed(2)}`}/></div>{alternative.budget_status === false ? <p className="rounded-md bg-amber-100 p-2 text-xs text-amber-900">Over the entered budget.</p> : alternative.budget_status === null && form.budget ? <p className="rounded-md bg-amber-100 p-2 text-xs text-amber-900">Budget fit unknown until you enter a checked price.</p> : null}<p className="text-sm text-muted-foreground">{alternative.tradeoffs}</p>{form.available && <p className="text-xs"><strong>Available matches:</strong> {alternative.matched_ingredients.join(", ") || "None"} · <strong>Missing:</strong> {alternative.missing_available_ingredients.join(", ") || "none listed"}</p>}<RecipeCard recipe={alternative.recipe}/><PriceFields recipeId={alternative.recipe_id} value={prices[alternative.recipe_id] ?? { cost: "", source: "", checked_on: localDate() }} onChange={updatePrice}/><button type="button" disabled={savingId !== null} onClick={() => void addToDraft(alternative)} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{savingId === alternative.recipe_id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Plus className="h-4 w-4"/>}Add to temporary diet plan draft</button></article>)}</div> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No alternatives passed the current filters. Try relaxing a constraint or changing priorities.</p>}
      <p className="text-xs text-muted-foreground">Source: {comparison.nutrition_source}. Cost and price date come from your own entry and are sent only with this request; the app does not verify or retain them on the backend.</p>
    </section>}
  </main>;
}

function PriceFields({ recipeId, value, onChange }: { recipeId: number; value: PriceDraft; onChange: (id: number, field: keyof PriceDraft, value: string) => void }) {
  return <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-xs font-semibold">Add price you checked (optional)</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs">INR per recorded serving<input className={inputClass} type="number" min="0.01" max="5000" step="0.01" value={value.cost} onChange={(event) => onChange(recipeId, "cost", event.target.value)} placeholder="Leave blank if unknown"/></label><label className="space-y-1 text-xs">Where did you check it?<input className={inputClass} value={value.source} onChange={(event) => onChange(recipeId, "source", event.target.value)} maxLength={120} placeholder="Mess menu / canteen board"/></label><label className="space-y-1 text-xs sm:col-span-2">Checked on<input className={inputClass} type="date" value={value.checked_on} onChange={(event) => onChange(recipeId, "checked_on", event.target.value)}/></label></div></details>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/60 p-2.5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
