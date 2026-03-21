"""Debate system: issue selection, prompt builders, and transcript formatting."""

import asyncio
import json
import logging
import time
from typing import AsyncGenerator, Dict, List, Any, Optional

from .council import query_model, get_short_model_name, build_display_names, NO_STAGE_DIRECTIONS
from .config import get_chairman_model
from .prompts import (
    DEBATE_ISSUE_SELECTION_PROMPT,
)
from .models import DebateIssue, DebateTurn
from . import storage

logger = logging.getLogger(__name__)


def _pick_alternate_model(exclude_id: str, council_models: List[str]) -> Optional[str]:
    """Return the first council model that isn't exclude_id, or None if impossible."""
    for m in council_models:
        if m != exclude_id:
            return m
    return None


def _find_member_index(model_id: str, council_models: List[str], name_hint: str = None, character_names: Dict = None, exclude_indices: set = None) -> Optional[int]:
    """
    Find the member_index for a model_id, handling duplicates via name_hint.

    When multiple slots have the same model_id, use name_hint + character_names
    to find the correct slot. Falls back to first non-excluded match.
    """
    exclude_indices = exclude_indices or set()

    # If name_hint matches a character_name, use that index
    if name_hint and character_names:
        for idx_str, cname in character_names.items():
            idx = int(idx_str)
            if cname == name_hint and idx < len(council_models) and council_models[idx] == model_id and idx not in exclude_indices:
                return idx

    # Fallback: first occurrence of model_id not in exclude set
    for i, m in enumerate(council_models):
        if m == model_id and i not in exclude_indices:
            return i
    return None


