"""Pydantic models for LLM Council Plus."""

from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from datetime import datetime


class CouncilConfig(BaseModel):
    """Snapshot of council configuration at time of first message."""
    council_models: List[str] = Field(default_factory=list)
    chairman_model: str = ""
    council_temperature: float = 0.5
    chairman_temperature: float = 0.4
    stage2_temperature: float = 0.3
    revision_temperature: float = 0.4
    execution_mode: str = "full"
    character_names: Optional[Dict[str, str]] = Field(default=None)
    member_prompts: Optional[Dict[str, str]] = Field(default=None)
    chairman_character_name: Optional[str] = None
    chairman_custom_prompt: Optional[str] = None
    stage1_prompt: str = ""
    stage2_prompt: str = ""
    stage5_prompt: str = ""
    revision_prompt: str = ""
    captured_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class DebateTurn(BaseModel):
    """A single turn in a debate."""
    role: str  # "primary_a", "primary_b", "commentator_1", "commentator_2", "commentator_3"
    name: str  # Display name (character name)
    model_id: str  # For reference
    text: str  # The debate content


class DebateIssue(BaseModel):
    """A debate issue with transcript and verdict."""
    idx: int  # 0, 1, 2
    title: str  # "Speed Demon vs Perfectionist: Velocity or robustness?"
    status: str = "pending"  # "pending", "running", "completed", "failed", "skipped", "timeout"
    participants: List[Dict] = Field(default_factory=list)  # [{"model_id": "...", "role": "primary_a", "name": "..."}]
    transcript: List[DebateTurn] = Field(default_factory=list)
    verdict: Optional[Dict] = None  # {"summary": "Speed wins 3-1", "winner": "primary_a"}
    meta: Dict = Field(default_factory=dict)  # {"duration_ms": 8000, "error": "..."}
