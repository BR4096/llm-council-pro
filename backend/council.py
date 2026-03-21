"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Optional, Tuple
import asyncio
import logging
import re
from . import openrouter
from . import ollama_client
from .config import get_council_models, get_chairman_model
from .search import perform_web_search, SearchProvider
from .settings import get_settings

logger = logging.getLogger(__name__)

NO_STAGE_DIRECTIONS = (
    "\n\nDo not use stage directions, actions, or physical gestures "
    "(e.g., \"*adjusts glasses*\", \"(leans forward, a slight frown)\"). "
    "Do not self-identify by name "
    "(e.g., \"As Daniel Kahneman, I say...\")."
)

STAGE_DIRECTION_PATTERN = re.compile(r'^\s*\([^)]*\)\s*$', re.MULTILINE)

def strip_stage_directions(content: str, model_id: str = None) -> str:
    """Remove standalone parenthetical stage directions for Gemma models."""
    if not content:
        return content
    if model_id and 'gemma' in model_id.lower():
        result = STAGE_DIRECTION_PATTERN.sub('', content)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()
    return content

# Multi-language ranking patterns for Stage 2 parsing.
# Supports English, French, Spanish, and German responses generated
# when members have custom prompts in those languages (Phase 9).
def get_short_model_name(model_id: str) -> str:
    """Extract short model name from a prefixed model ID.

    Examples:
        'ollama:gemma3:4b' -> 'gemma3'
        'openrouter:anthropic/claude-sonnet-4' -> 'claude-sonnet-4'
        'openai:gpt-4.1' -> 'gpt-4.1'
        'gpt-4.1' -> 'gpt-4.1'
    """
    if not model_id:
        return "Unknown"
    if '/' in model_id:
        return model_id.split('/')[-1]
    if ':' in model_id:
        return model_id.split(':')[1]
    return model_id


def build_display_names(council_models: list, character_names: dict) -> dict:
    """Build a mapping of slot_index -> display_name for all council slots.

    Uses character names when set. Falls back to short model names.
    Disambiguates duplicate short names with "Member N" when needed.

    Returns: e.g. {0: "Member 1", 1: "Member 2", 2: "dolphin3"}
    """
    slot_names = {}
    short_name_slots = {}  # short_name -> [slot indices that need this name]

    for i, model_id in enumerate(council_models):
        char_name = character_names.get(str(i))
        if char_name:
            slot_names[i] = char_name
        else:
            short = get_short_model_name(model_id)
            slot_names[i] = short
            short_name_slots.setdefault(short, []).append(i)

    # Disambiguate duplicate short names — use "Member N" (1-indexed slot)
    for short, indices in short_name_slots.items():
        if len(indices) > 1:
            for idx in indices:
                slot_names[idx] = f"Member {idx + 1}"

    return slot_names


RANKING_PATTERNS = {
    "en": {
        "response_pattern": r"Response",
        "header_patterns": [r"FINAL\s*RANKING:"]
    },
    "fr": {
        "response_pattern": r"R[ée]ponse",
        "header_patterns": [r"CLASSEMENT\s*FINAL:", r"RANG\s*FINAL:"]
    },
    "es": {
        "response_pattern": r"Respuesta",
        "header_patterns": [r"CLASIFICACI[ÓO]N\s*FINAL:", r"RANKING\s*FINAL:"]
    },
    "de": {
        "response_pattern": r"Antwort",
        "header_patterns": [r"ENDG[ÜU]LTIGE\s*RANGFOLGE:", r"FINALE\s*WERTUNG:"]
    }
}


def build_member_prompt(
    base_prompt: str,
    member_index: int,
    settings,
    use_default_fallback: bool = True
) -> str:
    """
    Build final prompt by prepending member-specific custom prompt if set.

    Order: Member prompt (role) -> Global prompt (task)
    Separator: Double newline only if both parts have content

    Args:
        base_prompt: The global stage prompt (task instructions)
        member_index: Index of the council member (0, 1, 2, ...)
        settings: Settings object containing member_prompts and default_member_role
        use_default_fallback: If True, fall back to default_member_role when no custom prompt.
                              If False, only use custom prompt (for Stages 2/3 where default
                              role doesn't make sense with task-focused prompts).

    Returns:
        Final prompt with member role prepended if available
    """
    # Get member prompts dict safely (handles missing attribute and None)
    member_prompts = getattr(settings, 'member_prompts', None) or {}

    # Get this member's custom prompt (keys are strings: "0", "1", etc.)
    member_prompt = member_prompts.get(str(member_index), "") or ""

    # Track if we have a CUSTOM prompt (not default fallback)
    has_custom_prompt = bool(member_prompt.strip())

    # Get default member role if no custom prompt (only for Stage 1)
    if not member_prompt.strip() and use_default_fallback:
        default_role = getattr(settings, 'default_member_role', None) or ""
        member_prompt = default_role

    # Prepend only if member prompt has actual content (avoid empty prepend)
    if member_prompt.strip():
        # Only append anti-stage-direction instruction for CUSTOM prompts
        if has_custom_prompt:
            return f"{member_prompt}{NO_STAGE_DIRECTIONS}\n\n{base_prompt}"
        return f"{member_prompt}\n\n{base_prompt}"
    return base_prompt


def build_member_messages(
    base_prompt: str,
    member_index: int,
    settings,
    use_default_fallback: bool = True
) -> List[Dict[str, str]]:
    """
    Build messages list with persona in system message, task in user message.

    This mirrors the debate prompt structure for better character adherence.
    Models prioritize system messages for identity, so separating persona (system)
    from task (user) improves character consistency.

    Args:
        base_prompt: The global stage prompt (task instructions)
        member_index: Index of the council member (0, 1, 2, ...)
        settings: Settings object containing member_prompts and default_member_role
        use_default_fallback: If True, fall back to default_member_role when no custom prompt.

    Returns:
        List of message dicts: [{"role": "system", ...}, {"role": "user", ...}]
        Or just [{"role": "user", ...}] if no persona is set.
    """
    member_prompts = getattr(settings, 'member_prompts', None) or {}
    member_prompt = member_prompts.get(str(member_index), "") or ""

    has_custom_prompt = bool(member_prompt.strip())

    if not member_prompt.strip() and use_default_fallback:
        default_role = getattr(settings, 'default_member_role', None) or ""
        member_prompt = default_role

    if member_prompt.strip():
        # Persona goes in system message
        # For custom prompts, append NO_STAGE_DIRECTIONS to system message
        if has_custom_prompt:
            system_content = f"{member_prompt}{NO_STAGE_DIRECTIONS}"
        else:
            system_content = member_prompt

        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": base_prompt}
        ]

    # No persona - just user message
    return [{"role": "user", "content": base_prompt}]


