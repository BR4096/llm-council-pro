"""Invite-code authentication for LLM Council."""

import hashlib
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import jwt

# --- Constants ---

USERS_FILE = "data/users.json"
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 24 * 60 * 60  # 24 hours

# Word lists for readable invite codes
_ADJECTIVES = [
    "alpine", "bright", "coral", "dusty", "eager", "frosty", "golden",
    "hollow", "ivory", "jolly", "keen", "lunar", "mossy", "noble",
    "opal", "polar", "quiet", "rustic", "silver", "tidal",
]
_NOUNS = [
    "fox", "hawk", "owl", "bear", "deer", "wolf", "crane", "heron",
    "lynx", "raven", "seal", "swan", "trout", "viper", "wren",
    "bison", "cedar", "dune", "flint", "grove",
]


def _get_jwt_secret() -> str:
    """Get JWT secret from environment. Raises if not set."""
    secret = os.getenv("COUNCIL_JWT_SECRET")
    if not secret:
        raise RuntimeError(
            "COUNCIL_JWT_SECRET environment variable is required for authentication"
        )
    return secret


def _hash_code(code: str) -> str:
    """SHA-256 hash of an invite code."""
    return hashlib.sha256(code.encode()).hexdigest()


# --- Data I/O ---

def load_users() -> Dict[str, Any]:
    """Read data/users.json. Returns empty structure if missing."""
    path = Path(USERS_FILE)
    if not path.exists():
        return {"invite_codes": {}}
    with open(path, "r") as f:
        return json.load(f)


def save_users(data: Dict[str, Any]) -> None:
    """Write data/users.json."""
    path = Path(USERS_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# --- Invite Code Operations ---

def validate_invite_code(code: str) -> Optional[Dict[str, Any]]:
    """
    Validate an invite code. Returns the user record dict if valid and active,
    or None if invalid/revoked.
    Also updates last_used and use_count on success.
    """
    data = load_users()
    codes = data.get("invite_codes", {})
    record = codes.get(code)
    if record is None or not record.get("active", False):
        return None

    # Update usage stats
    record["last_used"] = datetime.now(timezone.utc).isoformat()
    record["use_count"] = record.get("use_count", 0) + 1
    save_users(data)

    return record


def create_invite_code(label: str, role: str = "user") -> str:
    """Create a new invite code with a readable format like 'alpine-fox-2026'."""
    data = load_users()
    codes = data.get("invite_codes", {})

    # Generate a unique code
    for _ in range(100):
        adj = random.choice(_ADJECTIVES)
        noun = random.choice(_NOUNS)
        year = datetime.now(timezone.utc).strftime("%Y")
        code = f"{adj}-{noun}-{year}"
        if code not in codes:
            break
    else:
        # Fallback: append random digits
        code = f"{adj}-{noun}-{year}-{random.randint(100, 999)}"

    codes[code] = {
        "label": label,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "role": role,
        "active": True,
        "last_used": None,
        "use_count": 0,
    }
    data["invite_codes"] = codes
    save_users(data)
    return code


def revoke_invite_code(code: str) -> bool:
    """Revoke an invite code. Returns True if found and revoked."""
    data = load_users()
    codes = data.get("invite_codes", {})
    if code not in codes:
        return False
    codes[code]["active"] = False
    save_users(data)
    return True


def list_invite_codes() -> List[Dict[str, Any]]:
    """List all invite codes with usage stats. Plaintext codes are excluded."""
    data = load_users()
    codes = data.get("invite_codes", {})
    result = []
    for code, record in codes.items():
        result.append({
            "code_hash": _hash_code(code),
            "code_prefix": code[:8] + "...",
            "label": record.get("label", ""),
            "role": record.get("role", "user"),
            "active": record.get("active", True),
            "created_at": record.get("created_at"),
            "last_used": record.get("last_used"),
            "use_count": record.get("use_count", 0),
        })
    return result


# --- JWT Operations ---

def create_jwt(role: str, label: str, code: str) -> str:
    """Create a JWT token with role, label, and hashed code."""
    now = int(time.time())
    payload = {
        "role": role,
        "label": label,
        "code_hash": _hash_code(code),
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> Optional[Dict[str, Any]]:
    """Verify a JWT token. Returns decoded payload or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token, _get_jwt_secret(), algorithms=[JWT_ALGORITHM]
        )
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


# --- Bootstrap ---

def bootstrap_admin():
    """
    On first startup, if COUNCIL_ADMIN_CODE is set and data/users.json
    doesn't exist, create it with that code as admin.
    """
    admin_code = os.getenv("COUNCIL_ADMIN_CODE")
    if not admin_code:
        return

    path = Path(USERS_FILE)
    if path.exists():
        return

    data = {
        "invite_codes": {
            admin_code: {
                "label": "Admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "role": "admin",
                "active": True,
                "last_used": None,
                "use_count": 0,
            }
        }
    }
    save_users(data)
