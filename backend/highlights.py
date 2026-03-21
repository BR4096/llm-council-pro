"""Council highlights extraction for Phase 15."""

from typing import List, Dict, Any, Optional
import json
import re
import logging
from .council import query_model, get_short_model_name, build_display_names
from .settings import get_settings
from .config import get_chairman_model
from .json_utils import escape_invalid_json_escapes

logger = logging.getLogger(__name__)

# --- Constants ---

EMPTY_HIGHLIGHTS = {
    "agreements": [],
    "disagreements": [],
    "unique_insights": []
}


# --- Helper Functions ---

def _sanitize_json_control_chars(text: str) -> str:
    """
    Replace bare control characters (\\n, \\r, \\t) that appear inside JSON
    string literals with their escaped equivalents.

    LLMs sometimes emit multi-line text inside JSON string values without
    escaping the newlines, producing JSON that json.loads() rejects with
    "Invalid control character". This function walks the text and replaces
    control chars only when inside a string literal (between unescaped double
    quotes), leaving structural whitespace (outside strings) untouched.
    """
    result = []
    in_string = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == '\\':
                # Escaped character — pass both chars through unchanged
                result.append(ch)
                i += 1
                if i < len(text):
                    result.append(text[i])
            elif ch == '"':
                # End of string literal
                in_string = False
                result.append(ch)
            elif ch == '\n':
                result.append('\\n')
            elif ch == '\r':
                result.append('\\r')
            elif ch == '\t':
                result.append('\\t')
            else:
                result.append(ch)
        else:
            if ch == '"':
                in_string = True
            result.append(ch)
        i += 1
    return ''.join(result)


def _strip_json_comments(text: str) -> str:
    """Strip // and /* */ comments from JSON text, preserving content inside string literals."""
    result = []
    i = 0
    in_string = False

    while i < len(text):
        ch = text[i]

        if in_string:
            result.append(ch)
            if ch == '\\':
                # Skip escaped character
                if i + 1 < len(text):
                    i += 1
                    result.append(text[i])
            elif ch == '"':
                in_string = False
            i += 1
            continue

        # Outside string
        if ch == '"':
            in_string = True
            result.append(ch)
            i += 1
        elif ch == '/' and i + 1 < len(text) and text[i + 1] == '/':
            # Single-line comment: skip to end of line
            i += 2
            while i < len(text) and text[i] != '\n':
                i += 1
            # Keep the newline itself
        elif ch == '/' and i + 1 < len(text) and text[i + 1] == '*':
            # Multi-line comment: skip to */
            i += 2
            while i + 1 < len(text) and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 2  # skip past */
        else:
            result.append(ch)
            i += 1

    return ''.join(result)


def _repair_json(text: str) -> str:
    """
    Attempt to repair common LLM JSON output mistakes without external libraries.

    Handles:
    1. Trailing commas before ] or } (e.g. [1, 2, 3,] or {"a": 1,})
    2. Missing commas between consecutive array objects (e.g. } { or } " or } [)
    3. Truncated JSON — track the open brace/bracket stack and close them

    Returns the repaired text (may still be invalid if too broken).
    """
    # 1. Remove trailing commas before closing brackets/braces.
    # Pattern: comma followed by optional whitespace then ] or }
    text = re.sub(r',\s*([}\]])', r'\1', text)

    # 2. Insert missing commas between adjacent JSON values in arrays.
    # Covers: } { (object followed by object), } " (object followed by string key),
    # } [ (object followed by array)
    text = re.sub(r'([}\]])\s*(\{)', r'\1,\2', text)
    text = re.sub(r'([}\]])\s*(")', r'\1,\2', text)

    # 2b. Insert missing commas between adjacent string literals.
    # After control-char sanitization, real newlines inside strings are escaped,
    # so raw whitespace between " and " is always structural (outside strings).
    # Covers: "value" "key": (missing comma between object properties) and
    # "item1" "item2" (missing comma between array string elements).
    text = re.sub(r'"\s*(")', r'",\1', text)

    # 3. Handle truncated JSON by tracking the open delimiter stack.
    # Walk the text character by character, maintaining:
    #   - stack: list of opening delimiters ({ or [) that haven't been closed
    #   - in_str: whether we're inside a string literal
    # If the JSON is truncated mid-string, close the string first.
    # Then close all open delimiters in reverse order.
    stack = []
    in_str = False
    last_valid_pos = 0
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == '"':
                in_str = False
                last_valid_pos = i
        else:
            if ch == '"':
                in_str = True
            elif ch == '{':
                stack.append('}')
                last_valid_pos = i
            elif ch == '[':
                stack.append(']')
                last_valid_pos = i
            elif ch == '}':
                if stack and stack[-1] == '}':
                    stack.pop()
                last_valid_pos = i
            elif ch == ']':
                if stack and stack[-1] == ']':
                    stack.pop()
                last_valid_pos = i
        i += 1

    # If there are unclosed structures, close them
    if stack:
        # Truncate any unterminated string — roll back to last clean structural position.
        # Do NOT append '"' here; doing so creates adjacent quotes ("...x""]) which
        # is invalid JSON. Just truncate and let the closing logic finish.
        if in_str:
            text = text[:last_valid_pos + 1]
        # Remove trailing comma or colon (orphaned delimiter after truncation)
        text = text.rstrip()
        text = re.sub(r'[,:\s]+$', '', text)
        # Close all open structures in reverse order
        text += ''.join(reversed(stack))

    # Final cleanup: trailing comma before newly appended closers
    text = re.sub(r',\s*([}\]])', r'\1', text)

    return text


