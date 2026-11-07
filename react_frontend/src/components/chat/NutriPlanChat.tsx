import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MessageCircle, Send, Sparkles, X, Trash2, LoaderCircle, WifiOff, Settings2, Plus } from "lucide-react";
import { toast } from "sonner";
import { applyChatPlanAction, ApiError, getChatHealth, sendChat } from "@/lib/api";
import type { ChatHealth, ChatProfile, ChatRecipe, ChatResponse, ChatTurn } from "@/types/chat";
import type { GymPlan } from "@/types/recipe";
import ChatMarkdown from "@/components/chat/ChatMarkdown";
import ChatDietPlanCard from "@/components/chat/ChatDietPlanCard";
import ChatRecipeCard from "@/components/chat/ChatRecipeCard";

interface ChatEntry extends ChatTurn {
  id: string;
  recipes?: ChatRecipe[];
  notes?: string[];
  dietPlan?: GymPlan;
}

interface FailedRequest {
  messages: ChatTurn[];
  profile: ChatProfile;
}

const CHAT_LIMIT = 3000;
const SUGGESTIONS = [
  "Find high-protein vegetarian dinners I can cook in 30 minutes.",
  "How much protein should I aim for to support strength training?",
  "Suggest a vegan meal using ingredients I have.",
  "Help me understand my calorie estimate.",
];
const ACTIVITY_LEVELS = [
  "Little/no exercise",
  "Light exercise",
  "Moderate exercise (3-5 days/wk)",
  "Very active (6-7 days/wk)",
  "Extra active (very active & physical job)",
];