async def select_debate_issues(
    highlights: Dict,
    stage3_results: List[Dict],
    settings,
) -> List[Dict]:
    """
    Use the chairman model to select 1-3 debate issues from Stage 4 disagreements.

    Args:
        highlights: Stage 4 highlights output containing 'disagreements' list
        stage3_results: List of Stage 3 revised response dicts (model_id, response)
        settings: Settings object with council_models, chairman_model, character_names

    Returns:
        List of dicts, each with: idx, title, participants (list of {model_id, role, name})
        Returns [] if no disagreements or on any failure.
    """
    disagreements = highlights.get("disagreements") or []
    if not disagreements:
        logger.info("[DEBATE] No disagreements found — skipping issue selection")
        return []

    chairman_model = get_chairman_model()
    if not chairman_model:
        logger.warning("[DEBATE] No chairman model configured — cannot select issues")
        return []

    # Build character_names mapping (index string -> name) from settings
    character_names = getattr(settings, "character_names", None) or {}

    # Build council_models list for model_id lookup
    council_models = getattr(settings, "council_models", []) or []
    display_names = build_display_names(council_models, character_names)

    # Build human-readable character names text for the prompt
    character_names_lines = []
    for i, model_id in enumerate(council_models):
        name = character_names.get(str(i), "")
        if name:
            character_names_lines.append(f"  {i}: {name}")
        else:
            # Use last segment of model_id as fallback display
            short = model_id.split(":")[-1].split("/")[-1] if model_id else f"Model {i}"
            character_names_lines.append(f"  {i}: {short} (no character name set)")

    character_names_text = "\n".join(character_names_lines) if character_names_lines else "  (none configured)"

    # Build model_ids text for index reference
    model_ids_lines = [
        f"  {i}: {model_id}"
        for i, model_id in enumerate(council_models)
    ]
    model_ids_text = "\n".join(model_ids_lines) if model_ids_lines else "  (none configured)"

    # Build disagreements text
    disagreements_lines = []
    for idx, d in enumerate(disagreements):
        topic = d.get("topic", "Unknown topic")
        why = d.get("why_they_differ", "")
        positions = d.get("positions", [])
        pos_text = "; ".join(
            f"{p.get('model_id', 'unknown')}: {p.get('position_text', '')[:120]}"
            for p in positions
        )
        disagreements_lines.append(
            f"  [{idx}] Topic: {topic}\n"
            f"      Why they differ: {why}\n"
            f"      Positions: {pos_text}"
        )
    disagreements_text = "\n\n".join(disagreements_lines)

    prompt = DEBATE_ISSUE_SELECTION_PROMPT.format(
        character_names_text=character_names_text,
        model_ids_text=model_ids_text,
        disagreements_text=disagreements_text,
    )

    # For Ollama models, request enough tokens and JSON-constrained output
    extra_kwargs: Dict[str, Any] = {}
    if chairman_model.startswith("ollama:"):
        extra_kwargs = {"num_predict": 4096, "json_format": True}

    try:
        result = await query_model(
            chairman_model,
            [{"role": "user", "content": prompt}],
            temperature=0.3,
            **extra_kwargs,
        )

        raw_content = result.get("content", "") if result else ""
        logger.info("[DEBATE] Chairman raw response length: %d", len(raw_content))
        logger.info("[DEBATE] Chairman raw response (first 500): %s", raw_content[:500])

        issues = []

        if not raw_content.strip():
            logger.warning("[DEBATE] Empty response from chairman for issue selection")
        else:
            issues_raw = _parse_json_response(raw_content)
            logger.info("[DEBATE] Parsed issues_raw type=%s, value=%s", type(issues_raw).__name__, str(issues_raw)[:300])

            issues_list = _extract_issues_array(issues_raw)
            if issues_list is None:
                logger.warning(f"[DEBATE] Issue selection returned non-list: {type(issues_raw)}")
            else:
                # Cap at 5 and attach idx
                for i, issue in enumerate(issues_list[:5]):
                    if not isinstance(issue, dict):
                        logger.warning("[DEBATE] Skipping non-dict issue item: %s", type(issue).__name__)
                        continue
                    title = issue.get("title", f"Issue {i}")
                    primary_a = issue.get("primary_a", {})
                    primary_b = issue.get("primary_b", {})
                    participants = []
                    used_indices = set()
                    mid_a = ""
                    idx_a = None

                    if primary_a.get("model_id"):
                        mid_a = primary_a["model_id"]
                        name_hint_a = primary_a.get("name", "")
                        idx_a = _find_member_index(mid_a, council_models, name_hint_a, character_names)
                        # If model_id is invalid (not in council), skip this issue entirely
                        if idx_a is None:
                            logger.warning("[DEBATE] Issue %d primary_a model_id '%s' not in council; skipping issue", i, mid_a)
                            continue
                        if idx_a is not None:
                            used_indices.add(idx_a)
                        resolved_name_a = _resolve_participant_name(mid_a, council_models, character_names, member_index=idx_a, display_names=display_names)
                        logger.info("[DEBATE-DEBUG] Issue %d primary_a: mid='%s' hint='%s' idx=%s name='%s'", i, mid_a, name_hint_a, idx_a, resolved_name_a)
                        participants.append({
                            "model_id": mid_a,
                            "role": "primary_a",
                            "name": resolved_name_a,
                            "member_index": idx_a,
                        })
                    else:
                        logger.warning("[DEBATE] Issue %d primary_a missing model_id: %s", i, primary_a)

                    if primary_b.get("model_id"):
                        mid_b = primary_b["model_id"]
                        name_hint_b = primary_b.get("name", "")

                        if mid_b == mid_a and mid_a:
                            # Same model_id — try to find a DIFFERENT slot for primary_b
                            idx_b = _find_member_index(mid_b, council_models, name_hint_b, character_names, exclude_indices=used_indices)
                            logger.info("[DEBATE-DEBUG] Issue %d primary_b same model_id as primary_a; idx_b from hint='%s': %s", i, name_hint_b, idx_b)
                            if idx_b is None:
                                # No other slot with this model — try a completely different model
                                alt = _pick_alternate_model(mid_a, council_models)
                                if alt:
                                    logger.warning("[DEBATE] Issue %d primary_b == primary_a (%s); substituting %s", i, mid_a, alt)
                                    mid_b = alt
                                    idx_b = _find_member_index(alt, council_models, None, character_names, exclude_indices=used_indices)
                                else:
                                    # All slots same model — just use a different slot index
                                    for ci in range(len(council_models)):
                                        if ci not in used_indices:
                                            idx_b = ci
                                            break
                                    logger.info("[DEBATE-DEBUG] Issue %d all-same-model fallback: assigned idx_b=%s", i, idx_b)
                                    if idx_b is None:
                                        logger.warning("[DEBATE] Issue %d: no distinct slot available; skipping", i)
                                        continue
                        else:
                            idx_b = _find_member_index(mid_b, council_models, name_hint_b, character_names, exclude_indices=used_indices)
                            # If model_id is invalid (not in council), skip this issue entirely
                            if idx_b is None:
                                logger.warning("[DEBATE] Issue %d primary_b model_id '%s' not in council; skipping issue", i, mid_b)
                                continue

                        if idx_b is not None:
                            used_indices.add(idx_b)
                        resolved_name_b = _resolve_participant_name(mid_b, council_models, character_names, member_index=idx_b, display_names=display_names)
                        logger.info("[DEBATE-DEBUG] Issue %d primary_b: mid='%s' hint='%s' idx=%s name='%s'", i, mid_b, name_hint_b, idx_b, resolved_name_b)
                        participants.append({
                            "model_id": mid_b,
                            "role": "primary_b",
                            "name": resolved_name_b,
                            "member_index": idx_b,
                        })
                    else:
                        logger.warning("[DEBATE] Issue %d primary_b missing model_id: %s", i, primary_b)

                    issues.append({
                        "idx": i,
                        "title": title,
                        "participants": participants,
                    })

        # Fallback: if no valid issues but disagreements exist, auto-construct from disagreements
        if not issues and disagreements:
            logger.warning(
                "[DEBATE] No valid issues from chairman despite %d disagreement(s) — using fallback",
                len(disagreements),
            )

            for fi, d in enumerate(disagreements[:5]):
                positions = d.get("positions", [])
                if len(positions) < 1:
                    continue

                p_a = positions[0]
                mid_a = p_a.get("model_id", "")
                used_indices = set()
                logger.info("[DEBATE-DEBUG] Fallback %d: positions=%s council_models=%s", fi, positions, council_models)

                # Find member_index for p_a (prefer index from disagreement positions)
                idx_a = p_a.get("member_index")
                if idx_a is None:
                    idx_a = _find_member_index(mid_a, council_models, None, character_names)
                if idx_a is not None:
                    used_indices.add(idx_a)
                logger.info("[DEBATE-DEBUG] Fallback %d: mid_a='%s' idx_a=%s", fi, mid_a, idx_a)

                # Pick p_b: walk remaining positions, prefer different model_id
                p_b = None
                idx_b = None
                for pos in positions[1:]:
                    pos_mid = pos.get("model_id", "")
                    if pos_mid != mid_a:
                        p_b = pos
                        idx_b = pos.get("member_index")
                        if idx_b is None or idx_b in used_indices:
                            idx_b = _find_member_index(pos_mid, council_models, None, character_names, exclude_indices=used_indices)
                        break

                # If no distinct model found, try different slot of same model
                if p_b is None:
                    logger.info("[DEBATE-DEBUG] Fallback %d: no distinct model for p_b, trying different slot of same model", fi)
                    for pos in positions[1:]:
                        pos_mid = pos.get("model_id", "")
                        candidate_idx = pos.get("member_index")
                        if candidate_idx is not None and candidate_idx not in used_indices:
                            p_b = pos
                            idx_b = candidate_idx
                            break
                        candidate_idx = _find_member_index(pos_mid, council_models, None, character_names, exclude_indices=used_indices)
                        if candidate_idx is not None:
                            p_b = pos
                            idx_b = candidate_idx
                            break

                # Last resort: pick any unused slot
                if p_b is None:
                    logger.info("[DEBATE-DEBUG] Fallback %d: last resort — picking any unused slot", fi)
                    for ci in range(len(council_models)):
                        if ci not in used_indices:
                            p_b = {"model_id": council_models[ci]}
                            idx_b = ci
                            break

                if p_b is None:
                    logger.warning("[DEBATE] Fallback issue %d: no second participant available; skipping", fi)
                    continue

                if idx_b is not None:
                    used_indices.add(idx_b)

                mid_b = p_b.get("model_id", "")
                name_a = _resolve_participant_name(mid_a, council_models, character_names, member_index=idx_a, display_names=display_names)
                name_b = _resolve_participant_name(mid_b, council_models, character_names, member_index=idx_b, display_names=display_names)
                logger.info("[DEBATE-DEBUG] Fallback %d: FINAL mid_a='%s' idx_a=%s name_a='%s' mid_b='%s' idx_b=%s name_b='%s'", fi, mid_a, idx_a, name_a, mid_b, idx_b, name_b)
                topic = d.get("topic", "Unresolved disagreement")
                issues.append({
                    "idx": fi,
                    "title": f"{name_a} vs {name_b}: {topic}",
                    "participants": [
                        {"model_id": mid_a, "role": "primary_a", "name": name_a, "member_index": idx_a},
                        {"model_id": mid_b, "role": "primary_b", "name": name_b, "member_index": idx_b},
                    ],
                })
            logger.info("[DEBATE] Fallback constructed %d debate issue(s) from disagreements", len(issues))

        logger.info(f"[DEBATE] Selected {len(issues)} debate issue(s)")
        return issues

    except Exception as e:
        logger.error(f"[DEBATE] Issue selection failed: {e}", exc_info=True)
        # Even on exception, try fallback if disagreements exist
        if disagreements:
            logger.info("[DEBATE] Attempting fallback after exception")
            fallback_issues = []
            for fi, d in enumerate(disagreements[:5]):
                positions = d.get("positions", [])
                if len(positions) < 1:
                    continue

                p_a = positions[0]
                mid_a = p_a.get("model_id", "")
                used_indices = set()
                idx_a = p_a.get("member_index")
                if idx_a is None:
                    idx_a = _find_member_index(mid_a, council_models, None, character_names)
                if idx_a is not None:
                    used_indices.add(idx_a)

                # Pick p_b: prefer different model, then different slot of same model
                p_b = None
                idx_b = None
                for pos in positions[1:]:
                    pos_mid = pos.get("model_id", "")
                    if pos_mid != mid_a:
                        p_b = pos
                        idx_b = pos.get("member_index")
                        if idx_b is None or idx_b in used_indices:
                            idx_b = _find_member_index(pos_mid, council_models, None, character_names, exclude_indices=used_indices)
                        break
                if p_b is None:
                    for pos in positions[1:]:
                        pos_mid = pos.get("model_id", "")
                        candidate_idx = pos.get("member_index")
                        if candidate_idx is not None and candidate_idx not in used_indices:
                            p_b = pos
                            idx_b = candidate_idx
                            break
                        candidate_idx = _find_member_index(pos_mid, council_models, None, character_names, exclude_indices=used_indices)
                        if candidate_idx is not None:
                            p_b = pos
                            idx_b = candidate_idx
                            break
                if p_b is None:
                    for ci in range(len(council_models)):
                        if ci not in used_indices:
                            p_b = {"model_id": council_models[ci]}
                            idx_b = ci
                            break
                if p_b is None:
                    logger.warning("[DEBATE] Exception fallback issue %d: no second participant; skipping", fi)
                    continue
                if idx_b is not None:
                    used_indices.add(idx_b)

                mid_b = p_b.get("model_id", "")
                name_a = _resolve_participant_name(mid_a, council_models, character_names, member_index=idx_a, display_names=display_names)
                name_b = _resolve_participant_name(mid_b, council_models, character_names, member_index=idx_b, display_names=display_names)
                topic = d.get("topic", "Unresolved disagreement")
                fallback_issues.append({
                    "idx": fi,
                    "title": f"{name_a} vs {name_b}: {topic}",
                    "participants": [
                        {"model_id": mid_a, "role": "primary_a", "name": name_a, "member_index": idx_a},
                        {"model_id": mid_b, "role": "primary_b", "name": name_b, "member_index": idx_b},
                    ],
                })
            if fallback_issues:
                logger.info("[DEBATE] Exception fallback constructed %d issue(s)", len(fallback_issues))
                return fallback_issues
        return []


