import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RecipeExplorer from "@/pages/RecipeExplorer";
import type { Recipe } from "@/types/recipe";

const { searchRecipes } = vi.hoisted(() => ({ searchRecipes: vi.fn() }));
vi.mock("@/lib/api", () => ({ searchRecipes, ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock("@/components/RecipeTile", () => ({ default: ({ recipe, onCook }: { recipe: Recipe; onCook?: (recipe: Recipe) => void }) => <article><h3>{recipe.Name}</h3><button type="button" onClick={() => onCook?.(recipe)}>Cook with me</button></article> }));

const recipe: Recipe = {
  recipe_id: 72, RecipeId: 72, Name: "Spinach Lentil Soup", Calories: 280, ProteinContent: 16, FatContent: 6,
  SaturatedFatContent: 1, CholesterolContent: 0, SodiumContent: 210, CarbohydrateContent: 42,
  FiberContent: 11, SugarContent: 4, RecipeIngredientParts: ["lentils", "spinach"], RecipeInstructions: ["Rinse the lentils.", "Simmer until tender."],
  CookTime: "PT20M", PrepTime: "PT10M", TotalTime: "PT30M",
};

describe("Recipe Explorer discovery and cook mode", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    searchRecipes.mockResolvedValue({ items: [recipe], total: 1, page: 1, page_size: 12, nutrition_basis: "Food.com", filter_notes: [] });
  });

  it("turns quiz choices into real recipe filters and launches step-by-step cooking", async () => {
    render(<RecipeExplorer />);
    fireEvent.change(screen.getByLabelText(/Food preference/i), { target: { value: "vegan" } });
    fireEvent.change(screen.getByLabelText(/Time today/i), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/Craving/i), { target: { value: "protein" } });
    fireEvent.click(screen.getByRole("button", { name: /Find my food style and recipes/i }));
    expect(await screen.findByText(/Protein Planner/)).toBeInTheDocument();
    expect(searchRecipes).toHaveBeenCalledWith(expect.objectContaining({ dietary_preference: "vegan", max_minutes: 15, min_protein: 15 }));
    fireEvent.click(screen.getByRole("button", { name: /Cook with me/i }));
    expect(screen.getByRole("dialog", { name: /Spinach Lentil Soup/i })).toBeInTheDocument();
    expect(screen.getByText("Rinse the lentils.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next step/i }));
    expect(screen.getByText("Simmer until tender.")).toBeInTheDocument();
  });
});
