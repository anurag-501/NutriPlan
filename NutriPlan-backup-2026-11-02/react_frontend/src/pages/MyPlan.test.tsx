import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MyPlan from "@/pages/MyPlan";
import type { ChatRecipe } from "@/types/chat";

const { applyChatPlanAction, calculateMealPlate } = vi.hoisted(() => ({ applyChatPlanAction: vi.fn(), calculateMealPlate: vi.fn() }));
vi.mock("@/lib/api", () => ({
  applyChatPlanAction, calculateMealPlate,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));
vi.mock("@/lib/mealLogs", () => ({ createId: () => "local-id", localDate: () => "2026-10-31", readMealLogs: () => [], writeMealLogs: vi.fn() }));
vi.mock("@/components/RecipeTile", () => ({ default: ({ recipe }: { recipe: ChatRecipe }) => <p>{recipe.Name}</p> }));

const recipe: ChatRecipe = {
  recipe_id: 44, RecipeId: 44, Name: "Tofu Rice Bowl", Calories: 390, FatContent: 10, SaturatedFatContent: 2,
  CholesterolContent: 0, SodiumContent: 330, CarbohydrateContent: 48, FiberContent: 7, SugarContent: 5,
  ProteinContent: 24, RecipeIngredientParts: ["tofu", "rice"], RecipeInstructions: ["Cook"],
  CookTime: "PT20M", PrepTime: "PT10M", TotalTime: "PT30M", RecipeServings: "1",
  nutrition_source: "Bundled dataset", ingredients_quantities_available: false,
  dietary_classification: "Keyword screened", dietary_preference: "vegetarian", excluded_ingredients: [], allergen_note: "Check labels.",
};

describe("FoodSwap draft review in My Plan", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("nutriplan.foodSwapDraft", JSON.stringify({
      recipe, dietary_preference: "vegetarian", exclusions: [], baseline_name: "Mess bowl", created_at: "2026-10-31T10:00:00Z", nutrition_note: "Dataset estimate.", price_inr: null,
    }));
    applyChatPlanAction.mockResolvedValue({
      action: "add", meal_name: "FoodSwap choice", meals: [{ meal_name: "FoodSwap choice", recommended_calories: 390, recipes: [recipe] }],
      selected_recipe_ids: { "FoodSwap choice": 44 }, nutrition_totals: { calories: 390, protein_g: 24, carbohydrate_g: 48, fat_g: 10 },
      nutrition_source: "Bundled dataset", nutrition_note: "Validated by backend.",
    });
  });

  it("requires a separate confirmation before changing the saved plan", async () => {
    render(<MemoryRouter><MyPlan /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Review adding to My Plan/i }));
    expect(applyChatPlanAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm & add to My Plan/i }));
    await waitFor(() => expect(applyChatPlanAction).toHaveBeenCalledWith(expect.objectContaining({ action: "add", recipe_id: 44, dietary_preference: "vegetarian" })));
    const saved = JSON.parse(localStorage.getItem("nutriplan.savedPlan") || "{}");
    expect(saved.meals[0].recipes[0].Name).toBe("Tofu Rice Bowl");
    expect(localStorage.getItem("nutriplan.foodSwapDraft")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Add to prep queue/i }));
    expect(await screen.findByText(/Sum of listed times: 30 min/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Join this week/i }));
    expect(screen.getByText(/0\/1 recipe-backed meal logged so far/i)).toBeInTheDocument();
  });
});
