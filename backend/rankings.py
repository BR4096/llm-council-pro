"""Chairman Rankings stage for multi-criteria scoring of revised responses."""

from typing import List, Dict, Any, Optional
import logging
import re
from .council import query_model
from .settings import get_settings

logger = logging.getLogger(__name__)

# --- Constants ---

DIMENSION_WEIGHTS = {
    "reasoning": 0.4,
    "insight": 0.4,
    "clarity": 0.2,
}

LABEL_SCORES = {
    "Strong": 100,
    "Moderate": 65,
    "Weak": 30,
}

TRUTH_CHECK_CONTEXT_TEMPLATE = """FACTUAL VERIFICATION SUMMARY:
The following claims from the responses were verified:

{claims_summary}

Consider this verification when evaluating reasoning quality. Responses with disputed claims may have lower reasoning scores.
"""

RANKING_PROMPT = """You are the Chairman of an LLM Council evaluating revised responses to the following question:

Question: {user_query}

{truth_check_context}Below are the revised responses from each council member. Rank all responses from best to worst using three dimensions:

- **Reasoning quality**: Logical soundness, evidence use, and argument structure. Disputed or inaccurate factual claims lower this score.
- **Insight**: Depth of understanding, novel perspectives, and going beyond obvious points.
- **Clarity**: Communication quality, organization, and accessibility to the reader.

Label each dimension as **Strong**, **Moderate**, or **Weak** for each response.

Rules:
- Rank ALL responses — never omit any.
- Never produce tied ranks — always pick a winner between comparable responses.
- Be decisive even when responses are close in quality.

Responses to rank:

{responses_text}

Respond with ONLY the final ranking section below — no preamble, no explanation:

FINAL RANKING:
1. Response X — Reasoning: [Strong/Moderate/Weak] | Insight: [Strong/Moderate/Weak] | Clarity: [Strong/Moderate/Weak]
2. Response Y — Reasoning: [Strong/Moderate/Weak] | Insight: [Strong/Moderate/Weak] | Clarity: [Strong/Moderate/Weak]
(continue for all responses)"""


# --- Truth-check context formatting ---

def format_truth_check_context(truth_check_results: Dict) -> str:
    """
    Format truth-check results into a context block for the ranking prompt.

    Args:
        truth_check_results: Output from stage4_truth_check(), or None

    Returns:
        Formatted context string (with trailing newline) if claims exist,
        otherwise empty string so the placeholder renders cleanly.
    """
    if not truth_check_results or not truth_check_results.get("checked"):
        return ""

    claims = truth_check_results.get("claims", [])

    # Only include Confirmed and Disputed claims (skip Unaddressed)
    relevant = [
        c for c in claims
        if c.get("verdict") in ("Confirmed", "Disputed")
    ]

    if not relevant:
        return ""

    # Cap at 5 claims to keep context length manageable
    relevant = relevant[:5]

    lines = []
    for c in relevant:
        claim_text = c.get("text", "")
        verdict = c.get("verdict", "")
        lines.append(f"- {claim_text} [{verdict}]")

    claims_summary = "\n".join(lines)
    return TRUTH_CHECK_CONTEXT_TEMPLATE.format(claims_summary=claims_summary) + "\n"


# --- Parsing ---

