"""Ollama API client for making LLM requests."""

import asyncio
import httpx
from typing import List, Dict, Any, Optional
from .config import get_ollama_base_url

# Retry configuration
MAX_RETRIES = 2
INITIAL_RETRY_DELAY = 1.0  # seconds


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0,
    temperature: float = 0.7,
    num_predict: Optional[int] = None,
    json_format: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via Ollama API.

    Args:
        model: Ollama model identifier (e.g., "llama3")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds
        temperature: Model temperature

    Returns:
        Response dict with 'content' and 'error' if failed
    """
    base_url = get_ollama_base_url()
    # Ensure base_url doesn't end with slash
    if base_url.endswith('/'):
        base_url = base_url[:-1]
        
    api_url = f"{base_url}/api/chat"

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature
        }
    }
    if num_predict is not None:
        payload["options"]["num_predict"] = num_predict
    if json_format:
        payload["format"] = "json"

    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    api_url,
                    json=payload
                )

                response.raise_for_status()
                data = response.json()
                
                message = data.get('message', {})
                content = message.get('content', '')
                reasoning = message.get('thinking', '')

                # Ensure content is always a string
                if isinstance(content, (list, dict)):
                    import json
                    content = json.dumps(content)

                return {
                    'content': content,
                    'reasoning': reasoning,
                    'error': None
                }

        except httpx.HTTPStatusError as e:
            print(f"HTTP error querying Ollama model {model}: {e}")
            last_error = f"http_{e.response.status_code}"
        except httpx.ConnectError:
             print(f"Connection error querying Ollama at {base_url}")
             last_error = "connection_error"
             # Fail fast on connection error (likely Ollama not running)
             break
        except httpx.TimeoutException:
            print(f"Timeout querying Ollama model {model}")
            last_error = "timeout"
        except Exception as e:
            print(f"Error querying Ollama model {model}: {e}")
            last_error = str(e)
            
        # Wait before retry if it wasn't a connection error
        if attempt < MAX_RETRIES - 1 and last_error != "connection_error":
            await asyncio.sleep(INITIAL_RETRY_DELAY * (2 ** attempt))

    error_messages = {
        "connection_error": "Could not connect to Ollama. Is it running?",
        "timeout": "Request timed out",
    }
    return {
        'content': None,
        'error': last_error,
        'error_message': error_messages.get(last_error, f"Error: {last_error}")
    }


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple Ollama models in parallel.

    Args:
        models: List of Ollama model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    # Create tasks for all models
    tasks = [query_model(model, messages) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}
