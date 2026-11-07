from __future__ import annotations

import main
from chat_api import get_chat_service


def _new_project_key(client, monkeypatch, project_id="study-mate"):
    monkeypatch.setenv("API_ADMIN_TOKEN", "test-admin-token")
    response = client.post(
        "/api/v1/projects",
        headers={"X-Admin-Token": "test-admin-token"},
        json={
            "project_id": project_id,
            "name": "StudyMate",
            "description": "A second reusable app",
            "system_prompt": "Explain study topics clearly.",
            "enabled_modules": ["chat", "nutrition", "recipes"],
            "rate_limit_per_minute": 10,
        },
    )
    assert response.status_code == 201, response.text
    key_response = client.post(
        f"/api/v1/projects/{project_id}/clients",
        headers={"X-Admin-Token": "test-admin-token"},
        json={"name": "test client"},
    )
    assert key_response.status_code == 201, key_response.text
    return key_response.json()["api_key"]


def test_api_v1_health_reports_dataset_and_database(client):
    live = client.get("/api/v1/health/live")
    ready = client.get("/api/v1/health/ready")
    assert live.status_code == 200
    assert live.json()["api_version"] == "v1"
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["dataset_rows"] == 10
    assert ready.json()["database"] == "ready"


def test_api_v1_authenticates_project_keys_and_uses_real_recipe_data(client, monkeypatch):
    api_key = _new_project_key(client, monkeypatch)
    authorization = {"Authorization": f"Bearer {api_key}"}

    project = client.get("/api/v1/projects/me", headers=authorization)
    assert project.status_code == 200
    assert project.json()["project_id"] == "study-mate"

    recipes = client.get("/api/v1/recipes?q=Recipe%201", headers=authorization)
    assert recipes.status_code == 200
    assert recipes.json()["items"][0]["recipe_id"] == 1

    usage = client.get("/api/v1/projects/me/usage", headers=authorization)
    assert usage.status_code == 200
    assert usage.json()["total_requests"] == 1

    assert client.get("/api/v1/projects/me").status_code == 401
    assert client.get("/api/v1/projects/me", headers={"Authorization": "Bearer npk_invalid-key"}).status_code == 401


def test_api_v1_opt_in_history_is_private_and_deletable(client, monkeypatch):
    api_key = _new_project_key(client, monkeypatch)

    class LocalReply:
        async def reply(self, payload, dataframe, **kwargs):
            assert kwargs["project_id"] == "study-mate"
            assert kwargs["project_name"] == "StudyMate"
            return {"message": "Study response", "recipes": [], "notes": [], "diet_plan": None}

    monkeypatch.setitem(main.app.dependency_overrides, get_chat_service, lambda: LocalReply())
    response = client.post(
        "/api/v1/chat",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"messages": [{"role": "user", "content": "Explain photosynthesis"}], "persist_history": True},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["message"] == "Study response"
    assert body["persisted"] is True
    conversation_id = body["conversation_id"]

    history = client.get(f"/api/v1/chat/history/{conversation_id}", headers={"Authorization": f"Bearer {api_key}"})
    assert history.status_code == 200
    assert [turn["role"] for turn in history.json()["messages"]] == ["user", "assistant"]

    other_key = _new_project_key(client, monkeypatch, project_id="career-mate")
    hidden = client.get(f"/api/v1/chat/history/{conversation_id}", headers={"Authorization": f"Bearer {other_key}"})
    assert hidden.status_code == 404

    deleted = client.delete(f"/api/v1/chat/history/{conversation_id}", headers={"Authorization": f"Bearer {api_key}"})
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/chat/history/{conversation_id}", headers={"Authorization": f"Bearer {api_key}"}).status_code == 404


def test_api_v1_nutrition_uses_existing_minor_safeguard(client, monkeypatch):
    api_key = _new_project_key(client, monkeypatch)
    response = client.post(
        "/api/v1/nutrition/calculate",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "age": 17, "height": 170, "weight": 65, "sex_coefficient": "range",
            "activity": "Moderate exercise (3-5 days/wk)", "training_days": 3,
            "goal": "fat_loss", "dietary_preference": "vegetarian",
        },
    )
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert "under 18" in response.json()["guidance"]
