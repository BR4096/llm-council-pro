"""Kimi (Moonshot AI) provider implementation."""

import httpx
import logging
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

logger = logging.getLogger(__name__)


class KimiProvider(LLMProvider):
    """Kimi (Moonshot AI) API provider."""

    BASE_URL = "https://api.kimi.com/coding/v1"

    def _get_api_key(self) -> str:
        """Get Kimi API key from settings."""
        settings = get_settings()
        return settings.kimi_api_key or ""

    async def query(self, model_id: str, messages: List[Dict[str, str]],
                   timeout: float = 120.0, temperature: float = 0.7, **kwargs) -> Dict[str, Any]:
        """
        Send a query to the Kimi API.

        NOTE: "streaming" in LLM Council context means the provider returns content.
        The query() method uses response.text pattern (same as custom_openai.py, deepseek.py).
        Frontend handles SSE streaming to users; providers just return complete content.

        Kimi is a straightforward OpenAI-compatible API with no special handling required.
        """
        api_key = self._get_api_key()
        if not api_key:
            return {"error": True, "error_message": "Kimi API key not configured"}

        # Strip kimi: prefix
        model = model_id.removeprefix("kimi:")

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
                    error_detail = response.text[:200]  # Truncate long error responses
                    return {
                        "error": True,
                        "error_message": f"Kimi API error: {response.status_code} - {error_detail}"
                    }

                data = response.json()
                content = data["choices"][0]["message"]["content"]
                return {"content": content, "error": False}

        except httpx.TimeoutException:
            return {"error": True, "error_message": "Kimi API request timed out"}
        except httpx.ConnectError:
            return {"error": True, "error_message": "Failed to connect to Kimi API"}
        except (KeyError, IndexError) as e:
            return {"error": True, "error_message": f"Invalid Kimi API response format: {str(e)}"}
        except Exception as e:
            return {"error": True, "error_message": f"Kimi API error: {str(e)}"}

    async def get_models(self) -> List[Dict[str, Any]]:
        """
        Fetch available models from Kimi API.

        Returns empty list on any error (silent failure pattern).
        Filters out non-chat models (embeddings, audio, etc.).
        """
        api_key = self._get_api_key()
        if not api_key:
            return []

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}/models",
                    headers={"Authorization": f"Bearer {api_key}"}
                )

                if response.status_code != 200:
                    return []

                data = response.json()
                models = []

                for model in data.get("data", []):
                    model_id = model.get("id", "")
                    if not model_id:
                        continue

                    # Filter out non-chat models
                    mid = model_id.lower()
                    if any(x in mid for x in ["embed", "whisper", "tts", "audio"]):
                        continue

                    models.append({
                        "id": f"kimi:{model_id}",
                        "name": f"{model_id} [Kimi]",
                        "provider": "Kimi"
                    })

                return sorted(models, key=lambda x: x["name"])

        except Exception:
            return []

    async def validate_key(self, api_key: str) -> Dict[str, Any]:
        """
        Validate Kimi API key.

        Uses /models endpoint as lightweight validation.
        Distinguishes between authentication failures and network issues.
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}/models",
                    headers={"Authorization": f"Bearer {api_key}"}
                )

                if response.status_code == 200:
                    data = response.json()
                    model_count = len(data.get("data", []))
                    return {
                        "success": True,
                        "message": f"API key is valid. Found {model_count} Kimi models."
                    }
                elif response.status_code == 401:
                    return {"success": False, "message": "Invalid Kimi API key"}
                elif response.status_code == 403:
                    return {"success": False, "message": "Kimi API key lacks permissions"}
                else:
                    return {"success": False, "message": f"Kimi API error: {response.status_code}"}

        except httpx.ConnectError:
            return {"success": False, "message": "Failed to connect to Kimi API. Check network."}
        except httpx.TimeoutException:
            return {"success": False, "message": "Kimi API request timed out"}
        except Exception as e:
            return {"success": False, "message": str(e)}
