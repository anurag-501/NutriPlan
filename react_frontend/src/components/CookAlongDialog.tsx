import { useEffect, useState } from "react";
import { ChefHat, ChevronLeft, ChevronRight, Clock3, Pause, Play, X } from "lucide-react";
import type { Recipe } from "@/types/recipe";

export default function CookAlongDialog({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const steps = recipe.RecipeInstructions || [];
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((remaining) => {
      if (remaining <= 1) { setRunning(false); return 0; }
      return remaining - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  function startTimer(minutes: number) { setSeconds(minutes * 60); setRunning(true); }
  function formatTime(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }

  return <div className="fixed inset-0 z-[80] grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="cook-along-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border bg-card p-5 shadow-2xl sm:rounded-2xl sm:p-7">
      <div className="flex items-start justify-between gap-3"><div><p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><ChefHat className="h-4 w-4"/>Cook with me · dataset instructions</p><h2 id="cook-along-title" className="mt-1 font-display text-2xl font-bold">{recipe.Name}</h2><p className="text-sm text-muted-foreground">{recipe.Calories} kcal · {recipe.ProteinContent} g protein per recorded serving</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-muted" aria-label="Close cook mode"><X className="h-5 w-5"/></button></div>
      <div className="mt-5 grid gap-5 md:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl bg-muted/50 p-4"><h3 className="font-semibold">Ingredient list</h3>{recipe.RecipeIngredientParts.length ? <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">{recipe.RecipeIngredientParts.map((ingredient, index) => <li key={`${ingredient}-${index}`}>{ingredient}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No ingredient list was provided for this recipe.</p>}<p className="mt-3 text-xs text-muted-foreground">Quantities are not present in the bundled dataset. Check packaging and adjust to your portions.</p></div>
        <div className="space-y-3"><div className="rounded-xl border p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wider text-primary">Step {steps.length ? step + 1 : 0} of {steps.length}</p><span className="text-xs text-muted-foreground">Follow actual dataset directions</span></div>{steps.length ? <p className="mt-3 text-lg leading-relaxed">{steps[step]}</p> : <p className="mt-3 text-sm text-muted-foreground">No instructions are available in the source data. Use this panel for the ingredient list only.</p>}<div className="mt-4 flex justify-between gap-2"><button type="button" disabled={!steps.length || step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"><ChevronLeft className="h-4 w-4"/>Previous</button><button type="button" disabled={!steps.length || step >= steps.length - 1} onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">Next step<ChevronRight className="h-4 w-4"/></button></div></div>
          <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><p className="inline-flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4 text-primary"/>Optional kitchen timer</p><span role="timer" aria-live="polite" className="font-mono text-xl font-bold">{formatTime(seconds)}</span></div><p className="mt-1 text-xs text-muted-foreground">Set a timer for your own cooking step; recipe directions do not specify reliable per-step times.</p><div className="mt-3 flex flex-wrap gap-2">{[5, 10, 15].map((minutes) => <button type="button" key={minutes} onClick={() => startTimer(minutes)} className="rounded-lg border px-3 py-1.5 text-sm">{minutes} min</button>)}{running ? <button type="button" onClick={() => setRunning(false)} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"><Pause className="h-4 w-4"/>Pause</button> : seconds > 0 ? <button type="button" onClick={() => setRunning(true)} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"><Play className="h-4 w-4"/>Resume</button> : null}</div></div>
        </div>
      </div>
    </section>
  </div>;
}