def _parse_highlights(llm_response: str) -> Dict:
    """Parse highlights JSON from LLM response. Returns empty structure on failure."""
    # Input validation
    if llm_response is None:
        return EMPTY_HIGHLIGHTS.copy()
    if not isinstance(llm_response, str):
        llm_response = str(llm_response) if llm_response else ""
    if not llm_response.strip():
        return EMPTY_HIGHLIGHTS.copy()

    text = ""
    try:
        text = llm_response.strip()

        # Handle markdown code blocks (```json...``` or ```...```)
        if text.startswith("```"):
            parts = text.split("```")
            # Take the content between first pair of backticks
            if len(parts) > 1:
                text = parts[1]
                # Strip 'json' language marker if present
                if text.startswith("json"):
                    text = text[4:]
                text = text.strip()

        # Handle case where LLM adds text before/after JSON
        # Find first { and last }
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            text = text[first_brace:last_brace + 1]

        # Normalize mismatched/single-quoted keys before comment stripping.
        # LLMs sometimes produce "key': or 'key': — mismatched quotes break
        # string-state tracking in _strip_json_comments, letting // comments survive.
        text = re.sub(r'"([^"]*?)\'(?=\s*:)', r'"\1"', text)
        text = re.sub(r"(?<=[\s,{\[])\'([^']+)\'(?=\s*:)", r'"\1"', text)

        # Strip // and /* */ comments that some LLMs (e.g. qwen3) embed in JSON
        text = _strip_json_comments(text)

        # Sanitize bare control characters (newlines, tabs, carriage returns)
        # that LLMs sometimes embed directly inside JSON string values.
        # JSON spec requires these to be escaped (\\n, \\t, \\r); bare ones
        # cause "Invalid control character" errors from json.loads().
        text = _sanitize_json_control_chars(text)

        # Escape invalid JSON escape sequences (e.g., \(, \) from LaTeX)
        text = escape_invalid_json_escapes(text)

        # First attempt: parse as-is
        try:
            data = json.loads(text)
        except json.JSONDecodeError as first_err:
            # Second attempt: apply JSON repair for common LLM mistakes
            logger.debug(f"[HIGHLIGHTS] First parse failed ({first_err}), attempting repair")
            repaired = _repair_json(text)
            try:
                data = json.loads(repaired)
                logger.info("[HIGHLIGHTS] JSON repair succeeded")
                text = repaired  # update for error logging context
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse highlights JSON: {e}")
                logger.warning(f"[HIGHLIGHTS DEBUG] Text that failed parsing (first 500 chars): {text[:500] if text else 'None'}")
                return EMPTY_HIGHLIGHTS.copy()

        # Validate structure is a dict
        if not isinstance(data, dict):
            logger.warning("Highlights JSON is not a dict")
            return EMPTY_HIGHLIGHTS.copy()

        # Ensure all keys exist with valid list values
        result = {
            "agreements": data.get("agreements") or [],
            "disagreements": data.get("disagreements") or [],
            "unique_insights": data.get("unique_insights") or []
        }

        # Validate each category is a list
        for key in result:
            if not isinstance(result[key], list):
                logger.warning(f"Highlights {key} is not a list, resetting")
                result[key] = []

        # Validate each item in lists is a dict with expected structure
        for key in ["agreements", "disagreements", "unique_insights"]:
            valid_items = []
            for item in result[key]:
                if isinstance(item, dict):
                    # Item is valid dict, keep it
                    valid_items.append(item)
                else:
                    # Item is malformed (string, int, etc.) - log and skip
                    logger.warning(
                        f"Highlights {key} contained non-dict item: "
                        f"type={type(item).__name__}, value={str(item)[:100]}"
                    )
            result[key] = valid_items

        return result

    except (KeyError, TypeError, AttributeError) as e:
        logger.warning(f"Failed to parse highlights JSON: {e}")
        logger.warning(f"[HIGHLIGHTS DEBUG] Text that failed parsing (first 500 chars): {text[:500] if text else 'None'}")
        return EMPTY_HIGHLIGHTS.copy()


