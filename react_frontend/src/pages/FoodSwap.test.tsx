import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FoodSwap from "@/pages/FoodSwap";
import type { Recipe } from "@/types/recipe";

const { searchRecipes, compareFoodSwap, applyChatPlanAction } = vi.hoisted(() => ({ searchRecipes: vi.fn(), compareFoodSwap: vi.fn(), applyChatPlanAction: vi.fn() }));
vi.mock("@/lib/api", () => ({
  searchRecipes, compareFoodSwap, applyChatPlanAction,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));
vi.mock("@/lib/mealLogs", () => ({ localDate: () => "2026-10-31" }));
vi.mock("@/components/RecipeCard", () => ({ default: ({ recipe }: { recipe: Recipe }) => <div>{recipe.Name}</div> }));

const recipe = (id: number, name: string): Recipe => ({
  recipe_id: id, RecipeId: id, Name: name, Calories: 320, ProteinContent: 18, FatContent: 7,
  SaturatedFatContent: 1, CholesterolContent: 0, SodiumContent: 300, CarbohydrateContent: 44,
  FiberContent: 9, SugarContent: 4, RecipeIngredientParts: ["lentils", "rice"], RecipeInstructions: ["Cook"],
  CookTime: "PT15M", PrepTime: "PT5M", TotalTime: "PT20M",
});
const baseline = recipe(17, "Lentil Bowl");
const alternative = recipe(18, "Chickpea Bowl");

describe("FoodSwap", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    searchRecipes.mockResolvedValue({ items: [baseline], total: 1, page: 1, page_size: 12, nutrition_basis: "Food.com", filter_notes: [] });
    compareFoodSwap.mockResolvedValue({
      current_meal: { items: [{ recipe: baseline, servings: 1 }], totals: { Calories: 320, ProteinContent: 18, CarbohydrateContent: 44, FatContent: 7 }, cost_inr: null, warnings: [] },
      alternatives: [{ recipe: alternative, recipe_id: 18, cost_inr: null, price_source: null, price_checked_on: null, budget_status: null, matched_ingredients: [], missing_available_ingredients: [], availability_score: null, prep_minutes: 20, score: 82.5, tradeoffs: "Compared with the selected meal: same calories." }],
      eligible_count: 8, ranking_priority: "balanced", nutrition_source: "Food.com recipe dataset", notes: ["Recorded serving estimate."],
    });
    applyChatPlanAction.mockResolvedValue({ meals: [{ meal_name: "FoodSwap choice", recommended_calories: 320, recipes: [{ ...alternative, dietary_classification: "unclassified", excluded_ingredients: [], allergen_note: "Check labels" }] }], nutrition_note: "Dataset estimate." });
  });

  it("compares real recipe selections and stores a backend-validated temporary draft", async () => {
    render(<MemoryRouter><FoodSwap /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Search a dish or ingredient/i), { target: { value: "lentil" } });
    fireEvent.click(screen.getByRole("button", { name: /Search recipe data/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Add to current meal/i }));
    fireEvent.click(screen.getByRole("button", { name: /Compare meal alternatives/i }));
    expect((await screen.findAllByText("Chickpea Bowl")).length).toBeGreaterThan(0);
    await waitFor(() => expect(compareFoodSwap).toHaveBeenCalledWith(expect.objectContaining({ current_meal: [{ recipe_id: 17, servings: 1 }], prices: [] })));
    fireEvent.click(screen.getByRole("button", { name: /Add to temporary diet plan draft/i }));
    expect(await screen.findByText(/temporary plan draft/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("nutriplan.foodSwapDraft") || "{}").recipe.recipe_id).toBe(18);
  });
});
