"""Chat endpoints and explicit, server-validated plan actions."""

from __future__ import annotations

import os
import time
from collections import deque
from typing import Annotated, Any, Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from chat_service import ChatService, ChatServiceError
from config import ACTIVITY_MULTIPLIERS
from nutrition_planner import DATASET_SOURCE, filter_recipe_frame, recipe_record

router = APIRouter()


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=3000)

    @model_validator(mode="after")
    def content_is_not_blank(self):
        if not self.content.strip():
            raise ValueError("Message cannot be blank")
        return self


class ChatProfile(BaseModel):
    age: int | None = Field(default=None, ge=1, le=100)
    height: float | None = Field(default=None, gt=100, le=250)
    weight: float | None = Field(default=None, gt=25, le=300)
    sex_coefficient: Literal["male", "female", "range"] | None = None
    activity: str | None = None
    training_days: int | None = Field(default=None, ge=0, le=7)
    goal: Literal["lean_gain", "bulk", "fat_loss", "maintenance"] | None = None
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] | None = None
    allergies: list[str] = Field(default_factory=list, max_length=20)
    disliked_foods: list[str] = Field(default_factory=list, max_length=20)
    available_ingredients: list[str] = Field(default_factory=list, max_length=30)
    max_minutes: int | None = Field(default=None, ge=1, le=1440)
    meal_category: Literal["breakfast", "main meal", "snack"] | None = None
    budget_preference: str | None = Field(default=None, max_length=100)
    meals_per_day: Literal[3, 4, 5] | None = None
    cuisine: str | None = Field(default=None, max_length=80)
    professional_support_needed: bool = False

    @model_validator(mode="after")
    def validate_activity(self):
        if self.activity is not None and self.activity not in ACTIVITY_MULTIPLIERS:
            raise ValueError("Choose a supported activity level")
        for field_name in ("allergies", "disliked_foods", "available_ingredients"):
            values = getattr(self, field_name)
            if any(not value.strip() or len(value) > 100 for value in values):
                raise ValueError(f"{field_name} entries must contain 1–100 characters")
        return self


class ChatRequest(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=12)
    profile: ChatProfile = Field(default_factory=ChatProfile)

    @model_validator(mode="after")
    def validate_recent_history(self):
        if self.messages[-1].role != "user":
            raise ValueError("The latest chat turn must be from the user")
        if sum(len(turn.content) for turn in self.messages) > 12000:
            raise ValueError("Recent chat history exceeds 12,000 characters")
        return self


class MealSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meal_name: str = Field(min_length=1, max_length=40)
    recommended_calories: int = Field(ge=0, le=5000)
    recipe_ids: list[int] = Field(min_length=1, max_length=5)
    selected_recipe_id: int = Field(gt=0)


class PlanActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["add", "replace"]
    recipe_id: int = Field(gt=0)
    meal_name: str | None = Field(default=None, min_length=1, max_length=40)
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] | None = None
    allergies: list[str] = Field(default_factory=list, max_length=20)
    disliked_foods: list[str] = Field(default_factory=list, max_length=20)
    current_meals: list[MealSelection] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_meal_groups(self):
        names = [meal.meal_name.casefold() for meal in self.current_meals]
        if len(names) != len(set(names)):
            raise ValueError("Current plan meal names must be unique")
        for meal in self.current_meals:
            if meal.selected_recipe_id not in meal.recipe_ids:
                raise ValueError("Selected recipe must be one of that meal's available recipes")
            if len(meal.recipe_ids) != len(set(meal.recipe_ids)):
                raise ValueError("A meal cannot contain duplicate recipe IDs")
        if self.action == "replace" and not self.meal_name:
            raise ValueError("Choose a meal to replace")
        return self


class ChatRecipe(BaseModel):
    recipe_id: int
    RecipeId: int
    Name: str
    Calories: float
    ProteinContent: float
    CarbohydrateContent: float
    FatContent: float
    RecipeIngredientParts: list[str]
    RecipeInstructions: list[str]
    PrepTime: str
    CookTime: str
    TotalTime: str
    RecipeServings: str | None = None
    nutrition_source: str
    ingredients_quantities_available: bool
    dietary_classification: str
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] | None = None
    excluded_ingredients: list[str] = Field(default_factory=list)
    allergen_note: str


class ChatResponse(BaseModel):
    message: str
    recipes: list[ChatRecipe] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    diet_plan: dict[str, Any] | None = None


