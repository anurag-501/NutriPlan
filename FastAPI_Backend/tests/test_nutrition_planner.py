import pandas as pd

from nutrition_planner import (
    build_gym_plan,
    calculate_gym_targets,
    filter_recipe_frame,
    has_non_vegetarian_food,
    paged_recipe_search,
    recipe_record,
)


def make_row(recipe_id, name, ingredients, calories, protein, carbs=35, fat=10, total_time="PT20M"):
    return {
        "RecipeId": recipe_id,
        "Name": name,
        "CookTime": "PT10M",
        "PrepTime": "PT10M",
        "TotalTime": total_time,
        "RecipeIngredientParts": 'c(' + ", ".join(f'"{item}"' for item in ingredients) + ')',
        "Calories": float(calories),
        "FatContent": float(fat),
        "SaturatedFatContent": 2.0,
        "CholesterolContent": 5.0,
        "SodiumContent": 100.0,
        "CarbohydrateContent": float(carbs),
        "FiberContent": 5.0,
        "SugarContent": 3.0,
        "ProteinContent": float(protein),
        "RecipeInstructions": 'c("Mix ingredients", "Cook and serve")',
        "_ingredients_parsed": frozenset(item.casefold() for item in ingredients),
        "_has_non_vegetarian": any(term in " ".join(ingredients).casefold() for term in ("chicken", "fish", "beef")),
        "_has_egg": "egg" in " ".join(ingredients).casefold(),
    }


def recipes():
    return pd.DataFrame([
        make_row(1, "Paneer Protein Bowl", ["paneer", "tomato", "rice"], 420, 27),
        make_row(2, "Oats Breakfast Bowl", ["oats", "milk", "banana"], 310, 16, total_time="PT15M"),
        make_row(3, "Egg Oats Scramble", ["egg", "oats", "spinach"], 360, 24),
        make_row(4, "Chicken Curry", ["chicken", "tomato", "rice"], 510, 38),
    ])


def profile(**changes):
    values = {
        "age": 30, "height": 175, "weight": 70, "sex_coefficient": "male",
        "activity": "Moderate exercise (3-5 days/wk)", "training_days": 4,
        "training_experience": "intermediate", "goal": "maintenance",
        "dietary_preference": "vegetarian", "allergies": [], "disliked_foods": [],
        "meals_per_day": 3, "budget": None, "cuisine": None,
        "workout_time": "evening", "professional_support_needed": False,
    }
    return values | changes


def test_adult_energy_and_goal_estimates_are_explainable():
    maintain = calculate_gym_targets(profile())
    fat_loss = calculate_gym_targets(profile(goal="fat_loss"))
    assert maintain["available"] is True
    assert maintain["maintenance_calories"] == maintain["target_calories"]
    assert fat_loss["target_calories"][0] == round(maintain["maintenance_calories"][0] * 0.9)
    assert maintain["protein_g_range"] == [98, 140]
    assert "Mifflin" in maintain["energy_method"]


def test_under_18_gets_guidance_without_targets():
    result = calculate_gym_targets(profile(age=17))
    assert result["available"] is False
    assert "pediatric" in result["guidance"]
    assert "target_calories" not in result


def test_professional_support_flag_suppresses_targets():
    result = calculate_gym_targets(profile(professional_support_needed=True))
    assert result["available"] is False
    assert "clinician" in result["guidance"]


def test_older_adult_uses_separate_protein_range():
    result = calculate_gym_targets(profile(age=67))
    assert result["protein_g_range"] == [70, 84]
    assert "ESPEN" in result["protein_basis"]


def test_range_coefficient_returns_energy_range():
    result = calculate_gym_targets(profile(sex_coefficient="range"))
    assert result["target_calories"][0] < result["target_calories"][1]


def test_dietary_filters_exclude_meat_and_egg_as_selected():
    data = recipes()
    strict = filter_recipe_frame(data, dietary_preference="vegetarian")
    egg_inclusive = filter_recipe_frame(data, dietary_preference="egg-inclusive")
    assert set(strict["RecipeId"]) == {1, 2}
    assert set(egg_inclusive["RecipeId"]) == {1, 2, 3}


