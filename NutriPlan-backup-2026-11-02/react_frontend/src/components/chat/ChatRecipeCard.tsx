import { useState } from "react";
import { ArrowRightLeft, BookOpenCheck, LoaderCircle, Plus } from "lucide-react";
import type { ChatRecipe } from "@/types/chat";
import type { GymPlan } from "@/types/recipe";
import { youtubeSearchUrl } from "@/lib/recipeLinks";

interface ChatRecipeCardProps {
  recipe: ChatRecipe;
  plan: GymPlan | null;
  busy: boolean;
  onPlanAction: (recipe: ChatRecipe, action: "add" | "replace", mealName?: string) => Promise<void>;
}

export default function ChatRecipeCard({ recipe, plan, busy, onPlanAction }: ChatRecipeCardProps) {
  const [replaceMeal, setReplaceMeal] = useState("");
  const meals = plan?.meals ?? [];
  return <article className="rounded-xl border bg-card p-3 text-card-foreground shadow-sm" aria-label={`Recipe: ${recipe.Name}`}>
    <div className="flex items-start justify-between gap-2">
      <div><h3 className="font-semibold leading-snug">{recipe.Name}</h3><p className="mt-1 text-xs text-muted-foreground">{Math.round(recipe.Calories)} kcal · {Math.round(recipe.ProteinContent)} g protein per recorded serving</p></div>
      <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    </div>
    <details className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View Recipe</summary>
      <div className="mt-3 space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-xs"><div><dt className="text-muted-foreground">Carbs</dt><dd>{Math.round(recipe.CarbohydrateContent)} g</dd></div><div><dt className="text-muted-foreground">Fat</dt><dd>{Math.round(recipe.FatContent)} g</dd></div><div><dt className="text-muted-foreground">Source servings</dt><dd>{recipe.RecipeServings || "Unavailable"}</dd></div></dl>
        <p className="text-xs text-muted-foreground">{recipe.dietary_classification} Nutrition: {recipe.nutrition_source}. Ingredient quantities and verified allergy/cross-contact information are unavailable.</p>
        <div><h4 className="font-medium">Ingredients</h4>{recipe.RecipeIngredientParts.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{recipe.RecipeIngredientParts.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="text-xs text-muted-foreground">Ingredients unavailable.</p>}</div>
        <div><h4 className="font-medium">Instructions</h4>{recipe.RecipeInstructions.length ? <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs">{recipe.RecipeInstructions.map((item, index) => <li key={`${index}-${item.slice(0, 18)}`}>{item}</li>)}</ol> : <p className="text-xs text-muted-foreground">Instructions unavailable.</p>}</div>
        {recipe.allergen_note && <p className="rounded-md border border-amber-300/70 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{recipe.allergen_note}</p>}
      </div>
    </details>
    <a href={youtubeSearchUrl(recipe.Name)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-primary/30 px-3 text-xs font-semibold text-primary">
      Watch Recipe on YouTube
    </a>
    <p className="mt-1 text-[11px] text-muted-foreground">Search link only; individual videos are not verified.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void onPlanAction(recipe, "add", "Chat additions")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />} Add to Diet Plan
      </button>
      {meals.length > 0 && <div className="flex flex-1 flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`replace-${recipe.recipe_id}`}>Meal to replace</label>
        <select id={`replace-${recipe.recipe_id}`} value={replaceMeal} onChange={(event) => setReplaceMeal(event.target.value)} className="min-h-9 min-w-24 flex-1 rounded-lg border bg-background px-2 text-xs" aria-label={`Select meal to replace with ${recipe.Name}`}>
          <option value="">Choose meal…</option>{meals.map((meal) => <option key={meal.meal_name} value={meal.meal_name}>{meal.meal_name}</option>)}
        </select>
        <button type="button" disabled={busy || !replaceMeal} onClick={() => void onPlanAction(recipe, "replace", replaceMeal)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-50"><ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" /> Replace Meal</button>
      </div>}
      {meals.length === 0 && <p className="self-center text-xs text-muted-foreground">Save a plan in Gym Planner to replace a meal.</p>}
    </div>
  </article>;
}