def _restore_model_ids(highlights: Dict, name_to_model: Dict[str, str], name_to_index: Dict[str, int] = None) -> Dict:
    """Replace character names in model_id/model fields with actual model IDs,
    and attach member_index for frontend display of duplicate models.

    The highlights prompt labels responses with human-readable names, and the LLM
    echoes those names into the JSON output's model_id fields. This function maps
    them back to real model IDs so downstream consumers (debates) can query models.
    It also stores member_index so the frontend can look up the correct character
    name directly (bypassing the lossy reverse-lookup from model ID).
    """
    if not name_to_model:
        return highlights

    # Build normalized lookups: handle LLM writing underscores instead of spaces
    norm_model = {}
    norm_index = {}
    for name, mid in name_to_model.items():
        for variant in (name, name.replace(' ', '_'), name.replace('_', ' ')):
            norm_model[variant] = mid
            norm_model[variant.lower()] = mid
    if name_to_index:
        for name, idx in name_to_index.items():
            for variant in (name, name.replace(' ', '_'), name.replace('_', ' ')):
                norm_index[variant] = idx
                norm_index[variant.lower()] = idx

    valid_model_ids = set(name_to_model.values())

    def resolve_model(name):
        if not name or not isinstance(name, str):
            return name or ""
        # Strip brackets if LLM included them (edge case)
        name = name.strip('[]')
        return norm_model.get(name) or norm_model.get(name.lower(), name)

    def resolve_index(name):
        if not name or not isinstance(name, str):
            return None
        # Strip brackets if LLM included them (edge case)
        name = name.strip('[]')
        return norm_index.get(name) or norm_index.get(name.lower())

    # agreements[].models[] — list of model identifiers
    for agreement in highlights.get("agreements", []):
        if "models" in agreement and isinstance(agreement["models"], list):
            agreement["member_indices"] = [resolve_index(m) for m in agreement["models"]]
            agreement["models"] = [resolve_model(m) for m in agreement["models"]]
            # Filter out unresolved model names
            valid_pairs = [(m, idx) for m, idx in zip(agreement["models"], agreement.get("member_indices", []))
                           if m in valid_model_ids]
            if valid_pairs:
                agreement["models"], indices = zip(*valid_pairs)
                agreement["models"] = list(agreement["models"])
                agreement["member_indices"] = list(indices)
            else:
                agreement["models"] = []
                agreement["member_indices"] = []

    # disagreements[].positions[].model_id — this is what debate.py reads
    for disagreement in highlights.get("disagreements", []):
        positions = disagreement.get("positions", [])
        if not isinstance(positions, list):
            disagreement["positions"] = []
            continue
        for position in positions:
            if not isinstance(position, dict):
                continue
            if "model_id" in position:
                position["member_index"] = resolve_index(position["model_id"])
                position["model_id"] = resolve_model(position["model_id"])
        # Filter out positions with unresolved model_ids (and any non-dict remnants)
        disagreement["positions"] = [p for p in positions
                                      if isinstance(p, dict) and p.get("model_id") in valid_model_ids]

    # unique_insights[].model — single model identifier
    for insight in highlights.get("unique_insights", []):
        if "model" in insight:
            insight["member_index"] = resolve_index(insight["model"])
            insight["model"] = resolve_model(insight["model"])
            # Clear unresolved model (keep the insight text)
            if insight["model"] not in valid_model_ids:
                insight["model"] = ""
                insight["member_index"] = None

    return highlights


def _add_truth_check_status(highlights: Dict, truth_check_results: Dict) -> Dict:
    """Cross-reference agreements with truth-check verified claims.

    Adds truth_check_status: "verified" to agreements whose finding text
    contains a confirmed claim (simple substring match).

    Args:
        highlights: Parsed highlights dict with agreements/disagreements/unique_insights.
        truth_check_results: Truth-check output dict with claims list.

    Returns:
        Modified highlights dict with truth_check_status annotations on agreements.
    """
    # Guard against None/empty inputs
    if not highlights or not truth_check_results:
        return highlights or EMPTY_HIGHLIGHTS.copy()

    # Only process if truth-check was actually run
    if not truth_check_results.get("checked"):
        return highlights

    # Extract verified claims safely
    claims = truth_check_results.get("claims") or []
    verified_claims = []
    for c in claims:
        if isinstance(c, dict) and c.get("verdict") == "Confirmed":
            claim_text = c.get("text", "")
            if claim_text and isinstance(claim_text, str):
                verified_claims.append(claim_text.lower())

    if not verified_claims:
        return highlights

    # Safe matching loop
    agreements = highlights.get("agreements") or []
    updated_agreements = []
    for agreement in agreements:
        if not isinstance(agreement, dict):
            updated_agreements.append(agreement)
            continue
        finding = agreement.get("finding", "")
        if not finding or not isinstance(finding, str):
            updated_agreements.append(agreement)
            continue
        finding_lower = finding.lower()

        # Simple substring match for cross-referencing
        matched = False
        for claim in verified_claims:
            if claim and (claim in finding_lower or finding_lower in claim):
                updated_agreements.append({**agreement, "truth_check_status": "verified"})
                matched = True
                break  # Only tag once per agreement

        if not matched:
            updated_agreements.append(agreement)

    return {**highlights, "agreements": updated_agreements}


