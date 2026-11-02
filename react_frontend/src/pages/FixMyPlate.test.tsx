import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FixMyPlate from "@/pages/FixMyPlate";
import type { Recipe } from "@/types/recipe";

const { searchRecipes, calculateMealPlate } = vi.hoisted(() => ({ searchRecipes: vi.fn(), calculateMealPlate: vi.fn() }));
vi.mock("@/lib/api", () => ({
  searchRecipes,
  calculateMealPlate,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));
vi.mock("@/lib/mealLogs", () => ({ logRecipes: vi.fn(), localDate: () => "2026-10-31" }));
vi.mock("@/components/RecipeTile", () => ({ default: ({ recipe }: { recipe: Recipe }) => <div>{recipe.Name}</div> }));

const bowl: Recipe = {
  recipe_id: 17, Name: "Lentil Bowl", Calories: 320, ProteinContent: 18, FatContent: 7,
  SaturatedFatContent: 1, CholesterolContent: 0, SodiumContent: 300, CarbohydrateContent: 44,
  FiberContent: 9, SugarContent: 4, RecipeIngredientParts: ["lentils", "rice"], RecipeInstructions: [],
  CookTime: "PT15M", PrepTime: "PT5M", TotalTime: "PT20M",
};

describe("Fix My Plate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchRecipes.mockResolvedValue({ items: [bowl], total: 1, page: 1, page_size: 12, nutrition_basis: "Food.com", filter_notes: [] });
    calculateMealPlate.mockResolvedValue({ items: [], totals: { Calories: 320, ProteinContent: 18, CarbohydrateContent: 44, FatContent: 7 }, nutrition_basis: "Food.com dataset", limitations: [] });
  });

  it("adds a real dataset recipe and requests plate totals from the backend", async () => {
    render(<FixMyPlate />);
    fireEvent.change(screen.getByLabelText(/Search a dish or ingredient/i), { target: { value: "lentil" } });
    fireEvent.click(screen.getByRole("button", { name: /Find recipes for this plate/i }));
    expect(await screen.findByText("Dataset matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add recorded serving to plate/i }));
    expect(await screen.findByText("320 kcal")).toBeInTheDocument();
    await waitFor(() => expect(calculateMealPlate).toHaveBeenCalledWith([{ recipe_id: 17, servings: 1 }]));
    expect(screen.getByText(/No local prices|local prices/i)).toBeInTheDocument();
  });
});
