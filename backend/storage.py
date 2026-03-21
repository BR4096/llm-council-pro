"""JSON-based storage for conversations."""

import json
import os
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def validate_conversation_id(conversation_id: str) -> str:
    """
    Validate that conversation_id is a valid UUID.

    Raises ValueError if invalid, preventing path traversal attacks.
    Returns the validated UUID string.
    """
    try:
        return str(uuid.UUID(conversation_id))
    except ValueError:
        raise ValueError(f"Invalid conversation ID: {conversation_id}")


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    validated_id = validate_conversation_id(conversation_id)
    return os.path.join(DATA_DIR, f"{validated_id}.json")


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": []
    }

    # Save to file
    path = get_conversation_path(conversation_id)
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, 'r') as f:
        return json.load(f)


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation['id'])
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            with open(path, 'r') as f:
                data = json.load(f)
                # Return metadata only
                conversations.append({
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"])
                })

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "content": content
    })

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: Optional[List[Dict[str, Any]]] = None,
    stage3: Optional[List[Dict[str, Any]]] = None,
    stage5: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    stage4: Optional[Dict[str, Any]] = None,
):
    """
    Add an assistant message to a conversation.

    Supports partial execution modes where stage2, stage3, stage4, and/or stage5 may be None.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses (always present)
        stage2: List of model rankings (None if execution_mode was 'chat_only')
        stage3: List of revision responses (None if execution_mode was 'chat_only' or 'chat_ranking')
        stage5: Final synthesized response (None if execution_mode was not 'full')
        metadata: Optional metadata including execution_mode, label_to_model, etc.
        stage4: Dict with truth_check, rankings, highlights, score sub-dicts
                (None if full mode did not complete Stage 4)
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "stage1": stage1,
    }

    # Only include stage2, stage3, stage4, and stage5 if they were executed
    if stage2 is not None:
        message["stage2"] = stage2
    if stage3 is not None:
        message["stage3"] = stage3
    if stage4 is not None:
        message["stage4"] = stage4
    if stage5 is not None:
        message["stage5"] = stage5

    if metadata:
        message["metadata"] = metadata

    conversation["messages"].append(message)

    save_conversation(conversation)


def add_error_message(conversation_id: str, error_text: str):
    """
    Add an error message to a conversation to record a failed turn.

    Args:
        conversation_id: Conversation identifier
        error_text: The error description
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "content": None,
        "error": error_text,
        "stage1": [],
        "stage2": [],
        "stage3": None
    }

    conversation["messages"].append(message)
    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


def delete_conversation(conversation_id: str) -> bool:
    """
    Delete a conversation.

    Args:
        conversation_id: Conversation identifier

    Returns:
        True if deleted, False if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return False

    os.remove(path)
    return True


def delete_all_conversations() -> int:
    """
    Delete all conversations.

    Returns:
        Number of conversations deleted
    """
    ensure_data_dir()

    count = 0
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            os.remove(path)
            count += 1

    return count


def get_all_conversations_full() -> List[Dict[str, Any]]:
    """
    Get all conversations with full content (for export).

    Returns:
        List of full conversation dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            with open(path, 'r') as f:
                data = json.load(f)
                conversations.append(data)

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return conversations


def delete_conversations_by_ids(conversation_ids: List[str]) -> Dict[str, Any]:
    """
    Delete multiple conversations by their IDs.

    Args:
        conversation_ids: List of conversation IDs to delete

    Returns:
        Dict with 'deleted' count and 'not_found' list
    """
    deleted = 0
    not_found = []

    for conv_id in conversation_ids:
        path = get_conversation_path(conv_id)
        if os.path.exists(path):
            os.remove(path)
            deleted += 1
        else:
            not_found.append(conv_id)

    return {"deleted": deleted, "not_found": not_found}


def update_last_message_stage5(conversation_id: str, stage5: Optional[Dict[str, Any]]):
    """
    Add stage5 data to the last assistant message.

    Called after Stage 5 completes when an early partial save was done before Stage 5 started.
    Only updates the stage5 field — never touches debates[], gateway_issues, or other fields.
    """
    if stage5 is None:
        return
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return
    messages = conversation.get("messages", [])
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant":
            messages[i]["stage5"] = stage5
            save_conversation(conversation)
            return


def save_council_config(conversation_id: str, config: dict):
    """Save council config snapshot to a conversation."""
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    conversation["council_config"] = config
    save_conversation(conversation)


def get_council_config(conversation_id: str) -> Optional[dict]:
    """Get council config snapshot from a conversation, or None if not set."""
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None
    return conversation.get("council_config")