from .providers.openai import OpenAIProvider
from .providers.anthropic import AnthropicProvider
from .providers.google import GoogleProvider
from .providers.mistral import MistralProvider
from .providers.deepseek import DeepSeekProvider
from .providers.openrouter import OpenRouterProvider
from .providers.ollama import OllamaProvider
from .providers.groq import GroqProvider
from .providers.custom_openai import CustomOpenAIProvider
from .providers.perplexity import PerplexityProvider
from .providers.glm import GLMProvider
from .providers.kimi import KimiProvider

# Initialize providers
PROVIDERS = {
    "openai": OpenAIProvider(),
    "anthropic": AnthropicProvider(),
    "google": GoogleProvider(),
    "mistral": MistralProvider(),
    "deepseek": DeepSeekProvider(),
    "groq": GroqProvider(),
    "openrouter": OpenRouterProvider(),
    "ollama": OllamaProvider(),
    "custom": CustomOpenAIProvider(),
    "perplexity": PerplexityProvider(),
    "glm": GLMProvider(),
    "kimi": KimiProvider(),
}

def get_provider_for_model(model_id: str) -> Any:
    """Determine the provider for a given model ID."""
    if ":" in model_id:
        provider_name = model_id.split(":")[0]
        if provider_name in PROVIDERS:
            return PROVIDERS[provider_name]

    # Default to OpenRouter for unprefixed models (legacy support)
    return PROVIDERS["openrouter"]


async def query_model(model: str, messages: List[Dict[str, str]], timeout: float = 120.0, temperature: float = 0.7, **kwargs) -> Dict[str, Any]:
    """Dispatch query to appropriate provider."""
    provider = get_provider_for_model(model)
    return await provider.query(model, messages, timeout, temperature, **kwargs)


async def query_models_parallel(models: List[str], messages: List[Dict[str, str]]) -> Dict[str, Any]:
    """Dispatch parallel query to appropriate providers."""
    tasks = []
    model_to_task_map = {}
    
    # Group models by provider to optimize batching if supported (mostly for OpenRouter/Ollama legacy)
    # But for simplicity and modularity, we'll just spawn individual tasks for now
    # OpenRouter and Ollama wrappers might handle their own internal concurrency if we called a batch method,
    # but the base interface is single query.
    # To maintain OpenRouter's batch efficiency if it exists, we could check type, but let's stick to simple asyncio.gather first.
    
    # Actually, the previous implementation used specific batch logic for Ollama and OpenRouter.
    # We should preserve that if possible, OR just rely on asyncio.gather which is fine for HTTP clients.
    # The previous `_query_ollama_batch` was just a helper to strip prefixes.
    # `openrouter.query_models_parallel` was doing the gather.
    
    # Let's just use asyncio.gather for all. It's clean and effective.
    
    async def _query_safe(m: str):
        try:
            return m, await query_model(m, messages)
        except Exception as e:
            return m, {"error": True, "error_message": str(e)}

    tasks = [_query_safe(m) for m in models]
    results = await asyncio.gather(*tasks)
    
    return dict(results)


