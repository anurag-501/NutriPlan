"""Reusable, versioned REST API layered over NutriPlan's existing services."""

from __future__ import annotations

import hmac
import os
import sqlite3
import time
import uuid
from typing import Annotated, Any, Literal
from uuid import UUID

import pandas as pd
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from pydantic import BaseModel, ConfigDict, Field, field_validator

import platform_store
from chat_api import ChatRequest, ChatResponse, get_chat_service
from chat_service import ChatService, ChatServiceError
from config import ACTIVITY_MULTIPLIERS
from nutrition_planner import (
    DATASET_SOURCE,
    build_gym_plan,
    calculate_gym_targets,
    paged_recipe_search,
    recipe_record,
)

router = APIRouter(prefix="/api/v1", tags=["API v1"])


def _default_project_rate_limit() -> int:
    try:
        return min(max(int(os.getenv("API_PLATFORM_RATE_LIMIT_PER_MINUTE", "30")), 1), 600)
    except ValueError:
        return 30


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(min_length=3, max_length=50, pattern=r"^[a-z][a-z0-9-]*$")
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=1000)
    system_prompt: str = Field(default="", max_length=4000)
    enabled_modules: list[Literal["chat", "nutrition", "recipes"]] = Field(
        default_factory=lambda: ["chat", "nutrition", "recipes"], min_length=1, max_length=3
    )
    rate_limit_per_minute: int = Field(default_factory=_default_project_rate_limit, ge=1, le=600)

    @field_validator("enabled_modules")
    @classmethod
    def modules_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("enabled_modules cannot contain duplicates")
        return value


class ClientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=100)


class ProfileInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    age: int = Field(ge=1, le=100)
    height: float = Field(gt=100, le=250)
    weight: float = Field(gt=25, le=300)
    sex_coefficient: Literal["male", "female", "range"]
    activity: str
    training_days: int = Field(ge=0, le=7)
    training_experience: Literal["beginner", "intermediate", "advanced"] = "beginner"
    goal: Literal["lean_gain", "bulk", "fat_loss", "maintenance"]
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] = "omnivore"
    allergies: list[str] = Field(default_factory=list, max_length=20)
    disliked_foods: list[str] = Field(default_factory=list, max_length=20)
    meals_per_day: Literal[3, 4, 5] = 3
    budget: str | None = Field(default=None, max_length=100)
    cuisine: str | None = Field(default=None, max_length=80)
    workout_time: Literal["morning", "afternoon", "evening", "flexible"] = "flexible"
    professional_support_needed: bool = False

    @field_validator("activity")
    @classmethod
    def activity_is_supported(cls, value: str) -> str:
        if value not in ACTIVITY_MULTIPLIERS:
            raise ValueError("Choose one of the listed activity levels")
        return value


class RecipeSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipe_id: int = Field(gt=0)
    servings: float = Field(gt=0, le=10)


class MealAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[RecipeSelection] = Field(min_length=1, max_length=20)


class PlatformChatRequest(ChatRequest):
    conversation_id: UUID | None = None
    persist_history: bool = False


class PlatformChatResponse(ChatResponse):
    conversation_id: UUID | None = None
    persisted: bool = False


def _dataset(request: Request) -> pd.DataFrame:
    dataframe = getattr(request.app.state, "dataset", None)
    if dataframe is None:
        raise HTTPException(status_code=503, detail="Recipe dataset is not ready")
    return dataframe


def _require_admin(x_admin_token: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("API_ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Project administration is not enabled. Set API_ADMIN_TOKEN on the backend and restart it.")
    if not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=401, detail="A valid X-Admin-Token is required")


