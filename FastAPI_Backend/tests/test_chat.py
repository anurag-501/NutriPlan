import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import chat_service as chat_service_module
import main
from chat_api import (
    ChatProfile,
    ChatRateLimiter,
    ChatRequest,
    ChatTurn,
    get_chat_service,
)
from chat_service import (
    TOOL_DEFINITIONS,
    ChatService,
    ChatServiceError,
    NutritionToolArgs,
    PlanToolArgs,
)


class FakeResponses:
    def __init__(self, outputs=None, error=None):
        self.outputs = list(outputs or [])
        self.error = error
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.outputs.pop(0)


class FakeOpenAIClient:
    def __init__(self, outputs=None, error=None):
        self.responses = FakeResponses(outputs, error)

    async def close(self):
        return None


def response(text="", output=None):
    return SimpleNamespace(output_text=text, output=output or [])


def config(api_key="test-key"):
    return SimpleNamespace(api_key=api_key, model="test-model", timeout_seconds=2, max_retries=0)


def valid_search_arguments(**changes):
    values = {
        "query": "Recipe 1",
        "dietary_preference": "omnivore",
        "meal_category": "all",
        "target_calories": None,
        "calorie_tolerance": None,
        "min_protein": None,
        "max_minutes": None,
        "include_ingredients": [],
        "exclude_ingredients": [],
        "budget_preference": None,
    }
    return values | changes


def test_chat_validates_message_bounds_and_latest_user_role():
    with pytest.raises(ValidationError):
        ChatRequest(messages=[])
    with pytest.raises(ValidationError):
        ChatRequest(messages=[ChatTurn(role="assistant", content="Need more info")])
    with pytest.raises(ValidationError):
        ChatRequest(messages=[ChatTurn(role="user", content=" ")])


def test_chat_provider_not_configured_has_clear_error(mock_dataset):
    service = ChatService(config=config(api_key=""))
    payload = ChatRequest(messages=[ChatTurn(role="user", content="Suggest dinner")])
    with pytest.raises(ChatServiceError) as error:
        asyncio.run(service.reply(payload, mock_dataset))
    assert error.value.status_code == 503
    assert "OPENAI_API_KEY" in error.value.public_message
    assert service.availability == "missing_configuration"


def test_mocked_ai_function_call_searches_real_recipe_data(mock_dataset):
    search_call = SimpleNamespace(
        type="function_call",
        name="search_recipes",
        call_id="call_search_1",
        arguments=json.dumps(valid_search_arguments()),
    )
    client = FakeOpenAIClient([response(output=[search_call]), response("I found a dataset recipe.")])
    service = ChatService(config=config(), client=client)
    payload = ChatRequest(messages=[ChatTurn(role="user", content="Find recipe 1")])

    result = asyncio.run(service.reply(payload, mock_dataset))

    assert result["message"] == "I found a dataset recipe."
    assert result["recipes"][0]["recipe_id"] == 1
    assert result["recipes"][0]["Name"] == "Recipe 1"
    assert result["recipes"][0]["ingredients_quantities_available"] is False
    assert client.responses.calls[0]["model"] == "test-model"
    assert client.responses.calls[0]["max_output_tokens"] == 1400
    assert all(tool["strict"] for tool in client.responses.calls[0]["tools"])
    assert client.responses.calls[1]["input"][-1]["type"] == "function_call_output"


def test_recipe_detail_tool_uses_dataset_and_checks_diet_exclusions(mock_dataset):
    service = ChatService(config=config(), client=FakeOpenAIClient())
    detail_call = SimpleNamespace(
        type="function_call", name="get_recipe_details", call_id="call_detail_1",
        arguments=json.dumps({"recipe_id": 1}),
    )
    result, cards, notes, plan = service._dispatch_tool(
        detail_call.name, detail_call.arguments, ChatProfile(dietary_preference="omnivore"), mock_dataset
    )
    assert result["recipe"]["name"] == "Recipe 1"
    assert cards[1]["RecipeIngredientParts"]
    assert notes and plan is None

    excluded, cards, _, _ = service._dispatch_tool(
        detail_call.name, detail_call.arguments, ChatProfile(dietary_preference="vegetarian"), mock_dataset
    )
    assert "does not match" in excluded["error"]
    assert cards == {}


def test_chat_meal_comparison_uses_foodswap_dataset_tool_and_never_claims_prices(mock_dataset):
    service = ChatService(config=config(), client=FakeOpenAIClient())
    args = {
        "current_meal": [{"recipe_id": 1, "servings": 1}],
        "dietary_preference": "omnivore", "exclusions": [], "available_ingredients": ["salt"],
        "priority": "lower_cost", "minimum_protein_g": None, "maximum_calories": None,
        "maximum_minutes": None, "result_limit": 3,
    }
    result, cards, notes, plan = service._dispatch_tool(
        "compare_meals", json.dumps(args), ChatProfile(dietary_preference="omnivore"), mock_dataset
    )
    assert result["current_meal"][0]["recipe_id"] == 1
    assert result["alternatives"]
    assert result["prices"] == "not provided; cost was not ranked"
    assert cards and set(cards) == {item["recipe_id"] for item in result["alternatives"]}
    assert any("enter prices you personally checked" in note for note in notes)
    assert plan is None
    tool = next(item for item in TOOL_DEFINITIONS if item.get("name") == "compare_meals")
    assert tool["strict"] is True
    assert tool["parameters"]["additionalProperties"] is False