async def stage1_collect_responses(user_query: str, search_context: str = "", request: Any = None) -> Any:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        search_context: Optional web search results to provide context
        request: FastAPI request object for checking disconnects

    Yields:
        - First yield: total_models (int)
        - Subsequent yields: Individual model results (dict)
    """
    settings = get_settings()

    # Build search context block if search results provided
    search_context_block = ""
    if search_context:
        from .prompts import STAGE1_SEARCH_CONTEXT_TEMPLATE
        search_context_block = STAGE1_SEARCH_CONTEXT_TEMPLATE.format(search_context=search_context)

    # Use customizable Stage 1 prompt
    try:
        prompt_template = settings.stage1_prompt
        if not prompt_template:
            from .prompts import STAGE1_PROMPT_DEFAULT
            prompt_template = STAGE1_PROMPT_DEFAULT

        prompt = prompt_template.format(
            user_query=user_query,
            search_context_block=search_context_block
        )
    except (KeyError, AttributeError, TypeError) as e:
        logger.warning(f"Error formatting Stage 1 prompt: {e}. Using fallback.")
        prompt = f"{search_context_block}Question: {user_query}" if search_context_block else user_query

    messages = [{"role": "user", "content": prompt}]

    # Prepare tasks for all models
    models = get_council_models()

    # Yield total count first
    yield len(models)

    council_temp = settings.council_temperature

    async def _query_safe(m: str, index: int):
        try:
            # Check if this member has a character name for persona-aware prompting
            char_names = getattr(settings, 'character_names', None) or {}
            char_name = char_names.get(str(index))

            if char_name and char_name.strip():
                from .prompts import STAGE1_PERSONA_TEMPLATE
                persona_prompt = STAGE1_PERSONA_TEMPLATE.format(
                    persona=char_name,
                    search_context_block=search_context_block,
                    user_query=user_query
                )
                member_messages = build_member_messages(persona_prompt, index, settings)
            else:
                member_messages = build_member_messages(prompt, index, settings)

            return m, index, await query_model(m, member_messages, temperature=council_temp)
        except Exception as e:
            return m, index, {"error": True, "error_message": str(e)}

    # Create tasks (enumerate models to get index)
    logger.info("[STAGE1-DEBUG] Council slots: %s", [(i, m) for i, m in enumerate(models)])
    tasks = [asyncio.create_task(_query_safe(m, i)) for i, m in enumerate(models)]
    
    # Process as they complete
    pending = set(tasks)
    try:
        while pending:
            # Check for client disconnect
            if request and await request.is_disconnected():
                logger.info("Client disconnected during Stage 1. Cancelling tasks...")
                for t in pending:
                    t.cancel()
                raise asyncio.CancelledError("Client disconnected")

            # Wait for the next task to complete (with timeout to check for disconnects)
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=1.0)

            for task in done:
                try:
                    model, idx, response = await task

                    result = None
                    if response is not None:
                        if response.get('error'):
                            # Include failed models with error info
                            result = {
                                "model": model,
                                "member_index": idx,
                                "response": None,
                                "error": response.get('error'),
                                "error_message": response.get('error_message', 'Unknown error')
                            }
                        else:
                            # Successful response - ensure content is always a string
                            content = response.get('content', '')
                            if not isinstance(content, str):
                                # Handle case where API returns non-string content (array, object, etc.)
                                content = str(content) if content is not None else ''
                            content = strip_stage_directions(content, model)
                            result = {
                                "model": model,
                                "member_index": idx,
                                "response": content,
                                "error": None
                            }

                    if result:
                        yield result
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.error(f"Error processing Stage 1 task result: {e}")

    except asyncio.CancelledError:
        # Ensure all tasks are cancelled if we get cancelled
        for t in tasks:
            if not t.done():
                t.cancel()
        raise


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    search_context: str = "",
    request: Any = None
) -> Any: # Returns an async generator
    """
    Stage 2: Collect peer rankings from all council models.
    
    Yields:
        - First yield: label_to_model mapping (dict)
        - Subsequent yields: Individual model results (dict)
    """
    settings = get_settings()

    # Filter to only successful responses for ranking
    successful_results = [r for r in stage1_results if not r.get('error')]

    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(successful_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, successful_results)
    }

    # Create mapping from label to instance key (model_id:index)
    # This uniquely identifies each council member even when using the same model
    label_to_instance_key = {
        f"Response {label}": f"{result['model']}:{result.get('member_index', i)}"
        for i, (label, result) in enumerate(zip(labels, successful_results))
    }

    # Yield BOTH mappings as a combined dict
    yield {
        "label_to_model": label_to_model,
        "label_to_instance_key": label_to_instance_key
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, successful_results)
    ])

    search_context_block = ""
    if search_context:
        search_context_block = f"Context from Web Search:\n{search_context}\n"

    try:
        # Ensure prompt is not None
        prompt_template = settings.stage2_prompt
        if not prompt_template:
            from .prompts import STAGE2_PROMPT_DEFAULT
            prompt_template = STAGE2_PROMPT_DEFAULT

        ranking_prompt = prompt_template.format(
            user_query=user_query,
            responses_text=responses_text,
            search_context_block=search_context_block
        )
    except (KeyError, AttributeError, TypeError) as e:
        logger.warning(f"Error formatting Stage 2 prompt: {e}. Using fallback.")
        ranking_prompt = f"Question: {user_query}\n\n{responses_text}\n\nRank these responses."

    messages = [{"role": "user", "content": ranking_prompt}]

    # Only use models that successfully responded in Stage 1
    # (no point asking failed models to rank - they'll just fail again)
    # Build list of (model, member_index) tuples to preserve slot identity for duplicates
    model_indices = [(r['model'], r.get('member_index', i)) for i, r in enumerate(successful_results)]

    # Use dedicated Stage 2 temperature (lower for consistent ranking output)
    stage2_temp = settings.stage2_temperature

    async def _query_safe(m: str, member_index: int):
        try:
            # Build member-specific prompt using the slot's own index
            final_prompt = build_member_prompt(ranking_prompt, member_index, settings, use_default_fallback=False)
            member_messages = [{"role": "user", "content": final_prompt}]
            return m, member_index, await query_model(m, member_messages, temperature=stage2_temp)
        except Exception as e:
            return m, member_index, {"error": True, "error_message": str(e)}

    # Create tasks — each carries its own member_index
    tasks = [asyncio.create_task(_query_safe(m, idx)) for m, idx in model_indices]

    # Process as they complete
    pending = set(tasks)
    try:
        while pending:
            # Check for client disconnect
            if request and await request.is_disconnected():
                logger.info("Client disconnected during Stage 2. Cancelling tasks...")
                for t in pending:
                    t.cancel()
                raise asyncio.CancelledError("Client disconnected")

            # Wait for the next task to complete (with timeout to check for disconnects)
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=1.0)

            for task in done:
                try:
                    model, idx, response = await task

                    result = None
                    if response is not None:
                        if response.get('error'):
                            # Include failed models with error info
                            result = {
                                "model": model,
                                "member_index": idx,
                                "ranking": None,
                                "parsed_ranking": [],
                                "error": response.get('error'),
                                "error_message": response.get('error_message', 'Unknown error')
                            }
                        else:
                            # Ensure content is always a string before parsing
                            full_text = response.get('content', '')
                            if not isinstance(full_text, str):
                                # Handle case where API returns non-string content (array, object, etc.)
                                full_text = str(full_text) if full_text is not None else ''

                            # Parse with expected count to avoid duplicates
                            expected_count = len(successful_results)
                            parsed = parse_ranking_from_text(full_text, expected_count=expected_count)

                            result = {
                                "model": model,
                                "member_index": idx,
                                "ranking": full_text,
                                "parsed_ranking": parsed,
                                "error": None
                            }

                    if result:
                        yield result
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.error(f"Error processing task result: {e}")

    except asyncio.CancelledError:
        # Ensure all tasks are cancelled if we get cancelled
        for t in tasks:
            if not t.done():
                t.cancel()
        raise


def build_confidence_signal(highlights: Optional[Dict[str, Any]]) -> str:
    """
    Derive a one-sentence confidence instruction from highlights agreement/disagreement ratio.

    Returns a natural language guidance string for the Chairman, or "" if no clear
    signal can be derived (balanced, ambiguous, or no data).
    """
    try:
        if not highlights:
            return ""
        agreements = highlights.get("agreements") or []
        disagreements = highlights.get("disagreements") or []
        n_agree = len(agreements)
        n_disagree = len(disagreements)
        if n_agree == 0 and n_disagree == 0:
            return ""
        if n_disagree == 0 and n_agree >= 2:
            return "The council showed strong agreement on the core points — express your synthesis with appropriate confidence."
        if n_disagree >= 2 and n_agree == 0:
            return "The council showed significant disagreement — calibrate your synthesis language to reflect this genuine uncertainty."
        if n_agree > n_disagree * 2:
            return "The council broadly agreed on most points — you may express measured confidence in the synthesis."
        if n_disagree > n_agree:
            return "The council had more disagreements than agreements — acknowledge the genuine complexity where relevant."
        return ""  # Balanced or ambiguous — no signal injected

    except (AttributeError, TypeError, KeyError) as e:
        # Malformed highlights data - log and return empty signal
        logger.warning(
            f"build_confidence_signal() failed due to malformed data: {e}. "
            f"highlights type: {type(highlights)}"
        )
        return ""  # No confidence signal - Stage 5 proceeds normally


def build_stage4_context_block(
    truth_check: Optional[Dict[str, Any]],
    highlights: Optional[Dict[str, Any]],
    get_display_name_fn  # callable(model_id: str, member_index: Optional[int] = None) -> str
) -> str:
    """
    Build a Stage 4 Analysis context block for the Chairman prompt.

    Returns an empty string when there is nothing to report (graceful degradation).
    Only includes sections that have actual content.
    """
    try:
        sections = []

        # Truth-check section: only if truth_check ran (checked == True)
        if truth_check and truth_check.get("checked") is True:
            claims = truth_check.get("claims") or []
            relevant = [c for c in claims if c.get("verdict") in ("Disputed", "Confirmed")]
            if relevant:
                lines = ["**Truth-Check Findings:**"]
                for c in relevant:
                    lines.append(f"- [{c['verdict']}] {c.get('text', c.get('claim', ''))}")
                sections.append("\n".join(lines))

        # Highlights section: only if highlights is not None
        if highlights is not None:
            highlight_lines = []

            agreements = highlights.get("agreements") or []
            for item in agreements:
                finding = item.get("finding", "")
                if finding:
                    highlight_lines.append(f"- Agreement: {finding}")

            disagreements = highlights.get("disagreements") or []
            for item in disagreements:
                # Use "finding" if present, fall back to "topic"
                finding = item.get("finding") or item.get("topic", "")
                if finding:
                    highlight_lines.append(f"- Disagreement: {finding}")

            unique_insights = highlights.get("unique_insights") or []
            for item in unique_insights:
                model_id = item.get("model", "")
                finding = item.get("finding", "")
                if model_id and finding:
                    display_name = get_display_name_fn(model_id, item.get("member_index"))
                    highlight_lines.append(f"- {display_name} uniquely noted: {finding}")

            if highlight_lines:
                sections.append("**Council Highlights:**\n" + "\n".join(highlight_lines))

        if not sections:
            return ""

        body = "## Stage 4 Analysis\n\n" + "\n\n".join(sections)

        # Append confidence signal when derivable
        confidence_signal = build_confidence_signal(highlights)
        if confidence_signal:
            body += f"\n\n**Confidence Signal:** {confidence_signal}"

        return body

    except (AttributeError, TypeError, KeyError) as e:
        # Malformed highlights data - log and return empty string
        logger.error(
            f"build_stage4_context_block() failed due to malformed data: {e}. "
            f"highlights type: {type(highlights)}, "
            f"highlights value: {str(highlights)[:500] if highlights else 'None'}"
        )
        return ""  # Graceful degradation - Stage 5 proceeds without Stage 4 context


async def stage5_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    search_context: str = "",
    label_to_model: Dict[str, str] = None,
    label_to_instance_key: Dict[str, str] = None,
    stage4_truth_check: Optional[Dict[str, Any]] = None,
    stage4_highlights: Optional[Dict[str, Any]] = None,
    debates: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Stage 5: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2
        search_context: Optional web search context
        label_to_model: Mapping from anonymous labels to model IDs
        label_to_instance_key: Mapping from labels to unique instance keys (model_id:index)

    Returns:
        Dict with 'model' and 'response' keys
    """
    settings = get_settings()
    character_names = settings.character_names or {}
    council_models = settings.council_models or []

    def format_model_name(model_id: str) -> str:
        """Convert technical model ID to human-readable name."""
        import re
        if '/' in model_id:
            parts = model_id.split('/')
            short = parts[1] if len(parts) > 1 else model_id
        elif ':' in model_id:
            parts = model_id.split(':')
            short = parts[1] if len(parts) > 1 else model_id  # model segment, not tag
        else:
            short = model_id
        name = short.replace('-', ' ').title()
        name = re.sub(r'\s+\d{4,}$', '', name)              # strip version hashes
        name = re.sub(r'\s+\d+[bBmM]$', '', name, flags=re.IGNORECASE)  # strip param counts
        return name

    display_names = build_display_names(council_models, character_names)

    def get_display_name(model_id: str, instance_index: int) -> str:
        """Get character name if set, otherwise short model name."""
        char_name = character_names.get(str(instance_index))
        if char_name:
            return char_name
        return display_names.get(instance_index, get_short_model_name(model_id))

    def get_instance_index(label: str) -> int:
        """Extract instance index from label_to_instance_key."""
        if label_to_instance_key and label in label_to_instance_key:
            instance_key = label_to_instance_key[label]
            if ':' in instance_key:
                try:
                    return int(instance_key.rsplit(':', 1)[-1])
                except ValueError:
                    pass
        return 0

    # Build comprehensive context for chairman (only include successful responses)
    stage1_text = "\n\n".join([
        f"Member: {get_display_name(result['model'], result.get('member_index', i))}\nResponse: {result.get('response', 'No response')}"
        for i, result in enumerate(stage1_results)
        if result.get('response') is not None
    ])

    # Build Stage 2 text with reviewer display names
    stage2_text_raw = "\n\n".join([
        f"Reviewer: {get_display_name(result['model'], i)}\nRanking: {result.get('ranking', 'No ranking')}"
        for i, result in enumerate(stage2_results)
        if result.get('ranking') is not None
    ])

    # Replace "Response X" labels with display names in stage2_text
    stage2_text = stage2_text_raw
    if label_to_model:
        import re as _re
        for label, model_id in label_to_model.items():
            instance_index = get_instance_index(label)
            display_name = get_display_name(model_id, instance_index)
            stage2_text = stage2_text.replace(label, display_name)
        # Collapse "Name (Name)" duplicates that arise when Stage 2 reviewers annotate
        # response labels with character names that self-identified in Stage 1 content
        for label, model_id in label_to_model.items():
            instance_index = get_instance_index(label)
            display_name = get_display_name(model_id, instance_index)
            escaped = _re.escape(display_name)
            stage2_text = _re.sub(
                rf'\*{{0,2}}{escaped}\*{{0,2}}\s*\({escaped}\)',
                display_name,
                stage2_text,
                flags=_re.IGNORECASE,
            )
            stage2_text = _re.sub(
                rf'\[{escaped}\]\({escaped}\)',
                display_name,
                stage2_text,
                flags=_re.IGNORECASE,
            )

    search_context_block = ""
    if search_context:
        search_context_block = f"Context from Web Search:\n{search_context}\n"

    # Build Stage 4 context block (empty string if Stage 4 did not run)
    stage4_context_block = build_stage4_context_block(
        truth_check=stage4_truth_check,
        highlights=stage4_highlights,
        get_display_name_fn=lambda model_id, member_index=None: get_display_name(
            model_id,
            member_index if member_index is not None else (
                council_models.index(model_id) if council_models and model_id in council_models else 0
            ),
        ),
    )

    # Build debate context block (empty if no debates were run)
    debate_context_block = ""
    if debates:
        # Only include completed debates with transcripts
        completed_debates = [d for d in debates if d.get("status") == "completed" and d.get("transcript")]
        if completed_debates:
            debate_sections = []
            for debate in completed_debates:
                title = debate.get("title", f"Issue {debate.get('idx', '?')}")
                transcript_lines = []
                for turn in debate.get("transcript", []):
                    name = turn.get("name", turn.get("role", "Unknown"))
                    transcript_lines.append(f"  {name}: {turn.get('text', '')}")
                verdict = debate.get("verdict", {})
                verdict_text = verdict.get("summary", "") if verdict else ""
                section = f"- {title}\n" + "\n".join(transcript_lines)
                if verdict_text:
                    section += f"\n  Verdict: {verdict_text}"
                debate_sections.append(section)
            debate_context_block = (
                "\n\nDEBATE TRANSCRIPTS (reference naturally if it adds value — do not force a recap):\n"
                + "\n\n".join(debate_sections)
            )

    try:
        # Ensure prompt is not None
        prompt_template = settings.stage5_prompt
        if not prompt_template:
            from .prompts import STAGE5_PROMPT_DEFAULT
            prompt_template = STAGE5_PROMPT_DEFAULT

        chairman_prompt = prompt_template.format(
            user_query=user_query,
            stage1_text=stage1_text,
            stage2_text=stage2_text,
            search_context_block=search_context_block
        )
    except (KeyError, AttributeError, TypeError) as e:
        logger.warning(f"Error formatting Stage 5 prompt: {e}. Using fallback.")
        chairman_prompt = f"Question: {user_query}\n\nSynthesis required."

    # Inject member names constraint for anti-hallucination
    member_names_list = ", ".join(f'"{display_names[i]}"' for i in sorted(display_names.keys()))
    member_names_constraint = f"\nIMPORTANT — The ONLY council member names are: {member_names_list}. Reference members using ONLY these exact names. Do not invent, modify, or add parameter counts to these names.\n"
    chairman_prompt = chairman_prompt.replace(
        "Provide a clear, well-reasoned final answer",
        f"{member_names_constraint}\nProvide a clear, well-reasoned final answer",
        1
    )

    # Inject Stage 4 context block before STAGE 1 section (preserves custom prompt compatibility)
    if stage4_context_block:
        chairman_prompt = chairman_prompt.replace(
            "STAGE 1 - Individual Responses:",
            f"{stage4_context_block}\n\nSTAGE 1 - Individual Responses:",
            1
        )

    # Inject debate context block before STAGE 1 section (after Stage 4 context if present)
    if debate_context_block:
        chairman_prompt = chairman_prompt.replace(
            "STAGE 1 - Individual Responses:",
            f"{debate_context_block}\n\nSTAGE 1 - Individual Responses:",
            1
        )

    # Determine message structure based on whether the prompt is default or custom
    from .prompts import STAGE5_PROMPT_DEFAULT

    # Check if we are using the default prompt (or if it's empty/None, which falls back to default)
    is_default_prompt = (not settings.stage5_prompt) or (settings.stage5_prompt.strip() == STAGE5_PROMPT_DEFAULT.strip())

    # Get chairman custom prompt if set
    chairman_custom = getattr(settings, 'chairman_custom_prompt', None) or ""

    # Build system message with custom prompt prepended if present
    default_system = "You are the Chairman of an LLM Council. Your task is to synthesize the provided model responses into a single, comprehensive answer."

    # Add member names constraint to system message (small models attend to system msg most strongly)
    system_names_constraint = (
        f" The council members are: {member_names_list}."
        f" Use ONLY these exact names when referencing members."
        f" NEVER add parenthetical identifiers, model names, or parameter counts after a member name."
    )

    if is_default_prompt:
        base_system = default_system + system_names_constraint
        system_content = f"{chairman_custom}\n\n{base_system}" if chairman_custom.strip() else base_system

        messages = [
            {"role": "system", "content": system_content.strip()},
            {"role": "user", "content": chairman_prompt}
        ]
    else:
        # Custom stage5 prompt path
        constraint_prefix = f"{system_names_constraint.strip()}\n\n"
        if chairman_custom.strip():
            chairman_prompt = f"{chairman_custom}\n\n{constraint_prefix}{chairman_prompt}"
        else:
            chairman_prompt = f"{constraint_prefix}{chairman_prompt}"
        messages = [{"role": "user", "content": chairman_prompt}]

    # Reinforce persona in user message when character name exists (applies in both branches)
    chairman_char_name = getattr(settings, 'chairman_character_name', None) or ""
    if chairman_char_name.strip():
        persona_preamble = (
            f"As {chairman_char_name}, synthesize the council's deliberation below."
            " Draw on your intellectual framework and distinctive perspective."
            " After synthesizing the council's views, include a dedicated section"
            f" where you — as {chairman_char_name} — apply your own theoretical"
            " framework to the question as an original analytical contribution,"
            " not just a summary of others' views.\n\n"
        )
        for msg in messages:
            if msg["role"] == "user":
                msg["content"] = persona_preamble + msg["content"]
                break

    # Query the chairman model with error handling
    chairman_model = get_chairman_model()
    chairman_temp = settings.chairman_temperature

    try:
        response = await query_model(chairman_model, messages, temperature=chairman_temp)

        # Check for error in response
        if response is None or response.get('error'):
            error_msg = response.get('error_message', 'Unknown error') if response else 'No response received'
            return {
                "model": chairman_model,
                "response": f"Error synthesizing final answer: {error_msg}",
                "error": True,
                "error_message": error_msg
            }

        # Combine reasoning and content if available
        content = response.get('content') or ''
        reasoning = response.get('reasoning') or response.get('reasoning_details') or ''
        
        final_response = content
        if reasoning and not content:
            # If only reasoning is provided (some reasoning models do this)
            final_response = f"**Reasoning:**\n{reasoning}"
        elif reasoning and content:
            # If both are provided, prepend reasoning in a collapsible block or just prepend
            # For now, we'll just prepend it clearly
            final_response = f"<think>\n{reasoning}\n</think>\n\n{content}"

        if not final_response:
             final_response = "No response generated by the Chairman."

        # Collapse "Name (Name)" duplicates that reasoning models produce when they
        # see council member names repeated across multiple context sections.
        import re as _re2
        all_display_names = set()
        for i, result in enumerate(stage1_results):
            all_display_names.add(get_display_name(result['model'], get_instance_index(f'Response {chr(65+i)}')))
        for display_name in all_display_names:
            _esc = _re2.escape(display_name)
            final_response = _re2.sub(
                rf'\*{{0,2}}{_esc}\*{{0,2}}\s*\({_esc}\)',
                display_name,
                final_response,
                flags=_re2.IGNORECASE,
            )
            final_response = _re2.sub(
                rf'\[{_esc}\]\({_esc}\)',
                display_name,
                final_response,
                flags=_re2.IGNORECASE,
            )
            # Collapse "Part (FullName)" for multi-word names
            # e.g. "Graeber (David Graeber)" → "David Graeber"
            _parts = display_name.split()
            if len(_parts) >= 2:
                _esc_full = _re2.escape(display_name)
                for _word in _parts:
                    if len(_word) < 3:
                        continue
                    _esc_part = _re2.escape(_word)
                    final_response = _re2.sub(
                        rf'\*{{0,2}}{_esc_part}\*{{0,2}}\s*\(\*{{0,2}}{_esc_full}\*{{0,2}}\)\*{{0,2}}',
                        display_name,
                        final_response,
                        flags=_re2.IGNORECASE,
                    )

        # Fix lowercase character names — LLMs sometimes lowercase proper nouns in prose
        # Process both full names and individual parts (e.g., "Lakoff" from "George Lakoff")
        _name_parts_to_fix = {}  # lowercase -> correctly-cased
        for display_name in all_display_names:
            if len(display_name) < 2:
                continue
            _name_parts_to_fix[display_name.lower()] = display_name
            for part in display_name.split():
                if len(part) >= 3:
                    _name_parts_to_fix[part.lower()] = part
        # Sort by length descending so full names match before parts
        for _lower, _correct in sorted(_name_parts_to_fix.items(), key=lambda x: len(x[0]), reverse=True):
            _esc = _re2.escape(_lower)
            final_response = _re2.sub(
                rf'\b{_esc}\b',
                _correct,
                final_response,
                flags=_re2.IGNORECASE,
            )

        # Extract citations from Perplexity response if present
        citations = response.get('citations', [])

        return {
            "model": chairman_model,
            "response": final_response,
            "citations": citations,
            "error": False
        }

    except Exception as e:
        logger.error(f"Unexpected error in Stage 3 synthesis: {e}")
        return {
            "model": chairman_model,
            "response": f"Error: Unable to generate final synthesis due to unexpected error.",
            "error": True,
            "error_message": str(e)
        }