def test_vegetarian_filter_checks_title_without_misreading_eggplant():
    data = pd.DataFrame([
        make_row(5, "Eggplant Tomato Bake", ["eggplant", "tomato"], 250, 8),
        make_row(6, "Salmon Salad", ["lettuce", "tomato"], 220, 10),
    ]).drop(columns=["_has_non_vegetarian", "_has_egg"])
    filtered = filter_recipe_frame(data, dietary_preference="vegetarian")
    assert list(filtered["RecipeId"]) == [5]


def test_vegetarian_filter_excludes_sardine_crabmeat_and_seafood_titles():
    data = pd.DataFrame([
        make_row(7, "Eggplant Tomato Bake", ["eggplant", "tomato"], 250, 8),
        make_row(8, "Pasta With Canned Sardines Sauce", ["sardines", "tomato"], 340, 18),
        make_row(9, "Tomato Crabmeat Sauce for Pasta", ["crabmeat", "tomato"], 320, 20),
        make_row(10, "Spaghetti with Seafood", ["shrimp", "pasta"], 400, 22),
    ]).drop(columns=["_has_non_vegetarian", "_has_egg"])
    filtered = filter_recipe_frame(data, dietary_preference="vegetarian")
    assert list(filtered["RecipeId"]) == [7]


def test_vegetarian_filter_conservatively_excludes_carne_and_worcestershire():
    data = pd.DataFrame([
        make_row(11, "Chili Con Carne", ["tomato", "beans"], 380, 28),
        make_row(12, "Cola Roast", ["Worcestershire sauce", "cola"], 420, 35),
        make_row(13, "Dijon Pesto Steak", ["top round steaks"], 380, 34),
        make_row(14, "Philadelphia Scrapple", ["cornmeal", "flour"], 360, 20),
        make_row(15, "Easiest Hamburger Soup", ["hamburger", "potatoes"], 390, 25),
        make_row(16, "Roasted Red Snapper", ["red snapper", "lemon"], 310, 30),
        make_row(17, "Orange Roughy With Vegetables", ["potatoes"], 310, 25),
        make_row(18, "San Francisco Chops", ["broth", "soy sauce"], 310, 25),
        make_row(19, "A Real Philly Cheesesteak", ["onion", "mushroom", "provolone"], 410, 25),
        make_row(20, "Three Bean Chili", ["tomato", "beans", "corn"], 310, 16),
    ])
    # Match the startup-cached classification used by FastAPI's real dataset.
    data["_has_non_vegetarian"] = data.apply(
        lambda row: has_non_vegetarian_food(row["Name"], row["RecipeIngredientParts"]),
        axis=1,
    )
    filtered = filter_recipe_frame(data, dietary_preference="vegetarian")
    assert list(filtered["RecipeId"]) == [20]


def test_search_filters_calories_protein_ingredients_time_and_category():
    result = filter_recipe_frame(
        recipes(), dietary_preference="omnivore", min_calories=300,
        max_calories=450, min_protein=20, max_minutes=20,
        include_ingredients=["tomato"], exclude_ingredients=["egg"],
        meal_category="main meal",
    )
    assert list(result["RecipeId"]) == [1]


def test_portion_scaling_scales_nutrition_but_not_ingredient_quantities():
    row = recipes().iloc[0]
    scaled = recipe_record(row, 1.5)
    assert scaled["Calories"] == 630.0
    assert scaled["ProteinContent"] == 40.5
    assert scaled["RecipeIngredientParts"] == ["paneer", "tomato", "rice"]
    assert scaled["ingredients_quantities_available"] is False


def test_search_paginates_and_returns_dataset_provenance():
    items, total = paged_recipe_search(recipes(), dietary_preference="omnivore", page=2, page_size=2)
    assert total == 4
    assert len(items) == 2
    assert "Food.com" in items[0]["nutrition_source"]


def test_gym_plan_uses_only_selected_diet_pool():
    result = build_gym_plan(recipes(), profile())
    assert result["available"] is True
    assert len(result["meals"]) == 3
    assert result["pre_workout"]["recipes"]
    assert all("chicken" not in " ".join(recipe["RecipeIngredientParts"]).casefold() for meal in result["meals"] for recipe in meal["recipes"])


def test_budget_is_explicitly_limited_by_dataset_schema():
    items, _ = paged_recipe_search(recipes(), dietary_preference="omnivore", page=1, page_size=1)
    assert items[0]["ingredients_quantities_available"] is False
