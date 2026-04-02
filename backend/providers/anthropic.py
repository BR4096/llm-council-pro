"""Anthropic provider implementation."""

import asyncio
import logging
import httpx
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1.0
RETRYABLE_STATUS_CODES = (429, 529)

class AnthropicProvider(LLMProvider):
    """Anthropic API provider."""
    
    BASE_URL = "https://api.anthropic.com/v1"
    
    def _get_api_key(self) -> str:
        settings = get_settings()
        return settings.anthropic_api_key or ""

    async def query(self, model_id: str, messages: List[Dict[str, str]], timeout: float = 120.0, temperature: float = 0.7, **kwargs) -> Dict[str, Any]:
        api_key = self._get_api_key()
        if not api_key:
            return {"error": True, "error_message": "Anthropic API key not configured"}
            
        model = model_id.removeprefix("anthropic:")
        
        # Convert messages to Anthropic format (system message is separate)
        system_message = ""
        filtered_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                filtered_messages.append(msg)
        
        payload = {
            "model": model,
            "messages": filtered_messages,
            "max_tokens": 4096,
            "temperature": temperature
        }
        if system_message:
            payload["system"] = system_message

        for attempt in range(MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        f"{self.BASE_URL}/messages",
                        headers={
                            "x-api-key": api_key,
                            "anthropic-version": "2023-06-01",
                            "content-type": "application/json"
                        },
                        json=payload
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
                            "error_message": f"Anthropic API error: {response.status_code} - {response.text}",
                            "token_usage": None
                        }

                    data = response.json()
                    content = data["content"][0]["text"]

                    # Extract token usage
                    token_usage = None
                    usage = data.get("usage")
                    if usage:
                        token_usage = {
                            "input": usage.get("input_tokens"),
                            "output": usage.get("output_tokens")
                        }

                    return {"content": content, "error": False, "token_usage": token_usage}

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
        api_key = self._get_api_key()
        if not api_key:
            return []
            
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}/models",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    }
                )
                
                if response.status_code != 200:
                    # Fallback to hardcoded list if API fails (e.g. older keys or API not enabled)
                    return [
                        {"id": "anthropic:claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet", "provider": "Anthropic"},
                        {"id": "anthropic:claude-3-opus-20240229", "name": "Claude 3 Opus", "provider": "Anthropic"},
                        {"id": "anthropic:claude-3-sonnet-20240229", "name": "Claude 3 Sonnet", "provider": "Anthropic"},
                        {"id": "anthropic:claude-3-haiku-20240307", "name": "Claude 3 Haiku", "provider": "Anthropic"},
                    ]
                    
                data = response.json()
                models = []
                
                for model in data.get("data", []):
                    if model.get("type") == "model":
                        models.append({
                            "id": f"anthropic:{model['id']}",
                            "name": f"{model.get('display_name', model['id'])} [Anthropic]",
                            "provider": "Anthropic"
                        })
                
                return sorted(models, key=lambda x: x["name"])
                
        except Exception:
            return []

    async def validate_key(self, api_key: str) -> Dict[str, Any]:
        try:
            # Test with a cheap call
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.BASE_URL}/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": "claude-3-haiku-20240307",
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