export default function NutriPlanChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedRequest, setFailedRequest] = useState<FailedRequest | null>(null);
  const [health, setHealth] = useState<ChatHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [profile, setProfile] = useState<ChatProfile>({});
  const [allergyText, setAllergyText] = useState("");
  const [dislikedText, setDislikedText] = useState("");
  const [availableText, setAvailableText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmPlanSave, setConfirmPlanSave] = useState<GymPlan | null>(null);
  const [plan, setPlan] = useState<GymPlan | null>(() => readStorage<GymPlan | null>("nutriplan.savedPlan", null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  async function refreshHealth() {
    try {
      setHealth(await getChatHealth());
      setHealthError(false);
    } catch {
      setHealth(null);
      setHealthError(true);
    }
  }

  const currentProfile = useMemo<ChatProfile>(() => ({
    ...profile,
    allergies: splitTerms(allergyText),
    disliked_foods: splitTerms(dislikedText),
    available_ingredients: splitTerms(availableText),
  }), [profile, allergyText, dislikedText, availableText]);

  useEffect(() => {
    let cancelled = false;
    getChatHealth().then((result) => { if (!cancelled) { setHealth(result); setHealthError(false); } })
      .catch(() => { if (!cancelled) { setHealth(null); setHealthError(true); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const update = () => setPlan(readStorage<GymPlan | null>("nutriplan.savedPlan", null));
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("nutriplan:updated", update);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("nutriplan:updated", update);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    try { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); } catch { /* Optional on constrained browsers. */ }
  }, [messages, busy, error]);

  useEffect(() => {
    if (!confirmClear) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setConfirmClear(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClear]);

  async function runRequest(turns: ChatTurn[], profileSnapshot: ChatProfile) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true); setError(""); setFailedRequest(null);
    if (!online) {
      setError("You appear to be offline. Reconnect and retry your message.");
      setFailedRequest({ messages: turns, profile: profileSnapshot });
      setBusy(false); sendingRef.current = false;
      return;
    }
    try {
      const result: ChatResponse = await sendChat(turns, profileSnapshot);
      setHealth((current) => ({
        provider: "openai", model: current?.model ?? "OpenAI",
        history: current?.history ?? "session only", ...current,
        configured: true, status: "available", status_message: "A chat response succeeded in this backend process.",
      }));
      setMessages((previous) => [...previous, {
        id: makeId(), role: "assistant", content: result.message, recipes: result.recipes, notes: result.notes,
        dietPlan: result.diet_plan ?? undefined,
      }]);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setFailedRequest({ messages: turns, profile: profileSnapshot });
      void refreshHealth();
    } finally {
      setBusy(false); sendingRef.current = false;
    }
  }

  async function sendMessage(rawText: string) {
    const content = rawText.trim();
    if (!content || busy || sendingRef.current || content.length > CHAT_LIMIT) return;
    const userEntry: ChatEntry = { id: makeId(), role: "user", content };
    const nextEntries = [...messages, userEntry].slice(-12);
    const turns = nextEntries.map(({ role, content: text }) => ({ role, content: text }));
    setMessages(nextEntries);
    setComposer("");
    await runRequest(turns, currentProfile);
  }

  async function retry() {
    if (failedRequest) await runRequest(failedRequest.messages, failedRequest.profile);
  }

  async function applyPlanAction(recipe: ChatRecipe, action: "add" | "replace", mealName?: string) {
    if (planBusy) return;
    setPlanBusy(true);
    try {
      const savedPlan = readStorage<GymPlan | null>("nutriplan.savedPlan", null);
      const selected = readStorage<Record<string, number>>("nutriplan.selectedMeals", {});
      const currentMeals = (savedPlan?.meals || []).map((meal) => {
        const recipeIds = meal.recipes.map((item) => item.recipe_id ?? item.RecipeId).filter((id): id is number => typeof id === "number");
        return {
          meal_name: meal.meal_name,
          recommended_calories: Math.max(0, Math.round(meal.recommended_calories || 0)),
          recipe_ids: Array.from(new Set(recipeIds)).slice(0, 5),
          selected_recipe_id: selected[meal.meal_name] && recipeIds.includes(selected[meal.meal_name]) ? selected[meal.meal_name] : recipeIds[0],
        };
      }).filter((meal) => meal.recipe_ids.length > 0 && meal.selected_recipe_id !== undefined);
      const exclusions = Array.from(new Set([
        ...(currentProfile.allergies || []), ...(currentProfile.disliked_foods || []), ...recipe.excluded_ingredients,
      ]));
      const result = await applyChatPlanAction({
        action,
        recipe_id: recipe.recipe_id,
        meal_name: mealName,
        dietary_preference: recipe.dietary_preference ?? currentProfile.dietary_preference,
        allergies: exclusions,
        current_meals: currentMeals,
      });
      const nextPlan: GymPlan = savedPlan
        ? { ...savedPlan, meals: result.meals }
        : {
            available: true, estimated: true,
            guidance: "This is a recipe draft created by an explicit chat action. It has no personalized calorie target.",
            meals: result.meals,
            limitations: [result.nutrition_note, "No personalized daily target was calculated for this draft."],
            nutrition_source: result.nutrition_source,
            pre_workout: null, post_workout: null,
          };
      localStorage.setItem("nutriplan.savedPlan", JSON.stringify(nextPlan));
      localStorage.setItem("nutriplan.selectedMeals", JSON.stringify(result.selected_recipe_ids));
      localStorage.setItem("nutriplan.chatPlanTotals", JSON.stringify(result.nutrition_totals));
      window.dispatchEvent(new Event("nutriplan:updated"));
      setPlan(nextPlan);
      toast.success(action === "add" ? "Added to your diet plan" : "Meal replaced", {
        description: `Verified plan total: ${Math.round(result.nutrition_totals.calories)} kcal · ${Math.round(result.nutrition_totals.protein_g)} g protein across selected meals.`,
      });
    } catch (requestError) {
      toast.error("Could not update the plan", { description: errorMessage(requestError) });
    } finally {
      setPlanBusy(false);
    }
  }

  function saveGeneratedPlan(generatedPlan: GymPlan) {
    if (plan) {
      setConfirmPlanSave(generatedPlan);
      return;
    }
    persistGeneratedPlan(generatedPlan);
  }

  function persistGeneratedPlan(generatedPlan: GymPlan) {
    const selectedRecipeIds = Object.fromEntries(generatedPlan.meals.flatMap((meal) => {
      const recipeId = meal.recipes[0]?.recipe_id ?? meal.recipes[0]?.RecipeId;
      return typeof recipeId === "number" ? [[meal.meal_name, recipeId]] : [];
    }));
    localStorage.setItem("nutriplan.savedPlan", JSON.stringify(generatedPlan));
    localStorage.setItem("nutriplan.selectedMeals", JSON.stringify(selectedRecipeIds));
    window.dispatchEvent(new Event("nutriplan:updated"));
    setPlan(generatedPlan);
    setConfirmPlanSave(null);
    toast.success("Diet plan saved to My Plan", { description: "You can change recipe choices or remove the saved plan from the My Plan page." });
  }

  function clearConversation() {
    setMessages([]); setError(""); setFailedRequest(null); setComposer(""); setConfirmClear(false);
    setProfile({}); setAllergyText(""); setDislikedText(""); setAvailableText("");
  }

  function updateNumber(key: "age" | "height" | "weight" | "training_days" | "max_minutes", value: string) {
    setProfile((old) => ({ ...old, [key]: value === "" ? undefined : Number(value) }));
  }

  function updateProfile<K extends keyof ChatProfile>(key: K, value: ChatProfile[K]) {
    setProfile((old) => ({ ...old, [key]: value }));
  }

  const status = healthError ? "backend_offline" : health?.status ?? (health?.configured ? "configured_unverified" : "missing_configuration");
  const statusLabels: Record<string, string> = {
    available: health?.provider === "ollama" ? `Local AI ready · ${health?.model ?? "Ollama"}` : `AI responded · ${health?.model ?? "OpenAI"}`,
    configured_unverified: "AI configured · not checked",
    missing_configuration: "AI provider configuration missing",
    invalid_configuration: "AI configuration invalid",
    invalid_credentials: "OpenAI key rejected",
    permission_denied: "Model access unavailable",
    model_unavailable: health?.provider === "ollama" ? "Local model not installed" : "Configured model unavailable",
    provider_rate_limited: "OpenAI rate limited",
    quota_exceeded: "OpenAI quota or billing issue",
    timeout: "AI request timed out",
    connection_error: health?.provider === "ollama" ? "Local Ollama is offline" : "AI provider connection problem",
    provider_unavailable: "AI provider temporarily unavailable",
    provider_error: "AI request failed",
    backend_offline: "API offline",
  };
  const readyLabel = statusLabels[status] ?? "AI status unknown";
  const statusClass = status === "available" ? "bg-emerald-500" : status === "backend_offline" || status === "invalid_credentials" || status === "provider_error" ? "bg-destructive" : "bg-amber-500";

  return <>
    {open && <section id="nutriplan-chat-window" className="fixed inset-x-2 bottom-20 z-[70] flex max-h-[calc(100dvh-6rem)] w-auto flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-5 sm:max-h-[calc(100dvh-7rem)] sm:w-[min(420px,calc(100vw-2.5rem))]" aria-label="NutriPlan AI chat">
      <header className="flex items-center justify-between gap-3 border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15"><Sparkles className="h-5 w-5" aria-hidden="true" /></div><div className="min-w-0"><h2 className="truncate font-display font-semibold">NutriPlan AI</h2><p className="truncate text-xs text-primary-foreground/80">Your Personal Diet Assistant</p></div></div>
        <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => setConfirmClear(true)} disabled={busy} className="rounded-md p-2 hover:bg-white/15 disabled:opacity-40" aria-label="New chat" title="New chat"><Plus className="h-4 w-4" /></button><button type="button" onClick={() => setConfirmClear(true)} disabled={messages.length === 0 || busy} className="rounded-md p-2 hover:bg-white/15 disabled:opacity-40" aria-label="Clear chat" title="Clear chat"><Trash2 className="h-4 w-4" /></button><button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-white/15" aria-label="Collapse chat"><X className="h-4 w-4" /></button></div>
      </header>

      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground"><span className={`h-2 w-2 rounded-full ${statusClass}`} aria-hidden="true" /><span aria-live="polite">{readyLabel}</span><button type="button" onClick={() => void refreshHealth()} className="rounded underline underline-offset-2" aria-label="Refresh AI status">Check</button><span className="ml-auto">Session only</span></div>

      <details className="border-b px-4 py-2 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground"><Settings2 className="h-4 w-4 text-primary" aria-hidden="true" /> Optional profile & preferences <span className="ml-auto text-xs font-normal text-muted-foreground">Only sent with your chat request</span></summary>
        <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pt-3 pb-1">
          <Field label="Age"><input aria-label="Age" type="number" min={1} max={100} value={profile.age ?? ""} onChange={(event) => updateNumber("age", event.target.value)} className={fieldClass} /></Field>
          <Field label="Goal"><select aria-label="Goal" value={profile.goal ?? ""} onChange={(event) => updateProfile("goal", (event.target.value || undefined) as ChatProfile["goal"])} className={fieldClass}><option value="">Not specified</option><option value="lean_gain">Lean gain</option><option value="bulk">Bulk</option><option value="fat_loss">Fat loss</option><option value="maintenance">Maintenance</option></select></Field>
          <Field label="Height (cm)"><input aria-label="Height in cm" type="number" min={101} max={250} value={profile.height ?? ""} onChange={(event) => updateNumber("height", event.target.value)} className={fieldClass} /></Field>
          <Field label="Weight (kg)"><input aria-label="Weight in kg" type="number" min={26} max={300} value={profile.weight ?? ""} onChange={(event) => updateNumber("weight", event.target.value)} className={fieldClass} /></Field>
          <Field label="Equation input"><select aria-label="Equation input" value={profile.sex_coefficient ?? ""} onChange={(event) => updateProfile("sex_coefficient", (event.target.value || undefined) as ChatProfile["sex_coefficient"])} className={fieldClass}><option value="">Not specified</option><option value="range">Show a range</option><option value="female">Female coefficient</option><option value="male">Male coefficient</option></select></Field>
          <Field label="Activity"><select aria-label="Activity level" value={profile.activity ?? ""} onChange={(event) => updateProfile("activity", event.target.value || undefined)} className={fieldClass}><option value="">Not specified</option>{ACTIVITY_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></Field>
          <Field label="Training days/week"><input aria-label="Training days per week" type="number" min={0} max={7} value={profile.training_days ?? ""} onChange={(event) => updateNumber("training_days", event.target.value)} className={fieldClass} /></Field>
          <Field label="Diet"><select aria-label="Diet preference" value={profile.dietary_preference ?? ""} onChange={(event) => updateProfile("dietary_preference", (event.target.value || undefined) as ChatProfile["dietary_preference"])} className={fieldClass}><option value="">No preference set</option><option value="vegetarian">Vegetarian (no eggs)</option><option value="egg-inclusive">Vegetarian, eggs included</option><option value="vegan">Vegan</option><option value="omnivore">No diet filter</option></select></Field>
          <Field label="Max cook time (min)"><input aria-label="Maximum cooking time" type="number" min={1} max={1440} value={profile.max_minutes ?? ""} onChange={(event) => updateNumber("max_minutes", event.target.value)} className={fieldClass} /></Field>
          <Field label="Meal type"><select aria-label="Meal type" value={profile.meal_category ?? ""} onChange={(event) => updateProfile("meal_category", (event.target.value || undefined) as ChatProfile["meal_category"])} className={fieldClass}><option value="">Any</option><option value="breakfast">Breakfast</option><option value="main meal">Main meal</option><option value="snack">Snack</option></select></Field>
          <Field label="Meals per day"><select aria-label="Meals per day" value={profile.meals_per_day ?? ""} onChange={(event) => updateProfile("meals_per_day", (event.target.value ? Number(event.target.value) : undefined) as ChatProfile["meals_per_day"])} className={fieldClass}><option value="">Planner default (3)</option><option value={3}>3 meals</option><option value={4}>4 meals</option><option value={5}>5 meals</option></select></Field>
          <Field label="Cuisine preference"><input aria-label="Cuisine preference" placeholder="Optional" value={profile.cuisine ?? ""} onChange={(event) => updateProfile("cuisine", event.target.value || undefined)} className={fieldClass} /></Field>
          <Field label="Allergies / exclusions"><input aria-label="Allergies" placeholder="Comma-separated" value={allergyText} onChange={(event) => setAllergyText(event.target.value)} className={fieldClass} /></Field>
          <Field label="Dislikes"><input aria-label="Disliked foods" placeholder="Comma-separated" value={dislikedText} onChange={(event) => setDislikedText(event.target.value)} className={fieldClass} /></Field>
          <Field label="Ingredients available"><input aria-label="Available ingredients" placeholder="Comma-separated" value={availableText} onChange={(event) => setAvailableText(event.target.value)} className={fieldClass} /></Field>
          <Field label="Budget preference"><input aria-label="Budget preference" value={profile.budget_preference ?? ""} onChange={(event) => updateProfile("budget_preference", event.target.value || undefined)} className={fieldClass} /></Field>
          <label className="col-span-2 flex items-start gap-2 rounded-md border border-amber-300/60 p-2 text-xs"><input type="checkbox" checked={profile.professional_support_needed ?? false} onChange={(event) => updateProfile("professional_support_needed", event.target.checked)} /><span>I need individualized advice for a health situation. If checked, the planner will withhold personal targets.</span></label>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Profile fields stay in this page session. Budget and allergen certification are unavailable in the recipe data; keyword filtering cannot guarantee allergy safety or account for cross-contact.</p>
      </details>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? <div className="mx-auto max-w-sm py-3 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-6 w-6" aria-hidden="true" /></div>
          <h3 className="font-display text-lg font-semibold">What can I help you plan?</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ask about meals, training nutrition, or your preferences. If profile details are needed for an estimate, I’ll ask first.</p>
          <div className="mt-4 grid gap-2 text-left">{SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={busy} onClick={() => void sendMessage(suggestion)} className="rounded-xl border bg-background px-3 py-2 text-xs leading-relaxed transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60">{suggestion}</button>)}</div>
        </div> : messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[92%] space-y-3 rounded-2xl px-3 py-2.5 ${message.role === "user" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
            {message.role === "assistant" ? <ChatMarkdown content={message.content} /> : <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>}
            {message.dietPlan && <ChatDietPlanCard plan={message.dietPlan} savedPlanExists={Boolean(plan)} onSave={saveGeneratedPlan} />}
            {message.recipes?.map((recipe) => <ChatRecipeCard key={recipe.recipe_id} recipe={recipe} plan={plan} busy={planBusy} onPlanAction={applyPlanAction} />)}
            {message.notes?.map((note, index) => <p key={index} className="rounded-md bg-muted/70 p-2 text-xs text-muted-foreground">{note}</p>)}
          </div>
        </div>)}
        {busy && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl border bg-background px-3 py-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /><span>NutriPlan AI is thinking…</span></div></div>}
        {error && <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert"><p className="flex items-start gap-2"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{error}</span></p><div className="mt-2 flex gap-2">{failedRequest && <button type="button" disabled={busy || !online} onClick={() => void retry()} className="rounded-md border bg-background px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Retry</button>}<button type="button" onClick={() => { setError(""); setFailedRequest(null); }} className="rounded-md border bg-background px-3 py-1.5 text-xs font-semibold">Dismiss</button></div></div>}
      </div>

      <div className="border-t p-3">
        {!online && <p className="mb-2 text-xs text-destructive" role="status">Offline — reconnect to send a message.</p>}
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
          <label className="sr-only" htmlFor="nutriplan-chat-input">Message NutriPlan AI</label>
          <textarea id="nutriplan-chat-input" ref={inputRef} rows={2} maxLength={CHAT_LIMIT} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(composer); } }} placeholder="Ask about meals, recipes, or nutrition…" className="max-h-28 min-h-10 flex-1 resize-y bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground" />
          <button type="button" disabled={busy || !composer.trim()} onClick={() => void sendMessage(composer)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-45" aria-label="Send message"><Send className="h-4 w-4" /></button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{healthError ? "Backend connection unavailable." : status === "missing_configuration" ? "The optional external provider is not configured." : status === "invalid_configuration" ? "Check the backend AI_PROVIDER and local model settings." : status === "model_unavailable" ? `Install ${health?.model ?? "the configured model"} in Ollama to enable chat replies.` : status === "connection_error" ? "Start Ollama on the backend machine and check OLLAMA_BASE_URL." : status === "configured_unverified" ? "Provider access is not confirmed yet. Check status or send a message." : health?.provider === "ollama" ? "Messages and entered profile fields are sent to your configured local Ollama service. This chat stays in this page session." : "Messages and entered profile fields are sent to the explicitly configured OpenAI provider. NutriPlan does not store this chat."}</span><span className="shrink-0">{composer.length}/{CHAT_LIMIT}</span></div>
      </div>

      {confirmClear && <div className="absolute inset-0 z-10 grid place-items-center bg-black/45 p-4">
        <div role="alertdialog" aria-modal="true" aria-labelledby="clear-chat-title" aria-describedby="clear-chat-description" className="w-full max-w-xs rounded-xl border bg-card p-4 shadow-xl">
          <h3 id="clear-chat-title" className="font-semibold">Clear this conversation?</h3><p id="clear-chat-description" className="mt-1 text-sm text-muted-foreground">This removes the messages and profile preferences from this page session. Your saved diet plan is unchanged.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" autoFocus onClick={() => setConfirmClear(false)} className="rounded-lg border px-3 py-2 text-sm">Keep chat</button><button type="button" onClick={clearConversation} className="rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground">Clear chat</button></div>
        </div>
      </div>}
      {confirmPlanSave && <div className="absolute inset-0 z-20 grid place-items-center bg-black/45 p-4">
        <div role="alertdialog" aria-modal="true" aria-labelledby="replace-plan-title" aria-describedby="replace-plan-description" className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-xl">
          <h3 id="replace-plan-title" className="font-semibold">Replace your saved diet plan?</h3>
          <p id="replace-plan-description" className="mt-1 text-sm text-muted-foreground">This stores the generated plan in this browser and replaces the current saved plan.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setConfirmPlanSave(null)} className="rounded-lg border px-3 py-2 text-sm">Keep current plan</button><button type="button" onClick={() => persistGeneratedPlan(confirmPlanSave)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Replace saved plan</button></div>
        </div>
      </div>}
    </section>}

    {!open && <button type="button" onClick={() => setOpen(true)} className="fixed bottom-20 right-3 z-[70] inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xl transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50 sm:bottom-5 sm:right-5 sm:min-h-14 sm:px-5" aria-label="Open NutriPlan AI chat" aria-expanded={open} aria-controls="nutriplan-chat-window">
      <MessageCircle className="h-5 w-5" aria-hidden="true" /><span>Ask NutriPlan AI</span><span className="sr-only">{readyLabel}</span>
    </button>}
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>{label}</span>{children}</label>;
}

const fieldClass = "w-full rounded-md border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

function splitTerms(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))).slice(0, 20);
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    let detail = error.message;
    try {
      const parsed = JSON.parse(error.message) as { detail?: string };
      detail = parsed.detail || detail;
    } catch { /* Preserve the plain response body. */ }
    if (error.status === 503 && detail.toLowerCase().includes("openai_api_key")) return "AI setup is incomplete. Add OPENAI_API_KEY to the project-root .env file and restart FastAPI.";
    if (error.status === 429) return "Too many chat requests. Wait about a minute, then retry.";
    if (error.status === 500 && (!detail.trim() || detail.trim().toLowerCase() === "internal server error")) return "The FastAPI backend is not responding correctly on port 8080. Start or restart it, then retry.";
    if (error.status >= 500 && error.status !== 503) return detail || "The AI service is temporarily unavailable. Please retry.";
    return detail;
  }
  return "Could not reach the chat API. Check that the backend is running on port 8080, then retry.";
}
