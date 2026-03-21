"""Preset storage and management."""

import json
from pathlib import Path
from typing import Dict, Any, Optional, List

# Preset file path
PRESETS_FILE = Path(__file__).parent.parent / "data" / "presets.json"


def get_presets() -> Dict[str, Any]:
    """Load all presets from file."""
    if PRESETS_FILE.exists():
        try:
            with open(PRESETS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_presets(presets: Dict[str, Any]) -> None:
    """Save presets to file."""
    PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PRESETS_FILE, "w") as f:
        json.dump(presets, f, indent=2)


def get_preset(name: str) -> Optional[Dict[str, Any]]:
    """Get a specific preset by name."""
    presets = get_presets()
    return presets.get(name)


def create_preset(name: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new preset. Raises ValueError if exists."""
    presets = get_presets()
    if name in presets:
        raise ValueError(f"Preset '{name}' already exists")
    presets[name] = config
    save_presets(presets)
    return {name: config}


def update_preset(name: str, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update existing preset. Returns None if not found."""
    presets = get_presets()
    if name not in presets:
        return None
    presets[name] = config
    save_presets(presets)
    return {name: config}


def delete_preset(name: str) -> bool:
    """Delete preset. Returns True if deleted."""
    presets = get_presets()
    if name in presets:
        del presets[name]
        save_presets(presets)
        return True
    return False


def export_presets(preset_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Export presets as a list of {name, config} objects.

    If preset_names is None or empty, export all presets.
    Otherwise, export only the named presets.
    """
    presets = get_presets()
    if not preset_names:
        return [{"name": name, "config": config} for name, config in presets.items()]
    return [
        {"name": name, "config": config}
        for name, config in presets.items()
        if name in preset_names
    ]


def import_presets(presets_data: List[Dict[str, Any]], conflict_mode: str) -> Dict[str, Any]:
    """Import a list of {name, config} preset objects.

    conflict_mode:
        'skip'      - skip presets that already exist
        'overwrite' - replace existing presets
        'rename'    - append (1), (2), etc. to make name unique

    Returns counts: {imported, skipped, renamed, errors}
    """
    existing_presets = get_presets()
    imported = 0
    skipped = 0
    renamed = 0
    errors = []

    for item in presets_data:
        try:
            name = item.get("name", "").strip()
            config = item.get("config", {})

            if not name:
                errors.append("Skipped item with empty name")
                continue

            if name in existing_presets:
                if conflict_mode == "skip":
                    skipped += 1
                    continue
                elif conflict_mode == "overwrite":
                    existing_presets[name] = config
                    imported += 1
                elif conflict_mode == "rename":
                    # Find a unique name by appending (1), (2), etc.
                    counter = 1
                    new_name = f"{name} ({counter})"
                    while new_name in existing_presets:
                        counter += 1
                        new_name = f"{name} ({counter})"
                    existing_presets[new_name] = config
                    imported += 1
                    renamed += 1
            else:
                existing_presets[name] = config
                imported += 1
        except Exception as e:
            errors.append(f"Error importing preset: {str(e)}")

    save_presets(existing_presets)
    return {"imported": imported, "skipped": skipped, "renamed": renamed, "errors": errors}
