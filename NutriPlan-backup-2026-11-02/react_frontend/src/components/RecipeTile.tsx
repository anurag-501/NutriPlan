import { BookmarkPlus, Download, ExternalLink, Loader2, NotebookPen, ChefHat } from "lucide-react";
import { useState } from "react";
import RecipeCard from "@/components/RecipeCard";
import type { Recipe } from "@/types/recipe";
import { logRecipes } from "@/lib/mealLogs";
import { shareOrDownloadRecipeCard, youtubeSearchUrl } from "@/lib/recipeLinks";

interface RecipeTileProps {
  recipe: Recipe;
  onSave?: (recipe: Recipe) => void;
  badge?: string;
  onCook?: (recipe: Recipe) => void;
}

export default function RecipeTile({ recipe, onSave, badge, onCook }: RecipeTileProps) {
  const [logging, setLogging] = useState(false);
  const [message, setMessage] = useState("");
  async function logMeal() {
    setLogging(true); setMessage("");
    try { await logRecipes([{ recipe, servings: 1 }]); setMessage("Logged as 1 recorded serving on this device."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this meal."); }
    finally { setLogging(false); }
  }
  return (
    <article className="relative flex flex-col gap-2">
      {badge && <span className="self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{badge}</span>}
      <RecipeCard recipe={recipe} />
      {recipe.nutrition_source && (
        <p className="px-1 text-xs text-muted-foreground">Nutrition: dataset-reported estimate per recorded serving.</p>
      )}
      {recipe.portion_multiplier && recipe.portion_multiplier !== 1 && (
        <p className="px-1 text-xs text-muted-foreground">Nutrition is scaled ×{recipe.portion_multiplier}; ingredient quantities are not available to scale.</p>
      )}
      <a href={youtubeSearchUrl(recipe.Name)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10">
        <ExternalLink className="h-4 w-4" /> Watch Recipe on YouTube
      </a>
      <p className="px-1 text-xs text-muted-foreground">Opens an encoded YouTube search; individual videos are not verified.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={logging} onClick={() => void logMeal()} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:border-primary disabled:opacity-60">
          {logging ? <Loader2 className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />} Log 1 serving
        </button>
        <button type="button" onClick={() => void shareOrDownloadRecipeCard(recipe)} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:border-primary">
          <Download className="h-4 w-4" /> Share / download meal card
        </button>
      </div>
      {onCook && <button type="button" onClick={() => onCook(recipe)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15"><ChefHat className="h-4 w-4"/>Cook with me</button>}
      {message && <p role="status" className="px-1 text-xs text-muted-foreground">{message}</p>}
      {onSave && (
        <button type="button" onClick={() => onSave(recipe)} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:border-primary">
          <BookmarkPlus className="h-4 w-4" /> Save recipe on this device
        </button>
      )}
    </article>
  );
}
