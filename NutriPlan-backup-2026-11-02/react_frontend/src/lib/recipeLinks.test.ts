import { describe, expect, it } from "vitest";
import { youtubeSearchUrl } from "@/lib/recipeLinks";

describe("recipe tutorial links", () => {
  it("uses a fixed YouTube search URL and encodes recipe text as query data", () => {
    const url = new URL(youtubeSearchUrl("Idli & dosa?"));
    expect(url.origin).toBe("https://www.youtube.com");
    expect(url.pathname).toBe("/results");
    expect(url.searchParams.get("search_query")).toBe("Idli & dosa? recipe cooking tutorial");
  });
});
