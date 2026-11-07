import type { DietaryPreference, GymGoal, GymPlan, Recipe } from "@/types/recipe";

export interface ChatProfile {
  age?: number;
  height?: number;
  weight?: number;
  sex_coefficient?: "male" | "female" | "range";
  activity?: string;
  training_days?: number;
  goal?: GymGoal;
  dietary_preference?: DietaryPreference;
  allergies?: string[];
  disliked_foods?: string[];
  available_ingredients?: string[];
  max_minutes?: number;
  meal_category?: "breakfast" | "main meal" | "snack";
  budget_preference?: string;
  meals_per_day?: 3 | 4 | 5;
  cuisine?: string;
  professional_support_needed?: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRecipe extends Recipe {
  recipe_id: number;
  RecipeId: number;
  RecipeServings?: string | null;
  dietary_classification: string;
  dietary_preference?: DietaryPreference | null;
  excluded_ingredients: string[];
  allergen_note: string;
}

export interface ChatResponse {
  message: string;
  recipes: ChatRecipe[];
  notes: string[];
  diet_plan?: GymPlan | null;
}

export interface ChatHealth {
  provider: "ollama" | "openai" | string;
  configured: boolean;
  status?: "missing_configuration" | "configured_unverified" | "available" | "invalid_configuration" | "invalid_credentials" | "permission_denied" | "model_unavailable" | "provider_rate_limited" | "quota_exceeded" | "timeout" | "connection_error" | "provider_unavailable" | "provider_error";
  status_message?: string;
  model: string;
  available_models?: string[];
  history: string;
}

export interface PlanMealSelection {
  meal_name: string;
  recommended_calories: number;
  recipe_ids: number[];
  selected_recipe_id: number;
}

export interface ChatPlanActionResponse {
  action: "add" | "replace";
  meal_name: string;
  meals: Array<{ meal_name: string; recommended_calories: number; recipes: ChatRecipe[] }>;
  selected_recipe_ids: Record<string, number>;
  nutrition_totals: { calories: number; protein_g: number; carbohydrate_g: number; fat_g: number };
  nutrition_source: string;
  nutrition_note: string;
}
