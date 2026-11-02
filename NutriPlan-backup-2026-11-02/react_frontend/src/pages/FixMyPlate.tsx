import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import RecipeTile from "@/components/RecipeTile";
import { ApiError, calculateMealPlate, searchRecipes, type PlateCalculation } from "@/lib/api";
import { logRecipes } from "@/lib/mealLogs";
import type { DietaryPreference, Recipe, RecipeSearchResponse } from "@/types/recipe";

type PlateItem = { recipe: Recipe; servings: number };
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const split = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);

export default function FixMyPlate() {
  const [form, setForm] = useState({ search: "", mealNote: "", goal: "protein", diet: "omnivore" as DietaryPreference, exclusions: "", budget: "", minutes: "" });
  const [matches, setMatches] = useState<RecipeSearchResponse | null>(null);
  const [plate, setPlate] = useState<PlateItem[]>([]);
  const [calculation, setCalculation] = useState<PlateCalculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function findRecipes(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      setMatches(await searchRecipes({
        q: form.search || undefined, dietary_preference: form.diet, meal_category: "all",
        min_protein: form.goal === "protein" ? 12 : undefined,
        max_minutes: form.minutes ? Number(form.minutes) : form.goal === "quick" ? 30 : undefined,
        exclude_ingredients: split(form.exclusions), page: 1, page_size: 12,
      }));
    } catch (err) { setError(err instanceof ApiError ? `Recipe search failed (${err.status}): ${err.message}` : "Recipe search is unavailable. Check the backend connection and try again."); }
    finally { setBusy(false); }
  }

  async function recalculate(items: PlateItem[]) {
    setPlate(items); setError("");
    if (!items.length) { setCalculation(null); return; }
    try { setCalculation(await calculateMealPlate(items.map(({ recipe, servings }) => ({ recipe_id: recipe.recipe_id!, servings })))); }
    catch (err) { setCalculation(null); setError(err instanceof ApiError ? `Plate total failed (${err.status}): ${err.message}` : "Could not calculate the plate. Check the backend connection."); }
  }

  function addRecipe(recipe: Recipe) {
    if (plate.some(({ recipe: item }) => item.recipe_id === recipe.recipe_id)) { setMessage("That recipe is already on this plate."); return; }
    setMessage(""); void recalculate([...plate, { recipe, servings: 1 }]);
  }

  async function savePlate() {
    setSaving(true); setMessage(""); setError("");
    try {
      const log = await logRecipes(plate, "Meal plate", form.mealNote || undefined);
      setMessage(`Logged “${log.name}” in My Plan on this device.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not log this plate."); }
    finally { setSaving(false); }
  }

  return <main className="container space-y-7 py-8">
    <header className="max-w-3xl space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Build · Compare · Log</p><h1 className="font-display text-3xl font-bold md:text-4xl">Fix My Plate</h1><p className="text-muted-foreground">Search the recipe dataset for foods that match your meal, choose the recorded servings that actually describe your plate, then compare their reported nutrition. Your free-text note is kept as context; it is never converted into made-up numbers.</p></header>

    <form onSubmit={findRecipes} className="space-y-4 rounded-2xl border bg-card p-5 md:p-7">
      <label className="block space-y-2 text-sm font-semibold">Search a dish or ingredient from your meal<input className={inputClass} value={form.search} onChange={(event) => update("search", event.target.value)} placeholder="Try dal, tofu, oats, paneer…" /></label>
      <label className="block space-y-2 text-sm font-medium">What is actually on your plate? Optional note<textarea className={inputClass} rows={2} value={form.mealNote} onChange={(event) => update("mealNote", event.target.value)} placeholder="For example: hostel lunch — 2 rotis, dal, and aloo sabzi" /></label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium">Focus<select className={inputClass} value={form.goal} onChange={(event) => update("goal", event.target.value)}><option value="protein">Find higher-protein recipes</option><option value="balanced">Explore meal options</option><option value="quick">Keep it practical</option></select></label>
        <label className="space-y-1.5 text-sm font-medium">Diet preference<select className={inputClass} value={form.diet} onChange={(event) => update("diet", event.target.value as DietaryPreference)}><option value="vegetarian">Vegetarian, no eggs</option><option value="egg-inclusive">Egg-inclusive vegetarian</option><option value="vegan">Vegan</option><option value="omnivore">Any recipe</option></select></label>
        <label className="space-y-1.5 text-sm font-medium">Avoid ingredients<input className={inputClass} value={form.exclusions} onChange={(event) => update("exclusions", event.target.value)} placeholder="peanut, sesame…" /></label>
        <label className="space-y-1.5 text-sm font-medium">Max preparation time<input className={inputClass} type="number" min="1" max="1440" value={form.minutes} onChange={(event) => update("minutes", event.target.value)} placeholder="Any minutes" /></label>
      </div>
      <label className="block max-w-sm space-y-1.5 text-sm font-medium">Optional budget note<input className={inputClass} value={form.budget} onChange={(event) => update("budget", event.target.value)} placeholder="e.g. ₹40 extra" /></label>
      <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Budget is only a note: there are no local prices in the dataset, so results are not price-ranked. Recipe totals only include the dataset recipes and serving multipliers you select below. Mess dishes written only in the note have no nutrition estimate.</p>
      <button disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Find recipes for this plate</button>
    </form>

    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-primary/10 p-4 text-sm text-primary">{message} <Link to="/my-plan" className="font-semibold underline">Open My Plan</Link></p>}

    {matches && <section className="space-y-4"><div><h2 className="font-display text-2xl font-bold">Dataset matches</h2><p className="text-sm text-muted-foreground">{matches.total} eligible recipes · nutrition is per recorded recipe serving.</p></div>{matches.filter_notes.map((note) => <p key={note} className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{note}</p>)}{matches.items.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{matches.items.map((recipe) => <article key={recipe.recipe_id} className="space-y-2"><RecipeTile recipe={recipe} /><button type="button" onClick={() => addRecipe(recipe)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Add recorded serving to plate</button></article>)}</div> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No matches. Try a shorter search or remove a filter.</p>}</section>}

    <section className="space-y-4 rounded-2xl border bg-card p-5 md:p-7"><div><h2 className="font-display text-2xl font-bold">Your selected plate</h2><p className="text-sm text-muted-foreground">Review the serving multiplier before treating the total as representative of what you ate.</p></div>{plate.length ? <><ul className="space-y-2">{plate.map(({ recipe, servings }) => <li key={recipe.recipe_id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><span className="min-w-36 flex-1 font-medium">{recipe.Name}</span><label className="flex items-center gap-2 text-sm">Recorded servings<input aria-label={`Servings of ${recipe.Name}`} type="number" min="0.25" max="3" step="0.25" value={servings} onChange={(event) => { const value = Number(event.target.value); if (value >= 0.25 && value <= 3) void recalculate(plate.map((item) => item.recipe.recipe_id === recipe.recipe_id ? { ...item, servings: value } : item)); }} className="w-24 rounded-md border bg-background px-2 py-1.5" /></label><button type="button" aria-label={`Remove ${recipe.Name}`} onClick={() => void recalculate(plate.filter((item) => item.recipe.recipe_id !== recipe.recipe_id))} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4" /></button></li>)}</ul>{calculation && <><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Calories", `${calculation.totals.Calories} kcal`], ["Protein", `${calculation.totals.ProteinContent} g`], ["Carbohydrates", `${calculation.totals.CarbohydrateContent} g`], ["Fat", `${calculation.totals.FatContent} g`]].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}</div><p className="text-xs text-muted-foreground">Nutrition source: {calculation.nutrition_basis}. {calculation.limitations.join(" ")}</p></>}<button disabled={saving || !calculation} onClick={() => void savePlate()} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Log this plate on this device"}</button></> : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Search for a recipe above and add it to build a dataset-backed plate total.</p>}</section>
  </main>;
}