def test_chat_recipe_search_applies_vegetarian_and_allergy_exclusions(mock_dataset):
    service = ChatService(config=config(), client=FakeOpenAIClient())
    profile = ChatProfile(dietary_preference="vegetarian", allergies=["chicken"])
    result, cards, notes = service._search_recipes(valid_search_arguments(query=None), profile, mock_dataset)
    assert result["total_matches"] == 0
    assert cards == {}
    assert "allergy-safe" in notes[0]


def test_calorie_tool_uses_explicit_profile_and_handles_minors(mock_dataset):
    service = ChatService(config=config(), client=FakeOpenAIClient())
    adult_args = NutritionToolArgs(
        age=30, height=175, weight=70, sex_coefficient="male",
        activity="Moderate exercise (3-5 days/wk)", training_days=4,
        goal="maintenance",
    )
    adult = service._calculate_nutrition(ChatProfile(), adult_args)
    minor = service._calculate_nutrition(ChatProfile(), NutritionToolArgs(age=16))
    missing = service._calculate_nutrition(ChatProfile(), NutritionToolArgs(age=30))
    assert adult["available"] is True
    assert adult["target_calories"]
    assert minor["available"] is False
    assert "target_calories" not in minor
    assert set(missing["missing_inputs"]) == {"height", "weight", "sex_coefficient", "activity", "goal", "training_days"}
    assert ChatProfile(age=12).age == 12


def test_chatbot_generates_a_full_plan_through_existing_engine(mock_dataset):
    plan_call = SimpleNamespace(
        type="function_call",
        name="generate_diet_plan",
        call_id="call_plan_1",
        arguments=json.dumps({
            "age": 30, "height": 175, "weight": 70, "sex_coefficient": "male",
            "activity": "Moderate exercise (3-5 days/wk)", "training_days": 4,
            "goal": "maintenance", "dietary_preference": "omnivore", "allergies": [],
            "disliked_foods": [], "meals_per_day": 3, "cuisine": None,
            "professional_support_needed": False,
        }),
    )
    client = FakeOpenAIClient([response(output=[plan_call]), response("I created a three-meal plan draft.")])
    service = ChatService(config=config(), client=client)
    payload = ChatRequest(messages=[ChatTurn(role="user", content="Build my diet plan")])

    result = asyncio.run(service.reply(payload, mock_dataset))

    assert result["message"] == "I created a three-meal plan draft."
    assert result["diet_plan"]["available"] is True
    assert len(result["diet_plan"]["meals"]) == 3
    assert result["diet_plan"]["meals"][0]["recipes"]
    assert result["recipes"]
    assert "plan_saved" in result["diet_plan"] or result["diet_plan"]["nutrition_source"]


def test_diet_plan_tool_asks_for_missing_inputs_and_withholds_minor_plan(mock_dataset):
    service = ChatService(config=config(), client=FakeOpenAIClient())
    missing, cards, notes, plan = service._generate_diet_plan(PlanToolArgs(), ChatProfile(), mock_dataset)
    assert missing["missing_inputs"] == ["age"]
    assert cards == {} and notes == [] and plan is None

    minor, cards, notes, plan = service._generate_diet_plan(PlanToolArgs(age=16), ChatProfile(), mock_dataset)
    assert minor["available"] is False
    assert "meals" not in minor or minor["meals"] == []
    assert cards == {} and notes and plan is None

    health_support = service._calculate_nutrition(
        ChatProfile(professional_support_needed=True), NutritionToolArgs()
    )
    assert health_support["available"] is False
    assert "consult" in health_support["guidance"].lower()


def test_provider_timeout_and_rate_limit_are_mapped_without_leaking_provider_details(monkeypatch, mock_dataset):
    timed_service = ChatService(config=config(), client=FakeOpenAIClient(error=TimeoutError("private provider detail")))
    payload = ChatRequest(messages=[ChatTurn(role="user", content="Please help")])
    with pytest.raises(ChatServiceError) as timed:
        asyncio.run(timed_service.reply(payload, mock_dataset))
    assert timed.value.status_code == 504
    assert "private provider detail" not in timed.value.public_message
    assert timed_service.availability == "timeout"

    class FakeRateLimit(Exception):
        pass

    monkeypatch.setattr(chat_service_module, "RateLimitError", FakeRateLimit)
    limited = ChatService(config=config(), client=FakeOpenAIClient(error=FakeRateLimit("provider detail")))
    with pytest.raises(ChatServiceError) as rate_error:
        asyncio.run(limited.reply(payload, mock_dataset))
    assert rate_error.value.status_code == 429
    assert limited.availability == "provider_rate_limited"


