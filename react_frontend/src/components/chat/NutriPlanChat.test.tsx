import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NutriPlanChat from "@/components/chat/NutriPlanChat";
import ChatMarkdown from "@/components/chat/ChatMarkdown";
import { ApiError } from "@/lib/api";
import type { ChatRecipe } from "@/types/chat";
import type { GymPlan } from "@/types/recipe";

const { getChatHealth, sendChat, applyChatPlanAction } = vi.hoisted(() => ({
  getChatHealth: vi.fn(),
  sendChat: vi.fn(),
  applyChatPlanAction: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getChatHealth,
  sendChat,
  applyChatPlanAction,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const recipe: ChatRecipe = {
  recipe_id: 42,
  RecipeId: 42,
  Name: "Chickpea Bowl",
  CookTime: "PT15M",
  PrepTime: "PT5M",
  TotalTime: "PT20M",
  RecipeIngredientParts: ["chickpeas", "tomato"],
  Calories: 350,
  FatContent: 9,
  SaturatedFatContent: 2,
  CholesterolContent: 0,
  SodiumContent: 300,
  CarbohydrateContent: 48,
  FiberContent: 12,
  SugarContent: 5,
  ProteinContent: 18,
  RecipeInstructions: ["Combine the ingredients."],
  image_url: null,
  RecipeServings: "2 servings",
  dietary_classification: "Vegan classified from listed ingredients",
  dietary_preference: "vegan",
  excluded_ingredients: [],
  allergen_note: "Check labels; cross-contact is unknown.",
  ingredients_quantities_available: false,
  nutrition_source: "Food.com dataset",
  matching_explanation: "Matches the filters.",
};

const dietPlan: GymPlan = {
  available: true,
  estimated: true,
  targets: { available: true, estimated: true, target_calories: [2100, 2200], protein_g_range: [90, 130], protein_g_target: 100 },
  meals: [{ meal_name: "Breakfast", recommended_calories: 650, recipes: [recipe] }],
  pre_workout: null,
  post_workout: null,
  limitations: ["Nutrition is dataset-reported."],
  nutrition_source: "Food.com dataset",
};

describe("NutriPlan AI chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getChatHealth.mockResolvedValue({ provider: "openai", configured: true, status: "available", model: "test-model", history: "session only" });
    sendChat.mockResolvedValue({ message: "Try **Chickpea Bowl**.", recipes: [], notes: [] });
    applyChatPlanAction.mockResolvedValue({
      action: "add", meal_name: "Chat additions", meals: [{ meal_name: "Chat additions", recommended_calories: 0, recipes: [recipe] }],
      selected_recipe_ids: { "Chat additions": 42 }, nutrition_totals: { calories: 350, protein_g: 18, carbohydrate_g: 48, fat_g: 9 },
      nutrition_source: "Food.com dataset", nutrition_note: "Dataset values.",
    });
  });

  it("opens and collapses the chat while preserving the current session", async () => {
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    expect(await screen.findByText("What can I help you plan?")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message NutriPlan AI" });
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Hello")).toBeInTheDocument();
    await waitFor(() => expect(document.body).toHaveTextContent("Try Chickpea Bowl."));
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  it("supports Shift+Enter as a newline without sending", async () => {
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    expect(await screen.findByText("AI responded · test-model")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message NutriPlan AI" });
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sendChat).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one");
  });

  it("shows a loading state, renders recipe cards, and submits an explicit plan action", async () => {
    let resolveReply!: (value: { message: string; recipes: ChatRecipe[]; notes: string[] }) => void;
    sendChat.mockReturnValueOnce(new Promise((resolve) => { resolveReply = resolve; }));
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Find high-protein vegetarian dinners I can cook in 30 minutes." }));
    expect(screen.getByRole("status")).toHaveTextContent("NutriPlan AI is thinking");
    resolveReply({ message: "Here is a recipe.", recipes: [recipe], notes: [] });
    expect(await screen.findByRole("article", { name: "Recipe: Chickpea Bowl" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Diet Plan" }));
    await waitFor(() => expect(applyChatPlanAction).toHaveBeenCalledWith(expect.objectContaining({ action: "add", recipe_id: 42 })));
    expect(localStorage.getItem("nutriplan.savedPlan")).toContain("Chickpea Bowl");
  });

  it("shows a failed request and can retry it", async () => {
    sendChat.mockRejectedValueOnce(new Error("network unavailable"));
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    const input = screen.getByRole("textbox", { name: "Message NutriPlan AI" });
    fireEvent.change(input, { target: { value: "Suggest dinner" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the chat API");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.body).toHaveTextContent("Try Chickpea Bowl."));
    expect(sendChat).toHaveBeenCalledTimes(2);
  });

  it("does not claim provider access from configuration alone", async () => {
    getChatHealth.mockResolvedValueOnce({ provider: "openai", configured: true, status: "configured_unverified", status_message: "Not checked", model: "test-model", history: "session only" });
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    expect(await screen.findByText("AI configured · not checked")).toBeInTheDocument();
    expect(screen.queryByText("AI responded · test-model")).not.toBeInTheDocument();
  });

  it("distinguishes an unavailable local model from an offline backend", async () => {
    getChatHealth.mockResolvedValueOnce({ provider: "ollama", configured: true, status: "model_unavailable", model: "qwen3:4b", history: "session only" });
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    expect(await screen.findByText("Local model not installed")).toBeInTheDocument();
    expect(screen.queryByText("API offline")).not.toBeInTheDocument();
    expect(screen.getByText(/Install qwen3:4b in Ollama/)).toBeInTheDocument();
  });

  it("lets the user dismiss an error without retrying", async () => {
    sendChat.mockRejectedValueOnce(new Error("network unavailable"));
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    const input = screen.getByRole("textbox", { name: "Message NutriPlan AI" });
    fireEvent.change(input, { target: { value: "Suggest dinner" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  it("explains that a blank proxy 500 means FastAPI needs to be started", async () => {
    sendChat.mockRejectedValueOnce(new ApiError(500, ""));
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    const input = screen.getByRole("textbox", { name: "Message NutriPlan AI" });
    fireEvent.change(input, { target: { value: "Suggest dinner" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("FastAPI backend is not responding correctly on port 8080");
  });

  it("keeps a generated meal plan as a draft until the user saves it", async () => {
    sendChat.mockResolvedValueOnce({ message: "I built a draft.", recipes: [], notes: [], diet_plan: dietPlan });
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Help me understand my calorie estimate." }));
    expect(await screen.findByRole("article", { name: "Generated diet plan" })).toBeInTheDocument();
    expect(localStorage.getItem("nutriplan.savedPlan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save to My Plan" }));
    expect(JSON.parse(localStorage.getItem("nutriplan.savedPlan") || "null").meals[0].meal_name).toBe("Breakfast");
    expect(JSON.parse(localStorage.getItem("nutriplan.selectedMeals") || "{}")).toEqual({ Breakfast: 42 });
  });

  it("confirms before replacing a plan already saved on this device", async () => {
    localStorage.setItem("nutriplan.savedPlan", JSON.stringify({ ...dietPlan, meals: [] }));
    sendChat.mockResolvedValueOnce({ message: "Here is an updated draft.", recipes: [], notes: [], diet_plan: dietPlan });
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Help me understand my calorie estimate." }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace saved plan" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("replaces the current saved plan");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Replace saved plan" }));
    expect(JSON.parse(localStorage.getItem("nutriplan.savedPlan") || "null").meals[0].meal_name).toBe("Breakfast");
  });

  it("requires confirmation before clearing the conversation", async () => {
    render(<NutriPlanChat />);
    fireEvent.click(screen.getByRole("button", { name: "Open NutriPlan AI chat" }));
    const input = screen.getByRole("textbox", { name: "Message NutriPlan AI" });
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Hello")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear chat" }));
    expect(screen.getByText("What can I help you plan?")).toBeInTheDocument();
  });
});

describe("chat response Markdown", () => {
  it("renders formatting safely and does not interpret HTML or javascript links", () => {
    const { container } = render(<ChatMarkdown content={'**Protein**\n\n<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))'} />);
    expect(screen.getByText("Protein").tagName).toBe("STRONG");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=");
  });
});