def _resolve_participant_name(
    model_id: str,
    council_models: List[str],
    character_names: Dict[str, str],
    member_index: int = None,
    display_names: dict = None,
) -> str:
    """
    Resolve the display name for a debate participant.

    Priority:
    1. Character name via explicit member_index (handles duplicate models)
    2. Character name via council_models.index() lookup (unique models only)
    3. Pre-computed display name from display_names map (short model name, disambiguated)
    4. Short model name extracted from model_id

    Args:
        model_id: The participant's model ID
        council_models: Ordered list of council model IDs (for index lookup)
        character_names: Dict mapping index string to character name
        member_index: Explicit slot index (use when models may be duplicated)
        display_names: Pre-computed {slot_index: display_name} from build_display_names()

    Returns:
        Resolved display name string
    """
    # Strip brackets if present (edge case from highlights parsing)
    if model_id and isinstance(model_id, str):
        model_id = model_id.strip('[]')

    if not model_id:
        return "Unknown"

    # If explicit member_index provided, use it directly (handles duplicates)
    if member_index is not None:
        name = character_names.get(str(member_index), "")
        if name:
            return name
        # No character name — use pre-computed display name or short model name
        if display_names:
            return display_names.get(member_index, get_short_model_name(model_id))
        return get_short_model_name(model_id)

    # Fallback: look up by first occurrence in council_models (only correct for unique models)
    try:
        idx = council_models.index(model_id)
        name = character_names.get(str(idx), "")
        if name:
            return name
        if display_names:
            return display_names.get(idx, get_short_model_name(model_id))
        return get_short_model_name(model_id)
    except ValueError:
        pass

    # Final fallback: short model name (no member_index available)
    return get_short_model_name(model_id)


