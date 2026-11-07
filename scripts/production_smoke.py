"""Non-destructive smoke checks for a deployed NutriPlan FastAPI service.

Set NUTRIPLAN_SMOKE_BASE_URL to the real HTTPS backend URL. Optional:
NUTRIPLAN_SMOKE_API_KEY for authenticated API-platform checks,
NUTRIPLAN_SMOKE_ORIGIN for the deployed frontend CORS preflight, and --include-ai
to send one real, non-personal test prompt to the configured inference provider.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


TIMEOUT_SECONDS = 20
AI_TIMEOUT_SECONDS = 160
PROFILE = {
    "age": 25,
    "height": 170,
    "weight": 68,
    "sex_coefficient": "range",
    "activity": "Moderate exercise (3-5 days/wk)",
    "training_days": 3,
    "training_experience": "beginner",
    "goal": "maintenance",
    "dietary_preference": "vegetarian",
    "allergies": [],
    "disliked_foods": [],
    "meals_per_day": 3,
    "professional_support_needed": False,
}


@dataclass
class Response:
    status: int | None
    elapsed_ms: int
    payload: object | None = None
    error: str | None = None
    headers: dict[str, str] | None = None


def safe_detail(payload: object | None) -> str:
    if isinstance(payload, dict):
        detail = payload.get("detail") or payload.get("message")
        if isinstance(detail, str):
            return detail.replace("\n", " ")[:180]
    return ""


def request_json(base_url: str, method: str, path: str, *, body: object | None = None,
                 headers: dict[str, str] | None = None, timeout_seconds: int = TIMEOUT_SECONDS) -> Response:
    request_headers = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = Request(base_url + path, data=data, headers=request_headers, method=method)
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(2_000_001)
            elapsed = round((time.perf_counter() - started) * 1000)
            response_headers = {key.lower(): value for key, value in response.headers.items()}
            if len(raw) > 2_000_000:
                return Response(response.status, elapsed, error="Response exceeded the 2 MB smoke-test limit", headers=response_headers)
            if not raw:
                return Response(response.status, elapsed, {}, headers=response_headers)
            try:
                return Response(response.status, elapsed, json.loads(raw.decode("utf-8")), headers=response_headers)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return Response(response.status, elapsed, error="Response was not valid JSON", headers=response_headers)
    except HTTPError as exc:
        elapsed = round((time.perf_counter() - started) * 1000)
        try:
            raw = exc.read(16_384)
            payload = json.loads(raw.decode("utf-8"))
            return Response(exc.code, elapsed, payload)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return Response(exc.code, elapsed, error="Server returned a non-JSON error")
    except (TimeoutError, URLError, OSError) as exc:
        elapsed = round((time.perf_counter() - started) * 1000)
        reason = getattr(exc, "reason", exc)
        return Response(None, elapsed, error=str(reason).replace("\n", " ")[:180])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-ai", action="store_true", help="send one real test chat prompt to the configured model")
    args = parser.parse_args()
    configured_url = os.getenv("NUTRIPLAN_SMOKE_BASE_URL", "").strip().rstrip("/")
    if not configured_url:
        parser.error("Set NUTRIPLAN_SMOKE_BASE_URL to the actual deployed FastAPI HTTPS origin")
    parsed = urlparse(configured_url)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("NUTRIPLAN_SMOKE_BASE_URL must be an origin URL without credentials, query, or fragment")
    is_loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_loopback):
        parser.error("Use HTTPS for deployed services; HTTP is allowed only for loopback development")
    if parsed.path not in {"", "/"}:
        parser.error("NUTRIPLAN_SMOKE_BASE_URL must be the backend origin, without a path prefix")
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    results: list[tuple[str, str, int | None, int, str]] = []

    def check(name: str, method: str, path: str, *, body: object | None = None,
              headers: dict[str, str] | None = None, expected: set[int] | None = None,
              validator=None, detail_fn=None, timeout_seconds: int = TIMEOUT_SECONDS) -> Response:
        response = request_json(base_url, method, path, body=body, headers=headers, timeout_seconds=timeout_seconds)
        accepted = expected or {200}
        passed = response.status in accepted and response.error is None
        if passed and validator is not None:
            passed = bool(validator(response.payload))
        detail = response.error or (detail_fn(response.payload) if detail_fn else safe_detail(response.payload))
        results.append((name, "PASS" if passed else "FAIL", response.status, response.elapsed_ms, detail))
        return response

    check("Backend health", "GET", "/health")
    check("API v1 liveness", "GET", "/api/v1/health/live")
    check(
        "Dataset and database readiness", "GET", "/api/v1/health/ready",
        validator=lambda p: isinstance(p, dict) and p.get("status") == "ready" and isinstance(p.get("dataset_rows"), int) and p["dataset_rows"] > 0 and p.get("database") == "ready",
    )
    check("Chat health endpoint", "GET", "/api/chat/health")
    check(
        "AI provider availability", "GET", "/api/v1/ai/status",
        validator=lambda p: isinstance(p, dict) and p.get("status") == "available",
        detail_fn=lambda p: f"provider={p.get('provider')} status={p.get('status')}" if isinstance(p, dict) else "No status returned",
    )
    check("AI model list endpoint", "GET", "/api/v1/ai/models")

    recipe_search = check(
        "Vegetarian recipe search", "GET", "/recipes?dietary_preference=vegetarian&page_size=1",
        validator=lambda p: isinstance(p, dict) and isinstance(p.get("items"), list) and len(p["items"]) > 0,
    )
    recipe_id = None
    if isinstance(recipe_search.payload, dict):
        items = recipe_search.payload.get("items")
        if isinstance(items, list) and items and isinstance(items[0], dict):
            recipe_id = items[0].get("recipe_id") or items[0].get("RecipeId")
    if isinstance(recipe_id, int) and recipe_id > 0:
        check("Recipe details", "GET", f"/recipes/{recipe_id}")
        plate = check(
            "Nutrition totals", "POST", "/api/meal-plate/calculate",
            body={"items": [{"recipe_id": recipe_id, "servings": 1}]},
            validator=lambda p: isinstance(p, dict) and isinstance(p.get("totals"), dict),
        )
        check(
            "FoodSwap comparison", "POST", "/api/foodswap/compare",
            body={"current_meal": [{"recipe_id": recipe_id, "servings": 1}], "dietary_preference": "vegetarian", "priority": "balanced", "result_limit": 3},
            validator=lambda p: isinstance(p, dict) and isinstance(p.get("alternatives"), list),
        )
    else:
        results.append(("Recipe details", "SKIP", None, 0, "Recipe search did not return an ID"))
        results.append(("Nutrition totals", "SKIP", None, 0, "Recipe search did not return an ID"))
        results.append(("FoodSwap comparison", "SKIP", None, 0, "Recipe search did not return an ID"))

    check("Calorie and protein estimate", "POST", "/nutrition/calculate", body=PROFILE)
    check("Diet plan generation", "POST", "/gym-diet-plan", body=PROFILE)

    check(
        "API key protection", "GET", "/api/v1/projects/me",
        headers={"Authorization": "Bearer npk_invalid-production-smoke-check"},
        expected={401},
    )
    api_key = os.getenv("NUTRIPLAN_SMOKE_API_KEY", "").strip()
    if api_key:
        auth = {"Authorization": f"Bearer {api_key}"}
        check("Authenticated API project", "GET", "/api/v1/projects/me", headers=auth)
        check("Authenticated recipe search", "GET", "/api/v1/recipes?dietary_preference=vegetarian&page_size=1", headers=auth)
        check("Authenticated nutrition estimate", "POST", "/api/v1/nutrition/calculate", body=PROFILE, headers=auth)
    else:
        results.append(("Valid project API key", "BLOCKED", None, 0, "Set NUTRIPLAN_SMOKE_API_KEY to test protected platform routes"))

    origin = os.getenv("NUTRIPLAN_SMOKE_ORIGIN", "").strip().rstrip("/")
    if origin:
        preflight = request_json(base_url, "OPTIONS", "/api/chat", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        })
        response_headers = preflight.headers or {}
        allow_origin = response_headers.get("access-control-allow-origin", "").strip()
        allowed_methods = {value.strip().casefold() for value in response_headers.get("access-control-allow-methods", "").split(",")}
        allowed_headers = {value.strip().casefold() for value in response_headers.get("access-control-allow-headers", "").split(",")}
        problems = []
        if allow_origin != origin:
            problems.append(f"Access-Control-Allow-Origin was {allow_origin or 'missing'}")
        if "post" not in allowed_methods:
            problems.append("POST is not allowed")
        if not {"content-type", "authorization"}.issubset(allowed_headers):
            problems.append("Content-Type and Authorization are not both allowed")
        passed = preflight.status in {200, 204} and not problems
        detail = "; ".join(problems)
        results.append(("Frontend CORS preflight", "PASS" if passed else "FAIL", preflight.status, preflight.elapsed_ms, detail))
    else:
        results.append(("Frontend CORS preflight", "BLOCKED", None, 0, "Set NUTRIPLAN_SMOKE_ORIGIN to the actual Vercel HTTPS origin"))

    if args.include_ai:
        check(
            "Real model chat request", "POST", "/api/chat",
            body={"messages": [{"role": "user", "content": "This is a deployment smoke test. Reply briefly with READY; do not use tools."}], "profile": {}},
            validator=lambda p: isinstance(p, dict) and isinstance(p.get("message"), str) and bool(p["message"].strip()),
            detail_fn=lambda p: "Model returned a response" if isinstance(p, dict) and p.get("message") else safe_detail(p),
            timeout_seconds=AI_TIMEOUT_SECONDS,
        )
    else:
        results.append(("Real model chat request", "BLOCKED", None, 0, "Rerun with --include-ai after confirming the provider and test URL"))

    print("METHOD  STATUS  HTTP  TIME(ms)  CHECK / DETAIL")
    method_by_name = {
        "Backend health": "GET", "API v1 liveness": "GET", "Dataset and database readiness": "GET",
        "Chat health endpoint": "GET", "AI provider availability": "GET", "AI model list endpoint": "GET",
        "Vegetarian recipe search": "GET", "Recipe details": "GET", "Nutrition totals": "POST",
        "FoodSwap comparison": "POST", "Calorie and protein estimate": "POST", "Diet plan generation": "POST",
        "API key protection": "GET", "Authenticated API project": "GET", "Authenticated recipe search": "GET",
        "Authenticated nutrition estimate": "POST", "Frontend CORS preflight": "OPTIONS", "Real model chat request": "POST",
    }
    for name, status, code, elapsed, detail in results:
        print(f"{method_by_name.get(name, '-'):7} {status:8} {str(code or '-'):5} {elapsed:8}  {name}" + (f" — {detail}" if detail else ""))
    failures = sum(result[1] == "FAIL" for result in results)
    blocked = sum(result[1] == "BLOCKED" for result in results)
    print(f"\n{len(results)} checks: {len(results) - failures - blocked} passed, {failures} failed, {blocked} blocked.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
