import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CampusOptimizer from "@/pages/CampusOptimizer";
import type { Recipe } from "@/types/recipe";

const { searchRecipes } = vi.hoisted(() => ({ searchRecipes: vi.fn() }));
vi.mock("@/lib/api", () => ({ searchRecipes }));
vi.mock("@/lib/mealLogs", () => ({ localDate: () => "2026-10-31" }));

const recipe: Recipe = {
  recipe_id: 31, RecipeId: 31, Name: "Chana Bowl", Calories: 410, ProteinContent: 20, FatContent: 8,
  SaturatedFatContent: 2, CholesterolContent: 0, SodiumContent: 240, CarbohydrateContent: 62,
  FiberContent: 12, SugarContent: 5, RecipeIngredientParts: ["chickpeas", "rice"], RecipeInstructions: [],
  CookTime: "PT20M", PrepTime: "PT10M", TotalTime: "PT30M",
};

describe("Campus meal optimizer", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    searchRecipes.mockResolvedValue({ items: [recipe], total: 1, page: 1, page_size: 6, nutrition_basis: "Food.com", filter_notes: [] });
  });

  it("keeps custom mess nutrition unknown and totals only user-sourced menu costs", () => {
    render(<CampusOptimizer />);
    fireEvent.change(screen.getByLabelText(/Menu item name/i), { target: { value: "Mess dal and rice" } });
    fireEvent.change(screen.getByLabelText(/Price per recorded portion/i), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText(/Where checked/i), { target: { value: "Mess board" } });
    fireEvent.click(screen.getByRole("button", { name: /Add to menu/i }));
    expect(screen.getByText("Nutrition unavailable; this is a user-entered menu item.")).toBeInTheDocument();
    expect(screen.getByText("₹42.00")).toBeInTheDocument();
  });

  it("adds a dataset-recipe meal with its source estimates and saves a weekly template", async () => {
    render(<CampusOptimizer />);
    fireEvent.change(screen.getByLabelText(/Search dataset recipes/i), { target: { value: "chana" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Chana Bowl/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save weekly template/i }));
    expect(await screen.findByText(/saved as a local weekly template/i)).toBeInTheDocument();
    expect(screen.getByText(/410 kcal dataset estimate/i)).toBeInTheDocument();
  });
});
