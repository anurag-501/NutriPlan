"""FoodSwap comparison using only bundled recipe data and request-scoped user prices."""

from __future__ import annotations

import math
import re
import time
from collections import defaultdict, deque
from datetime import date
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from nutrition_planner import DATASET_SOURCE, filter_recipe_frame, recipe_record


class FoodSwapItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipe_id: int = Field(gt=0)
    servings: float = Field(default=1, ge=0.25, le=3)


class FoodSwapPrice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipe_id: int = Field(gt=0)
    cost_inr: float = Field(gt=0, le=5000, description="User-entered price per recorded recipe serving")
    source: str = Field(min_length=3, max_length=120)
    checked_on: date

    @field_validator("source")
    @classmethod
    def source_not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Price source must contain at least 3 characters")
        return value


class FoodSwapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_meal: list[FoodSwapItem] = Field(min_length=1, max_length=10)
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] = "omnivore"
    exclusions: list[str] = Field(default_factory=list, max_length=20)
    available_ingredients: list[str] = Field(default_factory=list, max_length=30)
    priority: Literal["balanced", "higher_protein", "lower_calories", "lower_cost"] = "balanced"
    budget_inr: float | None = Field(default=None, ge=0, le=50000)
    minimum_protein_g: float | None = Field(default=None, ge=0, le=500)
    maximum_calories: float | None = Field(default=None, ge=0, le=5000)
    maximum_minutes: int | None = Field(default=None, ge=1, le=1440)
    prices: list[FoodSwapPrice] = Field(default_factory=list, max_length=50)
    result_limit: int = Field(default=6, ge=3, le=10)

    @field_validator("exclusions", "available_ingredients")
    @classmethod
    def normalize_terms(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values if value.strip()]
        if any(len(value) > 100 for value in normalized):
            raise ValueError("Ingredient terms must be 100 characters or fewer")
        return list(dict.fromkeys(normalized))

    @model_validator(mode="after")
    def unique_prices_and_current_meals(self):
        price_ids = [item.recipe_id for item in self.prices]
        if len(price_ids) != len(set(price_ids)):
            raise ValueError("Enter one price per recipe")
        meal_ids = [item.recipe_id for item in self.current_meal]
        if len(meal_ids) != len(set(meal_ids)):
            raise ValueError("Current meal cannot contain duplicate recipe IDs; combine their servings")
        return self