def test_provider_invalid_key_and_quota_have_distinct_safe_status(monkeypatch, mock_dataset):
    class FakeStatus(Exception):
        def __init__(self, status_code, code):
            super().__init__("do not expose provider details")
            self.status_code = status_code
            self.code = code

    monkeypatch.setattr(chat_service_module, "APIStatusError", FakeStatus)
    payload = ChatRequest(messages=[ChatTurn(role="user", content="Please help")])
    invalid = ChatService(config=config(), client=FakeOpenAIClient(error=FakeStatus(401, "invalid_api_key")))
    with pytest.raises(ChatServiceError) as invalid_error:
        asyncio.run(invalid.reply(payload, mock_dataset))
    assert invalid_error.value.status_code == 502
    assert invalid.availability == "invalid_credentials"
    assert "do not expose" not in invalid_error.value.public_message

    # RateLimitError is normally a subclass of APIStatusError, so quota mapping
    # is exercised through the rate-limit handler as well.
    class FakeRateLimit(FakeStatus):
        pass
    monkeypatch.setattr(chat_service_module, "RateLimitError", FakeRateLimit)
    limited = ChatService(config=config(), client=FakeOpenAIClient(error=FakeRateLimit(429, "insufficient_quota")))
    with pytest.raises(ChatServiceError) as quota_error:
        asyncio.run(limited.reply(payload, mock_dataset))
    assert quota_error.value.status_code == 503
    assert limited.availability == "quota_exceeded"


def test_provider_unexpected_failure_is_sanitized(mock_dataset):
    service = ChatService(config=config(), client=FakeOpenAIClient(error=RuntimeError("secret text from upstream")))
    payload = ChatRequest(messages=[ChatTurn(role="user", content="Please help")])
    with pytest.raises(ChatServiceError) as error:
        asyncio.run(service.reply(payload, mock_dataset))
    assert error.value.status_code == 502
    assert "secret text" not in error.value.public_message


def test_chat_rate_limiter_allows_window_and_blocks_excess():
    limiter = ChatRateLimiter(limit=2, window_seconds=60)
    assert limiter.allow("127.0.0.1", now=100)
    assert limiter.allow("127.0.0.1", now=101)
    assert not limiter.allow("127.0.0.1", now=102)
    assert limiter.allow("127.0.0.1", now=160)


def test_chat_health_and_missing_provider_route(client, monkeypatch):
    service = ChatService(config=config(api_key=""))
    monkeypatch.setitem(main.app.dependency_overrides, get_chat_service, lambda: service)
    health = client.get("/api/chat/health")
    assert health.status_code == 200
    assert health.json()["configured"] is False
    assert health.json()["status"] == "missing_configuration"
    assert health.json()["provider"] == "openai"
    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_chat_route_uses_mocked_service(client, monkeypatch):
    class MockChatService:
        model = "mock-model"
        is_configured = True

        async def reply(self, payload, dataframe):
            return {"message": "Mocked, but through the route.", "recipes": [], "notes": []}

    monkeypatch.setitem(main.app.dependency_overrides, get_chat_service, lambda: MockChatService())
    result = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hi"}]})
    assert result.status_code == 200
    assert result.json()["message"] == "Mocked, but through the route."


def test_chat_route_rejects_invalid_profile(client):
    result = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hi"}], "profile": {"age": 0}})
    assert result.status_code == 422


def test_chat_plan_action_adds_from_dataset_and_recalculates_totals(client):
    result = client.post("/api/chat/plan-action", json={"action": "add", "recipe_id": 1, "dietary_preference": "omnivore"})
    assert result.status_code == 200
    data = result.json()
    assert data["meals"][0]["recipes"][0]["recipe_id"] == 1
    assert data["nutrition_totals"]["calories"] == 210.0
    assert data["nutrition_totals"]["protein_g"] == 16.0


def test_chat_plan_action_rejects_invalid_id_and_allergy_conflict(client):
    assert client.post("/api/chat/plan-action", json={"action": "add", "recipe_id": 999}).status_code == 404
    allergy = client.post("/api/chat/plan-action", json={"action": "add", "recipe_id": 1, "allergies": ["chicken"]})
    assert allergy.status_code == 422


def test_chat_plan_action_replaces_only_a_real_plan_meal(client):
    payload = {
        "action": "replace", "recipe_id": 2, "meal_name": "breakfast", "dietary_preference": "omnivore",
        "current_meals": [{"meal_name": "breakfast", "recommended_calories": 300, "recipe_ids": [1], "selected_recipe_id": 1}],
    }
    result = client.post("/api/chat/plan-action", json=payload)
    assert result.status_code == 200
    assert result.json()["meals"][0]["recipes"][0]["recipe_id"] == 2
    assert result.json()["selected_recipe_ids"]["breakfast"] == 2
    assert result.json()["nutrition_totals"]["calories"] == 220.0


def test_chat_plan_action_rejects_unknown_replace_target(client):
    result = client.post("/api/chat/plan-action", json={"action": "replace", "recipe_id": 2, "meal_name": "lunch"})
    assert result.status_code == 422
