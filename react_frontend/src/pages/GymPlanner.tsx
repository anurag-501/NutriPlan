import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Save } from "lucide-react";
import RecipeTile from "@/components/RecipeTile";
import { generateGymPlan, ApiError } from "@/lib/api";
import type { DietaryPreference, GymGoal, GymPlan, GymPlanRequest, Recipe } from "@/types/recipe";
import { ACTIVITY_LEVELS } from "@/types/recipe";

const fieldClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";
const labelClass = "space-y-1.5 text-sm font-medium text-foreground";

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function GymPlanner() {
  const [form, setForm] = useState({
    age: 25, height: 170, weight: 70, sex: "range" as GymPlanRequest["sex_coefficient"],
    activity: ACTIVITY_LEVELS[2] as string, trainingDays: 4, experience: "intermediate" as GymPlanRequest["training_experience"],
    goal: "lean_gain" as GymGoal, diet: "omnivore" as DietaryPreference,
    allergies: "", disliked: "", meals: 4 as 3 | 4 | 5, budget: "", cuisine: "",
    workoutTime: "evening" as GymPlanRequest["workout_time"], support: false,
  });
  const [result, setResult] = useState<GymPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((old) => ({ ...old, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    const request: GymPlanRequest = {
      age: Number(form.age), height: Number(form.height), weight: Number(form.weight),
      sex_coefficient: form.sex, activity: form.activity, training_days: Number(form.trainingDays),
      training_experience: form.experience, goal: form.goal, dietary_preference: form.diet,
      allergies: splitList(form.allergies), disliked_foods: splitList(form.disliked),
      meals_per_day: form.meals, budget: form.budget || undefined, cuisine: form.cuisine || undefined,
      workout_time: form.workoutTime, professional_support_needed: form.support,
    };
    try { setResult(await generateGymPlan(request)); }
    catch (err) { setError(err instanceof ApiError ? `API ${err.status}: ${err.message}` : "Could not connect to the planner. Check that the backend is running on port 8080."); }
    finally { setBusy(false); }
  }

  function savePlan() {
    if (!result?.available) return;
    localStorage.setItem("nutriplan.savedPlan", JSON.stringify(result));
    window.dispatchEvent(new Event("nutriplan:updated"));
  }
  function saveRecipe(recipe: Recipe) {
    const saved: Recipe[] = JSON.parse(localStorage.getItem("nutriplan.savedRecipes") || "[]");
    if (!saved.some((item) => item.recipe_id === recipe.recipe_id)) {
      localStorage.setItem("nutriplan.savedRecipes", JSON.stringify([...saved, recipe]));
      window.dispatchEvent(new Event("nutriplan:updated"));
    }
  }
  const target = result?.targets;

  return (
    <main className="container space-y-8 py-8">
      <header className="max-w-3xl space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Personal nutrition · Training support</p>
        <h1 className="font-display text-3xl font-bold md:text-4xl">Gym Diet Planner</h1>
        <p className="text-muted-foreground">Get explainable calorie and macro estimates, then match meals from the existing recipe library. Estimates are educational starting points, not prescriptions.</p>
      </header>

      <form onSubmit={submit} className="space-y-6 rounded-2xl border bg-card p-5 md:p-7" style={{ boxShadow: "var(--shadow-card)" }}>
        <section>
          <h2 className="mb-4 font-display text-xl font-semibold">Your profile</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>Age<input className={fieldClass} type="number" min={13} max={100} required value={form.age} onChange={(e) => update("age", +e.target.value)} /></label>
            <label className={labelClass}>Height (cm)<input className={fieldClass} type="number" min={101} max={250} required value={form.height} onChange={(e) => update("height", +e.target.value)} /></label>
            <label className={labelClass}>Weight (kg)<input className={fieldClass} type="number" min={26} max={300} required value={form.weight} onChange={(e) => update("weight", +e.target.value)} /></label>
            <label className={labelClass}>Equation input<select className={fieldClass} value={form.sex} onChange={(e) => update("sex", e.target.value as typeof form.sex)}><option value="range">Show both equation estimates</option><option value="female">Female coefficient</option><option value="male">Male coefficient</option></select></label>
            <label className={`${labelClass} sm:col-span-2`}>Activity level<select className={fieldClass} value={form.activity} onChange={(e) => update("activity", e.target.value)}>{ACTIVITY_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The equation coefficient is a physiological input, not a statement about gender identity. Choose a range if neither single coefficient is appropriate.</p>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl font-semibold">Training and goal</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>Training days per week<input className={fieldClass} type="number" min={0} max={7} value={form.trainingDays} onChange={(e) => update("trainingDays", +e.target.value)} /></label>
            <label className={labelClass}>Training experience<select className={fieldClass} value={form.experience} onChange={(e) => update("experience", e.target.value as typeof form.experience)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
            <label className={labelClass}>Goal<select className={fieldClass} value={form.goal} onChange={(e) => update("goal", e.target.value as GymGoal)}><option value="lean_gain">Lean muscle gain</option><option value="bulk">Muscle bulking</option><option value="fat_loss">Fat loss while maintaining muscle</option><option value="maintenance">Maintenance / general fitness</option></select></label>
            <label className={labelClass}>Meals per day<select className={fieldClass} value={form.meals} onChange={(e) => update("meals", +e.target.value as 3 | 4 | 5)}><option value={3}>3 meals</option><option value={4}>4 meals</option><option value={5}>5 meals</option></select></label>
            <label className={labelClass}>Usual workout time<select className={fieldClass} value={form.workoutTime} onChange={(e) => update("workoutTime", e.target.value as typeof form.workoutTime)}><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="flexible">Flexible</option></select></label>
            <label className={labelClass}>Diet preference<select className={fieldClass} value={form.diet} onChange={(e) => update("diet", e.target.value as DietaryPreference)}><option value="vegetarian">Vegetarian (no eggs)</option><option value="egg-inclusive">Egg-inclusive vegetarian</option><option value="vegan">Vegan</option><option value="omnivore">No diet filter</option></select></label>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl font-semibold">Food preferences</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>Allergies / intolerances<input className={fieldClass} placeholder="Comma-separated ingredients to exclude" value={form.allergies} onChange={(e) => update("allergies", e.target.value)} /></label>
            <label className={labelClass}>Foods you dislike<input className={fieldClass} placeholder="Comma-separated ingredients to exclude" value={form.disliked} onChange={(e) => update("disliked", e.target.value)} /></label>
            <label className={labelClass}>Cuisine keyword (optional)<input className={fieldClass} placeholder="e.g. Indian, Italian" value={form.cuisine} onChange={(e) => update("cuisine", e.target.value)} /></label>
            <label className={labelClass}>Budget preference (optional)<input className={fieldClass} placeholder="e.g. budget-friendly" value={form.budget} onChange={(e) => update("budget", e.target.value)} /></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The dataset has no price or structured cuisine fields. Cuisine is a text match; budget is recorded in the request but cannot be applied.</p>
        </section>

        <label className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 text-sm text-foreground dark:bg-amber-950/20">
          <input className="mt-1" type="checkbox" checked={form.support} onChange={(e) => update("support", e.target.checked)} />
          <span>I need individualized advice for pregnancy, a medical condition, eating-disorder concerns, or another health situation. If checked, the planner will not calculate personal targets.</span>
        </label>
        <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Building your plan…" : "Build my gym plan"}</button>
      </form>

      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-destructive">{error}</p>}
      {result && !result.available && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><h2 className="mb-2 font-display text-xl font-semibold">Personalized targets aren’t available for this profile</h2><p>{result.guidance}</p></section>}
      {result?.available && target && <div className="space-y-8">
        <section className="rounded-2xl bg-primary p-6 text-primary-foreground" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm opacity-80">Estimated daily energy target</p><h2 className="font-display text-3xl font-bold">{target.target_calories?.[0] === target.target_calories?.[1] ? `${target.target_calories?.[0]} kcal` : `${target.target_calories?.[0]}–${target.target_calories?.[1]} kcal`}</h2><p className="mt-1 text-sm opacity-80">Maintenance estimate: {target.maintenance_calories?.[0]}–{target.maintenance_calories?.[1]} kcal</p></div><button type="button" onClick={savePlan} className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"><Save className="h-4 w-4" /> Save on this device</button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><Macro label="Protein target" value={`${target.protein_g_target} g`} detail={`Range ${target.protein_g_range?.[0]}–${target.protein_g_range?.[1]} g`} /><Macro label="Carbohydrate estimate" value={`${target.carbohydrate_g_target} g`} /><Macro label="Fat estimate" value={`${target.fat_g_target} g`} /></div>
        </section>
        <section className="space-y-2 text-sm text-muted-foreground"><p>{target.energy_method} {target.equation_note}</p><p>{target.protein_basis}</p><p>{target.macronutrient_method}</p>{target.older_adult_note && <p>{target.older_adult_note}</p>}</section>
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="font-display text-2xl font-bold">Your meal suggestions</h2><p className="text-sm text-muted-foreground">Recommendations are the closest matches in the selected dataset subset.</p></div>
            <Link className="text-sm font-semibold text-primary underline" to="/my-plan">Open My Diet Plan →</Link>
          </div>
          <div className="space-y-8">
            {result.meals.map((meal) => <div key={meal.meal_name}>
              <h3 className="mb-3 font-display text-xl font-semibold capitalize">{meal.meal_name} <span className="text-sm font-normal text-muted-foreground">· around {meal.recommended_calories} kcal</span></h3>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{meal.recipes.map((recipe) => <RecipeTile key={recipe.recipe_id} recipe={recipe} onSave={saveRecipe} />)}</div>
            </div>)}
          </div>
        </section>
        {[result.pre_workout, result.post_workout].map((workout, index) => workout && <section key={index}>
          <h2 className="mb-2 font-display text-xl font-semibold">{index === 0 ? "Pre-workout ideas" : "Post-workout ideas"}</h2>
          <p className="mb-3 text-sm text-muted-foreground">{workout.timing}</p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{workout.recipes.map((recipe) => <RecipeTile key={recipe.recipe_id} recipe={recipe} onSave={saveRecipe} />)}</div>
        </section>)}
        <section className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground"><h2 className="mb-2 font-semibold text-foreground">Data and safety notes</h2><p>{result.nutrition_source}</p><ul className="mt-2 list-inside list-disc space-y-1">{result.limitations.map((note) => <li key={note}>{note}</li>)}</ul></section>
      </div>}
    </main>
  );
}

function Macro({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-xl bg-white/10 p-4"><p className="text-xs opacity-75">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p>{detail && <p className="mt-1 text-xs opacity-75">{detail}</p>}</div>;
}
