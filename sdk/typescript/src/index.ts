export interface APIClientOptions {
  baseURL: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  profile?: Record<string, unknown>;
  conversation_id?: string;
  /** Persist history only with the user's explicit consent. Defaults to false. */
  persist_history?: boolean;
}

export interface ChatResponse {
  message: string;
  recipes: unknown[];
  notes: string[];
  diet_plan: unknown | null;
  conversation_id: string | null;
  persisted: boolean;
}

export interface RecipeSearchOptions {
  q?: string;
  dietary_preference?: "vegetarian" | "egg-inclusive" | "vegan" | "omnivore";
  meal_category?: "all" | "breakfast" | "main meal" | "snack";
  min_calories?: number;
  max_calories?: number;
  min_protein?: number;
  max_minutes?: number;
  include_ingredients?: string[];
  exclude_ingredients?: string[];
  page?: number;
  page_size?: number;
}

export class APIError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * Server-side SDK for NutriPlan API v1. Do not construct this client in a
 * public browser bundle because project API keys are private credentials.
 */
export class NutriPlanAPIClient {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: APIClientOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!/^https?:\/\//i.test(this.baseURL)) throw new Error("baseURL must use HTTP or HTTPS");
    if (!this.apiKey.trim()) throw new Error("apiKey is required");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    try {
      response = await this.fetchImpl(`${this.baseURL}/api/v1${path}`, {
        ...init,
        headers,
      });
    } catch {
      throw new APIError(0, "Could not connect to the NutriPlan API.");
    }
    if (!response.ok) {
      const raw = await response.text();
      let message = raw || `API request failed (${response.status})`;
      try {
        const body = JSON.parse(raw) as { detail?: unknown };
        if (typeof body.detail === "string") message = body.detail;
      } catch { /* Keep the server's safe text response. */ }
      throw new APIError(response.status, message);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  health<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/health/ready");
  }

  aiStatus<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/ai/status");
  }

  aiModels<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/ai/models");
  }

  project<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/projects/me");
  }

  usage<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/projects/me/usage");
  }

  chat(body: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>("/chat", { method: "POST", body: JSON.stringify(body) });
  }

  recipeSearch<T = Record<string, unknown>>(options: RecipeSearchOptions = {}): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      if (Array.isArray(value)) value.forEach((entry) => query.append(key, entry));
      else if (value !== undefined) query.set(key, String(value));
    }
    return this.request<T>(`/recipes?${query.toString()}`);
  }

  recipe<T = Record<string, unknown>>(recipeId: number, portionMultiplier = 1): Promise<T> {
    return this.request<T>(`/recipes/${encodeURIComponent(recipeId)}?portion_multiplier=${encodeURIComponent(portionMultiplier)}`);
  }

  nutrition<T = Record<string, unknown>>(profile: Record<string, unknown>): Promise<T> {
    return this.request<T>("/nutrition/calculate", { method: "POST", body: JSON.stringify(profile) });
  }

  analyzeMeal<T = Record<string, unknown>>(items: Array<{ recipe_id: number; servings: number }>): Promise<T> {
    return this.request<T>("/nutrition/analyze-meal", { method: "POST", body: JSON.stringify({ items }) });
  }

  conversation<T = Record<string, unknown>>(conversationId: string): Promise<T> {
    return this.request<T>(`/chat/history/${encodeURIComponent(conversationId)}`);
  }

  clearConversation(conversationId: string): Promise<void> {
    return this.request<void>(`/chat/history/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
  }
}
