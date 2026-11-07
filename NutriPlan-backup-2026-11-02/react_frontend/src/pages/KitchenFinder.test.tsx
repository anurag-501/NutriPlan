import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import KitchenFinder from "@/pages/KitchenFinder";
import type { Recipe } from "@/types/recipe";

const { searchRecipes } = vi.hoisted(() => ({ searchRecipes: vi.fn() }));
vi.mock("@/lib/api", () => ({
  searchRecipes,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));
vi.mock("@/components/RecipeTile", () => ({ default: ({ recipe, badge }: { recipe: Recipe; badge?: string }) => <div>{recipe.Name} <span>{badge}</span></div> }));

const recipe = (id: number, name: string, ingredients: string[]): Recipe => ({
  recipe_id: id, Name: name, Calories: 250, ProteinContent: 12, FatContent: 8, SaturatedFatContent: 2,
  CholesterolContent: 0, SodiumContent: 200, CarbohydrateContent: 30, FiberContent: 4, SugarContent: 5,
  RecipeIngredientParts: ingredients, RecipeInstructions: [], CookTime: "PT10M", PrepTime: "PT5M", TotalTime: "PT15M",
});

describe("kitchen ingredient matching", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("ranks recipes by confirmed ingredient text matches and lists missing items", async () => {
    searchRecipes.mockImplementation(({ q }: { q: string }) => Promise.resolve({ items: q === "oats" ? [recipe(1, "Oat bowl", ["oats", "banana"])] : [recipe(1, "Oat bowl", ["oats", "banana"]), recipe(2, "Banana shake", ["banana"])], total: 2, page: 1, page_size: 12, nutrition_basis: "Food.com", filter_notes: [] }));
    render(<KitchenFinder />);
    fireEvent.change(screen.getByLabelText(/Ingredients on hand/i), { target: { value: "oats, banana" } });
    fireEvent.click(screen.getByRole("button", { name: /Find matching recipes/i }));
    expect(await screen.findByText("2 recipe matches")).toBeInTheDocument();
    expect(screen.getByText("2/2 ingredient names found")).toBeInTheDocument();
    expect(screen.getByText("1/2 ingredient names found")).toBeInTheDocument();
    expect(screen.getAllByText(/Missing from this recipe text:/)).toHaveLength(2);
    await waitFor(() => expect(searchRecipes).toHaveBeenCalledTimes(2));
  });
});
