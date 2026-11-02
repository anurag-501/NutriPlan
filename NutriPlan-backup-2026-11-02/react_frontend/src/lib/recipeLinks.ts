import type { Recipe } from "@/types/recipe";

export function youtubeSearchUrl(name: string): string {
  const query = `${name} recipe cooking tutorial`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

export async function shareOrDownloadRecipeCard(recipe: Recipe): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" rx="64" fill="#f7f4eb"/><circle cx="890" cy="170" r="125" fill="#dcebdd"/><text x="88" y="132" fill="#246044" font-family="Arial,sans-serif" font-size="34" font-weight="700">NUTRIPLAN · MEAL CARD</text><text x="88" y="330" fill="#183b2b" font-family="Arial,sans-serif" font-size="68" font-weight="700">${xml(recipe.Name.slice(0, 48))}</text><text x="88" y="505" fill="#183b2b" font-family="Arial,sans-serif" font-size="46">${Math.round(recipe.Calories)} kcal · ${Math.round(recipe.ProteinContent)} g protein</text><text x="88" y="585" fill="#183b2b" font-family="Arial,sans-serif" font-size="40">${Math.round(recipe.CarbohydrateContent)} g carbs · ${Math.round(recipe.FatContent)} g fat</text><text x="88" y="760" fill="#52665a" font-family="Arial,sans-serif" font-size="30">Dataset-reported per recorded recipe serving.</text><text x="88" y="815" fill="#52665a" font-family="Arial,sans-serif" font-size="26">Source: ${xml(recipe.nutrition_source || "bundled recipe dataset")}</text><text x="88" y="970" fill="#246044" font-family="Arial,sans-serif" font-size="30" font-weight="700">Eat smarter. Spend less. Waste less.</text></svg>`;
  const file = new File([svg], "nutriplan-meal-card.svg", { type: "image/svg+xml" });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try { await navigator.share({ title: recipe.Name, files: [file] }); return; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${recipe.Name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nutriplan-meal"}.svg`;
  document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
