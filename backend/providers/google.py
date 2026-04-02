"""Google Gemini provider implementation."""

import asyncio
import logging
import httpx
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1.0
RETRYABLE_STATUS_CODES = (429, 503)

class GoogleProvider(LLMProvider):
    """Google Gemini API provider."""
    
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
    
    def _get_api_key(self) -> str:
        settings = get_settings()
        return settings.google_api_key or ""

    async def query(self, model_id: str, messages: List[Dict[str, str]], timeout: float = 120.0, temperature: float = 0.7, **kwargs) -> Dict[str, Any]:
        api_key = self._get_api_key()
        if not api_key:
            return {"error": True, "error_message": "Google API key not configured"}
            
        model = model_id.removeprefix("google:")
        
        # Convert messages to Gemini format
        contents = []
        system_instruction = None
        
        for msg in messages:
            if msg["role"] == "system":
                system_instruction = {"parts": [{"text": msg["content"]}]}
            elif msg["role"] == "user":
                contents.append({"role": "user", "parts": [{"text": msg["content"]}]})
            elif msg["role"] == "assistant":
                contents.append({"role": "model", "parts": [{"text": msg["content"]}]})
        
        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature
            }
        }
        if system_instruction:
            payload["system_instruction"] = system_instruction

        for attempt in range(MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        f"{self.BASE_URL}/{model}:generateContent",
                        params={"key": api_key},
                        headers={"Content-Type": "application/json"},
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
                            "error_message": f"Google API error: {response.status_code} - {response.text}",
                            "token_usage": None
                        }

                    data = response.json()

                    # Extract token usage from usageMetadata
                    token_usage = None
                    usage_meta = data.get("usageMetadata")
                    if usage_meta:
                        token_usage = {
                            "input": usage_meta.get("promptTokenCount"),
                            "output": usage_meta.get("candidatesTokenCount")
                        }

                    try:
                        content = data["candidates"][0]["content"]["parts"][0]["text"]
                        return {"content": content, "error": False, "token_usage": token_usage}
                    except (KeyError, IndexError):
                        return {"error": True, "error_message": "Unexpected response format from Google API", "token_usage": None}

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
                    self.BASE_URL,
                    params={"key": api_key, "pageSize": 100}
                )
                
                if response.status_code != 200:
                    return []
                    
                data = response.json()
                models = []
                
                for model in data.get("models", []):
                    # Filter for models that support content generation
                    if "generateContent" in model.get("supportedGenerationMethods", []):
                        # Clean up ID (remove models/ prefix)
                        model_id = model["name"].removeprefix("models/")
                        
                        # Extra safety check for embeddings/vision-only if they sneak in
                        if "embed" in model_id.lower() or "vision" in model_id.lower():
                            continue
                            
                        models.append({
                            "id": f"google:{model_id}",
                            "name": f"{model.get('displayName', model_id)} [Google]",
                            "provider": "Google"
                        })
                
                return sorted(models, key=lambda x: x["name"])
                
        except Exception:
            return []

    async def validate_key(self, api_key: str) -> Dict[str, Any]:
        try:
            # Test by listing models (more robust than generating content with a specific model)
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    self.BASE_URL,
                    params={"key": api_key, "pageSize": 1}
                )
                
                if response.status_code == 200:
                    return {"success": True, "message": "API key is valid"}
                else:
                    try:
                        error_data = response.json()
                        if "error" in error_data:
                            message = error_data['error'].get('message', 'Unknown error')
                            return {"success": False, "message": f"Error {response.status_code}: {message}"}
                        else:
                            return {"success": False, "message": f"Error {response.status_code}: {str(error_data)[:200]}"}
                    except:
                        return {"success": False, "message": f"Error {response.status_code}: {response.text[:200]}"}
        except Exception as e:
            return {"success": False, "message": str(e)}
