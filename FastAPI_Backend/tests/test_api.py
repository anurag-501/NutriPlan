import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


FAKE_IMAGE_URL = "http://test-image.example.com/img.jpg"


@pytest.fixture
def client(mock_dataset, monkeypatch, tmp_path):
    import main
    monkeypatch.setattr(main, "dataset", mock_dataset)
    monkeypatch.setattr(main, "get_image_url", lambda _: FAKE_IMAGE_URL)
    monkeypatch.setenv("NUTRIPLAN_DB_PATH", str(tmp_path / "api-platform.sqlite3"))
    from fastapi.testclient import TestClient
    with TestClient(main.app) as client:
        yield client


def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"health_check": "OK"}


def test_health_alias(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"health_check": "OK"}


def test_predict_returns_results(client):
    payload = {
        "nutrition_input": [200.0, 5.0, 1.0, 30.0, 400.0, 20.0, 2.0, 3.0, 15.0],
        "ingredients": [],
        "params": {"n_neighbors": 3, "return_distance": False},
    }
    response = client.post("/predict/", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["output"] is not None
    assert len(data["output"]) == 3
    assert "Name" in data["output"][0]
    assert "Calories" in data["output"][0]
    assert data["output"][0]["image_url"] == FAKE_IMAGE_URL


def test_predict_no_results_with_impossible_ingredient(client):
    payload = {
        "nutrition_input": [200.0, 5.0, 1.0, 30.0, 400.0, 20.0, 2.0, 3.0, 15.0],
        "ingredients": ["unicorn_ingredient_xyz_impossible"],
        "params": {"n_neighbors": 3, "return_distance": False},
    }
    response = client.post("/predict/", json=payload)
    assert response.status_code == 200
    assert response.json() == {"output": None}


def test_generate_meal_plan_returns_results(client):
    payload = {
        "age": 30, "height": 175.0, "weight": 70.0,
        "gender": "Male", "activity": "Little/no exercise",
        "number_of_meals": 3, "weight_loss": "Maintain weight",
    }
    response = client.post("/generate-meal-plan/", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "bmi" in data
    assert "meals" in data
    assert len(data["meals"]) == 3
    first_recipe = data["meals"][0]["recipes"][0]
    assert "image_url" in first_recipe
    assert first_recipe["image_url"] == FAKE_IMAGE_URL


def test_predict_invalid_input_shape(client):
    payload = {
        "nutrition_input": [200.0, 5.0],  # only 2 values instead of 9
        "ingredients": [],
        "params": {"n_neighbors": 3, "return_distance": False},
    }
    response = client.post("/predict/", json=payload)
    assert response.status_code == 422


def test_recipe_search_has_pagination_and_provenance(client):
    response = client.get("/recipes", params={"dietary_preference": "omnivore", "page": 1, "page_size": 2})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 10
    assert len(data["items"]) == 2
    assert "Food.com" in data["nutrition_basis"]
    assert data["items"][0]["ingredients_quantities_available"] is False


def test_recipe_search_defaults_to_no_diet_filter(client):
    response = client.get("/recipes", params={"page_size": 1})
    assert response.status_code == 200
    assert response.json()["total"] == 10


def test_recipe_search_applies_ingredient_and_nutrition_filters(client):
    response = client.get("/recipes", params={
        "dietary_preference": "omnivore", "min_calories": 250,
        "include_ingredients": "chicken", "exclude_ingredients": "salt",
    })
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_meal_plate_calculation_uses_dataset_and_serving_multiplier(client):
    response = client.post("/api/meal-plate/calculate", json={"items": [
        {"recipe_id": 1, "servings": 1}, {"recipe_id": 2, "servings": 0.5},
    ]})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 2
    assert data["totals"]["Calories"] == 320
    assert data["totals"]["ProteinContent"] == 24.5
    assert "local prices" in data["limitations"][1]


def test_meal_plate_calculation_rejects_unknown_recipe_and_invalid_serving(client):
    assert client.post("/api/meal-plate/calculate", json={"items": [{"recipe_id": 999, "servings": 1}]}).status_code == 404
    assert client.post("/api/meal-plate/calculate", json={"items": [{"recipe_id": 1, "servings": 0}]}).status_code == 422


def test_nutrition_calculation_and_gym_plan_api(client):
    payload = {
        "age": 30, "height": 175, "weight": 70, "sex_coefficient": "male",
        "activity": "Little/no exercise", "training_days": 4,
        "training_experience": "beginner", "goal": "maintenance",
        "dietary_preference": "omnivore", "allergies": [], "disliked_foods": [],
        "meals_per_day": 3, "workout_time": "evening",
        "professional_support_needed": False,
    }
    calculated = client.post("/nutrition/calculate", json=payload)
    assert calculated.status_code == 200
    assert calculated.json()["protein_g_range"] == [98, 140]
    plan = client.post("/gym-diet-plan", json=payload)
    assert plan.status_code == 200
    assert plan.json()["available"] is True
    assert len(plan.json()["meals"]) == 3
    assert plan.json()["pre_workout"]["recipes"]


def test_gym_plan_does_not_calculate_targets_for_minors(client):
    payload = {
        "age": 17, "height": 165, "weight": 55, "sex_coefficient": "range",
        "activity": "Light exercise", "training_days": 3,
        "training_experience": "beginner", "goal": "fat_loss",
        "dietary_preference": "vegetarian", "meals_per_day": 3,
    }
    response = client.post("/gym-diet-plan", json=payload)
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["targets"] is None


def test_gym_plan_validates_activity(client):
    payload = {
        "age": 30, "height": 175, "weight": 70, "sex_coefficient": "range",
        "activity": "Never exercise", "training_days": 4,
        "training_experience": "beginner", "goal": "maintenance",
        "dietary_preference": "vegetarian", "meals_per_day": 3,
    }
    assert client.post("/gym-diet-plan", json=payload).status_code == 422
