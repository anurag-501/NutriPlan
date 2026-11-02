import { calculateMealPlate, type PlateCalculation, type PlateSelection } from "@/lib/api";
import type { Recipe } from "@/types/recipe";

export const MEAL_LOGS_KEY = "nutriplan.mealLogs";
export type MealLogStatus = "eaten" | "partial" | "replaced" | "skipped";

export interface MealLog {
  id: string;
  date: string;
  name: string;
  status: MealLogStatus;
  items: Array<{ recipe_id: number; name: string; servings: number }>;
  totals: PlateCalculation["totals"] | null;
  nutrition_basis?: string;
  notes?: string;
}

export function readMealLogs(): MealLog[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MEAL_LOGS_KEY) || "[]");
    return Array.isArray(value) ? value as MealLog[] : [];
  } catch { return []; }
}

export function writeMealLogs(logs: MealLog[]) {
  localStorage.setItem(MEAL_LOGS_KEY, JSON.stringify(logs));
  window.dispatchEvent(new Event("nutriplan:meal-logs-updated"));
  window.dispatchEvent(new Event("nutriplan:updated"));
}

export async function logRecipes(
  recipes: Array<{ recipe: Recipe; servings: number }>,
  name?: string,
  notes?: string,
  date = localDate(),
): Promise<MealLog> {
  if (!recipes.length || recipes.some(({ recipe }) => !recipe.recipe_id)) {
    throw new Error("Choose a recipe with a valid dataset ID first.");
  }
  const selections: PlateSelection[] = recipes.map(({ recipe, servings }) => ({ recipe_id: recipe.recipe_id!, servings }));
  const calculation = await calculateMealPlate(selections);
  const log: MealLog = {
    id: createId(), date, name: name?.trim() || recipes.map(({ recipe }) => recipe.Name).join(" + "),
    status: "eaten", items: recipes.map(({ recipe, servings }) => ({ recipe_id: recipe.recipe_id!, name: recipe.Name, servings })),
    totals: calculation.totals, nutrition_basis: calculation.nutrition_basis, notes,
  };
  writeMealLogs([log, ...readMealLogs()]);
  return log;
}

export function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