async def chairman_follow_up(
    original_query: str,
    stage5_verdict: str,
    follow_up_history: list,
    new_question: str,
) -> dict:
    """
    Answer a follow-up question as the chairman, with context from the original deliberation.

    Args:
        original_query: The original question posed to the council
        stage5_verdict: The chairman's previous synthesized verdict
        follow_up_history: List of {"question": str, "answer": str} dicts (last 3)
        new_question: The new follow-up question from the user

    Returns:
        Dict with "model" and "response" keys
    """
    settings = get_settings()
    chairman_model = get_chairman_model()
    chairman_temp = settings.chairman_temperature

    history_block = ""
    if follow_up_history:
        exchanges = []
        for item in follow_up_history:
            exchanges.append(f"User: {item['question']}\nYou: {item['answer']}")
        history_block = "\n\nPrevious follow-up exchanges:\n" + "\n\n".join(exchanges)

    prompt = (
        f"You are the chairman who synthesized a council deliberation.\n"
        f"Answer the follow-up question based on your previous verdict.\n\n"
        f"Original question: {original_query}\n\n"
        f"Your previous verdict:\n{stage5_verdict}"
        f"{history_block}\n\n"
        f"Follow-up question: {new_question}"
    )

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(chairman_model, messages, temperature=chairman_temp)

        if response is None or response.get('error'):
            error_msg = response.get('error_message', 'Unknown error') if response else 'No response received'
            return {
                "model": chairman_model,
                "response": f"Error generating follow-up response: {error_msg}",
                "error": True,
            }

        content = response.get('content') or ''
        reasoning = response.get('reasoning') or response.get('reasoning_details') or ''

        final_response = content
        if reasoning and not content:
            final_response = f"**Reasoning:**\n{reasoning}"
        elif reasoning and content:
            final_response = f"<think>\n{reasoning}\n</think>\n\n{content}"

        if not final_response:
            final_response = "No response generated."

        return {
            "model": chairman_model,
            "response": final_response,
            "error": False,
        }

    except Exception as e:
        logger.error(f"Unexpected error in chairman follow-up: {e}")
        return {
            "model": chairman_model,
            "response": f"Error: Unable to generate follow-up response.",
            "error": True,
        }


