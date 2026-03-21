"""Content processing utilities for export generators.

This module provides shared functions for processing conversation content
before export, including:
- Model name display formatting
- Ranking de-anonymization
- Think block processing
- Footnote marker stripping
"""

import re
from typing import Dict, Any, Optional


def get_display_name(
    model_id: str,
    character_names: Dict[str, str],
    instance_key: Optional[str] = None
) -> str:
    """
    Get the display name for a model.

    If character_names has an entry for this model, return it.
    Otherwise, extract short name from model ID (after '/' or FIRST ':').

    IMPORTANT: Only splits on the FIRST ':' to preserve model:tag formats
    like "llama3.1:70b" (Ollama) or "custom:model-name:version".

    Args:
        model_id: The full model ID (e.g., "openai:gpt-4", "ollama:llama3.1:70b")
        character_names: Dict mapping instance keys or indices to character names
        instance_key: Optional instance key for multi-instance lookup (e.g., "openai:gpt-4:0")

    Returns:
        Display name (character name or short model name)
    """
    # First try instance key if provided (for multi-instance scenarios)
    if instance_key and instance_key in character_names:
        return character_names[instance_key]

    # Try model_id directly
    if model_id in character_names:
        return character_names[model_id]

    # Try extracting numeric index from instance_key
    # instance_key is always f"{model_id}:{idx}" where idx is an integer
    if instance_key:
        suffix = instance_key.rsplit(':', 1)[-1]
        if suffix.isdigit() and suffix in character_names:
            return character_names[suffix]

    # Extract short name from model ID
    if '/' in model_id:
        # OpenRouter format: "anthropic/claude-sonnet-4"
        return model_id.split('/')[-1]
    elif ':' in model_id:
        # Provider-prefixed format: "ollama:llama3.1:70b"
        # Only split on FIRST ':' to preserve model:tag
        return model_id.split(':', 1)[1]
    return model_id


def build_extended_character_names(council_config: dict) -> dict:
    """
    Build an extended character_names dict that maps model_id → character name.

    council_config.character_names uses string-index keys {"0": "Sage", "1": "Critic"}.
    council_config.council_models is the ordered list of model IDs.

    This helper adds model_id and instance_key entries so get_display_name()
    can resolve names without needing a separate index.
    """
    character_names = (council_config or {}).get("character_names") or {}
    council_models = (council_config or {}).get("council_models") or []
    extended = dict(character_names)
    for idx, model_id in enumerate(council_models):
        idx_str = str(idx)
        if idx_str in character_names and model_id not in extended:
            extended[model_id] = character_names[idx_str]
            extended[f"{model_id}:{idx}"] = character_names[idx_str]
    return extended


def deanonymize_ranking_content(
    content: str,
    label_to_model: Optional[Dict[str, str]] = None,
    label_to_instance_key: Optional[Dict[str, str]] = None,
    character_names: Optional[Dict[str, str]] = None
) -> str:
    """
    Replace anonymous labels (Response A, Response B, etc.) with actual model names.

    Stage 2 rankings use anonymous labels to prevent bias. For exports, we replace
    these with the actual model names or character names for clarity.

    Args:
        content: The ranking content text
        label_to_model: Dict mapping labels to model IDs (e.g., {"A": "openai:gpt-4"})
        label_to_instance_key: Dict mapping labels to instance keys (e.g., {"A": "openai:gpt-4:0"})
        character_names: Dict mapping instance keys to character names

    Returns:
        Content with anonymous labels replaced by display names
    """
    if not content:
        return content

    if not label_to_model:
        return content

    character_names = character_names or {}

    # Pattern to match "Response X" where X is A, B, C, etc.
    # This handles various formats:
    # - "Response A" (standard)
    # - "Response A:" (with colon)
    # - "Response A." (with period)
    # - "1. Response A" (in numbered lists)
    pattern = r'\bResponse\s+([A-Z])\b'

    def replace_label(match):
        label = match.group(1)  # "A", "B", "C"
        full_label = f"Response {label}"  # "Response A", "Response B", etc.

        # Try full label first, then just the letter for backwards compatibility
        model_id = label_to_model.get(full_label) or label_to_model.get(label)
        if not model_id:
            return match.group(0)  # Keep original if no mapping

        instance_key = None
        if label_to_instance_key:
            instance_key = label_to_instance_key.get(full_label) or label_to_instance_key.get(label)

        display_name = get_display_name(model_id, character_names, instance_key)
        return display_name

    return re.sub(pattern, replace_label, content)


def process_think_blocks(content: str) -> str:
    """
    Convert <think/> blocks to markdown details/summary format.

    Think blocks are used by some models to show reasoning. Convert them
    to collapsible sections for better readability in exports.

    Args:
        content: The content text

    Returns:
        Content with think blocks converted to markdown details
    """
    if not content:
        return content

    # Handle self-closing <think/> tags
    content = re.sub(
        r'<think\s*/>',
        lambda m: '\n<details>\n<summary>Model Reasoning</summary>\n\n*Thinking...*\n\n</details>\n',
        content
    )

    # Handle <think...</think >blocks
    content = re.sub(
        r'<think\s*>(.*?)</think\s*>',
        r'\n<details>\n<summary>Model Reasoning</summary>\n\n\1\n\n</details>\n',
        content,
        flags=re.DOTALL
    )

    return content


def strip_footnote_markers(content: str) -> str:
    """
    Remove footnote-style markers that some search providers add.

    Examples:
    - "Some text【1†source】" -> "Some text"
    - "According to【2†source】, ..." -> "According to, ..."

    Args:
        content: The content text

    Returns:
        Content with footnote markers removed
    """
    if not content:
        return content

    # Pattern for footnote markers like 【1†source】, 【2†source】, etc.
    # These are added by some search/content providers
    pattern = r'【\d+†source】'
    return re.sub(pattern, '', content)


def process_export_content(
    content: str,
    label_to_model: Optional[Dict[str, str]] = None,
    label_to_instance_key: Optional[Dict[str, str]] = None,
    character_names: Optional[Dict[str, str]] = None,
    process_think: bool = True,
    strip_footnotes: bool = True
) -> str:
    """
    Apply all content processing transformations for export.

    Args:
        content: The raw content text
        label_to_model: Dict mapping labels to model IDs for de-anonymization
        label_to_instance_key: Dict mapping labels to instance keys
        character_names: Dict mapping instance keys to character names
        process_think: Whether to convert think blocks to details/summary
        strip_footnotes: Whether to remove footnote markers

    Returns:
        Processed content ready for export
    """
    if not content:
        return content

    # De-anonymize rankings first (before other processing)
    if label_to_model:
        content = deanonymize_ranking_content(
            content,
            label_to_model,
            label_to_instance_key,
            character_names
        )

    # Process think blocks
    if process_think:
        content = process_think_blocks(content)

    # Strip footnote markers
    if strip_footnotes:
        content = strip_footnote_markers(content)

    return content