def build_debate_prompt(persona_prompt: str, template: str, **kwargs) -> List[Dict]:
    """
    Build a messages list for a debate turn.

    Args:
        persona_prompt: The participant's character/system prompt. If empty,
                        uses a generic debate participant prompt.
        template: The user-facing prompt template (DEBATE_TURN_PRIMARY_A etc.)
        **kwargs: Template format arguments

    Returns:
        List of message dicts: [{"role": "system", ...}, {"role": "user", ...}]
    """
    system_content = persona_prompt.strip() if persona_prompt and persona_prompt.strip() else (
        "You are a debate participant. Argue your position clearly and persuasively."
    )
    if persona_prompt and persona_prompt.strip():
        system_content += NO_STAGE_DIRECTIONS
    user_content = template.format(**kwargs)
    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]


def format_transcript_text(transcript: List) -> str:
    """
    Format a list of DebateTurn dicts into readable text for injection into prompts.

    Args:
        transcript: List of DebateTurn dicts or DebateTurn instances

    Returns:
        Formatted string with each turn on labeled lines.
    """
    lines = []
    for turn in transcript:
        # Support both dict and DebateTurn model instances
        if isinstance(turn, dict):
            name = turn.get("name", "Unknown")
            role = turn.get("role", "")
            text = turn.get("text", "")
        else:
            name = turn.name
            role = turn.role
            text = turn.text
        lines.append(f"**{name} ({role}):** {text}")
    return "\n\n".join(lines)