def parse_ranking_from_text(ranking_text: str, expected_count: int = None) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Supports English, French, Spanish, and German language responses.
    All results are normalized to "Response X" format (English) so that
    the rest of the pipeline can use label_to_model mapping unchanged.

    Args:
        ranking_text: The full text response from the model
        expected_count: Optional number of expected ranked items (to truncate duplicates)

    Returns:
        List of response labels in ranked order, normalized to "Response X" format
    """
    import re

    # Defensive: ensure ranking_text is a string
    if not isinstance(ranking_text, str):
        ranking_text = str(ranking_text) if ranking_text is not None else ''

    def _deduplicate_and_truncate(raw_matches: List[str], count: int = None) -> List[str]:
        """Deduplicate while preserving order, then truncate if needed."""
        seen = set()
        result = []
        for m in raw_matches:
            if m not in seen:
                seen.add(m)
                result.append(m)
        if count and len(result) > count:
            result = result[:count]
        return result

    def _normalize_label(lang_label: str, response_pattern: str) -> str:
        """Convert a language-specific label (e.g. 'Réponse A') to 'Response A'."""
        letter_match = re.search(r'[A-Z]$', lang_label.strip())
        if letter_match:
            return f"Response {letter_match.group()}"
        return lang_label

    matches = []

    # Try each language's header patterns (try-all-languages strategy)
    for lang, patterns in RANKING_PATTERNS.items():
        response_pat = patterns["response_pattern"]
        header_pats = patterns["header_patterns"]

        for header_pat in header_pats:
            header_match = re.search(header_pat, ranking_text, re.IGNORECASE)
            if header_match:
                ranking_section = ranking_text[header_match.end():]

                # Try numbered list format: "1. Réponse A"
                numbered_matches = re.findall(
                    rf'\d+\.\s*{response_pat}\s+[A-Z]',
                    ranking_section,
                    re.IGNORECASE
                )
                if numbered_matches:
                    raw = [
                        _normalize_label(m, response_pat)
                        for m in numbered_matches
                    ]
                else:
                    # Fallback: extract all "Response X" variants in order
                    raw_found = re.findall(
                        rf'{response_pat}\s+[A-Z]',
                        ranking_section,
                        re.IGNORECASE
                    )
                    raw = [_normalize_label(m, response_pat) for m in raw_found]

                if raw:
                    matches = _deduplicate_and_truncate(raw, expected_count)
                    return matches

    # No language-specific header found — try generic full-text search across all languages
    for lang, patterns in RANKING_PATTERNS.items():
        response_pat = patterns["response_pattern"]
        raw_found = re.findall(rf'{response_pat}\s+[A-Z]', ranking_text, re.IGNORECASE)
        if raw_found:
            raw = [_normalize_label(m, response_pat) for m in raw_found]
            matches = _deduplicate_and_truncate(raw, expected_count)
            if matches:
                return matches

    # Last-resort fallback: extract single uppercase letters from a numbered list
    # Handles unusual formats where models use "1. A", "2. B" without "Response"
    letter_matches = re.findall(r'^\s*\d+\.\s+([A-Z])\b', ranking_text, re.MULTILINE)
    if letter_matches:
        raw = [f"Response {letter}" for letter in letter_matches]
        matches = _deduplicate_and_truncate(raw, expected_count)

    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
    label_to_instance_key: Dict[str, str] = None
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names
        label_to_instance_key: Mapping from labels to unique instance keys (model_id:index)

    Returns:
        List of dicts with model name, instance_key, and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each INSTANCE (not just model)
    instance_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        expected_count = len(label_to_model)
        parsed_ranking = parse_ranking_from_text(ranking_text, expected_count=expected_count)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                # Use instance key for unique tracking (handles duplicate models)
                if label_to_instance_key and label in label_to_instance_key:
                    instance_key = label_to_instance_key[label]
                else:
                    instance_key = label_to_model[label]
                instance_positions[instance_key].append(position)

    # Calculate average position for each instance
    aggregate = []
    for instance_key, positions in instance_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            # Extract model name from instance key (format: model_id:index)
            model = instance_key.rsplit(':', 1)[0] if ':' in instance_key else instance_key
            aggregate.append({
                "model": model,
                "instance_key": instance_key,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


def extract_critiques_per_model(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
    label_to_instance_key: Dict[str, str] = None
) -> Dict[str, str]:
    """
    Extract critiques for each model from Stage 2 peer reviews.

    Args:
        stage2_results: List of Stage 2 ranking results
        label_to_model: Mapping from "Response A" to model ID
        label_to_instance_key: Mapping from "Response A" to instance key (e.g. "model:0").
                               When provided, critiques are keyed by instance_key instead of
                               model ID, preventing duplicate models from mixing critiques.

    Returns:
        Dict mapping instance_key (or model ID if no instance keys) to aggregated critique text
    """
    import re
    from collections import defaultdict

    model_critiques = defaultdict(list)

    for review in stage2_results:
        if review.get('error'):
            continue

        ranking_text = review.get('ranking', '')
        reviewer_model = review['model']
        reviewer_instance = f"{reviewer_model}:{review.get('member_index', 0)}" if label_to_instance_key else reviewer_model

        # Build combined lookahead patterns for any supported language variant
        response_lookahead = r"(?:Response|R[eé]ponse|Respuesta|Antwort)\s+[A-Z][:\s]"
        header_lookahead = (
            r"(?:FINAL\s*RANKING|CLASSEMENT\s*FINAL|RANG\s*FINAL|"
            r"CLASIFICACI[ÓO]N\s*FINAL|RANKING\s*FINAL|"
            r"ENDG[ÜU]LTIGE\s*RANGFOLGE|FINALE\s*WERTUNG):"
        )

        # Extract critique for each response label
        for label, target_model in label_to_model.items():
            # Use instance_key as the critique key when available (handles duplicate models)
            target_key = label_to_instance_key.get(label, target_model) if label_to_instance_key else target_model

            # Match label followed by critique text until next label (any language), header, or end
            pattern = rf"{re.escape(label)}[:\s]+(.+?)(?={response_lookahead}|{header_lookahead}|$)"
            matches = re.findall(pattern, ranking_text, re.DOTALL | re.IGNORECASE)

            if matches:
                critique = matches[0].strip()
                # Exclude self-reviews (compare instance keys to handle duplicates)
                if reviewer_instance != target_key and len(critique) > 10:
                    model_critiques[target_key].append(
                        f"Reviewer feedback:\n{critique}"
                    )

    # Aggregate critiques per key
    aggregated = {}
    for key, critiques in model_critiques.items():
        if critiques:
            aggregated[key] = "\n\n---\n\n".join(critiques)
        else:
            aggregated[key] = "No specific critiques provided by peers."

    return aggregated


async def stage3_collect_revisions(
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
    request: Any = None,
    label_to_instance_key: Dict[str, str] = None
) -> Any:
    """
    Stage 3: Collect revised responses based on peer critiques.

    Each model receives its original answer plus aggregated peer critiques,
    and generates a revised response.

    Args:
        stage1_results: Original Stage 1 responses
        stage2_results: Stage 2 peer rankings/critiques
        label_to_model: Mapping from "Response A" to model ID
        request: FastAPI request object for checking disconnects
        label_to_instance_key: Mapping from "Response A" to instance key (e.g. "model:0")

    Yields:
        - First yield: total_models (int)
        - Subsequent yields: Individual model results (dict)
    """
    settings = get_settings()

    # Extract critiques keyed by instance_key (handles duplicate models correctly)
    model_critiques = extract_critiques_per_model(stage2_results, label_to_model, label_to_instance_key)

    # Only revise models that successfully responded in Stage 1
    successful_results = [r for r in stage1_results if not r.get('error') and r.get('response')]

    # Yield total count first
    yield len(successful_results)

    # Build revision prompt for each model
    revision_temp = settings.revision_temperature

    try:
        prompt_template = settings.revision_prompt
        if not prompt_template:
            from .prompts import REVISION_PROMPT_DEFAULT
            prompt_template = REVISION_PROMPT_DEFAULT
    except (AttributeError, TypeError):
        from .prompts import REVISION_PROMPT_DEFAULT
        prompt_template = REVISION_PROMPT_DEFAULT

    async def _query_revision(model: str, member_index: int, original_response: str, critiques: str):
        try:
            # Check if this member has a character name for persona-aware prompting
            char_names = getattr(settings, 'character_names', None) or {}
            char_name = char_names.get(str(member_index))

            if char_name and char_name.strip():
                from .prompts import REVISION_PERSONA_TEMPLATE
                base_prompt = REVISION_PERSONA_TEMPLATE.format(
                    persona=char_name,
                    original_response=original_response,
                    peer_critiques=critiques
                )
            else:
                base_prompt = prompt_template.format(
                    original_response=original_response,
                    peer_critiques=critiques
                )

            messages = build_member_messages(base_prompt, member_index, settings, use_default_fallback=False)
            return model, member_index, await query_model(model, messages, temperature=revision_temp)
        except Exception as e:
            return model, member_index, {"error": True, "error_message": str(e)}

    # Create tasks for all successful models
    # Use instance_key (model:index) to look up slot-specific critiques
    default_critique = "No specific critiques provided. Review and refine your response for accuracy and completeness."
    tasks = [
        asyncio.create_task(_query_revision(
            r['model'],
            r.get('member_index', i),
            r['response'],
            model_critiques.get(
                f"{r['model']}:{r.get('member_index', i)}" if label_to_instance_key else r['model'],
                default_critique
            )
        ))
        for i, r in enumerate(successful_results)
    ]

    # Process as they complete (same pattern as Stage 1)
    pending = set(tasks)
    try:
        while pending:
            # Check for client disconnect
            if request and await request.is_disconnected():
                logger.info("Client disconnected during Stage 3. Cancelling tasks...")
                for t in pending:
                    t.cancel()
                raise asyncio.CancelledError("Client disconnected")

            # Wait for the next task to complete (with timeout to check for disconnects)
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=1.0)

            for task in done:
                try:
                    model, idx, response = await task

                    result = None
                    if response is not None:
                        if response.get('error'):
                            result = {
                                "model": model,
                                "member_index": idx,
                                "response": None,
                                "error": response.get('error'),
                                "error_message": response.get('error_message', 'Unknown error')
                            }
                        else:
                            content = response.get('content', '')
                            if not isinstance(content, str):
                                content = str(content) if content is not None else ''
                            content = strip_stage_directions(content, model)
                            result = {
                                "model": model,
                                "member_index": idx,
                                "response": content,
                                "error": None
                            }

                    if result:
                        yield result
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.error(f"Error processing Stage 3 task result: {e}")

    except asyncio.CancelledError:
        for t in tasks:
            if not t.done():
                t.cancel()
        raise


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Uses a simple heuristic (first few words) to avoid unnecessary API calls.

    Args:
        user_query: The first user message

    Returns:
        A short title (max 50 chars)
    """
    # Validate input
    if not user_query or not isinstance(user_query, str):
        return "Untitled Conversation"

    # Simple heuristic: take first 50 chars
    title = user_query.strip()

    # If empty after stripping, return default
    if not title:
        return "Untitled Conversation"

    # Remove quotes if present
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