def _require_client(authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A project API key is required", headers={"WWW-Authenticate": "Bearer"})
    api_key = authorization[7:].strip()
    client = platform_store.authenticate_client(api_key)
    if client is None:
        raise HTTPException(status_code=401, detail="The project API key is invalid or revoked", headers={"WWW-Authenticate": "Bearer"})
    return client


def _project_for(client: dict[str, Any], module: str | None = None) -> dict[str, Any]:
    project = platform_store.get_project(client["project_id"])
    if project is None:
        raise HTTPException(status_code=401, detail="The API project is no longer available")
    if module and module not in project["enabled_modules"]:
        raise HTTPException(status_code=403, detail=f"The {module} module is disabled for this project")
    return project


_limiters: dict[str, Any] = {}


def _check_rate_limit(client: dict[str, Any], project: dict[str, Any]) -> None:
    from chat_api import ChatRateLimiter

    limiter = _limiters.get(client["client_id"])
    if limiter is None or limiter.limit != project["rate_limit_per_minute"]:
        limiter = ChatRateLimiter(project["rate_limit_per_minute"])
        _limiters[client["client_id"]] = limiter
    if not limiter.allow(client["client_id"]):
        raise HTTPException(status_code=429, detail="Project request limit reached. Wait a minute and retry.", headers={"Retry-After": "60"})
    if len(_limiters) > 10000:
        _limiters.clear()


def _record(client: dict[str, Any], route: str, status_code: int, started: float) -> None:
    platform_store.record_usage(
        client["project_id"], client["client_id"], route, status_code,
        int((time.perf_counter() - started) * 1000),
    )


@router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok", "service": "nutriplan-api", "api_version": "v1"}


@router.get("/health/ready")
def ready(request: Request) -> dict[str, Any]:
    dataframe = getattr(request.app.state, "dataset", None)
    try:
        with platform_store.connect() as db:
            db.execute("SELECT 1").fetchone()
        database_status = "ready"
    except sqlite3.Error:
        database_status = "unavailable"
    ready_state = dataframe is not None and database_status == "ready"
    return {
        "status": "ready" if ready_state else "not_ready",
        "dataset_rows": len(dataframe) if dataframe is not None else 0,
        "database": database_status,
    }


@router.get("/ai/status")
async def ai_status(service: Annotated[ChatService, Depends(get_chat_service)]) -> dict[str, Any]:
    result = await service.probe()
    return {
        "provider": result["provider"],
        "model": result["model"],
        "status": result["status"],
        "status_message": service.availability_message,
        "configured": service.is_configured,
        "models": [item.get("name") for item in result.get("models", [])],
    }


@router.get("/ai/models")
async def ai_models(service: Annotated[ChatService, Depends(get_chat_service)]) -> dict[str, Any]:
    result = await service.probe()
    return {
        "provider": result["provider"],
        "configured_model": result["model"],
        "status": result["status"],
        "models": result.get("models", []),
    }


@router.post("/projects", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_admin)])
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    try:
        project = platform_store.create_project(
            payload.project_id, payload.name, payload.description, payload.system_prompt,
            payload.enabled_modules, payload.rate_limit_per_minute,
        )
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HTTPException(status_code=409, detail="That project ID already exists") from exc
        raise
    return project


@router.get("/projects/me")
def project_info(client: Annotated[dict[str, Any], Depends(_require_client)]) -> dict[str, Any]:
    project = _project_for(client)
    return {
        "project_id": project["project_id"], "name": project["name"],
        "description": project["description"], "enabled_modules": project["enabled_modules"],
        "rate_limit_per_minute": project["rate_limit_per_minute"],
        "client": {"client_id": client["client_id"], "name": client["name"]},
    }


@router.post("/projects/{project_id}/clients", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_admin)])
def create_project_client(project_id: str, payload: ClientCreate) -> dict[str, Any]:
    if platform_store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    client, api_key = platform_store.create_client(project_id, payload.name)
    return {**client, "api_key": api_key, "warning": "Copy this key now. It cannot be retrieved again; only its salted hash is stored."}


@router.get("/projects/{project_id}/clients", dependencies=[Depends(_require_admin)])
def list_project_clients(project_id: str) -> dict[str, Any]:
    if platform_store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"clients": platform_store.list_project_clients(project_id)}


