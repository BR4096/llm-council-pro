"""Perplexity provider implementation."""

import asyncio
import logging
import httpx
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1.0
RETRYABLE_STATUS_CODES = (429,)

class PerplexityProvider(LLMProvider):
    """Perplexity API provider with citation extraction."""

    BASE_URL = "https://api.perplexity.ai"

    def _get_api_key(self) -> str:
        settings = get_settings()
        return settings.perplexity_api_key or ""

    async def query(self, model_id: str, messages: List[Dict[str, str]], timeout: float = 120.0, temperature: float = 0.7, **kwargs) -> Dict[str, Any]:
        api_key = self._get_api_key()
        if not api_key:
            return {"error": True, "error_message": "Perplexity API key not configured"}

        # Strip prefix if present
        model = model_id.removeprefix("perplexity:")

        request_json = {
            "model": model,
            "messages": messages,
            "temperature": temperature
        }

        for attempt in range(MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        f"{self.BASE_URL}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json"
                        },
                        json=request_json
                    )

                    if response.status_code in RETRYABLE_STATUS_CODES:
                        if attempt < MAX_RETRIES:
                            delay = INITIAL_RETRY_DELAY * (2 ** attempt)
                            logger.warning(f"Rate limited on {model_id}, retry in {delay}s ({attempt+1}/{MAX_RETRIES})")
                            await asyncio.sleep(delay)
                            continue
                        return {"error": True, "error_message": f"Rate limited after {MAX_RETRIES} retries", "token_usage": None}

                    if response.status_code != 200:
                        return {
                            "error": True,
                            "error_message": f"Perplexity API error: {response.status_code} - {response.text}",
                            "token_usage": None
                        }

                    data = response.json()
                    content = data["choices"][0]["message"]["content"]

                    # Extract citations from Perplexity response
                    citations = data.get("citations", [])
                    formatted_citations = [{"url": url, "title": url} for url in citations]

                    # Extract token usage (OpenAI-compatible format)
                    token_usage = None
                    usage = data.get("usage")
                    if usage:
                        token_usage = {
                            "input": usage.get("prompt_tokens"),
                            "output": usage.get("completion_tokens")
                        }

                    return {
                        "content": content,
                        "citations": formatted_citations,
                        "error": False,
                        "token_usage": token_usage
                    }

            except httpx.ReadTimeout:
                if attempt < MAX_RETRIES:
                    delay = INITIAL_RETRY_DELAY * (2 ** attempt)
                    logger.warning(f"Timeout on {model_id}, retry in {delay}s ({attempt+1}/{MAX_RETRIES})")
                    await asyncio.sleep(delay)
                    continue
                return {"error": True, "error_message": "Request timed out after retries", "token_usage": None}
            except Exception as e:
                return {"error": True, "error_message": str(e), "token_usage": None}

        return {"error": True, "error_message": "Unexpected retry loop exit", "token_usage": None}

    async def get_models(self) -> List[Dict[str, Any]]:
        """Fetch available models from Perplexity with hardcoded fallback.

        Perplexity does not provide a /models endpoint, so we return a hardcoded list.
        Source: https://docs.perplexity.ai/guides/model-cards
        Verified: 2026-02-06
        """
        api_key = self._get_api_key()
        if not api_key:
            return []

        # Hardcoded list of Perplexity Sonar family models
        return [
            {"id": "perplexity:sonar", "name": "Sonar [Perplexity]", "provider": "Perplexity"},
            {"id": "perplexity:sonar-pro", "name": "Sonar Pro [Perplexity]", "provider": "Perplexity"},
            {"id": "perplexity:sonar-reasoning", "name": "Sonar Reasoning [Perplexity]", "provider": "Perplexity"},
            {"id": "perplexity:sonar-reasoning-pro", "name": "Sonar Reasoning Pro [Perplexity]", "provider": "Perplexity"},
            {"id": "perplexity:sonar-deep-research", "name": "Sonar Deep Research [Perplexity]", "provider": "Perplexity"},
        ]

    async def validate_key(self, api_key: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "sonar",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 1
                    }
                )

                if response.status_code == 200:
                    return {"success": True, "message": "API key is valid"}
                else:
                    return {"success": False, "message": "Invalid API key"}
        except Exception as e:
            return {"success": False, "message": str(e)}
