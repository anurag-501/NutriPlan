import { FormEvent, useState } from "react";
import { Loader2, Search, Shuffle, Sparkles } from "lucide-react";
import RecipeTile from "@/components/RecipeTile";
import CookAlongDialog from "@/components/CookAlongDialog";
import { searchRecipes, ApiError } from "@/lib/api";
import type { DietaryPreference, Recipe, RecipeSearchFilters, RecipeSearchResponse } from "@/types/recipe";

const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";
const split = (raw: string) => raw.split(",").map((v) => v.trim()).filter(Boolean);

type ExplorerForm = { query: string; diet: DietaryPreference; category: string; minCalories: string; maxCalories: string; protein: string; density: string; minutes: string; include: string; exclude: string; cuisine: string; budget: string; portion: string };
function buildFilters(form: ExplorerForm, page: number): RecipeSearchFilters {
  return {
    q: form.query || undefined, dietary_preference: form.diet,
    meal_category: form.category as RecipeSearchFilters["meal_category"],
    min_calories: form.minCalories ? Number(form.minCalories) : undefined,
    max_calories: form.maxCalories ? Number(form.maxCalories) : undefined,
    min_protein: form.protein ? Number(form.protein) : undefined,
    min_protein_per_100_calories: form.density ? Number(form.density) : undefined,
    max_minutes: form.minutes ? Number(form.minutes) : undefined,
    include_ingredients: split(form.include), exclude_ingredients: split(form.exclude),
    cuisine: form.cuisine || undefined, budget: form.budget || undefined,
    page, page_size: 12, portion_multiplier: Number(form.portion),
  };
}

