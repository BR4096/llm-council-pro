"""Rating storage and aggregation for LLM Council deliberations."""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import storage

DATA_DIR = Path("data")
RATINGS_FILE = DATA_DIR / "ratings.jsonl"


def _ensure_ratings_file():
    """Ensure the ratings JSONL file exists."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not RATINGS_FILE.exists():
        RATINGS_FILE.touch()


def save_rating(
    conversation_id: str,
    message_index: int,
    score: int,
    comment: Optional[str],
    role_id: str,
    invite_label: Optional[str],
) -> Dict[str, Any]:
    """
    Save a rating for a specific assistant message.

    Saves inline in the conversation JSON (adds "rating" field to the message)
    and appends to data/ratings.jsonl for fast aggregation.

    Args:
        conversation_id: The conversation UUID
        message_index: Index of the assistant message in conversation.messages
        score: Rating score (1-5)
        comment: Optional comment text
        role_id: User's auth role (admin/user)
        invite_label: User's invite label (e.g., "Client: Jane M.")

    Returns:
        The rating dict that was saved
    """
    rated_at = datetime.utcnow().isoformat() + "Z"

    rating = {
        "score": score,
        "comment": comment or "",
        "rated_at": rated_at,
        "role_id": role_id,
        "invite_label": invite_label or "",
    }

    # 1. Save inline in conversation JSON
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    messages = conversation.get("messages", [])
    if message_index < 0 or message_index >= len(messages):
        raise ValueError(f"Message index {message_index} out of range")

    messages[message_index]["rating"] = rating
    storage.save_conversation(conversation)

    # 2. Append to JSONL for fast aggregation
    _ensure_ratings_file()
    jsonl_record = {
        "conversation_id": conversation_id,
        "message_index": message_index,
        "score": score,
        "comment": comment or "",
        "rated_at": rated_at,
        "role_id": role_id,
        "invite_label": invite_label or "",
    }
    with open(RATINGS_FILE, "a") as f:
        f.write(json.dumps(jsonl_record) + "\n")

    return rating


def get_ratings(
    role_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Get ratings from the JSONL file with optional filters.

    Args:
        role_id: Filter by role_id
        date_from: ISO date string, inclusive lower bound
        date_to: ISO date string, inclusive upper bound
        limit: Max number of ratings to return

    Returns:
        List of rating dicts, most recent first
    """
    _ensure_ratings_file()

    ratings = []
    with open(RATINGS_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Apply filters
            if role_id and record.get("role_id") != role_id:
                continue
            if date_from and record.get("rated_at", "") < date_from:
                continue
            if date_to and record.get("rated_at", "") > date_to:
                continue

            ratings.append(record)

    # Sort by rated_at descending (most recent first)
    ratings.sort(key=lambda r: r.get("rated_at", ""), reverse=True)

    return ratings[:limit]


def get_ratings_summary() -> Dict[str, Any]:
    """
    Get aggregated rating statistics.

    Returns:
        Dict with avg_score, count, and by_role breakdown
    """
    _ensure_ratings_file()

    all_scores: List[int] = []
    by_role: Dict[str, List[int]] = {}

    with open(RATINGS_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue

            score = record.get("score")
            if score is None:
                continue

            all_scores.append(score)
            role = record.get("role_id", "unknown")
            by_role.setdefault(role, []).append(score)

    avg_score = round(sum(all_scores) / len(all_scores), 2) if all_scores else 0.0
    count = len(all_scores)

    role_summary = {}
    for role, scores in by_role.items():
        role_summary[role] = {
            "avg": round(sum(scores) / len(scores), 2) if scores else 0.0,
            "count": len(scores),
        }

    return {
        "avg_score": avg_score,
        "count": count,
        "by_role": role_summary,
    }