@router.delete("/projects/{project_id}/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_admin)])
def revoke_project_client(project_id: str, client_id: UUID) -> Response:
    if not platform_store.revoke_client(project_id, str(client_id)):
        raise HTTPException(status_code=404, detail="Active project client not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/projects/me/usage")
def project_usage(client: Annotated[dict[str, Any], Depends(_require_client)]) -> dict[str, Any]:
    return platform_store.usage_summary(client["project_id"], client["client_id"])


@router.post("/chat", response_model=PlatformChatResponse)
async def versioned_chat(
    payload: PlatformChatRequest,
    request: Request,
    client: Annotated[dict[str, Any], Depends(_require_client)],
    service: Annotated[ChatService, Depends(get_chat_service)],
    dataframe: Annotated[pd.DataFrame, Depends(_dataset)],
) -> PlatformChatResponse:
    project = _project_for(client, "chat")
    _check_rate_limit(client, project)
    started = time.perf_counter()
    conversation_id = payload.conversation_id
    conversation_exists = False
    if payload.persist_history and conversation_id and not platform_store.owns_conversation(client["project_id"], client["client_id"], str(conversation_id)):
        # A new caller-chosen UUID is allowed; an existing foreign conversation is never returned.
        if platform_store.read_conversation(client["project_id"], client["client_id"], str(conversation_id)) is None:
            with platform_store.connect() as db:
                exists = db.execute("SELECT 1 FROM conversations WHERE conversation_id=?", (str(conversation_id),)).fetchone()
            if exists:
                raise HTTPException(status_code=404, detail="Conversation not found")
    elif payload.persist_history and conversation_id:
        conversation_exists = True
    if payload.persist_history and conversation_id is None:
        conversation_id = uuid.uuid4()
    try:
        result = await service.reply(
            payload, dataframe,
            project_context=project["system_prompt"] or None,
            project_name=project["name"],
            project_id=project["project_id"],
        )
        if payload.persist_history and conversation_id:
            turns = (
                [(payload.messages[-1].role, payload.messages[-1].content)]
                if conversation_exists
                else [(turn.role, turn.content) for turn in payload.messages]
            )
            turns.append(("assistant", result["message"]))
            platform_store.save_conversation_turns(client["project_id"], client["client_id"], str(conversation_id), turns)
        _record(client, "/api/v1/chat", 200, started)
    except ChatServiceError as exc:
        _record(client, "/api/v1/chat", exc.status_code, started)
        raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc
    return PlatformChatResponse(**result, conversation_id=conversation_id, persisted=payload.persist_history)


@router.get("/chat/history/{conversation_id}")
def read_chat_history(conversation_id: UUID, client: Annotated[dict[str, Any], Depends(_require_client)]) -> dict[str, Any]:
    messages = platform_store.read_conversation(client["project_id"], client["client_id"], str(conversation_id))
    if messages is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation_id": str(conversation_id), "messages": messages}


@router.delete("/chat/history/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def clear_chat_history(conversation_id: UUID, client: Annotated[dict[str, Any], Depends(_require_client)]) -> Response:
    if not platform_store.delete_conversation(client["project_id"], client["client_id"], str(conversation_id)):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/nutrition/calculate")
@router.post("/nutrition/daily-requirements")
def nutrition_calculate(
    payload: ProfileInputs,
    client: Annotated[dict[str, Any], Depends(_require_client)],
) -> dict[str, Any]:
    project = _project_for(client, "nutrition")
    _check_rate_limit(client, project)
    started = time.perf_counter()
    result = calculate_gym_targets(payload.model_dump())
    _record(client, "/api/v1/nutrition/calculate", 200, started)
    return result


@router.post("/nutrition/meal-plan")
def nutrition_meal_plan(
    payload: ProfileInputs,
    request: Request,
    client: Annotated[dict[str, Any], Depends(_require_client)],
) -> dict[str, Any]:
    project = _project_for(client, "nutrition")
    _check_rate_limit(client, project)
    started = time.perf_counter()
    result = build_gym_plan(_dataset(request), payload.model_dump())
    _record(client, "/api/v1/nutrition/meal-plan", 200, started)
    return result


@router.post("/nutrition/analyze-meal")
def nutrition_analyze_meal(
    payload: MealAnalysis,
    request: Request,
    client: Annotated[dict[str, Any], Depends(_require_client)],
) -> dict[str, Any]:
    project = _project_for(client, "nutrition")
    _check_rate_limit(client, project)
    started = time.perf_counter()
    dataframe = _dataset(request)
    totals = {"Calories": 0.0, "ProteinContent": 0.0, "CarbohydrateContent": 0.0, "FatContent": 0.0, "FiberContent": 0.0}
    items = []
    for selection in payload.items:
        matches = dataframe.loc[dataframe["RecipeId"] == selection.recipe_id]
        if matches.empty:
            raise HTTPException(status_code=404, detail=f"Recipe {selection.recipe_id} not found")
        recipe = recipe_record(matches.iloc[0], selection.servings)
        for field in totals:
            totals[field] += float(recipe.get(field, 0) or 0)
        items.append({"recipe_id": recipe["recipe_id"], "name": recipe["Name"], "servings": selection.servings, "nutrition": {field: recipe.get(field) for field in totals}, "nutrition_source": recipe["nutrition_source"]})
    _record(client, "/api/v1/nutrition/analyze-meal", 200, started)
    return {
        "items": items,
        "totals": {field: round(value, 1) for field, value in totals.items()},
        "nutrition_source": DATASET_SOURCE,
        "limitations": ["Values are dataset-reported estimates for the recorded recipe serving, scaled by the requested serving multiplier.", "The bundled data has no ingredient gram quantities; this is not a laboratory nutrient analysis."],
    }


@router.get("/recipes")
def recipes(
    request: Request,
    client: Annotated[dict[str, Any], Depends(_require_client)],
    q: str = Query(default="", max_length=100),
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] = "omnivore",
    meal_category: Literal["all", "breakfast", "main meal", "snack"] = "all",
    min_calories: float | None = Query(default=None, ge=0, le=5000),
    max_calories: float | None = Query(default=None, ge=0, le=5000),
    min_protein: float | None = Query(default=None, ge=0, le=500),
    max_minutes: int | None = Query(default=None, ge=1, le=1440),
    include_ingredients: Annotated[list[str] | None, Query()] = None,
    exclude_ingredients: Annotated[list[str] | None, Query()] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=48),
) -> dict[str, Any]:
    project = _project_for(client, "recipes")
    _check_rate_limit(client, project)
    started = time.perf_counter()
    items, total = paged_recipe_search(
        _dataset(request), query=q, dietary_preference=dietary_preference,
        meal_category=meal_category, min_calories=min_calories, max_calories=max_calories,
        min_protein=min_protein, max_minutes=max_minutes,
        include_ingredients=include_ingredients or [], exclude_ingredients=exclude_ingredients or [],
        page=page, page_size=page_size,
    )
    _record(client, "/api/v1/recipes", 200, started)
    return {
        "items": items, "total": total, "page": page, "page_size": page_size,
        "nutrition_source": DATASET_SOURCE,
        "limitations": ["Recipe dietary labels use ingredient text screening. Check original labels for allergies.", "The dataset does not contain ingredient weights, verified allergen declarations, or prices."],
    }


@router.get("/recipes/{recipe_id}")
def recipe_details(
    recipe_id: int,
    request: Request,
    client: Annotated[dict[str, Any], Depends(_require_client)],
    portion_multiplier: float = Query(default=1, ge=0.25, le=3),
) -> dict[str, Any]:
    project = _project_for(client, "recipes")
    _check_rate_limit(client, project)
    started = time.perf_counter()
    matches = _dataset(request).loc[lambda frame: frame["RecipeId"] == recipe_id]
    if matches.empty:
        raise HTTPException(status_code=404, detail="Recipe not found")
    result = recipe_record(matches.iloc[0], portion_multiplier)
    _record(client, "/api/v1/recipes/{recipe_id}", 200, started)
    return result