export default function RecipeExplorer() {
  const [form, setForm] = useState({ query: "", diet: "omnivore" as DietaryPreference, category: "all", minCalories: "", maxCalories: "", protein: "", density: "", minutes: "", include: "", exclude: "", cuisine: "", budget: "", portion: "1" });
  const [result, setResult] = useState<RecipeSearchResponse | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discoveryLabel, setDiscoveryLabel] = useState("");
  const [cookRecipe, setCookRecipe] = useState<Recipe | null>(null);
  const [quiz, setQuiz] = useState({ diet: "omnivore" as DietaryPreference, time: "30", craving: "curious" });
  const [quizLabel, setQuizLabel] = useState("");
  const pageSize = 12;
  function update(key: keyof typeof form, value: string) { setForm((old) => ({ ...old, [key]: value })); }

  async function search(event?: FormEvent, requestedPage = 1) {
    event?.preventDefault(); setBusy(true); setError(""); setPage(requestedPage);
    setDiscoveryLabel("");
    try {
      setResult(await searchRecipes(buildFilters(form, requestedPage)));
    } catch (err) { setError(err instanceof ApiError ? `API ${err.status}: ${err.message}` : "Could not reach the recipe service. Check that the backend is running."); }
    finally { setBusy(false); }
  }

  async function runMood(label: string, overrides: Partial<ExplorerForm>) {
    const next = { ...form, ...overrides }; setForm(next); setBusy(true); setError(""); setPage(1); setDiscoveryLabel(label);
    try { setResult(await searchRecipes(buildFilters(next, 1))); }
    catch (err) { setError(err instanceof ApiError ? `API ${err.status}: ${err.message}` : "Could not reach the recipe service. Check that the backend is running."); }
    finally { setBusy(false); }
  }

  async function surpriseMe() {
    setBusy(true); setError(""); setPage(1); setDiscoveryLabel("Surprise My Plate");
    try {
      const eligible = await searchRecipes({ ...buildFilters(form, 1), page_size: 48 });
      if (!eligible.items.length) { setResult(eligible); setError("No recipes match the current filters. Adjust them, then try again."); return; }
      const choice = eligible.items[Math.floor(Math.random() * eligible.items.length)];
      setResult({ ...eligible, items: [choice], total: 1, page_size: 1 });
    } catch (err) { setError(err instanceof ApiError ? `API ${err.status}: ${err.message}` : "Could not reach the recipe service. Check that the backend is running."); }
    finally { setBusy(false); }
  }

  async function findMyFoodPersonality() {
    const label = quiz.craving === "protein" ? "Protein Planner" : quiz.craving === "comfort" ? "Comfort Seeker" : Number(quiz.time) <= 15 ? "Quick-Start Cook" : quiz.diet === "vegetarian" || quiz.diet === "vegan" ? "Plant-Forward Explorer" : "Curious Taster";
    const overrides: Partial<ExplorerForm> = { diet: quiz.diet, minutes: quiz.time === "any" ? "" : quiz.time };
    if (quiz.craving === "protein") overrides.protein = "15";
    if (quiz.craving === "comfort") overrides.query = "soup";
    setQuizLabel(label);
    localStorage.setItem("nutriplan.foodPersonality", JSON.stringify({ label, selected_at: new Date().toISOString(), preferences: quiz }));
    await runMood(`Your food style · ${label}`, overrides);
  }

  function saveRecipe(recipe: Recipe) {
    const saved: Recipe[] = JSON.parse(localStorage.getItem("nutriplan.savedRecipes") || "[]");
    if (!saved.some((item) => item.recipe_id === recipe.recipe_id)) {
      localStorage.setItem("nutriplan.savedRecipes", JSON.stringify([...saved, recipe]));
      window.dispatchEvent(new Event("nutriplan:updated"));
    }
  }

  return (
    <main className="container space-y-7 py-8">
      <header className="max-w-3xl space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Search · Compare · Save</p><h1 className="font-display text-3xl font-bold md:text-4xl">Recipe Explorer</h1><p className="text-muted-foreground">Filter recipes by nutrition, ingredients, diet preference, cooking time, and meal type. Search uses the bundled recipe data and shows its reported nutrition values.</p></header>

      <section className="grid gap-5 rounded-2xl border bg-card p-5 md:grid-cols-[0.8fr_1.2fr] md:p-6"><div><p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-4 w-4"/>Food personality · just for fun</p><h2 className="mt-1 font-display text-2xl font-bold">What kind of food day are you having?</h2><p className="mt-2 text-sm text-muted-foreground">A light preference quiz that searches actual recipes. It is not a nutrition or personality assessment, and results stay in this browser.</p>{quizLabel && <p className="mt-3 rounded-lg bg-primary/10 p-3 text-sm font-semibold text-primary">Latest snapshot: {quizLabel}</p>}</div><div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1.5 text-sm font-medium">Food preference<select className={inputClass} value={quiz.diet} onChange={(event) => setQuiz((old) => ({ ...old, diet: event.target.value as DietaryPreference }))}><option value="omnivore">Any recipe</option><option value="vegetarian">Vegetarian, no eggs</option><option value="egg-inclusive">Egg-inclusive</option><option value="vegan">Vegan</option></select></label><label className="space-y-1.5 text-sm font-medium">Time today<select className={inputClass} value={quiz.time} onChange={(event) => setQuiz((old) => ({ ...old, time: event.target.value }))}><option value="15">Up to 15 min</option><option value="30">Up to 30 min</option><option value="any">No time limit</option></select></label><label className="space-y-1.5 text-sm font-medium">Craving<select className={inputClass} value={quiz.craving} onChange={(event) => setQuiz((old) => ({ ...old, craving: event.target.value }))}><option value="curious">Something new</option><option value="protein">More protein</option><option value="comfort">Comforting soup</option></select></label></div><button type="button" disabled={busy} onClick={() => void findMyFoodPersonality()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Sparkles className="h-4 w-4"/>Find my food style and recipes</button></div></section>

      <section className="space-y-3 rounded-2xl border bg-card p-5"><div><h2 className="font-display text-xl font-semibold">Find a meal for the moment</h2><p className="text-sm text-muted-foreground">Quick discovery presets search the same recipe dataset; they are not nutrition or mood classifications.</p></div><div className="flex flex-wrap gap-2">{[["Gym day", { protein: "15" }], ["Five-minute idea", { minutes: "5" }], ["Exam week", { minutes: "20" }], ["Lazy cooking", { minutes: "30" }], ["Comfort food · soup", { query: "soup" }], ["Refreshing · smoothie", { query: "smoothie" }]].map(([label, filters]) => <button key={label as string} type="button" onClick={() => void runMood(label as string, filters as Partial<ExplorerForm>)} className="rounded-full border px-3 py-2 text-sm font-medium hover:border-primary hover:bg-primary/5">{label as string}</button>)}<button type="button" disabled={busy} onClick={() => void surpriseMe()} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Shuffle className="h-4 w-4"/>Surprise My Plate</button></div><p className="text-xs text-muted-foreground">Use the filters below to constrain the surprise. Budget can be entered as a note, but prices are not in this dataset and aren’t used to rank results.</p></section>

      <form onSubmit={(event) => search(event, 1)} className="space-y-5 rounded-2xl border bg-card p-5 md:p-7" style={{ boxShadow: "var(--shadow-card)" }}>
        <label className="block space-y-2 text-sm font-semibold">Recipe or ingredient search<div className="flex gap-2"><input className={inputClass} value={form.query} onChange={(e) => update("query", e.target.value)} placeholder="Try oats, paneer, tofu, dal…" /><button className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Search className="h-4 w-4" />Search</button></div></label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5 text-sm font-medium">Diet preference<select className={inputClass} value={form.diet} onChange={(e) => update("diet", e.target.value)}><option value="vegetarian">Vegetarian, no eggs</option><option value="egg-inclusive">Egg-inclusive vegetarian</option><option value="vegan">Vegan</option><option value="omnivore">Any recipe</option></select></label>
          <label className="space-y-1.5 text-sm font-medium">Meal type<select className={inputClass} value={form.category} onChange={(e) => update("category", e.target.value)}><option value="all">All meal types</option><option value="breakfast">Breakfast</option><option value="main meal">Lunch / dinner</option><option value="snack">Snack</option></select></label>
          <label className="space-y-1.5 text-sm font-medium">Min calories<input className={inputClass} type="number" min="0" value={form.minCalories} onChange={(e) => update("minCalories", e.target.value)} placeholder="Any" /></label>
          <label className="space-y-1.5 text-sm font-medium">Max calories<input className={inputClass} type="number" min="0" value={form.maxCalories} onChange={(e) => update("maxCalories", e.target.value)} placeholder="Any" /></label>
          <label className="space-y-1.5 text-sm font-medium">Minimum protein (g)<input className={inputClass} type="number" min="0" value={form.protein} onChange={(e) => update("protein", e.target.value)} placeholder="Any" /></label>
          <label className="space-y-1.5 text-sm font-medium">Min protein / 100 kcal<input className={inputClass} type="number" min="0" step="0.1" value={form.density} onChange={(e) => update("density", e.target.value)} placeholder="Any" /></label>
          <label className="space-y-1.5 text-sm font-medium">Max cook time (min)<input className={inputClass} type="number" min="1" value={form.minutes} onChange={(e) => update("minutes", e.target.value)} placeholder="Any" /></label>
          <label className="space-y-1.5 text-sm font-medium">Nutrition portion multiplier<select className={inputClass} value={form.portion} onChange={(e) => update("portion", e.target.value)}><option value="0.5">½ serving</option><option value="0.75">¾ serving</option><option value="1">1 serving</option><option value="1.25">1¼ servings</option><option value="1.5">1½ servings</option><option value="2">2 servings</option></select></label>
          <label className="space-y-1.5 text-sm font-medium lg:col-span-2">Ingredients to include (comma-separated)<input className={inputClass} value={form.include} onChange={(e) => update("include", e.target.value)} placeholder="tofu, spinach" /></label>
          <label className="space-y-1.5 text-sm font-medium lg:col-span-2">Allergens / exclusions (comma-separated)<input className={inputClass} value={form.exclude} onChange={(e) => update("exclude", e.target.value)} placeholder="peanut, sesame" /></label>
          <label className="space-y-1.5 text-sm font-medium">Cuisine keyword<input className={inputClass} value={form.cuisine} onChange={(e) => update("cuisine", e.target.value)} placeholder="Optional text match" /></label>
          <label className="space-y-1.5 text-sm font-medium">Budget preference<input className={inputClass} value={form.budget} onChange={(e) => update("budget", e.target.value)} placeholder="Optional; no price data" /></label>
        </div>
        <p className="text-xs text-muted-foreground">Cuisine filtering is a text match because the dataset has no cuisine field. Budget can’t be applied because recipe prices aren’t included. Portion changes scale nutrition estimates only; this dataset has no ingredient gram quantities to scale.</p>
      </form>

      {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching recipes…</div>}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-destructive">{error}</p>}
      {result && <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3"><div>{discoveryLabel && <p className="text-xs font-semibold uppercase tracking-wider text-primary">{discoveryLabel}</p>}<h2 className="font-display text-2xl font-bold">{result.total.toLocaleString()} matches</h2><p className="text-sm text-muted-foreground">Page {result.page} · nutrition is dataset-reported per recorded serving</p></div><div className="flex gap-2"><button disabled={page <= 1 || busy} onClick={() => search(undefined, page - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Previous</button><button disabled={page * pageSize >= result.total || busy} onClick={() => search(undefined, page + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Next</button>{discoveryLabel === "Surprise My Plate" && <button disabled={busy} onClick={() => void surpriseMe()} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"><Shuffle className="h-4 w-4"/>Reroll</button>}</div></div>
        {result.filter_notes.map((note) => <p key={note} className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{note}</p>)}
        {result.items.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{result.items.map((recipe) => <RecipeTile key={recipe.recipe_id} recipe={recipe} onSave={saveRecipe} onCook={setCookRecipe} badge={`${recipe.protein_per_100_calories ?? 0} g protein / 100 kcal`} />)}</div> : <p className="rounded-xl border p-8 text-center text-muted-foreground">No recipes match all selected filters. Try widening the ranges or removing an exclusion.</p>}
      </section>}
      {cookRecipe && <CookAlongDialog recipe={cookRecipe} onClose={() => setCookRecipe(null)} />}
    </main>
  );
}
