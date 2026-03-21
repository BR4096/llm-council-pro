"""Truth-check stage for verifying factual claims in revised responses."""

from typing import List, Dict, Any, Optional
import asyncio
import json
import logging
import os
import httpx
from .council import query_model
from .settings import get_settings
from .json_utils import escape_invalid_json_escapes

logger = logging.getLogger(__name__)

# --- Prompts ---

EXTRACTION_PROMPT = """You are a fact-checker. Extract 3-5 specific, verifiable factual claims from the text below.

Include ONLY claims that are:
- Specific dates, numbers, or statistics ("X happened in 2023", "Y costs $50")
- Named entities with specific attributes ("Z won the 2024 election")
- Specific event outcomes ("The merger was approved by regulators")
- Attributed quotes with source and content

Exclude:
- Opinions and analysis ("This suggests...", "This approach is better")
- General knowledge that is universally known
- Reasoning steps or conclusions drawn from evidence

EXAMPLE:
Input text:
"The American Revolution ended with the Treaty of Paris in 1783.
Washington's army had approximately 17,000 soldiers at Yorktown.
Many historians believe this was the decisive moment of the war."

Expected output:
{{
  "claims": [
    {{
      "id": 0,
      "text": "The American Revolution ended with the Treaty of Paris in 1783",
      "source_response": "GPT-4",
      "source_sentence": "The American Revolution ended with the Treaty of Paris in 1783."
    }},
    {{
      "id": 1,
      "text": "Washington's army had approximately 17,000 soldiers at Yorktown",
      "source_response": "GPT-4",
      "source_sentence": "Washington's army had approximately 17,000 soldiers at Yorktown."
    }}
  ],
  "checked": true,
  "reason": "claims_found"
}}

Note: "Many historians believe this was the decisive moment of the war"
is excluded (opinion/analysis, not a specific factual claim).

If there are no checkable factual claims, return the empty result.

Text to analyze:
{responses_text}

Respond with ONLY this JSON, no other text:
{{
  "claims": [
    {{
      "id": 0,
      "text": "exact claim text",
      "source_response": "model name or index",
      "source_sentence": "original sentence containing the claim"
    }}
  ],
  "checked": true,
  "reason": "claims_found"
}}

If no checkable claims exist:
{{
  "claims": [],
  "checked": false,
  "reason": "no_checkable_claims"
}}"""

VERIFICATION_PROMPT = """You are a fact-checker. For each claim below, use the provided search evidence to classify whether the claim is supported, contradicted, or cannot be assessed.

Verdict definitions:
- Confirmed: The evidence explicitly supports the claim as stated
- Disputed: The evidence directly contradicts the claim
- Unverified: Evidence was found but does not address the claim, or no evidence found

For Disputed or Unverified claims, include a brief "reason" field (one sentence) explaining why.
Examples:
- Disputed: State the correct fact from the evidence (e.g., "Python 3.12 was released in 2023")
- Unverified: "No sources found mentioning this"

Claims:
{claims_json}

Search Evidence:
{evidence_text}

Respond with ONLY this JSON, no other text:
{{
  "verdicts": [
    {{
      "claim_id": 0,
      "verdict": "Confirmed",
      "source_url": "https://example.com/article"
    }},
    {{
      "claim_id": 1,
      "verdict": "Disputed",
      "reason": "Python 3.12 was released in 2023",
      "source_url": "https://example.com/article"
    }},
    {{
      "claim_id": 2,
      "verdict": "Unverified",
      "reason": "No sources found mentioning this",
      "source_url": ""
    }}
  ]
}}"""


# --- Helper Functions ---

def _parse_extraction(llm_response: str) -> List[Dict]:
    """Parse extraction JSON from LLM response. Returns [] on failure."""
    try:
        text = llm_response.strip()
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1] if len(parts) > 1 else parts[0]
            if text.startswith("json"):
                text = text[4:]
        text = escape_invalid_json_escapes(text)
        data = json.loads(text)
        claims = data.get("claims") or []
        return claims if isinstance(claims, list) else []
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(f"Failed to parse extraction: {e}")
        return []


