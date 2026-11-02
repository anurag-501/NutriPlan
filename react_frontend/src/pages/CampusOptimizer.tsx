import { FormEvent, useMemo, useState } from "react";
import { CalendarDays, Check, CopyPlus, IndianRupee, Leaf, Plus, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { searchRecipes } from "@/lib/api";
import { localDate } from "@/lib/mealLogs";
import type { DietaryPreference, Recipe, RecipeSearchResponse } from "@/types/recipe";

type CampusEntry = {
  id: string;
  date: string;
  meal: string;
  name: string;
  recipe?: Recipe;
  servings: number;
  cost: number | null;
  priceSource: string;
  priceDate: string;
  ingredients: string[];
};
type CampusTemplate = Omit<CampusEntry, "id" | "date"> & { templateId: string };
const ENTRIES_KEY = "nutriplan.campus.menu";
const TEMPLATES_KEY = "nutriplan.campus.templates";
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const split = (value: string) => value.split(",").map((term) => term.trim()).filter(Boolean);

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

export default function CampusOptimizer() {
  const today = localDate();
  const [entries, setEntries] = useState<CampusEntry[]>(() => read(ENTRIES_KEY, []));
  const [templates, setTemplates] = useState<CampusTemplate[]>(() => read(TEMPLATES_KEY, []));
  const [date, setDate] = useState(today);
  const [budgets, setBudgets] = useState<Record<string, string>>(() => read("nutriplan.campus.budgets", {}));
  const [meal, setMeal] = useState("Lunch");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [diet, setDiet] = useState<DietaryPreference>("omnivore");
  const [recipeResults, setRecipeResults] = useState<RecipeSearchResponse | null>(null);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [servings, setServings] = useState("1");
  const [cost, setCost] = useState("");
  const [source, setSource] = useState("");
  const [priceDate, setPriceDate] = useState(today);
  const [ingredientText, setIngredientText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const week = useMemo(() => {
    const current = new Date(`${date}T12:00:00`);
    const day = (current.getDay() + 6) % 7;
    current.setDate(current.getDate() - day);
    const start = localDate(current);
    current.setDate(current.getDate() + 6);
    const end = localDate(current);
    return { start, end, items: entries.filter((entry) => entry.date >= start && entry.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal)) };
  }, [date, entries]);
  const knownSpend = week.items.reduce((sum, entry) => sum + (entry.cost === null ? 0 : entry.cost * entry.servings), 0);
  const unknownPriceCount = week.items.filter((entry) => entry.cost === null).length;
  const groceryList = Array.from(new Set(week.items.flatMap((entry) => entry.ingredients))).sort((a, b) => a.localeCompare(b));
  const weekBudget = budgets[week.start] ?? "";
  const enteredBudget = Number(weekBudget);
  const budgetStatus = weekBudget && Number.isFinite(enteredBudget) ? unknownPriceCount ? "partially unknown" : knownSpend <= enteredBudget ? "within" : "over" : "not set";

  function saveEntries(next: CampusEntry[]) { setEntries(next); localStorage.setItem(ENTRIES_KEY, JSON.stringify(next)); }
  function saveTemplates(next: CampusTemplate[]) { setTemplates(next); localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); }
  function updateWeekBudget(value: string) { const next = { ...budgets, [week.start]: value }; setBudgets(next); localStorage.setItem("nutriplan.campus.budgets", JSON.stringify(next)); }

  async function findRecipe() {
    setBusy(true); setError(""); setMessage("");
    try {
      setRecipeResults(await searchRecipes({ q: query || undefined, dietary_preference: diet, page: 1, page_size: 6 }));
    } catch { setError("Recipe search is unavailable. Check the backend and try again."); }
    finally { setBusy(false); }
  }

  function currentEntry(): Omit<CampusEntry, "id" | "date"> | null {
    const entryName = (selected?.Name || name).trim();
    if (!entryName) { setError("Enter a mess or PG meal name, or choose a dataset recipe."); return null; }
    const amount = Number(servings);
    if (!Number.isFinite(amount) || amount < 0.25 || amount > 3) { setError("Serving multiplier must be between 0.25 and 3."); return null; }
    const checkedCost = cost.trim() ? Number(cost) : null;
    if (checkedCost !== null && (!Number.isFinite(checkedCost) || checkedCost <= 0 || checkedCost > 5000 || source.trim().length < 3 || !priceDate)) {
      setError("For a price, enter a positive amount, where you checked it, and the checked date. Leave all price fields blank if unknown."); return null;
    }
    return {
      meal, name: entryName, recipe: selected ?? undefined, servings: amount, cost: checkedCost,
      priceSource: checkedCost === null ? "" : source.trim(), priceDate: checkedCost === null ? "" : priceDate,
      ingredients: selected ? selected.RecipeIngredientParts || [] : split(ingredientText),
    };
  }

  function addToMenu(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    const item = currentEntry(); if (!item) return;
    const next = [{ ...item, id: crypto.randomUUID(), date }, ...entries];
    saveEntries(next); setMessage(`${item.name} added to your local menu for ${date}.`);
    setSelected(null); setName(""); setCost(""); setSource(""); setIngredientText("");
  }

  function saveTemplate() {
    setError(""); setMessage("");
    const item = currentEntry(); if (!item) return;
    const next = [{ ...item, templateId: crypto.randomUUID() }, ...templates];
    saveTemplates(next); setMessage(`${item.name} saved as a local weekly template.`);
  }

  function addTemplate(template: CampusTemplate) {
    saveEntries([{ ...template, id: crypto.randomUUID(), date }, ...entries]);
    setMessage(`${template.name} added to your menu for ${date}.`);
  }

  function removeEntry(id: string) { saveEntries(entries.filter((entry) => entry.id !== id)); }
  function removeTemplate(id: string) { saveTemplates(templates.filter((item) => item.templateId !== id)); }

  return <main className="container space-y-8 py-8 pb-28 md:pb-10">
    <header className="max-w-3xl space-y-3"><p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"><CalendarDays className="h-4 w-4"/>CAMPUS INTELLIGENCE</p><h1 className="font-display text-4xl font-bold md:text-5xl">Make the mess menu work for you.</h1><p className="text-muted-foreground">Build a weekly hostel, mess, or PG menu from recipes you recognize and meals you enter yourself. Your menu stays on this device; missing nutrition and prices stay unknown.</p></header>

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Weekly campus summary">
      <Summary label="Week of" value={week.start}/><Summary label="Known spending" value={`₹${knownSpend.toFixed(2)}`} detail={unknownPriceCount ? `${unknownPriceCount} item(s) with no checked price` : "All listed meals have a checked price"}/><Summary label="Weekly budget" value={weekBudget ? `₹${enteredBudget.toFixed(2)}` : "Not set"} detail={`Status: ${budgetStatus}`}/><Summary label="Menu entries" value={`${week.items.length}`} detail="Items entered for this week"/>
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <form onSubmit={addToMenu} className="space-y-4 rounded-2xl border bg-card p-5 md:p-6">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Add a meal</p><h2 className="font-display text-2xl font-bold">Mess menu or recipe</h2><p className="text-sm text-muted-foreground">Choose a dataset recipe for estimated nutrition, or enter a menu name with nutrition marked unavailable.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Date<input className={inputClass} type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label><label className="space-y-1.5 text-sm font-medium">Meal<select className={inputClass} value={meal} onChange={(event) => setMeal(event.target.value)}><option>Breakfast</option><option>Lunch</option><option>Snack</option><option>Dinner</option><option>Other</option></select></label></div>
        <div className="rounded-xl bg-muted/50 p-4"><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="campus-recipe-query">Search dataset recipes</label><input id="campus-recipe-query" className={`${inputClass} min-w-48 flex-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a recipe to match a menu meal" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findRecipe(); } }}/><select aria-label="Diet preference" className="rounded-lg border bg-background px-2 text-sm" value={diet} onChange={(event) => setDiet(event.target.value as DietaryPreference)}><option value="omnivore">Any diet</option><option value="vegetarian">Vegetarian, no eggs</option><option value="egg-inclusive">Egg-inclusive</option><option value="vegan">Vegan</option></select><button type="button" disabled={busy} onClick={() => void findRecipe()} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-semibold"><Search className="h-4 w-4"/>{busy ? "Searching…" : "Search"}</button></div>
          {recipeResults && <div className="mt-3 grid gap-2 sm:grid-cols-2">{recipeResults.items.map((recipe) => <button type="button" key={recipe.recipe_id} onClick={() => { setSelected(recipe); setName(""); setMessage(`${recipe.Name} selected. Nutrition uses the dataset serving.`); }} className={`rounded-lg border p-3 text-left text-sm ${selected?.recipe_id === recipe.recipe_id ? "border-primary bg-primary/5" : "bg-card hover:border-primary/50"}`}><span className="block font-semibold">{recipe.Name}</span><span className="text-xs text-muted-foreground">{recipe.Calories} kcal · {recipe.ProteinContent} g protein · dataset serving</span></button>)}{!recipeResults.items.length && <p className="text-sm text-muted-foreground">No recipe matches yet. You can still enter the mess meal below.</p>}</div>}
        </div>
        {selected ? <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><span><strong>{selected.Name}</strong><br/><span className="text-xs text-muted-foreground">Dataset nutrition will be shown as an estimate.</span></span><button type="button" onClick={() => setSelected(null)} className="rounded px-2 py-1 text-primary underline">Clear recipe</button></div> : <label className="block space-y-1.5 text-sm font-medium">Menu item name<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Hostel dal, rice and sabzi"/></label>}
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Portion multiplier<input className={inputClass} type="number" min="0.25" max="3" step="0.25" value={servings} onChange={(event) => setServings(event.target.value)}/></label><label className="space-y-1.5 text-sm font-medium">Price per recorded portion (₹)<input className={inputClass} type="number" min="0.01" max="5000" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Leave blank if unknown"/></label></div>
        {cost && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Where checked?<input className={inputClass} value={source} onChange={(event) => setSource(event.target.value)} maxLength={120} placeholder="Mess board / canteen"/></label><label className="space-y-1.5 text-sm font-medium">Checked on<input className={inputClass} type="date" value={priceDate} onChange={(event) => setPriceDate(event.target.value)}/></label></div>}
        {!selected && <label className="block space-y-1.5 text-sm font-medium">Ingredients for grocery checklist<input className={inputClass} value={ingredientText} onChange={(event) => setIngredientText(event.target.value)} placeholder="Optional; comma separated"/></label>}
        <label className="block space-y-1.5 text-sm font-medium">Weekly budget (₹)<input className={inputClass} type="number" min="0" max="50000" step="1" value={weekBudget} onChange={(event) => updateWeekBudget(event.target.value)} placeholder="Optional budget for this week"/></label>
        <div className="flex flex-wrap gap-2"><button className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"><Plus className="h-4 w-4"/>Add to menu</button><button type="button" onClick={saveTemplate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold"><CopyPlus className="h-4 w-4"/>Save weekly template</button></div>
        <p className="text-xs text-muted-foreground">Saved in this browser only. Custom menu nutrition remains unavailable. Prices are your own checked entries; unknown prices are excluded from known spending totals.</p>
      </form>

      <div className="space-y-5">
        <section className="space-y-3 rounded-2xl border bg-card p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">This week</p><h2 className="font-display text-2xl font-bold">Your campus menu</h2></div><label className="text-xs font-medium">Choose a week<input className="mt-1 block rounded-lg border bg-background px-3 py-2 text-sm" type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label></div>
          {week.items.length ? <div className="space-y-2">{week.items.map((entry) => <article key={entry.id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-primary">{entry.date} · {entry.meal}</p><h3 className="font-semibold">{entry.name}</h3><p className="text-xs text-muted-foreground">{entry.servings} serving multiplier · {entry.cost === null ? "price unknown" : `₹${(entry.cost * entry.servings).toFixed(2)} known cost${entry.priceSource ? ` · ${entry.priceSource} (${entry.priceDate})` : ""}`}</p>{entry.recipe ? <p className="mt-2 text-xs">Dataset estimate: {(entry.recipe.Calories * entry.servings).toFixed(0)} kcal · {(entry.recipe.ProteinContent * entry.servings).toFixed(1)} g protein</p> : <p className="mt-2 text-xs text-muted-foreground">Nutrition unavailable; this is a user-entered menu item.</p>}</div><button type="button" onClick={() => removeEntry(entry.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={`Remove ${entry.name}`}><Trash2 className="h-4 w-4"/></button></div></article>)}</div> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No menu items saved for this week. Add a meal or apply one of your templates.</p>}
        </section>
        <section className="space-y-3 rounded-2xl border bg-card p-5"><div className="flex items-center gap-2"><Leaf className="h-5 w-5 text-primary"/><div><h2 className="font-display text-xl font-bold">Grocery list</h2><p className="text-xs text-muted-foreground">Ingredient names only; this dataset has no quantities.</p></div></div>{groceryList.length ? <ul className="grid gap-2 sm:grid-cols-2">{groceryList.map((ingredient) => <li key={ingredient}><label className="flex items-center gap-2 rounded-lg bg-muted/40 p-2 text-sm"><input type="checkbox"/>{ingredient}</label></li>)}</ul> : <p className="text-sm text-muted-foreground">Add a recipe or enter ingredients on a menu item to build this list.</p>}</section>
      </div>
    </section>

    <section className="space-y-3 rounded-2xl border bg-card p-5"><div className="flex items-center gap-2"><CopyPlus className="h-5 w-5 text-primary"/><div><h2 className="font-display text-2xl font-bold">Recurring menu templates</h2><p className="text-sm text-muted-foreground">Keep regular mess items on this device and add them to any selected week after checking they still apply.</p></div></div>{templates.length ? <div className="grid gap-3 md:grid-cols-2">{templates.map((item) => <article key={item.templateId} className="flex items-start justify-between gap-3 rounded-xl border p-3"><div><p className="text-xs font-semibold text-primary">{item.meal} · {item.servings} portion multiplier</p><h3 className="font-semibold">{item.name}</h3><p className="text-xs text-muted-foreground">{item.cost === null ? "Price unknown" : `₹${item.cost.toFixed(2)} per recorded portion`} · {item.recipe ? `${item.recipe.Calories} kcal dataset estimate` : "Nutrition unavailable"}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => addTemplate(item)} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"><Check className="h-4 w-4"/>Add for {date}</button><button type="button" onClick={() => removeTemplate(item.templateId)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={`Delete ${item.name} template`}><Trash2 className="h-4 w-4"/></button></div></article>)}</div> : <p className="text-sm text-muted-foreground">No recurring templates. Save a regular menu item from the form.</p>}</section>

    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="rounded-lg bg-primary/10 p-3 text-sm text-primary">{message}</p>}
    <p className="text-xs text-muted-foreground">The dataset contains recipe-level nutrition, not a verified hostel food-composition or price database. Custom mess items do not receive guessed macros. An entered cost must include its source and check date; prices may change.</p>
  </main>;
}

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 flex items-center gap-1 text-lg font-bold text-primary">{label.includes("spending") || label.includes("budget") ? <IndianRupee className="h-4 w-4"/> : null}{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>; }
