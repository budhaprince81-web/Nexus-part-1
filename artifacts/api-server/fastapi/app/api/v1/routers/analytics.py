from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import (
    AgentRun,
    CodingSession,
    MemoryEntry,
    Notification,
    ResearchRecord,
    Task,
    TelemetrySample,
    User,
)

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/overview")
async def personal_overview(
    days: int = Query(default=30, ge=1, le=365),
    user: User = Depends(require_permission("analytics:read")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    since = datetime.now(UTC) - timedelta(days=days)
    values = {}
    for label, model, predicate in (
        ("memories", MemoryEntry, MemoryEntry.created_at >= since),
        ("agent_runs", AgentRun, AgentRun.created_at >= since),
        ("research_runs", ResearchRecord, ResearchRecord.created_at >= since),
        ("coding_sessions", CodingSession, CodingSession.created_at >= since),
        ("tasks_created", Task, Task.created_at >= since),
        ("notifications", Notification, Notification.created_at >= since),
        ("telemetry_events", TelemetrySample, TelemetrySample.created_at >= since),
    ):
        count = await session.scalar(
            select(func.count()).select_from(model).where(model.user_id == user.id, predicate)
        )
        values[label] = int(count or 0)
    completed_tasks = await session.scalar(
        select(func.count(Task.id)).where(
            Task.user_id == user.id, Task.status == "completed", Task.created_at >= since
        )
    )
    values["tasks_completed"] = int(completed_tasks or 0)
    return {"period_days": days, "since": since, "totals": values}


@router.get("/admin")
async def administrator_overview(
    user: User = Depends(require_permission("analytics:admin")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    del user
    counts = {}
    for label, model in (
        ("users", User), ("agent_runs", AgentRun), ("memory_entries", MemoryEntry),
        ("tasks", Task), ("research_records", ResearchRecord), ("coding_sessions", CodingSession),
    ):
        count = await session.scalar(select(func.count()).select_from(model))
        counts[label] = int(count or 0)
    return {"captured_at": datetime.now(UTC), "totals": counts}
