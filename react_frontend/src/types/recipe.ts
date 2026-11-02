export interface Recipe {
  RecipeId?: number;
  recipe_id?: number;
  Name: string;
  Calories: number;
  FatContent: number;
  SaturatedFatContent: number;
  CholesterolContent: number;
  SodiumContent: number;
  CarbohydrateContent: number;
  FiberContent: number;
  SugarContent: number;
  ProteinContent: number;
  RecipeIngredientParts: string[];
  RecipeInstructions: string[];
  CookTime: string;
  PrepTime: string;
  TotalTime: string;
  image_url?: string;
  meal_category?: string;
  protein_per_100_calories?: number;
  portion_multiplier?: number;
  ingredients_quantities_available?: boolean;
  nutrition_source?: string;
  matching_explanation?: string;
}

export type DietaryPreference = "vegetarian" | "egg-inclusive" | "vegan" | "omnivore";
export type GymGoal = "lean_gain" | "bulk" | "fat_loss" | "maintenance";

export interface GymPlanRequest {
  age: number;
  height: number;
  weight: number;
  sex_coefficient: "male" | "female" | "range";
  activity: string;
  training_days: number;
  training_experience: "beginner" | "intermediate" | "advanced";
  goal: GymGoal;
  dietary_preference: DietaryPreference;
  allergies: string[];
  disliked_foods: string[];
  meals_per_day: 3 | 4 | 5;
  budget?: string;
  cuisine?: string;
  workout_time: "morning" | "afternoon" | "evening" | "flexible";
  professional_support_needed: boolean;
}

export interface NutritionTargets {
  available: boolean;
  estimated: boolean;
  guidance?: string;
  maintenance_calories?: [number, number];
  target_calories?: [number, number];
  protein_g_range?: [number, number];
  protein_g_target?: number;
  carbohydrate_g_target?: number;
  fat_g_target?: number;
  energy_method?: string;
  protein_basis?: string;
  macronutrient_method?: string;
  equation_note?: string;
  older_adult_note?: string;
}

export interface GymPlanMeal {
  meal_name: string;
  recommended_calories: number;
  recipes: Recipe[];
}

export interface GymPlan {
  available: boolean;
  estimated: boolean;
  guidance?: string;
  targets?: NutritionTargets;
  meals: GymPlanMeal[];
  pre_workout?: { timing: string; recipes: Recipe[] } | null;
  post_workout?: { timing: string; recipes: Recipe[] } | null;
  limitations: string[];
  nutrition_source: string;
}

export interface RecipeSearchFilters {
  q?: string;
  dietary_preference?: DietaryPreference;
  meal_category?: "all" | "breakfast" | "main meal" | "snack";
  min_calories?: number;
  max_calories?: number;
  min_protein?: number;
  min_protein_per_100_calories?: number;
  max_minutes?: number;
  include_ingredients?: string[];
  exclude_ingredients?: string[];
  cuisine?: string;
  budget?: string;
  page?: number;
  page_size?: number;
  portion_multiplier?: number;
}

export interface RecipeSearchResponse {
  items: Recipe[];
  total: number;
  page: number;
  page_size: number;
  nutrition_basis: string;
  filter_notes: string[];
}

export interface MealGroup {
  meal_name: string;
  recipes: Recipe[];
}

export interface MealPlan {
  bmi: number;
  bmr: number;
  maintain_calories: number;
  target_calories: number;
  meals: MealGroup[];
}

export const NUTRITION_COLUMNS = [
  'Calories', 'FatContent', 'SaturatedFatContent', 'CholesterolContent',
  'SodiumContent', 'CarbohydrateContent', 'FiberContent', 'SugarContent', 'ProteinContent',
] as const;

export type NutritionKey = typeof NUTRITION_COLUMNS[number];

export const WEIGHT_LOSS_PLANS = [
  { label: 'Maintain weight', value: 'Maintain weight', weight: 1, loss: 'maintenance estimate' },
  { label: 'Mild weight loss (5% adjustment)', value: 'Mild weight loss', weight: 0.95, loss: 'modest adjustment' },
  { label: 'Weight loss (10% adjustment cap)', value: 'Weight loss', weight: 0.9, loss: 'modest adjustment' },
  { label: 'Stronger plan (legacy option capped at 10%)', value: 'Extreme weight loss', weight: 0.9, loss: 'capped for safety' },
] as const;

export const ACTIVITY_LEVELS = [
  'Little/no exercise',
  'Light exercise',
  'Moderate exercise (3-5 days/wk)',
  'Very active (6-7 days/wk)',
  'Extra active (very active & physical job)',
] as const;
