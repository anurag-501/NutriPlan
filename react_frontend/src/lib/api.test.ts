import { afterEach, describe, expect, it, vi } from "vitest";
import { getChatHealth, sendChat } from "@/lib/api";

describe("frontend API client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends only the latest twelve chat turns to the existing chat route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Hello", recipes: [], notes: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const messages = Array.from({ length: 15 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `turn ${index}`,
    }));

    await sendChat(messages, {});

    expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ messages: messages.slice(-12), profile: {} }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("uses a lightweight health endpoint and reports request timeout clearly", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getChatHealth();
    const rejection = expect(pending).rejects.toMatchObject({
      name: "ApiError",
      status: 408,
      message: expect.stringContaining("timed out after 8 seconds"),
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/health", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it("translates a network failure and does not add JSON content type to a GET", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatHealth()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: expect.stringContaining("deployed backend URL and CORS"),
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
  });

  it("shows safe API detail text without exposing non-JSON proxy pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "The selected AI provider is unavailable." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatHealth()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "The selected AI provider is unavailable.",
    });
  });
});
