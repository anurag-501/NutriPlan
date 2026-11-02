import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Dumbbell, Leaf, Search, ClipboardList, CookingPot, ArrowRightLeft, School } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GymPlan, Recipe } from "@/types/recipe";
import heroImage from "@/assets/hero-food.jpg";

interface WeightEntry { date: string; weight: number }
const planKey = "nutriplan.savedPlan";

export default function Index() {
  const [plan, setPlan] = useState<GymPlan | null>(() => read(planKey, null));
  const [savedCount, setSavedCount] = useState(() => read<Recipe[]>("nutriplan.savedRecipes", []).length);
  const [completed, setCompleted] = useState<string[]>(() => read("nutriplan.completeMeals", []));
  const [selection, setSelection] = useState<Record<string, number>>(() => read("nutriplan.selectedMeals", {}));
  const [trackingEnabled, setTrackingEnabled] = useState(() => localStorage.getItem("nutriplan.weightTracking") === "enabled");
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>(() => read("nutriplan.weightEntries", []));
  const [weight, setWeight] = useState("");

  useEffect(() => {
    const refresh = () => {
      setPlan(read(planKey, null));
      setSavedCount(read<Recipe[]>("nutriplan.savedRecipes", []).length);
      setCompleted(read("nutriplan.completeMeals", []));
      setSelection(read("nutriplan.selectedMeals", {}));
    };
    window.addEventListener("nutriplan:updated", refresh);
    return () => window.removeEventListener("nutriplan:updated", refresh);
  }, []);

  const logged = useMemo(() => (plan?.meals || []).filter((meal) => completed.includes(meal.meal_name)).reduce((sum, meal) => {
    const recipeId = selection[meal.meal_name] ?? meal.recipes[0]?.recipe_id;
    const recipe = meal.recipes.find((item) => item.recipe_id === recipeId) ?? meal.recipes[0];
    if (recipe) { sum.calories += recipe.Calories; sum.protein += recipe.ProteinContent; sum.carbs += recipe.CarbohydrateContent; sum.fat += recipe.FatContent; }
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 }), [plan, completed, selection]);
  const calorieTarget = plan?.targets?.target_calories?.[0] || 0;
  const progress = calorieTarget ? Math.min(100, Math.round(logged.calories / calorieTarget * 100)) : 0;

  function toggleTracking(enabled: boolean) {
    setTrackingEnabled(enabled);
    if (enabled) localStorage.setItem("nutriplan.weightTracking", "enabled");
    else localStorage.removeItem("nutriplan.weightTracking");
  }
  function logWeight(event: FormEvent) {
    event.preventDefault();
    if (!trackingEnabled || !weight || Number(weight) < 20 || Number(weight) > 350) return;
    const today = new Date().toISOString().slice(0, 10);
    const next = [...weightEntries.filter((entry) => entry.date !== today), { date: today, weight: Number(weight) }].sort((a, b) => a.date.localeCompare(b.date)).slice(-28);
    setWeightEntries(next); localStorage.setItem("nutriplan.weightEntries", JSON.stringify(next)); setWeight("");
  }

  return (
    <main className="container space-y-8 py-8 md:py-10">
      <section className="grid items-center gap-8 overflow-hidden rounded-3xl border bg-card p-5 shadow-[var(--shadow-card)] md:grid-cols-[1.1fr_0.9fr] md:p-9">
        <div className="space-y-5"><p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary"><Leaf className="h-4 w-4" />NutriPlan · Made for real campus meals</p><h1 className="font-display text-4xl font-bold leading-tight md:text-5xl">Eat well. Spend smart. Waste less.</h1><p className="max-w-2xl text-muted-foreground">Compare real recipe options, make sense of your mess menu, and keep a private plan on this device. Nutrition and price gaps stay visible instead of being guessed.</p><div className="flex flex-wrap gap-3"><Link to="/foodswap" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground"><ArrowRightLeft className="h-4 w-4"/>Fix My Plate with FoodSwap <ArrowRight className="h-4 w-4" /></Link><Link to="/recipes" className="inline-flex items-center gap-2 rounded-lg border bg-card px-5 py-3 font-semibold"><Search className="h-4 w-4" />Explore recipes</Link><Link to="/campus" className="inline-flex items-center gap-2 rounded-lg border bg-card px-5 py-3 font-semibold"><School className="h-4 w-4"/>Campus menu</Link></div></div>
        <img src={heroImage} alt="Fresh ingredients for everyday meals" className="h-64 w-full rounded-2xl object-cover md:h-80" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Estimated calorie target" value={calorieTarget ? `${calorieTarget.toLocaleString()} kcal` : "—"} detail={plan ? "Saved plan estimate" : "Build a plan to see your target"} />
        <Metric title="Logged intake" value={`${Math.round(logged.calories).toLocaleString()} kcal`} detail={`${Math.round(logged.protein)} g protein · ${Math.round(logged.carbs)} g carbs · ${Math.round(logged.fat)} g fat`} />
        <Metric title="Meals completed" value={`${completed.length}/${plan?.meals.length || 0}`} detail="Check meals in My Diet Plan" />
        <Metric title="Saved recipes" value={String(savedCount)} detail="Stored locally on this device" />
      </section>

      {plan && <section className="rounded-2xl border bg-card p-5 md:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-bold">Today’s progress</h2><p className="text-sm text-muted-foreground">Logged meals contribute dataset-reported estimates.</p></div><Link to="/my-plan" className="text-sm font-semibold text-primary underline">Open My Diet Plan</Link></div><div className="mt-4 h-4 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-sm text-muted-foreground">{progress}% of the saved calorie estimate from meals marked complete · {Math.max(0, Math.round(calorieTarget - logged.calories))} kcal remaining estimate</p></section>}

      <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]"><div className="rounded-2xl border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Weekly weight trend</h2><p className="text-sm text-muted-foreground">Optional. Entries stay in this browser and aren’t sent to the API.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trackingEnabled} onChange={(e) => toggleTracking(e.target.checked)} />Enable local logging</label></div>{trackingEnabled ? <><form onSubmit={logWeight} className="my-4 flex gap-2"><input aria-label="Weight in kilograms" type="number" min="20" max="350" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Weight in kg" className="max-w-xs flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Log today</button></form>{weightEntries.length ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={weightEntries}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="weight" name="kg" stroke="hsl(152 45% 28%)" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <p className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground">No weight entries yet. Logging is optional; you can leave it disabled and use the rest of the planner.</p>}</> : <p className="mt-5 rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground">Weight tracking is off. Enable it only if you want to store an optional trend on this device.</p>}</div>
        <div className="space-y-4"><ActionCard to="/foodswap" icon={<ArrowRightLeft className="h-5 w-5" />} title="FoodSwap · Fix My Plate" detail="Compare dataset meals and swap options with visible nutrition and user-entered prices." /><ActionCard to="/campus" icon={<School className="h-5 w-5" />} title="Campus meal optimizer" detail="Keep a hostel menu, checked costs, grocery names, and weekly templates." /><ActionCard to="/gym" icon={<Dumbbell className="h-5 w-5" />} title="Gym Diet Planner" detail="Age-aware calorie and macro estimates with meal suggestions." /><ActionCard to="/recipes" icon={<Search className="h-5 w-5" />} title="Recipe Explorer" detail="Filter dataset recipes by calories, protein, time, meal type, and exclusions." /><ActionCard to="/fix-my-plate" icon={<ClipboardList className="h-5 w-5" />} title="Build a meal plate" detail="Add known recipes, set serving multipliers, and log backend totals." /><ActionCard to="/kitchen" icon={<CookingPot className="h-5 w-5" />} title="What’s in My Kitchen?" detail="Find recipe matches for ingredients you confirm are available." /><ActionCard to="/my-plan" icon={<Leaf className="h-5 w-5" />} title="My Diet Plan" detail="Saved plan, local bookmarks, meal check-ins, and shopping list." /></div>
      </section>
      <p className="text-xs text-muted-foreground">Nutrition estimates are not medical advice. Recipes and nutrition values come from the bundled Food.com dataset; ingredient quantities and prices are not available in its schema.</p>
    </main>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) { return <div className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold text-primary">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
function ActionCard({ to, icon, title, detail }: { to: string; icon: React.ReactNode; title: string; detail: string }) { return <Link to={to} className="flex gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"><span className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</span><span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted-foreground">{detail}</span></span></Link>; }
function read<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
