import os
import re
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from urllib.parse import urlsplit

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

import platform_store
from api_v1 import router as api_v1_router
from chat_api import router as chat_router
from chat_service import ChatService
from config import (
    ACTIVITY_MULTIPLIERS,
    DEFAULT_N_NEIGHBORS,
    MEALS_CALORIES_PERC,
    WEIGHT_LOSS_PLANS,
)
from food_swap import FoodSwapRateLimiter, FoodSwapRequest, compare_foodswap
from image_finder import get_image_url
from model import output_recommended_recipes, recommend
from nutrition import (
    build_nutrition_vector,
    calculate_bmi,
    calculate_bmr,
    calculate_tdee,
)
from nutrition_planner import (
    DATASET_SOURCE,
    EGG_TERMS,
    NON_VEGAN_TERMS,
    build_gym_plan,
    calculate_gym_targets,
    contains_any_food_term,
    has_non_vegetarian_food,
    paged_recipe_search,
    recipe_record,
)

# Absolute path so the app works regardless of working directory.
_DATASET_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'Data', 'dataset.csv'
)

dataset: pd.DataFrame | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global dataset
    if dataset is None:
        # Pre-process ingredient strings into frozensets once at startup.
        # Enables fast set-based filtering in extract_ingredient_filtered_data()
        # instead of scanning every row with a compound regex on each request.
        dataset = pd.read_csv(_DATASET_PATH, compression='gzip')
        dataset['_ingredients_parsed'] = dataset['RecipeIngredientParts'].apply(
            lambda x: frozenset(s.lower() for s in re.findall(r'"([^"]*)"', x))
        )
        food_texts = zip(dataset['Name'].values, dataset['RecipeIngredientParts'].values)
        diet_flags = [
            (
                has_non_vegetarian_food(name, ingredients),
                contains_any_food_term(f"{name} {ingredients}", EGG_TERMS),
                contains_any_food_term(f"{name} {ingredients}", NON_VEGAN_TERMS),
            )
            for name, ingredients in food_texts
        ]
        dataset['_has_non_vegetarian'] = [flag[0] for flag in diet_flags]
        dataset['_has_egg'] = [flag[1] for flag in diet_flags]
        dataset['_has_non_vegan'] = [flag[2] for flag in diet_flags]
    app.state.dataset = dataset
    platform_store.initialize_database()
    app.state.chat_service = ChatService()
    yield
    await app.state.chat_service.close()


app = FastAPI(lifespan=lifespan)


def _cors_origins() -> list[str]:
    development_origins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost",
        "http://localhost:80",
    ]
    configured = []
    for value in os.getenv("CORS_ORIGINS", "").split(","):
        origin = value.strip().rstrip("/")
        if not origin or origin == "*":
            continue
        try:
            parsed = urlsplit(origin)
            if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment:
                configured.append(origin)
        except ValueError:
            continue
    return list(dict.fromkeys(development_origins + configured))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
)

app.include_router(chat_router)
app.include_router(api_v1_router)
_foodswap_limiter = FoodSwapRateLimiter()


# ---------------------------------------------------------------------------
# Shared models
# ---------------------------------------------------------------------------

class Recipe(BaseModel):
    Name: str
    CookTime: str
    PrepTime: str
    TotalTime: str
    RecipeIngredientParts: list[str]
    Calories: float
    FatContent: float
    SaturatedFatContent: float
    CholesterolContent: float
    SodiumContent: float
    CarbohydrateContent: float
    FiberContent: float
    SugarContent: float
    ProteinContent: float
    RecipeInstructions: list[str]
    image_url: str | None = None


class RecipeResult(Recipe):
    RecipeId: int
    recipe_id: int
    meal_category: str
    protein_per_100_calories: float
    portion_multiplier: float
    ingredients_quantities_available: bool
    nutrition_source: str
    matching_explanation: str


class RecipeSearchOut(BaseModel):
    items: list[RecipeResult]
    total: int
    page: int
    page_size: int
    nutrition_basis: str
    filter_notes: list[str]


class PlannerProfile(BaseModel):
    age: int = Field(ge=13, le=100)
    height: float = Field(gt=100, le=250, description="Height in centimetres")
    weight: float = Field(gt=25, le=300, description="Weight in kilograms")
    sex_coefficient: Literal["male", "female", "range"]
    activity: str
    training_days: int = Field(ge=0, le=7)
    training_experience: Literal["beginner", "intermediate", "advanced"]
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
    def activity_is_supported(cls, value):
        if value not in ACTIVITY_MULTIPLIERS:
            raise ValueError("Choose one of the listed activity levels")
        return value


class PlanMeal(BaseModel):
    meal_name: str
    recommended_calories: int
    recipes: list[RecipeResult]


class WorkoutMeal(BaseModel):
    timing: str
    recipes: list[RecipeResult]


class GymPlanOut(BaseModel):
    available: bool
    estimated: bool
    guidance: str | None = None
    targets: dict | None = None
    meals: list[PlanMeal]
    pre_workout: WorkoutMeal | None = None
    post_workout: WorkoutMeal | None = None
    limitations: list[str]
    nutrition_source: str


class PlateSelection(BaseModel):
    recipe_id: int = Field(gt=0)
    servings: float = Field(default=1, ge=0.25, le=3)


class PlateCalculationIn(BaseModel):
    items: list[PlateSelection] = Field(min_length=1, max_length=20)


# ---------------------------------------------------------------------------
# /predict/ — custom nutrition-based recommendation
# ---------------------------------------------------------------------------

class Params(BaseModel):
    n_neighbors: int = DEFAULT_N_NEIGHBORS
    return_distance: bool = False


class PredictionIn(BaseModel):
    nutrition_input: Annotated[list[float], Field(min_length=9, max_length=9)]
    ingredients: list[str] = []
    params: Params | None = None


class PredictionOut(BaseModel):
    output: list[Recipe] | None = None


# ---------------------------------------------------------------------------
# /generate-meal-plan/ — automatic meal plan from personal data
# ---------------------------------------------------------------------------

class PersonData(BaseModel):
    age: int = Field(ge=18, le=120)
    height: float               # cm
    weight: float               # kg
    gender: Literal["Male", "Female"]
    activity: str               # must be a key in ACTIVITY_MULTIPLIERS
    number_of_meals: Literal[3, 4, 5]
    weight_loss: str            # must be a key in WEIGHT_LOSS_PLANS


class MealRecommendation(BaseModel):
    meal_name: str
    recipes: list[Recipe]


class MealPlanOut(BaseModel):
    bmi: float
    bmr: float
    maintain_calories: float    # TDEE (no weight-loss adjustment)
    target_calories: float      # TDEE × weight-loss factor
    meals: list[MealRecommendation]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def home():
    return {"health_check": "OK"}


@app.get("/health")
def health():
    """Explicit health alias; the existing root health route remains supported."""
    return {"health_check": "OK"}


@app.post("/nutrition/calculate")
def calculate_nutrition(profile: PlannerProfile):
    return calculate_gym_targets(profile.model_dump())


@app.post("/gym-diet-plan", response_model=GymPlanOut)
def create_gym_diet_plan(profile: PlannerProfile):
    return build_gym_plan(dataset, profile.model_dump())


@app.get("/recipes", response_model=RecipeSearchOut)
def search_recipes(
    q: str = Query(default="", max_length=100),
    dietary_preference: Literal["vegetarian", "egg-inclusive", "vegan", "omnivore"] = "omnivore",
    meal_category: Literal["all", "breakfast", "main meal", "snack"] = "all",
    min_calories: float | None = Query(default=None, ge=0, le=5000),
    max_calories: float | None = Query(default=None, ge=0, le=5000),
    min_protein: float | None = Query(default=None, ge=0, le=500),
    min_protein_per_100_calories: float | None = Query(default=None, ge=0, le=100),
    max_minutes: int | None = Query(default=None, ge=1, le=1440),
    include_ingredients: list[str] = Query(default=[]),  # noqa: B008 - FastAPI query metadata
    exclude_ingredients: list[str] = Query(default=[]),  # noqa: B008 - FastAPI query metadata
    cuisine: str | None = Query(default=None, max_length=80),
    budget: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=48),
    portion_multiplier: float = Query(default=1, ge=0.25, le=3),
):
    filters = {
        "query": cuisine or q,
        "dietary_preference": dietary_preference,
        "meal_category": meal_category,
        "min_calories": min_calories,
        "max_calories": max_calories,
        "min_protein": min_protein,
        "min_protein_per_100_calories": min_protein_per_100_calories,
        "max_minutes": max_minutes,
        "include_ingredients": include_ingredients,
        "exclude_ingredients": exclude_ingredients,
        "page": page,
        "page_size": page_size,
        "portion_multiplier": portion_multiplier,
    }
    items, total = paged_recipe_search(dataset, **filters)
    notes = [
        "Vegetarian/vegan classification uses ingredient keyword screening; inspect ingredients for allergens and dietary rules.",
        "The dataset has no ingredient gram quantities or serving weights; portion scaling changes displayed nutrition only.",
    ]
    if budget:
        notes.append("Price data is not present in the bundled recipe dataset, so the budget preference was not applied.")
    if cuisine:
        notes.append("Cuisine is treated as a text search over recipe names and ingredients because the dataset has no cuisine field.")
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "nutrition_basis": DATASET_SOURCE,
        "filter_notes": notes,
    }


@app.get("/recipes/{recipe_id}", response_model=RecipeResult)
def get_recipe(recipe_id: int, portion_multiplier: float = Query(default=1, ge=0.25, le=3)):
    matches = dataset.loc[dataset["RecipeId"] == recipe_id]
    if matches.empty:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe_record(matches.iloc[0], portion_multiplier)


@app.post("/api/meal-plate/calculate")
def calculate_meal_plate(selection: PlateCalculationIn):
    """Sum nutrition from selected dataset recipes and explicitly stated servings."""
    items = []
    totals = {key: 0.0 for key in ("Calories", "ProteinContent", "CarbohydrateContent", "FatContent")}
    for selected in selection.items:
        matches = dataset.loc[dataset["RecipeId"] == selected.recipe_id]
        if matches.empty:
            raise HTTPException(status_code=404, detail=f"Recipe {selected.recipe_id} not found")
        recipe = recipe_record(matches.iloc[0], selected.servings)
        for key in totals:
            totals[key] += float(recipe[key])
        items.append({
            "recipe_id": recipe["recipe_id"], "Name": recipe["Name"],
            "servings": selected.servings, "Calories": recipe["Calories"],
            "ProteinContent": recipe["ProteinContent"],
            "CarbohydrateContent": recipe["CarbohydrateContent"], "FatContent": recipe["FatContent"],
            "nutrition_source": recipe["nutrition_source"],
        })
    return {
        "items": items,
        "totals": {key: round(value, 1) for key, value in totals.items()},
        "nutrition_basis": DATASET_SOURCE,
        "limitations": [
            "Totals are estimates summed from dataset-reported recipe servings and user-entered serving multipliers.",
            "The dataset does not contain gram weights, hostel menu portions, or current local prices; free-text meals are not automatically assigned nutrition values.",
        ],
    }


@app.post("/api/foodswap/compare")
def foodswap_compare(payload: FoodSwapRequest, request: Request):
    """Compare recipe-backed meal choices with explicit constraints and request-scoped prices."""
    client_ip = request.client.host if request.client else "unknown"
    if not _foodswap_limiter.allow(client_ip):
        raise HTTPException(status_code=429, detail="FoodSwap request limit reached. Wait a minute and try again.", headers={"Retry-After": "60"})
    if dataset is None:
        raise HTTPException(status_code=503, detail="Recipe dataset is not ready")
    return compare_foodswap(dataset, payload)


@app.post("/predict/", response_model=PredictionOut)
def predict(prediction_input: PredictionIn):
    params = (
        prediction_input.params.model_dump()
        if prediction_input.params
        else {"n_neighbors": DEFAULT_N_NEIGHBORS, "return_distance": False}
    )
    recommendation_dataframe = recommend(
        dataset,
        prediction_input.nutrition_input,
        prediction_input.ingredients,
        params,
    )
    output = output_recommended_recipes(recommendation_dataframe)
    if output:
        for recipe in output:
            recipe['image_url'] = get_image_url(recipe['Name'])
    return {"output": output}


@app.post("/generate-meal-plan/", response_model=MealPlanOut)
def generate_meal_plan(person: PersonData):
    bmi = calculate_bmi(person.weight, person.height)
    bmr = calculate_bmr(person.weight, person.height, person.age, person.gender)
    maintain_calories = calculate_tdee(bmr, person.activity)
    factor = WEIGHT_LOSS_PLANS[person.weight_loss]["factor"]
    target_calories = maintain_calories * factor

    meals = []
    for meal_name, perc in MEALS_CALORIES_PERC[person.number_of_meals].items():
        vector = build_nutrition_vector(target_calories * perc, meal_name)
        recs = recommend(
            dataset, vector, [],
            {"n_neighbors": DEFAULT_N_NEIGHBORS, "return_distance": False},
        )
        recipes = output_recommended_recipes(recs) if recs is not None else []
        for recipe in recipes:
            recipe['image_url'] = get_image_url(recipe['Name'])
        meals.append(MealRecommendation(
            meal_name=meal_name,
            recipes=recipes,
        ))

    return MealPlanOut(
        bmi=bmi,
        bmr=round(bmr, 2),
        maintain_calories=round(maintain_calories),
        target_calories=round(target_calories),
        meals=meals,
    )
