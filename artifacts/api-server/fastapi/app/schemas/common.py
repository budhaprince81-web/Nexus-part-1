from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str


class Page(BaseModel):
    items: list[Any]
    limit: int = Field(ge=1, le=200)
    offset: int = Field(ge=0)
    total: int


class UserIdentity(ORMModel):
    id: UUID
    email: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime
