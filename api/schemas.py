from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., description="User's natural language message")
    session_id: str = Field(default="default", description="Conversation session identifier")
    conn_name: str = Field(default="default", description="Target DB connection name")


class ConfirmExecuteRequest(BaseModel):
    """Execute a SQL statement that was previously blocked by RBAC's
    `needs_confirmation` gate, after the user explicitly approved it."""
    sql: str = Field(..., min_length=1, max_length=20_000)
    session_id: str = Field(default="default")
    conn_name: str = Field(default="default")


class RefineSqlRequest(BaseModel):
    """Run a user-edited SQL (typically a corrected version of what the LLM
    produced) directly against the DB without re-invoking the agent."""
    sql: str = Field(..., min_length=1, max_length=20_000)
    session_id: str = Field(default="default")
    conn_name: str = Field(default="default")
    note: str = Field(default="", max_length=500,
                      description="Optional user note recorded with the turn.")


class RegenerateRequest(BaseModel):
    """Re-run the agent on the most recent user message in a session."""
    session_id: str = Field(..., min_length=1)
    conn_name: str = Field(default="default")


class ExportRequest(BaseModel):
    """POST variant of /export — avoids URL length limits for long queries."""
    sql: str = Field(..., min_length=1, max_length=50_000)
    conn_name: str = Field(default="default")
    filename: str = Field(default="export", max_length=64)
    sheet_name: str = Field(default="Sheet1", max_length=31)


class ThoughtStep(BaseModel):
    thought: str = ""
    action: str = ""
    action_input: str = ""
    observation: str = ""


class ChatResponse(BaseModel):
    answer: str
    session_id: str
    steps: list[ThoughtStep] = Field(default_factory=list)
    tokens_used: int = 0
    followup_questions: list[str] = Field(default_factory=list)


class RefineResponse(BaseModel):
    ok: bool = True
    answer: str
    rows: list[dict] = Field(default_factory=list)
    row_count: int = 0
    warnings: list[str] = Field(default_factory=list)


class ConfirmExecuteResponse(BaseModel):
    ok: bool = True
    verb: str
    affected_rows: int = 0
    answer: str


class TemplateCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    prompt: str = Field(..., min_length=1, max_length=4000)
    category: str = Field(default="自訂", max_length=64)
    icon: str = Field(default="📌", max_length=16)
    description: str = Field(default="", max_length=1000)
    roles: str = Field(default="*", max_length=256,
                       description="Comma-separated role names, or '*' for all.")
    metric_ids: list[str] = Field(default_factory=list)
    query_plan: dict[str, Any] | None = None
    chart_config: dict[str, Any] | None = None
    is_public: bool = True


class TemplateUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=256)
    prompt: Optional[str] = Field(default=None, max_length=4000)
    category: Optional[str] = Field(default=None, max_length=64)
    icon: Optional[str] = Field(default=None, max_length=16)
    description: Optional[str] = Field(default=None, max_length=1000)
    roles: Optional[str] = Field(default=None, max_length=256)
    metric_ids: Optional[list[str]] = None
    query_plan: Optional[dict[str, Any]] = None
    chart_config: Optional[dict[str, Any]] = None
    is_public: Optional[bool] = None
    is_active: Optional[bool] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    connections: list[str]
    first_run_pending: bool = False


# ── Session / Memory schemas ──────────────────────────────────────────────────

class MessageItem(BaseModel):
    role: str           # "user" | "assistant"
    content: str


class SessionInfo(BaseModel):
    session_id: str
    message_count: int
    turn_count: int
    last_active: Optional[str] = None
    title: str = ""
    summary: str = ""
    owner_user_id: Optional[int] = None
    pinned: bool = False
    archived: bool = False


class SessionDetail(BaseModel):
    session_id: str
    message_count: int
    turn_count: int
    title: str = ""
    summary: str = ""
    entities: list[str] = Field(default_factory=list)
    messages: list[MessageItem] = Field(default_factory=list)
    owner_user_id: Optional[int] = None
    pinned: bool = False
    archived: bool = False


class SessionListResponse(BaseModel):
    sessions: list[SessionInfo] = Field(default_factory=list)


class SessionRenameRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
