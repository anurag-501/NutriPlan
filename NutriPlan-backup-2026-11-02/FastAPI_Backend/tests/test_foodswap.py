import json

from food_swap import FoodSwapRequest, compare_foodswap


def test_foodswap_uses_real_recipe_rows_and_user_entered_prices(client):
    response = client.post("/api/foodswap/compare", json={
        "current_meal": [{"recipe_id": 1, "servings": 0.5}],
        "dietary_preference": "omnivore",
        "priority": "lower_cost",
        "available_ingredients": ["salt", "pepper"],
        "prices": [
            {"recipe_id": 1, "cost_inr": 18, "source": "mess menu checked", "checked_on": "2026-10-31"},
            {"recipe_id": 9, "cost_inr": 24, "source": "canteen board", "checked_on": "2026-10-31"},
        ],
        "result_limit": 3,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["current_meal"]["totals"]["Calories"] == 105
    assert data["current_meal"]["cost_inr"] == 9
    assert data["alternatives"][0]["recipe_id"] == 9
    assert data["alternatives"][0]["cost_inr"] == 24
    assert data["alternatives"][0]["price_source"] == "canteen board"
    assert data["alternatives"][0]["budget_status"] is None
    assert data["alternatives"][0]["score"] >= 0
    assert any("user-entered cost" in note for note in data["notes"])


def test_foodswap_budget_keeps_unknown_cost_visible_and_excludes_known_over_budget(client):
    response = client.post("/api/foodswap/compare", json={
        "current_meal": [{"recipe_id": 1, "servings": 1}],
        "dietary_preference": "omnivore",
        "budget_inr": 15,
        "prices": [{"recipe_id": 9, "cost_inr": 25, "source": "user check", "checked_on": "2026-10-31"}],
        "result_limit": 3,
    })
    assert response.status_code == 200
    data = response.json()
    assert all(item["recipe_id"] != 9 for item in data["alternatives"])
    assert all(item["budget_status"] is None for item in data["alternatives"])
    assert any("unpriced candidates remain marked unknown" in note for note in data["notes"])


def test_foodswap_validates_recipe_ids_prices_and_duplicate_items(client):
    base = {"current_meal": [{"recipe_id": 1, "servings": 1}], "dietary_preference": "omnivore"}
    invalid_id = client.post("/api/foodswap/compare", json={**base, "prices": [{"recipe_id": 999, "cost_inr": 12, "source": "canteen", "checked_on": "2026-10-31"}]})
    assert invalid_id.status_code == 404
    invalid_price = client.post("/api/foodswap/compare", json={**base, "prices": [{"recipe_id": 2, "cost_inr": 0, "source": "canteen", "checked_on": "2026-10-31"}]})
    assert invalid_price.status_code == 422
    duplicate = client.post("/api/foodswap/compare", json={"current_meal": [{"recipe_id": 1}, {"recipe_id": 1}]})
    assert duplicate.status_code == 422


def test_foodswap_warns_if_current_meal_conflicts_but_filters_alternatives(client):
    response = client.post("/api/foodswap/compare", json={
        "current_meal": [{"recipe_id": 1, "servings": 1}],
        "dietary_preference": "vegetarian",
        "exclusions": ["chicken"],
    })
    assert response.status_code == 200
    data = response.json()
    assert data["current_meal"]["warnings"]
    assert all("chicken" not in ingredient.casefold() for alternative in data["alternatives"] for ingredient in alternative["recipe"]["RecipeIngredientParts"])


def test_foodswap_handles_mixed_missing_and_present_prep_times(mock_dataset):
    dataframe = mock_dataset.copy()
    dataframe.loc[dataframe["RecipeId"] == 5, "TotalTime"] = None
    result = compare_foodswap(dataframe, FoodSwapRequest(
        current_meal=[{"recipe_id": 1}], dietary_preference="omnivore", result_limit=3,
    ))
    assert len(result["alternatives"]) == 3
    assert all(item["prep_minutes"] is None or item["prep_minutes"] > 0 for item in result["alternatives"])


def test_foodswap_converts_pandas_missing_recipe_fields_to_json_null(mock_dataset):
    dataframe = mock_dataset.copy()
    dataframe.loc[dataframe["RecipeId"] == 1, "SodiumContent"] = float("nan")
    result = compare_foodswap(dataframe, FoodSwapRequest(
        current_meal=[{"recipe_id": 1}], dietary_preference="omnivore", result_limit=3,
    ))
    assert result["current_meal"]["items"][0]["recipe"]["SodiumContent"] is None
    json.dumps(result, allow_nan=False)
