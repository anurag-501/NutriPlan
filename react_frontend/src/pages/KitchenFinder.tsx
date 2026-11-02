import { FormEvent, useState } from "react";
import { Loader2, Search } from "lucide-react";
import RecipeTile from "@/components/RecipeTile";
import { ApiError, searchRecipes } from "@/lib/api";
import type { DietaryPreference, Recipe, RecipeSearchFilters } from "@/types/recipe";

type Match = { recipe: Recipe; matched: string[]; missing: string[] };
const split = (raw: string) => raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default function KitchenFinder() {
  const [ingredients, setIngredients] = useState("");
  const [diet, setDiet] = useState<DietaryPreference>("omnivore");
  const [minutes, setMinutes] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [servings, setServings] = useState("1");
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function find(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSearched(true);
    const terms = split(ingredients).slice(0, 6);
    if (!terms.length) { setError("Enter at least one ingredient you have on hand."); setMatches([]); setBusy(false); return; }
    const common: Omit<RecipeSearchFilters, "q"> = {
      dietary_preference: diet, max_minutes: minutes ? Number(minutes) : undefined,
      exclude_ingredients: split(exclusions), page: 1, page_size: 12, portion_multiplier: Number(servings),
    };
    try {
      const responses = await Promise.all(terms.map((term) => searchRecipes({ ...common, q: term })));
      const unique = new Map<number, Recipe>();
      responses.flatMap((response) => response.items).forEach((recipe) => { if (recipe.recipe_id) unique.set(recipe.recipe_id, recipe); });
      const ranked = [...unique.values()].map((recipe) => {
        const searchable = [recipe.Name, ...recipe.RecipeIngredientParts].join(" ").toLowerCase();
        const matched = terms.filter((term) => searchable.includes(term));
        return { recipe, matched, missing: terms.filter((term) => !matched.includes(term)) };
      }).filter((item) => item.matched.length > 0)
        .sort((a, b) => b.matched.length - a.matched.length || b.recipe.ProteinContent - a.recipe.ProteinContent);
      setMatches(ranked.slice(0, 18));
    } catch (err) {
      setMatches([]);
      setError(err instanceof ApiError ? `Recipe search failed (${err.status}): ${err.message}` : "Could not reach recipe search. Check that the backend is running.");
    } finally { setBusy(false); }
  }

  return <main className="container space-y-7 py-8">
    <header className="max-w-3xl space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Use what you have · waste less</p><h1 className="font-display text-3xl font-bold md:text-4xl">What’s in My Kitchen?</h1><p className="text-muted-foreground">Enter ingredients you have confirmed. We search the existing recipe dataset and rank results by how many ingredient names appear in each recipe.</p></header>
    <form onSubmit={find} className="space-y-4 rounded-2xl border bg-card p-5 md:p-7">
      <label className="block space-y-2 text-sm font-semibold">Ingredients on hand, separated by commas<textarea className={inputClass} rows={3} value={ingredients} onChange={(event) => setIngredients(event.target.value)} placeholder="e.g. oats, banana, milk, peanut butter" maxLength={300}/></label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium">Diet preference<select className={inputClass} value={diet} onChange={(event) => setDiet(event.target.value as DietaryPreference)}><option value="vegetarian">Vegetarian, no eggs</option><option value="egg-inclusive">Egg-inclusive vegetarian</option><option value="vegan">Vegan</option><option value="omnivore">Any recipe</option></select></label>
        <label className="space-y-1.5 text-sm font-medium">Max prep time<input className={inputClass} type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="Any time"/></label>
        <label className="space-y-1.5 text-sm font-medium">Exclude ingredients<input className={inputClass} value={exclusions} onChange={(event) => setExclusions(event.target.value)} placeholder="peanut, sesame"/></label>
        <label className="space-y-1.5 text-sm font-medium">Nutrition serving multiplier<select className={inputClass} value={servings} onChange={(event) => setServings(event.target.value)}><option value="0.5">½ serving</option><option value="1">1 serving</option><option value="1.5">1½ servings</option><option value="2">2 servings</option></select></label>
      </div>
      <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Ingredient matching uses recipe text, not exact pantry quantities; results may include missing ingredients listed below. Allergies need full label checks: dataset screening can miss ambiguous names and does not cover cross-contact. No photo-based ingredient detection or price data is configured.</p>
      <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}Find matching recipes</button>
    </form>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
    {busy && <p className="text-sm text-muted-foreground">Searching the recipe dataset…</p>}
    {searched && !busy && !error && <section className="space-y-4"><div><h2 className="font-display text-2xl font-bold">{matches.length} recipe matches</h2><p className="text-sm text-muted-foreground">Showing recipes with at least one listed ingredient in common. Ingredient names are text matches, not a guarantee that every ingredient is in stock.</p></div>{matches.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{matches.map(({ recipe, matched, missing }) => <article key={recipe.recipe_id} className="space-y-2"><RecipeTile recipe={recipe} badge={`${matched.length}/${split(ingredients).length} ingredient names found`}/><div className="rounded-lg bg-muted/50 p-3 text-xs"><p><strong>Matched:</strong> {matched.join(", ") || "None"}</p><p className="mt-1"><strong>Missing from this recipe text:</strong> {missing.length ? missing.join(", ") : "None of your entered ingredients"}</p><p className="mt-1 text-muted-foreground">The recipe may also need ingredients you did not enter.</p></div></article>)}</div> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No matching dataset recipes found. Try common ingredient names or fewer exclusions.</p>}</section>}
    <p className="text-xs text-muted-foreground">Nutrition is reported from the bundled Food.com recipe dataset per recorded serving. Quantities, preparation yield, and ingredient-level nutrition are not available.</p>
  </main>;
}
