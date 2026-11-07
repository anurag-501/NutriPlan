"""Small async client for the self-hosted Ollama HTTP API.

This module does not send requests to a third-party AI service. Ollama is
expected to run on a trusted local/private network address configured by the
operator.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import httpx


class LocalAIError(Exception):
    def __init__(self, category: str, public_message: str, status_code: int = 503):
        super().__init__(category)
        self.category = category
        self.public_message = public_message
        self.status_code = status_code


def validate_base_url(value: str) -> str:
    """Accept an operator-configured HTTP(S) Ollama origin without credentials."""
    candidate = value.strip().rstrip("/")
    try:
        parsed = urlsplit(candidate)
        valid = (
            parsed.scheme in {"http", "https"}
            and bool(parsed.hostname)
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("OLLAMA_BASE_URL must be a valid HTTP(S) URL without credentials")
    return candidate


class OllamaClient:
    def __init__(self, base_url: str, timeout_seconds: float = 600):
        self.base_url = validate_base_url(base_url)
        self.timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 5.0)),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def list_models(self) -> list[dict[str, Any]]:
        try:
            response = await self._client.get("/api/tags")
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException as exc:
            raise LocalAIError("timeout", "The local AI service did not respond in time.", 504) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise LocalAIError(
                "connection_error",
                "Cannot reach local Ollama. Start Ollama and check OLLAMA_BASE_URL.",
            ) from exc
        models = payload.get("models", []) if isinstance(payload, dict) else []
        return [model for model in models if isinstance(model, dict) and isinstance(model.get("name"), str)]

    async def chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_output_tokens: int,
        context_length: int = 8192,
        think: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "think": think,
            "options": {"num_predict": max_output_tokens, "num_ctx": context_length},
        }
        if tools:
            body["tools"] = tools
        try:
            response = await self._client.post("/api/chat", json=body)
            if response.status_code == 404:
                raise LocalAIError(
                    "model_unavailable",
                    f"Local model '{model}' is not installed. Run `ollama pull {model}`, then retry.",
                    503,
                )
            response.raise_for_status()
            payload = response.json()
        except LocalAIError:
            raise
        except httpx.TimeoutException as exc:
            raise LocalAIError("timeout", "The local model took too long to respond. Please retry.", 504) from exc
        except httpx.HTTPStatusError as exc:
            # Ollama reports an unknown model as a 400 on some versions.
            error_text = ""
            try:
                error_text = str(exc.response.json().get("error", "")).casefold()
            except (ValueError, AttributeError):
                pass
            if "model" in error_text and any(term in error_text for term in ("not found", "does not exist")):
                raise LocalAIError(
                    "model_unavailable",
                    f"Local model '{model}' is not installed. Run `ollama pull {model}`, then retry.",
                    503,
                ) from exc
            raise LocalAIError("provider_error", "The local AI service rejected the request.", 502) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise LocalAIError("connection_error", "Cannot reach local Ollama. Start Ollama and retry.") from exc

        message = payload.get("message") if isinstance(payload, dict) else None
        if not isinstance(message, dict):
            raise LocalAIError("provider_error", "Ollama returned an invalid response. Please retry.", 502)
        return message
