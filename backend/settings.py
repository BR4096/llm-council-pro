"""Settings storage and management."""

import json
import os
from pathlib import Path
from typing import Optional, List, Dict
from pydantic import BaseModel
from .search import SearchProvider

# Settings file path
SETTINGS_FILE = Path(__file__).parent.parent / "data" / "settings.json"

# Default models (matches original llm-council defaults)
DEFAULT_COUNCIL_MODELS = ["", ""]
DEFAULT_CHAIRMAN_MODEL = ""

# System default council config for reset functionality
SYSTEM_DEFAULT_COUNCIL_CONFIG = {
    "council_models": ["", ""],
    "chairman_model": "",
    "council_temperature": 0.5,
    "chairman_temperature": 0.4,
    "stage2_temperature": 0.3,
    "character_names": None,
    "member_prompts": None,
    "chairman_character_name": None,
    "chairman_custom_prompt": None
}

# Default enabled providers
DEFAULT_ENABLED_PROVIDERS = {
    "openrouter": True,
    "ollama": False,
    "groq": False,
    "direct": False,  # Master toggle for all direct connections
    "custom": False,  # Custom OpenAI-compatible endpoint
    "perplexity": False  # Perplexity direct connection
}

# Default direct provider toggles (individual)
DEFAULT_DIRECT_PROVIDER_TOGGLES = {
    "openai": False,
    "anthropic": False,
    "google": False,
    "mistral": False,
    "deepseek": False,
    "groq": False,
    "perplexity": False,
    "glm": False,
    "kimi": False
}