def _extract_issues_array(parsed: Any) -> Optional[List]:
    """Extract issues array from potentially wrapped JSON response.

    LLMs (especially Ollama models) often wrap bare arrays in objects like
    {"issues": [...]} even when prompted for a bare array.  This helper
    detects common wrapper keys and extracts the inner list.
    """
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        # Grab the first value that's a list — chairman may use any key name
        for key, val in parsed.items():
            if isinstance(val, list):
                logger.warning("[DEBATE] Extracted issues from wrapper key '%s'", key)
                return val
        # Single issue object instead of array (has "title" key)
        if "title" in parsed:
            logger.warning("[DEBATE] Wrapped single issue object into array")
            return [parsed]
    return None


def _parse_json_response(raw: str) -> Any:
    """
    Parse a JSON response, stripping markdown code blocks if present.
    Returns parsed object or None on failure.
    """
    content = raw.strip()

    # Strip markdown code fences
    if content.startswith("```"):
        lines = content.split("\n")
        # Remove first line (```json or ```) and last line (```)
        inner_lines = lines[1:]
        if inner_lines and inner_lines[-1].strip() == "```":
            inner_lines = inner_lines[:-1]
        content = "\n".join(inner_lines).strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.warning(f"[DEBATE] JSON parse error: {e}. Raw (first 300): {raw[:300]}")
        return None


def _get_participant_stage3_response(
    participant_model_id: str,
    stage3_results: List[Dict],
    member_index: int = None,
) -> str:
    """
    Find the Stage 3 response for a participant.

    Args:
        participant_model_id: The model_id to look up
        stage3_results: List of stage3 response dicts (each has 'model', 'response', and optionally 'member_index')
        member_index: Explicit slot index (use when models may be duplicated)

    Returns:
        Response text (truncated to 2000 chars), or empty string if not found.
    """
    # If member_index provided, match by it first (handles duplicate models)
    if member_index is not None:
        for result in stage3_results:
            if result.get("member_index") == member_index:
                text = result.get("response", "") or ""
                return text[:2000] if len(text) > 2000 else text

    # Fallback: match by model_id
    for result in stage3_results:
        model_id = result.get("model", "")
        if model_id == participant_model_id:
            text = result.get("response", "") or ""
            return text[:2000] if len(text) > 2000 else text
    return ""


def _get_member_prompt(model_id: str, settings, member_index: int = None) -> str:
    """
    Find the character/persona prompt for a council member.

    Args:
        model_id: The model_id to look up in settings.council_models
        settings: Settings object with council_models list and member_prompts dict
        member_index: Explicit slot index (use when models may be duplicated)

    Returns:
        The member prompt string, or empty string if not found.
    """
    member_prompts = getattr(settings, "member_prompts", {}) or {}

    # If explicit member_index provided, use it directly (handles duplicates)
    if member_index is not None:
        return member_prompts.get(str(member_index), "") or ""

    # Fallback: look up by first occurrence in council_models
    council_models = getattr(settings, "council_models", []) or []
    try:
        index = council_models.index(model_id)
        return member_prompts.get(str(index), "") or ""
    except ValueError:
        return ""


