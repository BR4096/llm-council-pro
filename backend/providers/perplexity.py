"""Perplexity provider implementation."""

import httpx
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

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

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self.BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": temperature
                    }
                )

                if response.status_code != 200:
                    return {
                        "error": True,
                        "error_message": f"Perplexity API error: {response.status_code} - {response.text}"
                    }

                data = response.json()
                content = data["choices"][0]["message"]["content"]

                # Extract citations from Perplexity response
                citations = data.get("citations", [])

                # Transform citations to user decision format
                formatted_citations = [{"url": url, "title": url} for url in citations]

                return {
                    "content": content,
                    "citations": formatted_citations,
                    "error": False
                }

        except Exception as e:
            return {"error": True, "error_message": str(e)}

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