class FoodSwapRateLimiter:
    """Process-local limit keyed by the connected peer IP; forwarded headers are ignored."""

    def __init__(self, limit: int = 30, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self.requests: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, client_ip: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        bucket = self.requests[client_ip]
        while bucket and current - bucket[0] >= self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.limit:
            return False
        bucket.append(current)
        return True


WEIGHTS = {
    "balanced": {"protein": 0.35, "availability": 0.25, "calorie_fit": 0.20, "prep": 0.20},
    "higher_protein": {"protein": 0.45, "availability": 0.25, "prep": 0.15, "calorie_fit": 0.15},
    "lower_calories": {"calories": 0.45, "protein": 0.25, "availability": 0.15, "prep": 0.15},
    "lower_cost": {"cost": 0.40, "protein": 0.25, "availability": 0.20, "prep": 0.15},
}


def _minutes(value: object) -> int | None:
    text = str(value or "").strip()
    if re.fullmatch(r"\d+(?:\.0+)?", text):
        minutes = int(float(text))
        return minutes if 0 <= minutes <= 1440 else None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?", text)
    if not match:
        return None
    return int(match.group(1) or 0) * 60 + int(match.group(2) or 0)


def _percentile(values: list[float | None], *, high_is_better: bool) -> list[float | None]:
    known = sorted(value for value in values if value is not None)
    if not known:
        return [None for _ in values]
    result: list[float | None] = []
    for value in values:
        if value is None:
            result.append(None)
            continue
        lower = sum(item < value for item in known)
        equal = sum(item == value for item in known)
        rank = (lower + (equal - 1) / 2) / max(len(known) - 1, 1)
        result.append(rank if high_is_better else 1 - rank)
    return result


def _recipe_totals(items: list[tuple[dict, float]]) -> dict[str, float]:
    return {
        key: round(sum(float(recipe[key]) * servings for recipe, servings in items), 1)
        for key in ("Calories", "ProteinContent", "CarbohydrateContent", "FatContent")
    }


def _json_safe_record(record: dict) -> dict:
    """Replace pandas missing scalars with JSON null before returning API data."""
    cleaned = {}
    for key, value in record.items():
        if isinstance(value, list):
            cleaned[key] = [_json_safe_value(item) for item in value]
        else:
            cleaned[key] = _json_safe_value(value)
    return cleaned


def _json_safe_value(value):
    if isinstance(value, dict):
        return {key: _json_safe_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe_value(item) for item in value]
    if value is None:
        return None
    try:
        missing = pd.isna(value)
        if hasattr(missing, "item"):
            missing = missing.item()
        if missing is True:
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        try:
            return _json_safe_value(value.item())
        except (ValueError, TypeError):
            pass
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _known_cost(recipe_ids: list[tuple[int, float]], prices: dict[int, FoodSwapPrice]) -> float | None:
    if any(recipe_id not in prices for recipe_id, _ in recipe_ids):
        return None
    return round(sum(prices[recipe_id].cost_inr * servings for recipe_id, servings in recipe_ids), 2)


def compare_foodswap(dataframe: pd.DataFrame, payload: FoodSwapRequest) -> dict:
    """Return a transparent ranked set; prices are never sourced or persisted here."""
    prices = {item.recipe_id: item for item in payload.prices}
    ids_to_check = {item.recipe_id for item in payload.current_meal} | set(prices)
    found = dataframe.loc[dataframe["RecipeId"].isin(ids_to_check)]
    known_ids = set(found["RecipeId"].astype(int).tolist())
    missing_ids = sorted(ids_to_check - known_ids)
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Recipe not found: {missing_ids[0]}")

    exclusions = payload.exclusions
    base_items = []
    base_rows = []
    base_warnings = []
    for item in payload.current_meal:
        row = dataframe.loc[dataframe["RecipeId"] == item.recipe_id].iloc[0]
        try:
            base_macros = [float(row[column]) for column in ("Calories", "ProteinContent", "CarbohydrateContent", "FatContent")]
        except (TypeError, ValueError):
            base_macros = []
        if len(base_macros) != 4 or not np.isfinite(base_macros).all():
            raise HTTPException(status_code=422, detail=f"Recipe {item.recipe_id} has incomplete nutrition values and cannot be used as a comparison baseline")
        valid = filter_recipe_frame(dataframe.loc[[row.name]], dietary_preference=payload.dietary_preference, exclude_ingredients=exclusions)
        if valid.empty:
            base_warnings.append(f"Current recipe ‘{row['Name']}’ conflicts with a selected diet preference or exclusion. Alternatives still apply your selected filters.")
        recipe = _json_safe_record(recipe_record(row))
        base_items.append((recipe, item.servings))
        base_rows.append((item.recipe_id, item.servings))
    base_totals = _recipe_totals(base_items)
    base_cost = _known_cost(base_rows, prices)

    candidates = filter_recipe_frame(
        dataframe,
        dietary_preference=payload.dietary_preference,
        exclude_ingredients=exclusions,
        min_protein=payload.minimum_protein_g,
        max_calories=payload.maximum_calories,
        max_minutes=payload.maximum_minutes,
    )
    macro_columns = ["Calories", "ProteinContent", "CarbohydrateContent", "FatContent"]
    numeric_macros = candidates[macro_columns].apply(pd.to_numeric, errors="coerce")
    candidates = candidates.loc[np.isfinite(numeric_macros.to_numpy(dtype=float)).all(axis=1)].copy()
    candidates = candidates.loc[~candidates["RecipeId"].isin({item.recipe_id for item in payload.current_meal})].copy()
    if candidates.empty:
        return _empty_result(base_items, base_totals, base_cost, payload, base_warnings)

    if payload.budget_inr is not None and prices:
        priced_costs = candidates["RecipeId"].map({recipe_id: price.cost_inr for recipe_id, price in prices.items()})
        candidates = candidates.loc[priced_costs.isna() | (priced_costs <= payload.budget_inr)].copy()
    eligible_count = len(candidates)
    if candidates.empty:
        return _empty_result(base_items, base_totals, base_cost, payload, base_warnings)

    # Keep ranking work bounded for the full 500k-row catalogue. The score is
    # computed among this deterministic candidate shortlist, not claimed as a
    # global percentile over every recipe in the source dataset.
    pool_cap = min(600, max(180, payload.result_limit * 30))
    selected_ids: set[int] = set()
    for column, largest in (("ProteinContent", True), ("Calories", False)):
        selected_ids.update(candidates.nlargest(pool_cap, column)["RecipeId"].astype(int).tolist() if largest else candidates.nsmallest(pool_cap, column)["RecipeId"].astype(int).tolist())
    candidates["_swap_calorie_distance"] = (candidates["Calories"] - base_totals["Calories"]).abs()
    selected_ids.update(candidates.nsmallest(pool_cap, "_swap_calorie_distance")["RecipeId"].astype(int).tolist())
    candidates["_swap_prep_minutes"] = pd.to_numeric(candidates["TotalTime"].map(_minutes), errors="coerce")
    known_times = candidates.loc[candidates["_swap_prep_minutes"].notna()]
    selected_ids.update(known_times.nsmallest(pool_cap, "_swap_prep_minutes")["RecipeId"].astype(int).tolist())
    if payload.available_ingredients and "_ingredients_parsed" in candidates.columns:
        terms = [term.casefold() for term in payload.available_ingredients]
        candidates["_swap_available_count"] = candidates["_ingredients_parsed"].apply(
            lambda ingredients: sum(any(term in ingredient for ingredient in ingredients) for term in terms)
        )
        selected_ids.update(candidates.nlargest(pool_cap, "_swap_available_count")["RecipeId"].astype(int).tolist())
    selected_ids.update(recipe_id for recipe_id in prices if recipe_id in set(candidates["RecipeId"].astype(int)))
    candidates = candidates.loc[candidates["RecipeId"].isin(selected_ids)].copy()

    available = [item.casefold() for item in payload.available_ingredients]
    recipes = []
    for _, row in candidates.iterrows():
        recipe_id = int(row["RecipeId"])
        recipe = _json_safe_record(recipe_record(row))
        # Ranking fields are temporary dataframe implementation details.
        recipe = {key: value for key, value in recipe.items() if not key.startswith("_swap_")}
        ingredients = [str(value) for value in recipe.get("RecipeIngredientParts", [])]
        matched = [term for term in payload.available_ingredients if any(term.casefold() in ingredient.casefold() for ingredient in ingredients)]
        cost = prices[recipe_id].cost_inr if recipe_id in prices else None
        budget_status = None if cost is None or payload.budget_inr is None else cost <= payload.budget_inr
        # A known over-budget candidate is excluded; an unpriced candidate remains visible
        # but is explicitly unverified against the budget.
        if payload.budget_inr is not None and budget_status is False:
            continue
        recipes.append({
            "recipe": recipe,
            "recipe_id": recipe_id,
            "cost_inr": cost,
            "price_source": prices[recipe_id].source if recipe_id in prices else None,
            "price_checked_on": prices[recipe_id].checked_on.isoformat() if recipe_id in prices else None,
            "budget_status": budget_status,
            "matched_ingredients": matched,
            "missing_available_ingredients": [term for term in payload.available_ingredients if term not in matched],
            "availability_score": len(matched) / len(available) if available else None,
            "prep_minutes": _minutes(row.get("TotalTime")),
        })

    if not recipes:
        return _empty_result(base_items, base_totals, base_cost, payload, base_warnings)

    has_candidate_prices = any(item["cost_inr"] is not None for item in recipes)
    effective_priority = payload.priority
    notes = [
        "Nutrition comes from the bundled recipe dataset per recorded recipe serving; ingredient gram weights are unavailable.",
        "Availability is based only on text matches against ingredients you entered; it does not confirm that food is in stock.",
    ]
    if payload.budget_inr is not None:
        notes.append("Budget removes candidates above your limit only when you supplied a per-serving price; unpriced candidates remain marked unknown.")
    if payload.priority == "lower_cost" and not has_candidate_prices:
        notes.append("You chose lower cost, but no alternative prices were supplied. Cost was omitted and the balanced score was used. Enter per-serving prices and their source/date to include cost.")
        effective_priority = "balanced"
    elif payload.priority == "lower_cost" and any(item["cost_inr"] is None for item in recipes):
        notes.append("Cost ranking uses only alternatives with user-entered prices. Unpriced choices remain visible with unknown cost; missing prices are not treated as free or affordable.")
    if payload.priority == "lower_cost" and base_cost is None:
        notes.append("The current meal's total cost is unknown because a per-serving price was not provided for every current item.")
    notes.append(f"Ranking score is calculated among a shortlist of {len(recipes)} candidates selected from {eligible_count} recipes that met the hard constraints.")
    if not payload.available_ingredients:
        notes.append("Ingredient availability was omitted from ranking because no available ingredients were supplied.")
    if effective_priority == "balanced":
        notes.append("Balanced score weights: protein 35%, ingredient match 25% when supplied, calorie similarity 20%, and shorter prep time 20%; missing dimensions are omitted and remaining weights are rescaled.")
    elif effective_priority == "higher_protein":
        notes.append("Higher-protein score weights: protein 45%, ingredient match 25% when supplied, shorter prep 15%, and calorie similarity 15%; missing dimensions are omitted and remaining weights are rescaled.")
    elif effective_priority == "lower_calories":
        notes.append("Lower-calorie score weights: lower calories 45%, protein 25%, ingredient match 15% when supplied, and shorter prep 15%; missing dimensions are omitted and remaining weights are rescaled.")
    else:
        notes.append("Lower-cost score weights: user-entered cost 40%, protein 25%, ingredient match 20% when supplied, and shorter prep 15%; missing dimensions are omitted and remaining weights are rescaled.")

    weights = WEIGHTS[effective_priority]
    metric_values = {
        "protein": _percentile([float(item["recipe"]["ProteinContent"]) for item in recipes], high_is_better=True),
        "calories": _percentile([float(item["recipe"]["Calories"]) for item in recipes], high_is_better=False),
        "calorie_fit": _percentile([abs(float(item["recipe"]["Calories"]) - base_totals["Calories"]) for item in recipes], high_is_better=False),
        "prep": _percentile([float(item["prep_minutes"]) if item["prep_minutes"] is not None else None for item in recipes], high_is_better=False),
        "availability": _percentile([float(item["availability_score"]) if item["availability_score"] is not None else None for item in recipes], high_is_better=True),
        "cost": _percentile([float(item["cost_inr"]) if item["cost_inr"] is not None else None for item in recipes], high_is_better=False),
    }
    for index, item in enumerate(recipes):
        components = [(weight, metric_values[metric][index]) for metric, weight in weights.items()]
        components = [(weight, score) for weight, score in components if score is not None]
        total_weight = sum(weight for weight, _ in components)
        item["score"] = round(100 * sum(weight * score for weight, score in components) / total_weight, 1) if total_weight else 0.0
        item["tradeoffs"] = _tradeoff_text(item, base_totals, payload.available_ingredients)

    recipes.sort(key=lambda item: (item["cost_inr"] is None, -item["score"], item["cost_inr"] or float("inf"), -item["recipe"]["ProteinContent"], item["recipe_id"]) if payload.priority == "lower_cost" else (-item["score"], item["cost_inr"] is None, item["cost_inr"] or float("inf"), -item["recipe"]["ProteinContent"], item["recipe_id"]))
    alternatives = recipes[:payload.result_limit]
    return _json_safe_value({
        "current_meal": {"items": [{"recipe": recipe, "servings": servings} for recipe, servings in base_items], "totals": base_totals, "cost_inr": base_cost, "warnings": base_warnings},
        "alternatives": alternatives,
        "eligible_count": eligible_count,
        "ranking_priority": effective_priority,
        "requested_priority": payload.priority,
        "nutrition_source": DATASET_SOURCE,
        "notes": notes,
    })


def _tradeoff_text(item: dict, baseline: dict[str, float], available: list[str]) -> str:
    recipe = item["recipe"]
    protein_delta = round(float(recipe["ProteinContent"]) - baseline["ProteinContent"], 1)
    calorie_delta = round(float(recipe["Calories"]) - baseline["Calories"], 1)
    protein_phrase = f"{abs(protein_delta):g} g more" if protein_delta >= 0 else f"{abs(protein_delta):g} g less"
    calorie_phrase = f"{abs(calorie_delta):g} kcal more" if calorie_delta >= 0 else f"{abs(calorie_delta):g} kcal less"
    match_phrase = f"matches {len(item['matched_ingredients'])} of {len(available)} ingredients you listed" if available else "availability was not scored"
    price_phrase = f"cost {item['cost_inr']:.2f} INR per recorded serving from {item['price_source']} ({item['price_checked_on']})" if item["cost_inr"] is not None else "price is unavailable"
    return f"Compared with the selected meal: {protein_phrase} protein, {calorie_phrase}, {match_phrase}; {price_phrase}."


def _empty_result(base_items: list[tuple[dict, float]], totals: dict[str, float], cost: float | None, payload: FoodSwapRequest, warnings: list[str] | None = None) -> dict:
    notes = list(warnings or [])
    notes.append("No recipes matched the selected dietary filters, exclusions, nutrition bounds, preparation time, and known price limit.")
    notes.append("Nutrition comes from the bundled recipe dataset per recorded recipe serving; ingredient gram weights are unavailable.")
    if payload.budget_inr is not None:
        notes.append("Budget removes candidates above your limit only when you supplied a per-serving price. Any unpriced candidate could not be verified against the budget.")
    return _json_safe_value({
        "current_meal": {"items": [{"recipe": recipe, "servings": servings} for recipe, servings in base_items], "totals": totals, "cost_inr": cost, "warnings": warnings or []},
        "alternatives": [], "eligible_count": 0, "ranking_priority": "balanced" if payload.priority == "lower_cost" and not payload.prices else payload.priority,
        "requested_priority": payload.priority,
        "nutrition_source": DATASET_SOURCE,
        "notes": notes,
    })