async def run_debate(
    conversation_id: str,
    issue_idx: int,
    issue: Dict,
    stage3_results: List[Dict],
    settings,
    request=None,
    original_query: str = "",
) -> AsyncGenerator[Dict, None]:
    """
    Orchestrate a sequential multi-model debate and stream SSE event dicts.

    Yields events in this order per turn:
        turn_start -> debate_token -> turn_complete
    After all turns:
        verdict -> debate_done

    A 120-second turn budget plus 30-second verdict budget produces a partial transcript with "timeout" status.
    The finished DebateIssue is persisted to stage4.debates[] in storage.

    Args:
        conversation_id: Conversation to load and update in storage
        issue_idx: Index of the issue (used as DebateIssue.idx)
        issue: Issue dict with 'idx', 'title', 'participants' (from select_debate_issues)
        stage3_results: Stage 3 revised response dicts for participant context
        settings: Settings object
        request: FastAPI Request for is_disconnected() checks (optional)
    """
    start_time = time.time()

    try:
        issue_title = issue.get("title", f"Issue {issue_idx}")
        participants = issue.get("participants", [])

        # Separate primary_a and primary_b
        primary_a = next((p for p in participants if p.get("role") == "primary_a"), None)
        primary_b = next((p for p in participants if p.get("role") == "primary_b"), None)

        if not primary_a or not primary_b:
            logger.warning(f"[DEBATE] Issue {issue_idx} missing primary_a or primary_b — aborting")
            yield {
                "type": "debate_done",
                "data": {
                    "idx": issue_idx,
                    "title": issue_title,
                    "status": "failed",
                    "participants": participants,
                    "transcript": [],
                    "verdict": None,
                    "meta": {"error": "Missing primary debaters"},
                },
            }
            return

        # Build commentator list from remaining council members
        council_models = getattr(settings, "council_models", []) or []
        character_names = getattr(settings, "character_names", {}) or {}
        display_names = build_display_names(council_models, character_names)

        # Collect indices already used by primaries
        primary_indices = set()
        if primary_a.get("member_index") is not None:
            primary_indices.add(primary_a["member_index"])
        if primary_b.get("member_index") is not None:
            primary_indices.add(primary_b["member_index"])

        # Pick commentators from remaining slots (by index, not model_id, to handle duplicates)
        council_size = len(council_models)
        commentator_count = min(max(council_size - 2, 0), 3)
        remaining_slots = [(i, council_models[i]) for i in range(council_size) if i not in primary_indices]

        commentators = []
        for ci, (slot_idx, model_id) in enumerate(remaining_slots[:commentator_count]):
            name = character_names.get(str(slot_idx), "") or display_names.get(slot_idx, get_short_model_name(model_id))
            commentators.append({
                "model_id": model_id,
                "role": f"commentator_{ci + 1}",
                "name": name,
                "member_index": slot_idx,
            })

        turn_order = [primary_a, primary_b] + commentators
        all_participants = turn_order

        transcript = []
        completed_turn_count = 0
        timed_out = False

        # Execute turns
        for turn_index, participant in enumerate(turn_order):
            # Check client disconnect
            if request is not None:
                try:
                    if await request.is_disconnected():
                        logger.info(f"[DEBATE] Client disconnected at turn {turn_index}")
                        break
                except Exception:
                    pass

            elapsed = time.time() - start_time
            remaining = 120.0 - elapsed
            if remaining <= 0:
                timed_out = True
                logger.info(f"[DEBATE] 120s timeout reached before turn {turn_index}")
                break

            yield {
                "type": "turn_start",
                "data": {
                    "name": participant["name"],
                    "role": participant["role"],
                    "model_id": participant["model_id"],
                    "turn_index": turn_index,
                },
            }

            # Build the prompt for this turn (use member_index to handle duplicate models)
            p_member_index = participant.get("member_index")
            persona_prompt = _get_member_prompt(participant["model_id"], settings, member_index=p_member_index)
            stage3_response = _get_participant_stage3_response(participant["model_id"], stage3_results, member_index=p_member_index)
            logger.info("[DEBATE-DEBUG] Turn %d: name='%s' model='%s' member_index=%s persona_prompt_len=%d stage3_response_len=%d",
                        turn_index, participant["name"], participant["model_id"], p_member_index,
                        len(persona_prompt), len(stage3_response))

            if turn_index == 0:
                # Primary A opens — no prior transcript
                messages = build_debate_prompt(
                    persona_prompt,
                    settings.debate_turn_primary_a_prompt,
                    persona=participant["name"],
                    issue_title=issue_title,
                    stage3_response=stage3_response,
                    original_query=original_query,
                )
            else:
                # Everyone else rebuts
                transcript_so_far = format_transcript_text(transcript)
                messages = build_debate_prompt(
                    persona_prompt,
                    settings.debate_turn_rebuttal_prompt,
                    persona=participant["name"],
                    issue_title=issue_title,
                    transcript_so_far=transcript_so_far,
                    stage3_response=stage3_response,
                    original_query=original_query,
                )

            # Query the participant's own model
            try:
                result = await asyncio.wait_for(
                    query_model(
                        participant["model_id"],
                        messages,
                        temperature=getattr(settings, "council_temperature", 0.5),
                    ),
                    timeout=remaining,
                )
                raw_content = result.get("content", "") if result else ""
                # Safely convert to string, handling arrays/objects from some Ollama models
                if isinstance(raw_content, (list, dict)):
                    import json
                    turn_text = json.dumps(raw_content)
                else:
                    turn_text = str(raw_content or "")
            except asyncio.TimeoutError:
                turn_text = "[Turn timed out]"
                timed_out = True
                logger.warning(f"[DEBATE] Turn {turn_index} ({participant['name']}) timed out")
            except Exception as e:
                turn_text = f"[Error: {e}]"
                logger.error(f"[DEBATE] Turn {turn_index} query failed: {e}")

            # Collapse "Name (Name)" duplicates that LLMs produce by echoing the transcript format
            import re as _re
            _escaped = _re.escape(participant["name"])
            turn_text = _re.sub(
                rf'\*{{0,2}}{_escaped}\*{{0,2}}\s*\({_escaped}\)\*{{0,2}}',
                participant["name"],
                turn_text,
                flags=_re.IGNORECASE,
            )
            turn_text = _re.sub(
                rf'\[{_escaped}\]\({_escaped}\)',
                participant["name"],
                turn_text,
                flags=_re.IGNORECASE,
            )
            # Collapse "Part (FullName)" for multi-word names
            # e.g. "Graeber (David Graeber)" → "David Graeber"
            _parts = participant["name"].split()
            if len(_parts) >= 2:
                _esc_full = _re.escape(participant["name"])
                for _word in _parts:
                    if len(_word) < 3:
                        continue
                    _esc_part = _re.escape(_word)
                    turn_text = _re.sub(
                        rf'\*{{0,2}}{_esc_part}\*{{0,2}}\s*\(\*{{0,2}}{_esc_full}\*{{0,2}}\)\*{{0,2}}',
                        participant["name"],
                        turn_text,
                        flags=_re.IGNORECASE,
                    )

            # Strip self-echo: LLMs sometimes prefix their turn with their own name
            # e.g. "**David Graeber:** text" or "David Graeber: text"
            turn_text = _re.sub(
                rf'^\s*\*{{0,2}}{_escaped}\*{{0,2}}\s*:\s*\*{{0,2}}\s*',
                '',
                turn_text,
                count=1,
                flags=_re.IGNORECASE,
            )

            # Yield the full text as a single token event (true streaming is a future enhancement)
            yield {
                "type": "debate_token",
                "data": {
                    "text": turn_text,
                    "turn_index": turn_index,
                },
            }

            transcript.append({
                "role": participant["role"],
                "name": participant["name"],
                "model_id": participant["model_id"],
                "text": turn_text,
            })
            completed_turn_count += 1

            yield {
                "type": "turn_complete",
                "data": {
                    "turn_index": turn_index,
                    "role": participant["role"],
                    "name": participant["name"],
                },
            }

            # Stop after timeout turn
            if timed_out:
                break

        # Determine status
        all_turns_ran = completed_turn_count == len(turn_order)
        status = "completed" if all_turns_ran and not timed_out else "timeout"

        # Generate verdict if both primaries spoke
        verdict = None
        primary_roles_present = {t["role"] for t in transcript}
        both_primaries_spoke = "primary_a" in primary_roles_present and "primary_b" in primary_roles_present

        if both_primaries_spoke:
            chairman_model = get_chairman_model()
            if chairman_model:
                elapsed = time.time() - start_time
                verdict_timeout = 30.0
                transcript_text = format_transcript_text(transcript)
                # Format as "primary_a: Name, primary_b: Name" so the chairman
                # uses names in the verdict without echoing role labels like "(primary_a)"
                participant_names = ", ".join(
                    f"{p['role']}: {p['name']}" for p in all_participants
                )
                verdict_prompt = settings.debate_verdict_prompt.format(
                    issue_title=issue_title,
                    transcript_text=transcript_text,
                    participant_names=participant_names,
                )

                # Ollama needs json_format hint
                extra_kwargs: Dict[str, Any] = {}
                if chairman_model.startswith("ollama:"):
                    extra_kwargs = {"num_predict": 1024, "json_format": True}

                try:
                    verdict_result = await asyncio.wait_for(
                        query_model(
                            chairman_model,
                            [{"role": "user", "content": verdict_prompt}],
                            temperature=getattr(settings, "chairman_temperature", 0.4),
                            **extra_kwargs,
                        ),
                        timeout=verdict_timeout,
                    )
                    raw_verdict = (verdict_result.get("content", "") or "") if verdict_result else ""
                    parsed = _parse_json_response(raw_verdict)
                    if isinstance(parsed, dict) and "summary" in parsed:
                        verdict = {
                            "summary": parsed.get("summary", ""),
                            "winner": parsed.get("winner"),
                        }
                        # Collapse "Name (Name)" duplicates in verdict summary
                        import re as _re
                        summary = verdict["summary"]
                        for p in all_participants:
                            _esc = _re.escape(p["name"])
                            # Pattern 1: plain or bold parenthetical, including trailing bold
                            summary = _re.sub(rf'\*{{0,2}}{_esc}\*{{0,2}}\s*\(\*{{0,2}}{_esc}\*{{0,2}}\)\*{{0,2}}', p["name"], summary, flags=_re.IGNORECASE)
                            # Pattern 2: markdown link syntax
                            summary = _re.sub(rf'\[{_esc}\]\({_esc}\)', p["name"], summary, flags=_re.IGNORECASE)
                            # Pattern 3: "Part (FullName)" for multi-word names
                            _parts = p["name"].split()
                            if len(_parts) >= 2:
                                _esc_full = _re.escape(p["name"])
                                for _word in _parts:
                                    if len(_word) < 3:
                                        continue
                                    _esc_part = _re.escape(_word)
                                    summary = _re.sub(
                                        rf'\*{{0,2}}{_esc_part}\*{{0,2}}\s*\(\*{{0,2}}{_esc_full}\*{{0,2}}\)\*{{0,2}}',
                                        p["name"],
                                        summary,
                                        flags=_re.IGNORECASE,
                                    )
                        # Strip self-echo name prefixes from verdict summary
                        for p in all_participants:
                            _esc_v = _re.escape(p["name"])
                            summary = _re.sub(
                                rf'^\s*\*{{0,2}}{_esc_v}\*{{0,2}}\s*:\s*\*{{0,2}}\s*',
                                '',
                                summary,
                                count=1,
                                flags=_re.IGNORECASE,
                            )
                        verdict["summary"] = summary
                    else:
                        verdict = {"summary": "Verdict unavailable", "winner": None}
                except asyncio.TimeoutError:
                    verdict = {"summary": "Verdict timed out", "winner": None}
                    logger.warning("[DEBATE] Verdict generation timed out")
                except Exception as e:
                    verdict = {"summary": "Verdict unavailable", "winner": None}
                    logger.error(f"[DEBATE] Verdict generation failed: {e}")

                yield {
                    "type": "verdict",
                    "data": verdict,
                }

        # Build the final DebateIssue result dict
        elapsed_ms = int((time.time() - start_time) * 1000)
        meta: Dict[str, Any] = {"duration_ms": elapsed_ms}
        if timed_out:
            meta["timeout"] = True

        debate_issue_dict = {
            "idx": issue_idx,
            "title": issue_title,
            "status": status,
            "participants": all_participants,
            "transcript": transcript,
            "verdict": verdict,
            "meta": meta,
        }

        # Persist to storage — update or append in stage4.debates[]
        try:
            conversation = storage.get_conversation(conversation_id)
            if conversation:
                messages = conversation.get("messages", [])
                assistant_msgs = [m for m in messages if m.get("role") == "assistant"]
                if assistant_msgs:
                    last_msg = assistant_msgs[-1]
                    stage4 = last_msg.setdefault("stage4", {})
                    debates = stage4.setdefault("debates", [])
                    # Replace existing entry if present, otherwise append
                    existing_idx = next(
                        (i for i, d in enumerate(debates) if d.get("idx") == issue_idx), None
                    )
                    if existing_idx is not None:
                        debates[existing_idx] = debate_issue_dict
                    else:
                        debates.append(debate_issue_dict)
                    storage.save_conversation(conversation)
                    logger.info(
                        f"[DEBATE] Persisted debate for issue {issue_idx} (status={status})"
                    )
        except Exception as e:
            logger.error(f"[DEBATE] Failed to persist debate results: {e}")

        yield {
            "type": "debate_done",
            "data": debate_issue_dict,
        }

    except Exception as e:
        logger.error(f"[DEBATE] Unexpected error in run_debate: {e}", exc_info=True)
        yield {
            "type": "debate_done",
            "data": {
                "idx": issue_idx,
                "status": "failed",
                "meta": {"error": str(e)},
            },
        }
