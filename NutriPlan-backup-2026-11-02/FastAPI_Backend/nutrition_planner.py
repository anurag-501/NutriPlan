"""Explainable gym nutrition estimates and search over the bundled recipe data."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from config import ACTIVITY_MULTIPLIERS, MEALS_CALORIES_PERC, NUTRITION_COLUMNS
from model import extract_quoted_strings

ENERGY_SOURCE = "Mifflin–St Jeor resting energy equation (adult estimate; original paper: https://pubmed.ncbi.nlm.nih.gov/2305711/), multiplied by an activity estimate."
TRAINING_PROTEIN_SOURCE = "For healthy exercising adults: 1.4–2.0 g/kg/day (ISSN position stand, https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/)."
OLDER_PROTEIN_SOURCE = "For healthy adults 65+: 1.0–1.2 g/kg/day is a commonly suggested range (ESPEN, https://pmc.ncbi.nlm.nih.gov/articles/PMC4208946/)."
GENERAL_PROTEIN_SOURCE = "For adults without regular training, 0.8 g/kg/day is the National Academies adult RDA (https://www.nationalacademies.org/read/25353/chapter/28)."
DATASET_SOURCE = "Food.com recipe dataset (as bundled with this project); nutrition values are dataset-reported estimates, not laboratory-verified values."

GOAL_FACTORS = {
    "fat_loss": 0.90,
    "maintenance": 1.00,
    "lean_gain": 1.05,
    "bulk": 1.10,
}

NON_VEGETARIAN_TERMS = (
    "chicken", "beef", "pork", "lamb", "mutton", "turkey", "duck", "goose",
    "venison", "bison", "meat", "fish", "seafood", "salmon", "tuna", "cod",
    "sardine", "mackerel", "herring", "trout", "tilapia", "halibut", "haddock",
    "pollock", "catfish", "perch", "swordfish", "eel", "anchovy", "anchovies",
    "shrimp", "prawn", "crab", "crabmeat", "crab meat", "lobster", "clam", "mussel",
    "oyster", "scallop", "squid", "octopus", "calamari", "crawfish", "crayfish",
    "gelatin", "lard", "bacon", "ham", "sausage", "pancetta", "prosciutto", "chorizo",
    "pepperoni", "salami", "liver", "caviar", "roe", "lox",
)
EGG_TERMS = ("egg", "eggs", "egg white", "egg yolk", "mayonnaise")
NON_VEGAN_TERMS = ("milk", "buttermilk", "butter", "cream", "cheese", "yogurt", "yoghurt", "curd", "paneer", "ghee", "egg", "honey", "whey", "casein")
BREAKFAST_TERMS = ("breakfast", "oatmeal", "porridge", "pancake", "waffle", "omelet", "omelette", "granola", "cereal", "chilla")
SNACK_TERMS = ("snack", "chaat", "crackers", "energy bar", "protein bar", "dip", "popcorn")


def _clean_terms(values: list[str] | None) -> list[str]:
    return [value.strip().casefold() for value in (values or []) if value and value.strip()]


def contains_food_term(text: str, term: str) -> bool:
    """Match whole words for single-token foods (e.g. egg != eggplant)."""
    return contains_any_food_term(str(text), (term.casefold(),))


@lru_cache(maxsize=16)
def _food_terms_pattern(terms: tuple[str, ...]) -> re.Pattern[str]:
    variants = []
    for term in terms:
        escaped = re.escape(term)
        plural_suffix = r"(?:es)?" if term.endswith("s") else r"(?:s|es)?"
        variants.append(escaped + plural_suffix)
    alternatives = "|".join(sorted(variants, key=len, reverse=True))
    return re.compile(rf"\b(?:{alternatives})\b", re.IGNORECASE)


def contains_any_food_term(text: str, terms: tuple[str, ...]) -> bool:
    return _food_terms_pattern(terms).search(str(text)) is not None


def _ingredients(row: Any) -> frozenset[str]:
    parsed = row.get("_ingredients_parsed") if hasattr(row, "get") else None
    if isinstance(parsed, frozenset):
        return parsed
    return frozenset(item.casefold() for item in extract_quoted_strings(str(row.get("RecipeIngredientParts", ""))))


def classify_meal(name: str) -> str:
    value = name.casefold()
    if any(term in value for term in BREAKFAST_TERMS):
        return "breakfast"
    if any(term in value for term in SNACK_TERMS):
        return "snack"
    return "main meal"


def calculate_gym_targets(profile: dict[str, Any]) -> dict[str, Any]:
    """Return cautious estimates; do not prescribe a plan for higher-risk cases."""
    age = profile["age"]
    if age < 18:
        return {
            "available": False,
            "estimated": True,
            "guidance": "Personalized calorie targets and weight-change plans are not generated for people under 18. Growth and puberty change nutrition needs; please work with a pediatric clinician or registered dietitian. Focus on regular meals, varied foods, sleep, and enjoyable activity.",
            "energy_method": None,
            "protein_basis": None,
        }
    if profile.get("professional_support_needed"):
        return {
            "available": False,
            "estimated": True,
            "guidance": "This planner does not calculate targets for pregnancy, relevant medical conditions, eating-disorder concerns, or other situations needing individualized care. Please consult a qualified clinician or registered dietitian.",
            "energy_method": None,
            "protein_basis": None,
        }

    weight = profile["weight"]
    height = profile["height"]
    # Mifflin–St Jeor; show both equation coefficients as a range when requested.
    base = 10 * weight + 6.25 * height - 5 * age
    if profile["sex_coefficient"] == "male":
        resting_values = [base + 5]
        sex_note = "The selected male coefficient is a physiological input to this equation, not a statement about gender identity."
    elif profile["sex_coefficient"] == "female":
        resting_values = [base - 161]
        sex_note = "The selected female coefficient is a physiological input to this equation, not a statement about gender identity."
    else:
        resting_values = [base - 161, base + 5]
        sex_note = "Both equation coefficients are shown as a range because neither single coefficient was selected."

    activity_factor = ACTIVITY_MULTIPLIERS[profile["activity"]]
    maintenance_values = [max(0, value * activity_factor) for value in resting_values]
    goal_factor = GOAL_FACTORS[profile["goal"]]
    target_values = [value * goal_factor for value in maintenance_values]
    calorie_range = [round(min(target_values)), round(max(target_values))]
    maintenance_range = [round(min(maintenance_values)), round(max(maintenance_values))]

    if age >= 65:
        protein_low, protein_high = 1.0, 1.2
        protein_basis = OLDER_PROTEIN_SOURCE
    elif profile.get("training_days", 0) == 0:
        protein_low = protein_high = 0.8
        protein_basis = GENERAL_PROTEIN_SOURCE
    else:
        protein_low, protein_high = 1.4, 2.0
        protein_basis = TRAINING_PROTEIN_SOURCE
    protein_target = min(weight * 1.6, calorie_range[0] * 0.35 / 4)
    protein_range = [round(weight * protein_low), round(weight * protein_high)]
    fat_target = round(calorie_range[0] * 0.275 / 9)
    carb_target = max(0, round((calorie_range[0] - protein_target * 4 - fat_target * 9) / 4))

    return {
        "available": True,
        "estimated": True,
        "maintenance_calories": maintenance_range,
        "target_calories": calorie_range,
        "protein_g_range": protein_range,
        "protein_g_target": round(protein_target),
        "carbohydrate_g_target": carb_target,
        "fat_g_target": fat_target,
        "energy_method": ENERGY_SOURCE,
        "protein_basis": protein_basis,
        "macronutrient_method": "Protein target uses 1.6 g/kg as a practical midpoint, capped at 35% of estimated energy. Carbohydrate is the remaining energy after protein and 27.5% energy from fat. These are estimates; actual needs vary.",
        "equation_note": sex_note,
        "older_adult_note": "At age 65+, energy estimates are less individually reliable. Consider clinical advice, especially with illness, frailty, or kidney disease." if age >= 65 else None,
        "goal_adjustment": goal_factor,
    }


def filter_recipe_frame(
    dataframe: pd.DataFrame,
    *,
    query: str = "",
    dietary_preference: str = "omnivore",
    meal_category: str | None = None,
    min_calories: float | None = None,
    max_calories: float | None = None,
    min_protein: float | None = None,
    min_protein_per_100_calories: float | None = None,
    max_minutes: int | None = None,
    include_ingredients: list[str] | None = None,
    exclude_ingredients: list[str] | None = None,
) -> pd.DataFrame:
    frame = dataframe
    if dietary_preference in {"vegetarian", "egg-inclusive", "vegan"}:
        if "_has_non_vegetarian" in frame.columns:
            frame = frame.loc[~frame["_has_non_vegetarian"]]
        else:
            frame = frame.loc[~frame.apply(
                lambda row: any(contains_food_term(row["Name"], term) for term in NON_VEGETARIAN_TERMS)
                or any(contains_food_term(item, term) for term in NON_VEGETARIAN_TERMS for item in row["_ingredients_parsed"]),
                axis=1,
            )]
        if frame.empty:
            return frame
    if dietary_preference == "vegetarian":
        if "_has_egg" in frame.columns:
            frame = frame.loc[~frame["_has_egg"]]
        else:
            frame = frame.loc[~frame.apply(
                lambda row: any(contains_food_term(row["Name"], term) for term in EGG_TERMS)
                or any(contains_food_term(item, term) for term in EGG_TERMS for item in row["_ingredients_parsed"]),
                axis=1,
            )]
    if dietary_preference == "vegan":
        # Ingredient labels are heuristic; this conservative screen excludes common dairy/egg terms.
        if "_has_non_vegan" in frame.columns:
            frame = frame.loc[~frame["_has_non_vegan"]]
        else:
            frame = frame.loc[~frame["_ingredients_parsed"].apply(lambda items: any(term in item for term in NON_VEGAN_TERMS for item in items))]

    # Pandas may return an empty DataFrame (rather than an empty boolean Series)
    # from row-wise apply on zero rows; stop before applying later diet filters.
    if frame.empty:
        return frame

    if query.strip():
        query_lower = query.strip().casefold()
        matches = frame["Name"].astype(str).str.casefold().str.contains(query_lower, regex=False)
        matches |= frame["RecipeIngredientParts"].astype(str).str.casefold().str.contains(query_lower, regex=False)
        frame = frame.loc[matches]
    if min_calories is not None:
        frame = frame.loc[frame["Calories"] >= min_calories]
    if max_calories is not None:
        frame = frame.loc[frame["Calories"] <= max_calories]
    if min_protein is not None:
        frame = frame.loc[frame["ProteinContent"] >= min_protein]
    if min_protein_per_100_calories is not None:
        protein_density = frame["ProteinContent"] * 100 / frame["Calories"].clip(lower=1)
        frame = frame.loc[protein_density >= min_protein_per_100_calories]
    if meal_category and meal_category != "all":
        category = meal_category.casefold()
        frame = frame.loc[frame["Name"].astype(str).apply(classify_meal) == category]
    if max_minutes is not None:
        def duration_minutes(value: Any) -> int | None:
            match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?", str(value))
            if not match:
                return None
            return int(match.group(1) or 0) * 60 + int(match.group(2) or 0)
        frame = frame.loc[frame["TotalTime"].apply(duration_minutes).fillna(10**9) <= max_minutes]

    includes = _clean_terms(include_ingredients)
    excludes = _clean_terms(exclude_ingredients)
    if includes:
        frame = frame.loc[frame["_ingredients_parsed"].apply(lambda items: all(any(term in item for item in items) for term in includes))]
    if excludes:
        frame = frame.loc[~frame["_ingredients_parsed"].apply(lambda items: any(term in item for item in items for term in excludes))]
    return frame


def _scale_nutrition(record: dict[str, Any], multiplier: float) -> dict[str, Any]:
    for column in NUTRITION_COLUMNS:
        record[column] = round(float(record[column]) * multiplier, 1)
    return record


def recipe_record(row: Any, portion_multiplier: float = 1.0) -> dict[str, Any]:
    record = row.to_dict() if hasattr(row, "to_dict") else dict(row)
    record.pop("_ingredients_parsed", None)
    record.pop("_has_non_vegetarian", None)
    record.pop("_has_egg", None)
    record.pop("_has_non_vegan", None)
    record["RecipeIngredientParts"] = extract_quoted_strings(str(record.get("RecipeIngredientParts", "")))
    record["RecipeInstructions"] = extract_quoted_strings(str(record.get("RecipeInstructions", "")))
    for field in ("CookTime", "PrepTime", "TotalTime"):
        record[field] = str(record.get(field, ""))
    record["recipe_id"] = int(record.get("RecipeId", 0))
    record["RecipeId"] = record["recipe_id"]
    record["meal_category"] = classify_meal(record.get("Name", ""))
    record["protein_per_100_calories"] = round(float(record["ProteinContent"]) * 100 / max(float(record["Calories"]), 1), 2)
    record["portion_multiplier"] = portion_multiplier
    record["ingredients_quantities_available"] = False
    record["nutrition_source"] = DATASET_SOURCE
    record["matching_explanation"] = "Matched using the filters you selected; values are for the dataset's recorded recipe serving."
    return _scale_nutrition(record, portion_multiplier)


def paged_recipe_search(dataframe: pd.DataFrame, **filters: Any) -> tuple[list[dict[str, Any]], int]:
    page = int(filters.pop("page", 1))
    page_size = int(filters.pop("page_size", 12))
    portion_multiplier = float(filters.pop("portion_multiplier", 1.0))
    filtered = filter_recipe_frame(dataframe, **filters)
    if filters.get("min_protein_per_100_calories") is not None:
        density = filtered["ProteinContent"] * 100 / filtered["Calories"].clip(lower=1)
        filtered = filtered.assign(_sort_score=density)
        filtered = filtered.sort_values("_sort_score", ascending=False)
    total = len(filtered)
    start = (page - 1) * page_size
    records = [recipe_record(row, portion_multiplier) for _, row in filtered.iloc[start:start + page_size].iterrows()]
    return records, total


def build_gym_plan(dataframe: pd.DataFrame, profile: dict[str, Any]) -> dict[str, Any]:
    targets = calculate_gym_targets(profile)
    response: dict[str, Any] = {
        "available": targets["available"],
        "estimated": True,
        "guidance": targets.get("guidance"),
        "targets": targets if targets["available"] else None,
        "meals": [],
        "pre_workout": None,
        "post_workout": None,
        "limitations": [
            "The dataset contains recipe-level nutrition but no ingredient gram quantities or serving weights; portion scaling changes displayed nutrition estimates only.",
            "Cuisine and budget are not structured fields in this dataset. Cuisine is treated as an optional text search; price cannot be estimated.",
            "Dietary classification is an ingredient-keyword screen and may miss undeclared or ambiguously named ingredients. Always review the full ingredient list for allergies and dietary rules.",
        ],
        "nutrition_source": DATASET_SOURCE,
    }
    if not targets["available"]:
        return response

    profile_terms = list(profile.get("allergies", [])) + list(profile.get("disliked_foods", []))
    pool = filter_recipe_frame(
        dataframe,
        query=profile.get("cuisine") or "",
        dietary_preference=profile["dietary_preference"],
        exclude_ingredients=profile_terms,
    )
    if pool.empty and profile.get("cuisine"):
        response["limitations"].append("No recipes matched the cuisine keyword together with your exclusions; results are empty rather than silently ignoring those filters.")
        return response
    if pool.empty:
        response["limitations"].append("No recipes matched the selected diet and ingredient exclusions.")
        return response

    calories = sum(targets["target_calories"]) / len(targets["target_calories"])
    protein = targets["protein_g_target"]
    meals = list(MEALS_CALORIES_PERC[profile["meals_per_day"]].items())
    vectors: list[list[float]] = []
    for _, share in meals:
        vectors.append([
            calories * share,
            targets["fat_g_target"] * share,
            3,
            25,
            400,
            targets["carbohydrate_g_target"] * share,
            6,
            10,
            protein * share,
        ])
    # Pre/post suggestions are recommendations from the same filtered source data.
    vectors.extend([
        [calories * 0.12, targets["fat_g_target"] * 0.12, 2, 10, 250, targets["carbohydrate_g_target"] * 0.12, 3, 5, protein * 0.12],
        [calories * 0.25, targets["fat_g_target"] * 0.25, 3, 20, 350, targets["carbohydrate_g_target"] * 0.25, 5, 5, protein * 0.25],
    ])

    count = min(3, len(pool))
    matrix = pool.loc[:, NUTRITION_COLUMNS].to_numpy(dtype=float)
    scaler = StandardScaler()
    prepared = scaler.fit_transform(matrix)
    nearest = NearestNeighbors(metric="cosine", algorithm="brute", n_neighbors=count).fit(prepared)
    indices = nearest.kneighbors(scaler.transform(np.asarray(vectors, dtype=float)), return_distance=False)

    groups = []
    for index, (name, share) in enumerate(meals):
        rows = pool.iloc[indices[index]]
        groups.append({
            "meal_name": name,
            "recommended_calories": round(calories * share),
            "recipes": [recipe_record(row) for _, row in rows.iterrows()],
        })
    pre_rows = pool.iloc[indices[-2]]
    post_rows = pool.iloc[indices[-1]]
    response.update({
        "meals": groups,
        "pre_workout": {"timing": "About 1–3 hours before training; choose a comfortable, familiar meal.", "recipes": [recipe_record(row) for _, row in pre_rows.iterrows()]},
        "post_workout": {"timing": "A regular meal after training can contribute to daily energy and protein needs; there is no guaranteed result from a single meal.", "recipes": [recipe_record(row) for _, row in post_rows.iterrows()]},
    })
    return response