def parse_verdicts(llm_response: str, num_claims: int) -> List[Dict]:
    """Parse verdict JSON from LLM response. Never raises, returns defaults for failed claims."""
    default_verdict = {"verdict": "Unverified", "source_url": "", "reason": ""}
    try:
        text = llm_response.strip()
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1] if len(parts) > 1 else parts[0]
            if text.startswith("json"):
                text = text[4:]
        text = escape_invalid_json_escapes(text)
        data = json.loads(text)
        verdicts = data.get("verdicts", [])
        result = []
        for i in range(num_claims):
            v = next((v for v in verdicts if v.get("claim_id") == i), None)
            if v and v.get("verdict") in ("Confirmed", "Disputed", "Unaddressed", "Unverified"):
                # Map legacy "Unaddressed" to "Unverified"
                verdict = v["verdict"]
                if verdict == "Unaddressed":
                    verdict = "Unverified"
                result.append({
                    "verdict": verdict,
                    "source_url": v.get("source_url", ""),
                    "reason": v.get("reason", "")
                })
            else:
                result.append(default_verdict.copy())
        return result
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(f"Failed to parse verdicts: {e}")
        return [default_verdict.copy() for _ in range(num_claims)]


async def _search_duckduckgo_structured(query: str) -> Dict:
    """Search DuckDuckGo for a single query, return structured result."""
    try:
        from ddgs import DDGS
        def _run():
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=1))
                if results:
                    r = results[0]
                    return {
                        "url": r.get("url", r.get("href", "")),
                        "title": r.get("title", ""),
                        "snippet": r.get("body", r.get("excerpt", ""))
                    }
                return {}
        return await asyncio.to_thread(_run)
    except Exception as e:
        logger.warning(f"DuckDuckGo search failed for '{query[:50]}': {e}")
        return {}


async def _search_tavily_structured(query: str, api_key: str) -> Dict:
    """Search Tavily for a single query, return structured result."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": api_key, "query": query, "max_results": 1, "include_answer": False}
            )
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            if results:
                r = results[0]
                return {"url": r.get("url", ""), "title": r.get("title", ""), "snippet": r.get("content", "")}
        return {}
    except Exception as e:
        logger.warning(f"Tavily search failed for '{query[:50]}': {e}")
        return {}


async def _search_brave_structured(query: str, api_key: str) -> Dict:
    """Search Brave for a single query, return structured result."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": 1},
                headers={"Accept": "application/json", "X-Subscription-Token": api_key}
            )
            response.raise_for_status()
            data = response.json()
            results = data.get("web", {}).get("results", [])
            if results:
                r = results[0]
                return {"url": r.get("url", ""), "title": r.get("title", ""), "snippet": r.get("description", "")}
        return {}
    except Exception as e:
        logger.warning(f"Brave search failed for '{query[:50]}': {e}")
        return {}


async def _search_single_claim(claim_text: str, provider: str, settings) -> Dict:
    """Search for a single claim using the specified provider."""
    if provider == "tavily":
        api_key = getattr(settings, 'tavily_api_key', None) or os.environ.get("TAVILY_API_KEY", "")
        return await _search_tavily_structured(claim_text, api_key)
    elif provider == "brave":
        api_key = getattr(settings, 'brave_api_key', None) or os.environ.get("BRAVE_API_KEY", "")
        return await _search_brave_structured(claim_text, api_key)
    else:
        return await _search_duckduckgo_structured(claim_text)


async def _search_claims_sequential_ddg(claims: List[Dict]) -> List[Dict]:
    """Search claims sequentially for DuckDuckGo (rate-limit mitigation). Cap at 3 claims."""
    results = []
    for claim in claims[:3]:
        result = await _search_duckduckgo_structured(claim["text"])
        results.append(result)
        await asyncio.sleep(1.0)
    # Pad to match original claims length
    while len(results) < len(claims):
        results.append({})
    return results


async def _search_claims_sequential_brave(claims: List[Dict], settings) -> List[Dict]:
    """Search claims sequentially for Brave (rate-limit mitigation: ~1 req/sec). Cap at 6 claims."""
    api_key = getattr(settings, 'brave_api_key', None) or os.environ.get("BRAVE_API_KEY", "")
    results = []
    for claim in claims[:6]:
        result = await _search_brave_structured(claim["text"], api_key)
        results.append(result)
        await asyncio.sleep(1.1)
    # Pad to match original claims length
    while len(results) < len(claims):
        results.append({})
    return results