def parse_ranking_output(ranking_text: str, expected_count: int) -> List[Dict]:
    """
    Parse the FINAL RANKING section from the Chairman's response.

    Extracts each line with format:
        {rank}. Response {letter} — Reasoning: {label} | Insight: {label} | Clarity: {label}

    Args:
        ranking_text: Full text output from the Chairman model
        expected_count: Number of responses expected in the ranking

    Returns:
        List of dicts with keys: rank, response_label, reasoning, insight, clarity
        Missing or invalid labels default to "Moderate".
    """
    # Defensive: ensure string input
    if not isinstance(ranking_text, str):
        ranking_text = str(ranking_text) if ranking_text is not None else ""

    # Strip markdown bold markers that Chairman may include (e.g. **Response B** → Response B)
    ranking_text = re.sub(r'\*\*([^*]+)\*\*', r'\1', ranking_text)

    valid_labels = set(LABEL_SCORES.keys())

    def _safe_label(raw: str) -> str:
        """Normalize raw label string to valid label, defaulting to Moderate."""
        candidate = raw.strip().title()
        return candidate if candidate in valid_labels else "Moderate"

    results = []

    # Find the FINAL RANKING section
    header_match = re.search(r"FINAL\s*RANKING:", ranking_text, re.IGNORECASE)
    if header_match:
        section = ranking_text[header_match.end():]
    else:
        # No header found — try parsing the full text
        section = ranking_text

    # Match each ranked line. Handle em-dash (—), double-dash (--), or regular dash (-).
    # Pattern: {number}. Response {letter} [—|-|--] Reasoning: {label} | Insight: {label} | Clarity: {label}
    line_pattern = re.compile(
        r"(\d+)\.\s*Response\s+([A-Z])\s*(?:—|--|-)?\s*"
        r"Reasoning:\s*(Strong|Moderate|Weak)\s*\|?\s*"
        r"Insight:\s*(Strong|Moderate|Weak)\s*\|?\s*"
        r"Clarity:\s*(Strong|Moderate|Weak)",
        re.IGNORECASE
    )

    seen_labels = set()
    for match in line_pattern.finditer(section):
        rank = int(match.group(1))
        response_label = f"Response {match.group(2).upper()}"
        reasoning = _safe_label(match.group(3))
        insight = _safe_label(match.group(4))
        clarity = _safe_label(match.group(5))

        # Deduplicate by response label (keep first occurrence)
        if response_label in seen_labels:
            continue
        seen_labels.add(response_label)

        results.append({
            "rank": rank,
            "response_label": response_label,
            "reasoning": reasoning,
            "insight": insight,
            "clarity": clarity,
        })

    # Sort by rank ascending
    results.sort(key=lambda x: x["rank"])

    # Re-number sequentially if ranks are non-contiguous
    for i, entry in enumerate(results, start=1):
        entry["rank"] = i

    # Truncate to expected_count
    if expected_count and len(results) > expected_count:
        results = results[:expected_count]

    return results


# --- Score normalization ---

def normalize_scores(parsed_rankings: List[Dict]) -> List[Dict]:
    """
    Compute weighted scores from dimension labels and normalize so top = 100.

    For each entry:
        raw_score = (reasoning_score × 0.4) + (insight_score × 0.4) + (clarity_score × 0.2)

    Then:
        normalized_score = (raw_score / max_raw_score) × 100

    Args:
        parsed_rankings: Output of parse_ranking_output()

    Returns:
        Updated list with raw_score and normalized_score added to each entry,
        sorted by normalized_score descending.
    """
    if not parsed_rankings:
        return []

    # Compute raw scores
    for entry in parsed_rankings:
        r_score = LABEL_SCORES.get(entry["reasoning"], LABEL_SCORES["Moderate"])
        i_score = LABEL_SCORES.get(entry["insight"], LABEL_SCORES["Moderate"])
        c_score = LABEL_SCORES.get(entry["clarity"], LABEL_SCORES["Moderate"])

        raw = (
            r_score * DIMENSION_WEIGHTS["reasoning"]
            + i_score * DIMENSION_WEIGHTS["insight"]
            + c_score * DIMENSION_WEIGHTS["clarity"]
        )
        entry["raw_score"] = round(raw, 2)

    # Normalize to 100-point scale
    max_raw = max(e["raw_score"] for e in parsed_rankings)
    for entry in parsed_rankings:
        if max_raw > 0:
            entry["normalized_score"] = round((entry["raw_score"] / max_raw) * 100, 1)
        else:
            entry["normalized_score"] = 0.0

    # Sort by normalized_score descending
    parsed_rankings.sort(key=lambda x: x["normalized_score"], reverse=True)

    return parsed_rankings


# --- Summary builder ---

def _build_summary(rankings: List[Dict]) -> Dict:
    """
    Build a summary dict from the final rankings list for Phase 18 UI display.

    Args:
        rankings: List of ranking dicts with model, normalized_score, etc.

    Returns:
        Dict with top_model, top_score, score_range, total_ranked.
    """
    if not rankings:
        return {
            "top_model": None,
            "top_score": 0.0,
            "score_range": 0.0,
            "total_ranked": 0,
        }

    scores = [r["normalized_score"] for r in rankings]
    top = rankings[0]

    return {
        "top_model": top["model"],
        "top_score": top["normalized_score"],
        "score_range": round(max(scores) - min(scores), 1),
        "total_ranked": len(rankings),
    }


# --- Main Coordinator ---

