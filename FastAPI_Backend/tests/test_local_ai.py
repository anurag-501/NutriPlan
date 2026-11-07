import asyncio
import json

import httpx
import pytest

from local_ai import LocalAIError, OllamaClient, validate_base_url


def test_ollama_list_models_uses_local_tags_endpoint():
    async def run():
        async def handler(request):
            assert request.url.path == "/api/tags"
            return httpx.Response(200, json={"models": [{"name": "qwen3:4b"}]})

        client = OllamaClient("http://127.0.0.1:11434")
        await client._client.aclose()
        client._client = httpx.AsyncClient(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
        try:
            return await client.list_models()
        finally:
            await client.close()

    assert asyncio.run(run()) == [{"name": "qwen3:4b"}]


def test_ollama_chat_disables_streaming_and_caps_output_tokens():
    async def run():
        async def handler(request):
            body = json.loads(request.content)
            assert request.url.path == "/api/chat"
            assert body["stream"] is False
            assert body["think"] is False
            assert body["options"]["num_predict"] == 512
            assert body["options"]["num_ctx"] == 8192
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "Hello"}})

        client = OllamaClient("http://127.0.0.1:11434")
        await client._client.aclose()
        client._client = httpx.AsyncClient(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
        try:
            return await client.chat(
                model="qwen3:4b", messages=[{"role": "user", "content": "Hi"}],
                tools=[], max_output_tokens=512, context_length=8192,
            )
        finally:
            await client.close()

    assert asyncio.run(run())["content"] == "Hello"


def test_ollama_missing_model_gets_actionable_error():
    async def run():
        async def handler(request):
            return httpx.Response(404, json={"error": "model 'qwen3:4b' not found"})

        client = OllamaClient("http://127.0.0.1:11434")
        await client._client.aclose()
        client._client = httpx.AsyncClient(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
        try:
            with pytest.raises(LocalAIError) as error:
                await client.chat(model="qwen3:4b", messages=[], tools=[], max_output_tokens=256)
            assert error.value.category == "model_unavailable"
            assert "ollama pull qwen3:4b" in error.value.public_message
        finally:
            await client.close()

    asyncio.run(run())


def test_ollama_base_url_rejects_credentials_and_non_http_scheme():
    with pytest.raises(ValueError):
        validate_base_url("http://user:secret@127.0.0.1:11434")
    with pytest.raises(ValueError):
        validate_base_url("file:///etc/passwd")