async def _search_claims_parallel(claims: List[Dict], provider: str, settings) -> List[Dict]:
    """Search claims in parallel for Tavily (and other non-rate-limited providers)."""
    tasks = [_search_single_claim(claim["text"], provider, settings) for claim in claims]
    try:
        raw = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=20.0)
        return [r if isinstance(r, dict) else {} for r in raw]
    except asyncio.TimeoutError:
        logger.warning("Parallel search timed out")
        return [{} for _ in claims]


def _format_evidence(claims: List[Dict], search_results: List[Dict]) -> str:
    """Format search evidence for verification prompt."""
    lines = []
    for i, claim in enumerate(claims):
        lines.append(f"Claim {i}: {claim['text']}")
        search = search_results[i] if i < len(search_results) else {}
        if search.get("snippet"):
            lines.append(f"Evidence (snippet): {search['snippet']}")
        else:
            lines.append("Evidence: No relevant source found")
        lines.append("")
    return "\n".join(lines)


# --- Main Coordinator ---

async def stage4_truth_check(
    revised_responses: List[Dict],
    settings,
    request=None
) -> Dict:
    """
    Run the two-pass truth-check:
      1. Extract 3-5 checkable claims via fast LLM
      2. Search for one source per claim (parallel or sequential based on provider)
      3. Verify all claims in one LLM call using search snippets as evidence

    Returns structured dict with claims + verdicts.
    Gracefully degrades: returns {"claims": [], "checked": False, ...} on failure.
    """
    EMPTY_RESULT = {"claims": [], "checked": False, "reason": "no_checkable_claims"}

    try:
        # --- Pass 1: Extract claims ---
        responses_text = "\n\n".join([
            f"[{r.get('model', 'Unknown')}]: {r.get('response', '')}"
            for r in revised_responses
            if r.get('response')
        ])
        if not responses_text.strip():
            return EMPTY_RESULT

        extraction_model = getattr(settings, 'chairman_model', None)
        if not extraction_model:
            logger.warning("No chairman model configured for truth-check")
            return EMPTY_RESULT

        extraction_result = await query_model(
            extraction_model,
            [{"role": "user", "content": EXTRACTION_PROMPT.format(responses_text=responses_text)}],
            temperature=0.1
        )

        extraction_text = extraction_result.get("content", "") or ""
        claims = _parse_extraction(extraction_text)

        if not claims:
            return EMPTY_RESULT

        # --- Pass 2: Search for evidence ---
        provider = getattr(settings, 'truth_check_provider', settings.search_provider)

        if provider == "duckduckgo":
            search_results = await _search_claims_sequential_ddg(claims)
        elif provider == "brave":
            search_results = await _search_claims_sequential_brave(claims, settings)
        else:
            search_results = await _search_claims_parallel(claims, provider, settings)

        # --- Pass 3: Verify all claims in one LLM call ---
        evidence_text = _format_evidence(claims, search_results)
        claims_json = json.dumps(claims, indent=2)

        verification_result = await query_model(
            extraction_model,
            [{"role": "user", "content": VERIFICATION_PROMPT.format(
                claims_json=claims_json,
                evidence_text=evidence_text
            )}],
            temperature=0.0
        )

        verdicts = parse_verdicts(
            verification_result.get("content", "") or "",
            len(claims)
        )

        # Assemble final result
        final_claims = []
        for i, claim in enumerate(claims):
            v = verdicts[i] if i < len(verdicts) else {"verdict": "Unverified", "source_url": "", "reason": ""}
            search = search_results[i] if i < len(search_results) else {}
            final_claims.append({
                "id": claim.get("id", i),
                "text": claim["text"],
                "source_response": claim.get("source_response", ""),
                "source_sentence": claim.get("source_sentence", ""),
                "verdict": v["verdict"],
                "source_url": v.get("source_url") or (search.get("url", "") if isinstance(search, dict) else ""),
                "reason": v.get("reason", "")
            })

        confirmed = sum(1 for c in final_claims if c["verdict"] == "Confirmed")
        disputed = sum(1 for c in final_claims if c["verdict"] == "Disputed")
        unverified = sum(1 for c in final_claims if c["verdict"] == "Unverified")

        return {
            "claims": final_claims,
            "checked": True,
            "summary": {
                "confirmed": confirmed,
                "disputed": disputed,
                "unverified": unverified,
                "total": len(final_claims)
            }
        }

    except Exception as e:
        logger.error(f"Truth-check failed: {e}")
        return {**EMPTY_RESULT, "error": str(e)}
