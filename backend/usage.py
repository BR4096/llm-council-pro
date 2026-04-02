"""Usage tracking for LLM Council deliberations.

Appends JSONL records for usage and errors. Provides aggregation queries
for the admin dashboard.
"""

import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from collections import defaultdict

USAGE_FILE = Path(__file__).parent.parent / "data" / "usage.jsonl"
ERRORS_FILE = Path(__file__).parent.parent / "data" / "errors.jsonl"


def log_usage(record: dict):
    """Append a usage record to data/usage.jsonl."""
    USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(USAGE_FILE, "a") as f:
        f.write(json.dumps(record, default=str) + "\n")


def log_error(record: dict):
    """Append an error record to data/errors.jsonl."""
    ERRORS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ERRORS_FILE, "a") as f:
        f.write(json.dumps(record, default=str) + "\n")


def _read_jsonl(path: Path, limit: int = 0) -> List[dict]:
    """Read a JSONL file and return list of dicts, most recent first."""
    if not path.exists():
        return []
    records = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    records.reverse()  # most recent first
    if limit > 0:
        records = records[:limit]
    return records


def get_usage(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    role_id: Optional[str] = None,
    invite_label: Optional[str] = None,
    limit: int = 100,
) -> List[dict]:
    """Read usage records with optional filters. Returns list of dicts, most recent first."""
    records = _read_jsonl(USAGE_FILE)
    filtered = []
    for r in records:
        if date_from and r.get("timestamp", "") < date_from:
            continue
        if date_to and r.get("timestamp", "") > date_to:
            continue
        if role_id and r.get("role_id") != role_id:
            continue
        if invite_label and r.get("invite_label") != invite_label:
            continue
        filtered.append(r)
        if len(filtered) >= limit:
            break
    return filtered


def get_usage_by_role() -> List[dict]:
    """Aggregate usage counts and avg duration by role_id."""
    records = _read_jsonl(USAGE_FILE)
    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"count": 0, "total_duration_ms": 0})
    for r in records:
        role = r.get("role_id", "unknown")
        agg[role]["count"] += 1
        duration = r.get("duration_ms", {})
        if isinstance(duration, dict):
            agg[role]["total_duration_ms"] += duration.get("total", 0)
        elif isinstance(duration, (int, float)):
            agg[role]["total_duration_ms"] += duration
    result = []
    for role, data in agg.items():
        avg_ms = data["total_duration_ms"] / data["count"] if data["count"] else 0
        result.append({
            "role_id": role,
            "count": data["count"],
            "avg_duration_ms": round(avg_ms),
            "total_duration_ms": data["total_duration_ms"],
        })
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


def get_usage_by_user() -> List[dict]:
    """Aggregate usage counts by invite_label."""
    records = _read_jsonl(USAGE_FILE)
    agg: Dict[str, int] = defaultdict(int)
    for r in records:
        label = r.get("invite_label", "unknown")
        agg[label] += 1
    result = [{"invite_label": label, "count": count} for label, count in agg.items()]
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


def get_usage_by_model() -> List[dict]:
    """Aggregate token usage and error counts by model."""
    records = _read_jsonl(USAGE_FILE)
    errors = _read_jsonl(ERRORS_FILE)

    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "request_count": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "error_count": 0,
    })

    for r in records:
        token_usage = r.get("token_usage", {}) or {}
        for model, usage in token_usage.items():
            agg[model]["request_count"] += 1
            if usage:
                agg[model]["total_input_tokens"] += usage.get("input", 0) or 0
                agg[model]["total_output_tokens"] += usage.get("output", 0) or 0

    for e in errors:
        model = e.get("model", "unknown")
        agg[model]["error_count"] += 1

    result = []
    for model, data in agg.items():
        result.append({"model": model, **data})
    result.sort(key=lambda x: x["request_count"], reverse=True)
    return result


def get_errors(limit: int = 50) -> List[dict]:
    """Return recent errors, most recent first."""
    return _read_jsonl(ERRORS_FILE, limit=limit)


def get_health_status() -> dict:
    """Return provider health status based on recent errors and successes.

    Looks at the last 24h of usage + errors. For each provider returns:
    status (ok/degraded/error), last_success timestamp, last_error timestamp.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    records = _read_jsonl(USAGE_FILE)
    errors = _read_jsonl(ERRORS_FILE)

    # Track per-provider stats
    provider_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "success_count": 0,
        "error_count": 0,
        "last_success": None,
        "last_error": None,
    })

    for r in records:
        ts = r.get("timestamp", "")
        if ts < cutoff:
            continue
        models_used = r.get("models_used", [])
        stage_errors = r.get("errors", [])
        error_models = {e.get("model") for e in stage_errors} if stage_errors else set()
        for model in models_used:
            provider = model.split(":")[0] if ":" in model else model
            if model not in error_models:
                provider_stats[provider]["success_count"] += 1
                if not provider_stats[provider]["last_success"] or ts > provider_stats[provider]["last_success"]:
                    provider_stats[provider]["last_success"] = ts

    for e in errors:
        ts = e.get("timestamp", "")
        if ts < cutoff:
            continue
        model = e.get("model", "unknown")
        provider = model.split(":")[0] if ":" in model else model
        provider_stats[provider]["error_count"] += 1
        if not provider_stats[provider]["last_error"] or ts > provider_stats[provider]["last_error"]:
            provider_stats[provider]["last_error"] = ts

    # Determine status per provider
    result = {}
    for provider, stats in provider_stats.items():
        if stats["success_count"] == 0 and stats["error_count"] > 0:
            status = "error"
        elif stats["error_count"] > stats["success_count"] * 0.3:
            status = "degraded"
        else:
            status = "ok"
        result[provider] = {
            "status": status,
            "success_count_24h": stats["success_count"],
            "error_count_24h": stats["error_count"],
            "last_success": stats["last_success"],
            "last_error": stats["last_error"],
        }

    return {"providers": result, "checked_at": datetime.now(timezone.utc).isoformat()}
