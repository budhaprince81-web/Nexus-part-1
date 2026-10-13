from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)
    namespace: str = Field(default="default", min_length=1, max_length=120)
    tags: list[str] = Field(default_factory=list, max_length=40)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: UUID
    content: str
    namespace: str
    tags: list[str]
    metadata: dict[str, Any] = Field(validation_alias="metadata_json")
    score: float | None = None
    created_at: datetime


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    tags: list[str] = Field(default_factory=list, max_length=40)
    due_at: datetime | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    status: Literal["pending", "in_progress", "completed", "cancelled"] | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    tags: list[str] | None = Field(default=None, max_length=40)
    due_at: datetime | None = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    description: str | None
    status: str
    priority: str
    tags: list[str]
    due_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class NotificationCreate(BaseModel):
    kind: Literal["info", "success", "warning", "error", "system", "agent", "task"] = "info"
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: UUID
    kind: str
    title: str
    message: str
    read_at: datetime | None
    metadata: dict[str, Any] = Field(validation_alias="metadata_json")
    created_at: datetime


class AgentRequest(BaseModel):
    agent_name: Literal["planner", "reasoning", "coder", "research", "vision"] = "reasoning"
    prompt: str = Field(min_length=1, max_length=80_000)
    context: dict[str, Any] = Field(default_factory=dict)


class AgentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    agent_name: str
    prompt: str
    status: str
    output: str | None
    model: str
    tokens_in: int
    tokens_out: int
    created_at: datetime
    completed_at: datetime | None


class ResearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=20_000)
    depth: Literal["quick", "standard", "deep", "expert"] = "standard"
    language: Literal["en", "ne"] = "en"


class ResearchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    query: str
    depth: str
    summary: str
    result: dict[str, Any]
    created_at: datetime


class CodingRequest(BaseModel):
    requirement: str = Field(min_length=5, max_length=80_000)
    project_name: str = Field(default="nexus-project", min_length=1, max_length=160)
    language: str | None = Field(default=None, max_length=40)
    framework: str | None = Field(default=None, max_length=80)


class CodingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    requirement: str
    project_name: str
    files: list[dict[str, Any]]
    status: str
    summary: str
    created_at: datetime


class VisionRequest(BaseModel):
    image_base64: str = Field(min_length=32, max_length=12_000_000)
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"] = "image/jpeg"
    prompt: str = Field(default="Describe the image, extract visible text, and identify notable objects.", max_length=10_000)


class VoiceRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=20_000)
    locale: str = Field(default="en-US", min_length=2, max_length=16)


class VoiceResponse(BaseModel):
    id: UUID
    transcript: str
    response: str
    intent: str
    locale: str
    created_at: datetime


class AutomationRequest(BaseModel):
    operation: Literal["list", "read", "write", "mkdir", "delete", "move", "info"]
    path: str = Field(min_length=1, max_length=1024)
    content: str | None = Field(default=None, max_length=1_000_000)
    destination: str | None = Field(default=None, max_length=1024)


class AutomationResponse(BaseModel):
    operation: str
    path: str
    success: bool
    result: Any = None


class PluginCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    base_url: HttpUrl
    manifest: dict[str, Any] = Field(default_factory=dict)


class PluginResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str
    base_url: str
    enabled: bool
    manifest: dict[str, Any]
    created_at: datetime


class PluginInvokeRequest(BaseModel):
    action: str = Field(min_length=1, max_length=120)
    query: dict[str, str] = Field(default_factory=dict, max_length=30)
    body: dict[str, Any] | None = None


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(min_length=1, max_length=50)
    expires_at: datetime | None = None


class ApiKeyResponse(BaseModel):
    id: UUID
    name: str
    prefix: str
    scopes: list[str]
    expires_at: datetime | None
    created_at: datetime
    key: str | None = None


class SettingsUpdate(BaseModel):
    value: dict[str, Any]


class PermissionUpdate(BaseModel):
    allowed: bool


class TelemetryEvent(BaseModel):
    event_name: str = Field(min_length=1, max_length=120)
    properties: dict[str, Any] = Field(default_factory=dict)
