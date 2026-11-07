import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "@/lib/apiConfig";

describe("API base URL configuration", () => {
  it("keeps the relative Vite proxy for local development", () => {
    expect(resolveApiBaseUrl(undefined, false)).toEqual({ baseUrl: "" });
    expect(resolveApiBaseUrl(" http://localhost:8080/ ", false)).toEqual({ baseUrl: "http://localhost:8080" });
  });

  it("requires an explicit HTTPS API URL for production", () => {
    expect(resolveApiBaseUrl(undefined, true).error).toContain("VITE_API_BASE_URL");
    expect(resolveApiBaseUrl("", true).error).toContain("VITE_API_BASE_URL");
  });

  it.each(["http://localhost:8080", "http://127.0.0.1:8080", "https://localhost:8080", "not-a-url"]) (
    "rejects unsafe production API URL %s",
    (value) => expect(resolveApiBaseUrl(value, true).error).toBeTruthy(),
  );

  it("accepts a public HTTPS origin and removes its trailing slash", () => {
    expect(resolveApiBaseUrl("https://api.example.com/", true)).toEqual({ baseUrl: "https://api.example.com" });
  });
});