# --- Main Entry Point ---

async def extract_highlights(
    revised_responses: List[Dict],
    user_query: str,
    truth_check_results: Dict = None,
    settings=None
) -> Dict:
    """Extract agreements, disagreements, and unique insights from revised responses.

    Uses a single LLM call with the chairman model to identify:
    - Agreements: Points where 2+ models make the same substantive claim
    - Disagreements: Topics where models explicitly contradict each other
    - Unique insights: Significant points mentioned by only one model

    Args:
        revised_responses: List of dicts with 'model' and 'response' keys.
        user_query: The original user question.
        truth_check_results: Optional truth-check output to cross-reference agreements.

    Returns:
        Dict with 'agreements', 'disagreements', and 'unique_insights' arrays.
        Returns EMPTY_HIGHLIGHTS on any error.
    """
    try:
        from .prompts import HIGHLIGHTS_PROMPT

        # Build formatted responses text with unique labels per slot
        character_names_dict = {}
        if settings:
            character_names_dict = getattr(settings, 'character_names', None) or {}

        council_models_list = getattr(settings, 'council_models', None) or [] if settings else []
        display_names = build_display_names(council_models_list, character_names_dict)

        name_to_model = {}
        name_to_index = {}
        labeled_responses = []
        for i, r in enumerate(revised_responses):
            if not r.get('response'):
                continue
            member_idx = r.get('member_index', i)
            model_id = r.get('model', '')
            name = character_names_dict.get(str(member_idx), None)
            if not name:
                name = display_names.get(member_idx, get_short_model_name(model_id))
            name_to_model[name] = model_id
            name_to_index[name] = member_idx
            labeled_responses.append(f"[{name}]: {r.get('response', '')}")

        responses_text = "\n\n".join(labeled_responses)

        # Empty responses_text check
        if not responses_text.strip():
            logger.info("No response content to analyze for highlights")
            return EMPTY_HIGHLIGHTS.copy()

        # Chairman model validation
        chairman_model = get_chairman_model()
        if not chairman_model:
            logger.warning("No chairman model configured for highlights extraction")
            return EMPTY_HIGHLIGHTS.copy()

        prompt = HIGHLIGHTS_PROMPT.format(
            responses_text=responses_text,
            user_query=user_query
        )

        # For Ollama models, request enough tokens and JSON-constrained output
        extra_kwargs = {}
        if chairman_model and chairman_model.startswith("ollama:"):
            extra_kwargs = {"num_predict": 8192, "json_format": True}

        result = await query_model(
            chairman_model,
            [{"role": "user", "content": prompt}],
            temperature=0.3,
            **extra_kwargs
        )

        # LLM response null check
        raw_content = result.get("content", "") if result else ""
        # Debug: Log raw LLM response
        logger.info(f"[HIGHLIGHTS DEBUG] Raw LLM response length: {len(raw_content)}")
        logger.info(f"[HIGHLIGHTS DEBUG] Raw LLM response (first 500 chars): {raw_content[:500]}")
        if not raw_content.strip():
            logger.warning("Empty response from chairman model for highlights")
            return EMPTY_HIGHLIGHTS.copy()

        highlights = _parse_highlights(raw_content)
        highlights = _restore_model_ids(highlights, name_to_model, name_to_index)
        # Debug: Log parsed result
        logger.info(f"[HIGHLIGHTS DEBUG] Parsed highlights: agreements={len(highlights.get('agreements', []))}, disagreements={len(highlights.get('disagreements', []))}, unique_insights={len(highlights.get('unique_insights', []))}")

        # Cross-reference with truth-check results if provided
        if truth_check_results:
            highlights = _add_truth_check_status(highlights, truth_check_results)

        return highlights

    except Exception as e:
        logger.error(f"Highlights extraction failed: {e}")
        return EMPTY_HIGHLIGHTS.copy()