async def stage4_chairman_rankings(
    revised_responses: List[Dict],
    settings,
    request=None,
    truth_check_results: Dict = None,
    user_query: str = ""
) -> Dict:
    """
    Run the Chairman Rankings stage: rank all revised responses in a single LLM call,
    then compute normalized multi-criteria scores.

    Args:
        revised_responses: List of {"model": str, "response": str} dicts from Stage 3
        settings: Settings object with chairman_model configured
        request: FastAPI request object for disconnect checks (optional)
        truth_check_results: Optional truth-check output from stage4_truth_check()

    Returns:
        Dict with keys:
            rankings: List of ranking dicts with model, rank, normalized_score, raw_score, dimensions
            checked: bool (True if rankings were successfully produced)
            model: chairman model ID used
        On failure:
            {"rankings": [], "checked": False, "reason": "error message"}
    """
    EMPTY_RESULT = {"rankings": [], "checked": False, "reason": "no_responses"}

    try:
        # Filter to successful responses only
        valid_responses = [r for r in revised_responses if r.get("response")]
        if not valid_responses:
            return EMPTY_RESULT

        chairman_model = getattr(settings, "chairman_model", None)
        if not chairman_model:
            logger.warning("No chairman model configured for rankings")
            return {**EMPTY_RESULT, "reason": "no_chairman_model"}

        # Build label-to-model mapping (A, B, C, ...)
        labels = [chr(65 + i) for i in range(len(valid_responses))]
        label_to_model = {
            f"Response {label}": r["model"]
            for label, r in zip(labels, valid_responses)
        }
        label_to_member_index = {
            f"Response {label}": r.get("member_index", i)
            for i, (label, r) in enumerate(zip(labels, valid_responses))
        }

        # Format responses text
        responses_text = "\n\n".join([
            f"Response {label}:\n{r['response']}"
            for label, r in zip(labels, valid_responses)
        ])

        # Format truth-check context block (optional)
        truth_check_context = format_truth_check_context(truth_check_results)

        # Build the user query from explicit param or default placeholder
        user_query = user_query or "the user's question"

        prompt = RANKING_PROMPT.format(
            user_query=user_query,
            truth_check_context=truth_check_context,
            responses_text=responses_text,
        )

        messages = [{"role": "user", "content": prompt}]

        # Query Chairman at low temperature for consistent ranking
        response = await query_model(chairman_model, messages, temperature=0.3)

        if response is None or response.get("error"):
            error_msg = response.get("error_message", "Unknown error") if response else "No response"
            logger.warning(f"Chairman rankings query failed: {error_msg}")
            return {**EMPTY_RESULT, "reason": error_msg}

        ranking_text = response.get("content", "") or ""
        if not isinstance(ranking_text, str):
            ranking_text = str(ranking_text)

        # Parse and normalize
        parsed = parse_ranking_output(ranking_text, expected_count=len(valid_responses))

        if not parsed:
            logger.warning("Failed to parse ranking output from Chairman")
            return {**EMPTY_RESULT, "reason": "parse_failure", "raw_output": ranking_text[:500]}

        scored = normalize_scores(parsed)

        # Build final output with model IDs mapped back from labels
        rankings = []
        for entry in scored:
            model_id = label_to_model.get(entry["response_label"], entry["response_label"])
            rankings.append({
                "model": model_id,
                "member_index": label_to_member_index.get(entry["response_label"], 0),
                "rank": entry["rank"],
                "normalized_score": entry["normalized_score"],
                "raw_score": entry["raw_score"],
                "dimensions": {
                    "reasoning": {
                        "label": entry["reasoning"],
                        "score": LABEL_SCORES.get(entry["reasoning"], LABEL_SCORES["Moderate"]),
                    },
                    "insight": {
                        "label": entry["insight"],
                        "score": LABEL_SCORES.get(entry["insight"], LABEL_SCORES["Moderate"]),
                    },
                    "clarity": {
                        "label": entry["clarity"],
                        "score": LABEL_SCORES.get(entry["clarity"], LABEL_SCORES["Moderate"]),
                    },
                },
            })

        return {
            "rankings": rankings,
            "checked": True,
            "model": chairman_model,
            "summary": _build_summary(rankings),
        }

    except Exception as e:
        logger.error(f"Chairman rankings failed: {e}")
        return {**EMPTY_RESULT, "reason": str(e)}