def generate_search_query(user_query: str) -> str:
    """Return user query directly for web search (passthrough).
    
    Modern search engines (DuckDuckGo, Brave, Tavily) handle 
    natural language queries well without optimization.
    
    Args:
        user_query: The user's full question
    
    Returns:
        User query truncated to 100 characters for safety
    """
    return user_query[:100]  # Truncate for safety


if __name__ == "__main__":
    # Test multi-language ranking parsing
    tests = [
        # English
        ("FINAL RANKING:\n1. Response A\n2. Response B\n3. Response C",
         ["Response A", "Response B", "Response C"]),
        # French with accent
        ("CLASSEMENT FINAL:\n1. Réponse A\n2. Réponse B\n3. Réponse C",
         ["Response A", "Response B", "Response C"]),
        # French without accent (model may omit accent)
        ("CLASSEMENT FINAL:\n1. Reponse A\n2. Reponse B",
         ["Response A", "Response B"]),
        # Spanish with accent
        ("CLASIFICACIÓN FINAL:\n1. Respuesta A\n2. Respuesta B",
         ["Response A", "Response B"]),
        # Spanish without accent
        ("CLASIFICACION FINAL:\n1. Respuesta A\n2. Respuesta B",
         ["Response A", "Response B"]),
        # German with umlaut
        ("ENDGÜLTIGE RANGFOLGE:\n1. Antwort A\n2. Antwort B",
         ["Response A", "Response B"]),
        # German without umlaut (in case LLM doesn't use it)
        ("ENDGULTIGE RANGFOLGE:\n1. Antwort A\n2. Antwort B",
         ["Response A", "Response B"]),
    ]

    all_passed = True
    for text, expected in tests:
        result = parse_ranking_from_text(text)
        if result != expected:
            print(f"FAIL: Input: {text[:50]!r}")
            print(f"      Expected: {expected}")
            print(f"      Got: {result}")
            all_passed = False
        else:
            print(f"PASS: {text[:40]!r} -> {result}")

    if all_passed:
        print("\nAll multi-language tests passed!")
    else:
        print("\nSome tests FAILED!")
        import sys
        sys.exit(1)