# Available models for selection (popular OpenRouter models)
AVAILABLE_MODELS = [
    # OpenAI
    {"id": "openai/gpt-4o", "name": "GPT-4o [OpenRouter]", "provider": "OpenAI", "source": "openrouter"},
    {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini [OpenRouter]", "provider": "OpenAI", "source": "openrouter"},
    {"id": "openai/o1-preview", "name": "o1 Preview [OpenRouter]", "provider": "OpenAI", "source": "openrouter"},
    {"id": "openai/o1-mini", "name": "o1 Mini [OpenRouter]", "provider": "OpenAI", "source": "openrouter"},
    # Google
    {"id": "google/gemini-pro-1.5", "name": "Gemini 1.5 Pro [OpenRouter]", "provider": "Google", "source": "openrouter", "is_free": True},
    {"id": "google/gemini-flash-1.5", "name": "Gemini 1.5 Flash [OpenRouter]", "provider": "Google", "source": "openrouter", "is_free": True},
    {"id": "google/gemini-pro-vision", "name": "Gemini Pro Vision [OpenRouter]", "provider": "Google", "source": "openrouter"},
    # Anthropic
    {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet [OpenRouter]", "provider": "Anthropic", "source": "openrouter"},
    {"id": "anthropic/claude-3-opus", "name": "Claude 3 Opus [OpenRouter]", "provider": "Anthropic", "source": "openrouter"},
    {"id": "anthropic/claude-3-haiku", "name": "Claude 3 Haiku [OpenRouter]", "provider": "Anthropic", "source": "openrouter"},
    # Meta
    {"id": "meta-llama/llama-3.1-405b-instruct", "name": "Llama 3.1 405B [OpenRouter]", "provider": "Meta", "source": "openrouter"},
    {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B [OpenRouter]", "provider": "Meta", "source": "openrouter", "is_free": True},
    # Mistral
    {"id": "mistralai/mistral-large", "name": "Mistral Large [OpenRouter]", "provider": "Mistral", "source": "openrouter"},
    {"id": "mistralai/mistral-medium", "name": "Mistral Medium [OpenRouter]", "provider": "Mistral", "source": "openrouter"},
    # DeepSeek
    {"id": "deepseek/deepseek-chat", "name": "DeepSeek V3 [OpenRouter]", "provider": "DeepSeek", "source": "openrouter"},
]


from .prompts import (
    STAGE1_PROMPT_DEFAULT,
    STAGE2_PROMPT_DEFAULT,
    STAGE5_PROMPT_DEFAULT,
    REVISION_PROMPT_DEFAULT,
    DEBATE_TURN_PRIMARY_A,
    DEBATE_TURN_REBUTTAL,
    DEBATE_VERDICT_PROMPT,
)

class Settings(BaseModel):
    """Application settings."""
    search_provider: SearchProvider = SearchProvider.DUCKDUCKGO
    search_keyword_extraction: str = "direct"  # "direct" or "yake"

    # API Keys
    tavily_api_key: Optional[str] = None
    brave_api_key: Optional[str] = None
    truth_check_provider: str = "duckduckgo"  # Inherits from search_provider
    firecrawl_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    mistral_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    perplexity_api_key: Optional[str] = None

    # GLM and Kimi API Keys (z.ai and Moonshot AI)
    glm_api_key: Optional[str] = None
    kimi_api_key: Optional[str] = None

    # GLM thinking mode toggle (enables chain-of-thought reasoning)
    glm_thinking_enabled: bool = False

    # Ollama Settings
    ollama_base_url: str = "http://localhost:11434"

    # Custom OpenAI-compatible endpoint
    custom_endpoint_name: Optional[str] = None
    custom_endpoint_url: Optional[str] = None
    custom_endpoint_api_key: Optional[str] = None

    # Enabled Providers (which sources are available for council selection)
    enabled_providers: Dict[str, bool] = DEFAULT_ENABLED_PROVIDERS.copy()

    # Individual direct provider toggles
    direct_provider_toggles: Dict[str, bool] = DEFAULT_DIRECT_PROVIDER_TOGGLES.copy()

    # Council Configuration (unified across all providers)
    council_models: List[str] = DEFAULT_COUNCIL_MODELS.copy()
    chairman_model: str = DEFAULT_CHAIRMAN_MODEL
    
    # Temperature Settings
    council_temperature: float = 0.5
    chairman_temperature: float = 0.4
    stage2_temperature: float = 0.3  # Lower for consistent ranking output
    revision_temperature: float = 0.4
    
    # Remote/Local filters
    council_member_filters: Optional[Dict[int, str]] = None
    chairman_filter: Optional[str] = None
    search_query_filter: Optional[str] = None

    search_results_count: int = 6  # Number of search results to fetch from the search engine
    full_content_results: int = 3  # Number of search results to fetch full content for (0 to disable)
    show_free_only: bool = False  # Filter to show only free OpenRouter models

    # System Prompts
    stage1_prompt: str = STAGE1_PROMPT_DEFAULT
    stage2_prompt: str = STAGE2_PROMPT_DEFAULT
    stage5_prompt: str = STAGE5_PROMPT_DEFAULT
    revision_prompt: str = REVISION_PROMPT_DEFAULT
    debate_turn_primary_a_prompt: str = DEBATE_TURN_PRIMARY_A
    debate_turn_rebuttal_prompt: str = DEBATE_TURN_REBUTTAL
    debate_verdict_prompt: str = DEBATE_VERDICT_PROMPT
    
    # Execution Mode
    execution_mode: str = "full"  # Default execution mode: 'chat_only', 'chat_ranking', 'full'

    # Character Names (optional display names for council members)
    character_names: Optional[Dict[str, str]] = None  # {"0": "Sage", "1": "Critic", ...}

    # Per-Member Custom Prompts (prepended to global stage prompts)
    member_prompts: Optional[Dict[str, str]] = None  # {"0": "You are a philosophy expert", ...}

    # Chairman Character Name (optional display name for chairman)
    chairman_character_name: Optional[str] = None

    # Chairman Custom Prompt (prepended to Stage 5 synthesis prompt)
    chairman_custom_prompt: Optional[str] = None

    # Default member role (fallback when no custom member prompt set)
    default_member_role: Optional[str] = "You are a helpful assistant."

    # Truth Check default preference
    truth_check_default: bool = False  # Enable truth-check by default for new conversations


def get_settings() -> Settings:
    """Load settings from file, or return defaults."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                data = json.load(f)
                # Migrate old "rebuttal" keys to "revision"
                if "rebuttal_temperature" in data:
                    data.setdefault("revision_temperature", data.pop("rebuttal_temperature"))
                if "rebuttal_prompt" in data:
                    data.setdefault("revision_prompt", data.pop("rebuttal_prompt"))
                if data.get("execution_mode") == "rebuttal":
                    data["execution_mode"] = "revision"
                # Migrate truth_check_provider to inherit from search_provider
                if "truth_check_provider" not in data:
                    data.setdefault("truth_check_provider", data.get("search_provider", "duckduckgo"))
                return Settings(**data)
        except Exception:
            pass
    return Settings()


def save_settings(settings: Settings) -> None:
    """Save settings to file."""
    # Ensure data directory exists
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings.model_dump(), f, indent=2)


def update_settings(**kwargs) -> Settings:
    """Update specific settings and save."""
    current = get_settings()
    updated_data = current.model_dump()
    updated_data.update(kwargs)
    updated = Settings(**updated_data)
    save_settings(updated)
    return updated
