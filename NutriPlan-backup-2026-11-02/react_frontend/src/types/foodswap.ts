import type { ChatRecipe } from "@/types/chat";
import type { DietaryPreference } from "@/types/recipe";

export interface FoodSwapPlanDraft {
  recipe: ChatRecipe;
  dietary_preference: DietaryPreference;
  exclusions: string[];
  baseline_name: string;
  created_at: string;
  nutrition_note: string;
  price_inr: number | null;
}
