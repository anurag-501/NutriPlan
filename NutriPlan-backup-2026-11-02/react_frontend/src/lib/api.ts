import type { Recipe, MealPlan, GymPlan, GymPlanRequest, RecipeSearchFilters, RecipeSearchResponse } from "@/types/recipe";
import type { ChatHealth, ChatPlanActionResponse, ChatProfile, ChatResponse, ChatTurn, PlanMealSelection } from "@/types/chat";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";
const DEFAULT_API_TIMEOUT_MS = 30_000;
const CHAT_HEALTH_TIMEOUT_MS = 8_000;
// Backend provider calls can include up to three validated tool round-trips.
const CHAT_REQUEST_TIMEOUT_MS = 150_000;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_API_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ApiError(res.status, body);
    }
    try {
      return await res.json() as T;
    } catch {
      throw new ApiError(502, "The API returned an invalid response.");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(408, `The request timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Please retry.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export interface PredictRequest {
  nutrition_input: [number, number, number, number, number, number, number, number, number];
  ingredients: string[];
  params: { n_neighbors: number; return_distance: false };
}

export interface MealPlanRequest {
  age: number;
  height: number;
  weight: number;
  gender: "Male" | "Female";
  activity: string;
  number_of_meals: 3 | 4 | 5;
  weight_loss: string;
}

export async function predictRecipes(req: PredictRequest): Promise<Recipe[]> {
  const data = await apiFetch<{ output: Recipe[] | null }>("/predict/", {
    method: "POST",
    body: JSON.stringify(req),
  });
  return data.output ?? [];
}

export async function generateMealPlan(req: MealPlanRequest): Promise<MealPlan> {
  return apiFetch<MealPlan>("/generate-meal-plan/", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function calculateNutrition(req: GymPlanRequest) {
  return apiFetch<import("@/types/recipe").NutritionTargets>("/nutrition/calculate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function generateGymPlan(req: GymPlanRequest): Promise<GymPlan> {
  return apiFetch<GymPlan>("/gym-diet-plan", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function searchRecipes(filters: RecipeSearchFilters): Promise<RecipeSearchResponse> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return apiFetch<RecipeSearchResponse>(`/recipes?${params.toString()}`);
}

export interface PlateSelection { recipe_id: number; servings: number }
export interface PlateCalculation {
  items: Array<{ recipe_id: number; Name: string; servings: number; Calories: number; ProteinContent: number; CarbohydrateContent: number; FatContent: number; nutrition_source: string }>;
  totals: { Calories: number; ProteinContent: number; CarbohydrateContent: number; FatContent: number };
  nutrition_basis: string;
  limitations: string[];
}

export async function calculateMealPlate(items: PlateSelection[]): Promise<PlateCalculation> {
  return apiFetch<PlateCalculation>("/api/meal-plate/calculate", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export interface FoodSwapPrice {
  recipe_id: number;
  cost_inr: number;
  source: string;
  checked_on: string;
}

export interface FoodSwapInput {
  current_meal: PlateSelection[];
  dietary_preference: RecipeSearchFilters["dietary_preference"];
  exclusions: string[];
  available_ingredients: string[];
  priority: "balanced" | "higher_protein" | "lower_calories" | "lower_cost";
  budget_inr?: number;
  minimum_protein_g?: number;
  maximum_calories?: number;
  maximum_minutes?: number;
  prices: FoodSwapPrice[];
  result_limit: number;
}

export interface FoodSwapAlternative {
  recipe: Recipe;
  recipe_id: number;
  cost_inr: number | null;
  price_source: string | null;
  price_checked_on: string | null;
  budget_status: boolean | null;
  matched_ingredients: string[];
  missing_available_ingredients: string[];
  availability_score: number | null;
  prep_minutes: number | null;
  score: number;
  tradeoffs: string;
}

export interface FoodSwapResponse {
  current_meal: { items: Array<{ recipe: Recipe; servings: number }>; totals: PlateCalculation["totals"]; cost_inr: number | null; warnings: string[] };
  alternatives: FoodSwapAlternative[];
  eligible_count: number;
  ranking_priority: FoodSwapInput["priority"];
  requested_priority: FoodSwapInput["priority"];
  nutrition_source: string;
  notes: string[];
}

export async function compareFoodSwap(input: FoodSwapInput): Promise<FoodSwapResponse> {
  return apiFetch<FoodSwapResponse>("/api/foodswap/compare", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getChatHealth(): Promise<ChatHealth> {
  return apiFetch<ChatHealth>("/api/chat/health", undefined, CHAT_HEALTH_TIMEOUT_MS);
}

export async function sendChat(messages: ChatTurn[], profile: ChatProfile): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages: messages.slice(-12), profile }),
  }, CHAT_REQUEST_TIMEOUT_MS);
}

export async function applyChatPlanAction(input: {
  action: "add" | "replace";
  recipe_id: number;
  meal_name?: string;
  dietary_preference?: ChatProfile["dietary_preference"];
  allergies?: string[];
  disliked_foods?: string[];
  current_meals?: PlanMealSelection[];
}): Promise<ChatPlanActionResponse> {
  return apiFetch<ChatPlanActionResponse>("/api/chat/plan-action", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
