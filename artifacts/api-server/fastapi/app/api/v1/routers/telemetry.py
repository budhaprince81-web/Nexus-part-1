from datetime import UTC, datetime
from uuid import uuid4

import psutil
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import AgentRun, AutomationAudit, MemoryEntry, Task, TelemetrySample, User
from app.schemas.resources import TelemetryEvent

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])


@router.post("/events", status_code=status.HTTP_202_ACCEPTED)
async def record_event(
    body: TelemetryEvent,
    user: User = Depends(require_permission("telemetry:write")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    session.add(
        TelemetrySample(
            id=uuid4(),
            user_id=user.id,
            event_name=body.event_name,
            properties=body.properties,
        )
    )
    await session.commit()
    return {"status": "accepted"}


@router.get("/events")
async def list_events(
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_permission("analytics:read")),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (
        await session.scalars(
            select(TelemetrySample)
            .where(TelemetrySample.user_id == user.id)
            .order_by(desc(TelemetrySample.created_at))
            .limit(limit)
        )
    ).all()
    return [
        {"id": str(row.id), "event_name": row.event_name, "properties": row.properties, "created_at": row.created_at}
        for row in rows
    ]


@router.get("/system")
async def system_telemetry(
    user: User = Depends(require_permission("telemetry:admin")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    del user
    agent_runs = await session.scalar(select(func.count(AgentRun.id)))
    memory_entries = await session.scalar(select(func.count(MemoryEntry.id)))
    tasks = await session.scalar(select(func.count(Task.id)))
    automation_operations = await session.scalar(select(func.count(AutomationAudit.id)))
    virtual = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "captured_at": datetime.now(UTC),
        "process": {
            "cpu_percent": psutil.cpu_percent(interval=None),
            "memory_rss_bytes": psutil.Process().memory_info().rss,
            "thread_count": psutil.Process().num_threads(),
        },
        "host": {
            "cpu_count": psutil.cpu_count(),
            "memory_total_bytes": virtual.total,
            "memory_available_bytes": virtual.available,
            "disk_total_bytes": disk.total,
            "disk_free_bytes": disk.free,
        },
        "database_counts": {
            "agent_runs": int(agent_runs or 0),
            "memory_entries": int(memory_entries or 0),
            "tasks": int(tasks or 0),
            "automation_operations": int(automation_operations or 0),
        },
    }