class ChatRateLimiter:
    """Small process-local fixed-window limiter; does not trust forwarded headers."""

    def __init__(self, limit: int = 12, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        bucket = self._requests.setdefault(key, deque())
        while bucket and current - bucket[0] >= self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.limit:
            return False
        bucket.append(current)
        if len(self._requests) > 10000:
            self._requests = {ip: times for ip, times in self._requests.items() if times and current - times[-1] < self.window_seconds}
        return True


def _configured_rate_limit() -> int:
    try:
        return min(max(int(os.getenv("CHAT_RATE_LIMIT_PER_MINUTE", "12")), 1), 120)
    except (TypeError, ValueError):
        return 12


_rate_limit = _configured_rate_limit()
_limiter = ChatRateLimiter(_rate_limit)


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service


def _get_dataset(request: Request) -> pd.DataFrame:
    dataframe = getattr(request.app.state, "dataset", None)
    if dataframe is None:
        raise HTTPException(status_code=503, detail="Recipe dataset is not ready")
    return dataframe


@router.get("/api/chat/health")
async def chat_health(service: Annotated[ChatService, Depends(get_chat_service)]):
    readiness = await service.probe()
    return {
        "provider": readiness["provider"],
        "configured": service.is_configured,
        "status": readiness["status"],
        "status_message": service.availability_message,
        "model": readiness["model"],
        "available_models": [item.get("name") for item in readiness.get("models", [])],
        "history": "current page session only; no backend history is stored",
    }


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    service: Annotated[ChatService, Depends(get_chat_service)],
    dataframe: Annotated[pd.DataFrame, Depends(_get_dataset)],
):
    client_ip = request.client.host if request.client else "unknown"
    if not _limiter.allow(client_ip):
        raise HTTPException(status_code=429, detail="Chat rate limit reached. Please wait a minute and try again.", headers={"Retry-After": "60"})
    try:
        return await service.reply(payload, dataframe)
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


def _recipe_row(dataframe: pd.DataFrame, recipe_id: int) -> tuple[int, pd.Series] | None:
    matches = dataframe.index[dataframe["RecipeId"] == recipe_id]
    if len(matches) == 0:
        return None
    index = matches[0]
    return index, dataframe.loc[index]


def _validated_recipe(
    dataframe: pd.DataFrame,
    recipe_id: int,
    preference: str | None,
    exclusions: list[str],
) -> dict:
    found = _recipe_row(dataframe, recipe_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    index, row = found
    candidate = dataframe.loc[[index]]
    filtered = filter_recipe_frame(
        candidate,
        dietary_preference=preference or "omnivore",
        exclude_ingredients=exclusions,
    )
    if filtered.empty:
        raise HTTPException(status_code=422, detail="This recipe does not match the selected dietary preference or ingredient exclusions")
    return recipe_record(row)


@router.post("/api/chat/plan-action")
def chat_plan_action(
    payload: PlanActionRequest,
    request: Request,
    dataframe: Annotated[pd.DataFrame, Depends(_get_dataset)],
):
    """Validate recipe IDs, apply one explicit user-selected change, and recompute totals from dataset rows."""
    exclusions = list(dict.fromkeys(payload.allergies + payload.disliked_foods))
    groups: list[dict] = []
    selected: dict[str, int] = {}
    for meal in payload.current_meals:
        recipes = []
        for recipe_id in meal.recipe_ids:
            recipe = _validated_recipe(dataframe, recipe_id, None, [])
            recipes.append(recipe)
        groups.append({
            "meal_name": meal.meal_name,
            "recommended_calories": meal.recommended_calories,
            "recipes": recipes,
        })
        selected[meal.meal_name] = meal.selected_recipe_id

    target = _validated_recipe(dataframe, payload.recipe_id, payload.dietary_preference, exclusions)
    meal_name = payload.meal_name or "Chat additions"
    existing_index = next((i for i, meal in enumerate(groups) if meal["meal_name"].casefold() == meal_name.casefold()), None)
    if payload.action == "replace":
        if existing_index is None:
            raise HTTPException(status_code=422, detail="The selected meal is not present in the current saved plan")
        groups[existing_index]["recipes"] = [target]
        selected[groups[existing_index]["meal_name"]] = payload.recipe_id
    else:
        if existing_index is None:
            groups.append({
                "meal_name": meal_name,
                "recommended_calories": round(float(target["Calories"])),
                "recipes": [target],
            })
            selected[meal_name] = payload.recipe_id
        else:
            group = groups[existing_index]
            if payload.recipe_id not in {recipe["recipe_id"] for recipe in group["recipes"]}:
                if len(group["recipes"]) >= 5:
                    raise HTTPException(status_code=409, detail="This meal already has five recipe choices")
                group["recipes"].append(target)
            selected[group["meal_name"]] = payload.recipe_id

    nutrition_totals = {"calories": 0.0, "protein_g": 0.0, "carbohydrate_g": 0.0, "fat_g": 0.0}
    for group in groups:
        chosen_id = selected[group["meal_name"]]
        chosen = next(recipe for recipe in group["recipes"] if recipe["recipe_id"] == chosen_id)
        nutrition_totals["calories"] += float(chosen["Calories"])
        nutrition_totals["protein_g"] += float(chosen["ProteinContent"])
        nutrition_totals["carbohydrate_g"] += float(chosen["CarbohydrateContent"])
        nutrition_totals["fat_g"] += float(chosen["FatContent"])
    nutrition_totals = {key: round(value, 1) for key, value in nutrition_totals.items()}
    return {
        "action": payload.action,
        "meal_name": meal_name,
        "meals": groups,
        "selected_recipe_ids": selected,
        "nutrition_totals": nutrition_totals,
        "nutrition_source": DATASET_SOURCE,
        "nutrition_note": "Totals sum the selected recipes' dataset-reported values per recorded recipe serving. Recipe serving weights and ingredient quantities are not available.",
    }
