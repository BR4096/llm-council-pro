"""GLM (Zhipu AI) provider implementation."""

import httpx
import json
import logging
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

logger = logging.getLogger(__name__)


class GLMProvider(LLMProvider):
    """GLM (Zhipu AI) API provider with thinking mode support."""

    BASE_URL = "https://api.z.ai/api/coding/paas/v4"

    def _get_api_key(self) -> str:
        """Get GLM API key from settings."""
        settings = get_settings()
        return settings.glm_api_key or ""

    async def query(self, model_id: str, messages: List[Dict[str, str]],
                   timeout: float = 120.0, temperature: float = 0.7, **kwargs) -> Dict[str, Any]:
        """
        Send a query to the GLM API.

        NOTE: "streaming" in LLM Council context means the provider returns content.
        The query() method uses response.text pattern (same as custom_openai.py, deepseek.py).
        Frontend handles SSE streaming to users; providers just return complete content.

        Handles GLM-4.7's streaming JSON parsing issues with chunk buffering.
        Supports optional thinking mode for chain-of-thought reasoning.
        """
        api_key = self._get_api_key()
        if not api_key:
            return {"error": True, "error_message": "GLM API key not configured"}

        # Strip glm: prefix
        model = model_id.removeprefix("glm:")

        # Build request body
        request_body = {
            "model": model,
            "messages": messages,
            "temperature": temperature
        }

        # Add thinking parameter if enabled in settings
        settings = get_settings()
        if hasattr(settings, 'glm_thinking_enabled') and settings.glm_thinking_enabled:
            request_body["thinking"] = {"type": "enabled"}

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self.BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json=request_body
                )

                if response.status_code != 200:
                    error_detail = response.text[:200]  # Truncate long error responses
                    return {
                        "error": True,
                        "error_message": f"GLM API error: {response.status_code} - {error_detail}"
                    }

                # Handle streaming JSON parsing with chunk buffering
                # GLM-4.7 has known issues with JSON boundaries
                content = self._parse_streaming_response(response.text)
                if content is None:
                    return {"error": True, "error_message": "Failed to parse GLM response"}

                return {"content": content, "error": False}

        except httpx.TimeoutException:
            return {"error": True, "error_message": "GLM API request timed out"}
        except httpx.ConnectError:
            return {"error": True, "error_message": "Failed to connect to GLM API"}
        except Exception as e:
            return {"error": True, "error_message": f"GLM API error: {str(e)}"}

    def _parse_streaming_response(self, text: str) -> str:
        """
        Parse streaming response with chunk buffering for GLM-4.7 compatibility.

        GLM-4.7 has known JSON parsing issues where chunk boundaries split JSON objects.
        This method attempts direct JSON parse first, then falls back to line-by-line SSE parsing.
        """
        # Try direct JSON parse first (non-streaming response)
        try:
            data = json.loads(text)
            if "choices" in data and len(data["choices"]) > 0:
                return data["choices"][0]["message"]["content"]
        except json.JSONDecodeError:
            pass  # Fall through to streaming parsing

        # Attempt SSE streaming parse with chunk buffering
        lines = text.strip().split('\n')
        content_parts = []

        for line in lines:
            if line.startswith('data: '):
                json_str = line[6:]  # Remove 'data: ' prefix
                if json_str == '[DONE]':
                    continue
                try:
                    chunk = json.loads(json_str)
                    if 'choices' in chunk and len(chunk['choices']) > 0:
                        delta = chunk['choices'][0].get('delta', {})
                        # Use 'content' field, ignore 'reasoning_content' (Phase 3 decision)
                        if 'content' in delta:
                            content_parts.append(delta['content'])
                except json.JSONDecodeError:
                    # Skip malformed chunks - GLM-4.7 streaming issue
                    logger.warning(f"Failed to parse GLM chunk, skipping: {json_str[:50]}...")
                    continue

        result = ''.join(content_parts)
        return result if result else None

    async def get_models(self) -> List[Dict[str, Any]]:
        """
        Fetch available models from GLM API.

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
                    if any(x in mid for x in ["embed", "whisper", "tts", "audio", "vision"]):
                        continue

                    models.append({
                        "id": f"glm:{model_id}",
                        "name": f"{model_id} [GLM]",
                        "provider": "GLM"
                    })

                return sorted(models, key=lambda x: x["name"])

        except Exception:
            return []

    async def validate_key(self, api_key: str) -> Dict[str, Any]:
        """
        Validate GLM API key.

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
                        "message": f"API key is valid. Found {model_count} GLM models."
                    }
                elif response.status_code == 401:
                    return {"success": False, "message": "Invalid GLM API key"}
                elif response.status_code == 403:
                    return {"success": False, "message": "GLM API key lacks permissions"}
                else:
                    return {"success": False, "message": f"GLM API error: {response.status_code}"}

        except httpx.ConnectError:
            return {"success": False, "message": "Failed to connect to GLM API. Check network."}
        except httpx.TimeoutException:
            return {"success": False, "message": "GLM API request timed out"}
        except Exception as e:
            return {"success": False, "message": str(e)}
