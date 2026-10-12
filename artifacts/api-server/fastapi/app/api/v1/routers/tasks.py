from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import Task, User
from app.schemas.resources import TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.get("/stats")
async def task_stats(
    user: User = Depends(require_permission("tasks:read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    rows = (
        await session.execute(
            select(Task.status, Task.priority, func.count(Task.id))
            .where(Task.user_id == user.id)
            .group_by(Task.status, Task.priority)
        )
    ).all()
    counts = {name: 0 for name in ("pending", "in_progress", "completed", "cancelled", "critical", "high", "overdue", "total")}
    now = datetime.now(UTC)
    due_overdue = await session.scalar(
        select(func.count(Task.id)).where(
            Task.user_id == user.id,
            Task.due_at < now,
            Task.status.not_in(["completed", "cancelled"]),
        )
    )
    for task_status, priority, count in rows:
        counts[task_status] = counts.get(task_status, 0) + count
        counts[priority] = counts.get(priority, 0) + count
        counts["total"] += count
    counts["overdue"] = int(due_overdue or 0)
    return counts


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    task_status: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(require_permission("tasks:read")),
    session: AsyncSession = Depends(get_session),
) -> list[TaskResponse]:
    statement = select(Task).where(Task.user_id == user.id)
    if task_status:
        statement = statement.where(Task.status == task_status)
    if priority:
        statement = statement.where(Task.priority == priority)
    if q:
        statement = statement.where(Task.title.ilike(f"%{q}%"))
    rows = (await session.scalars(statement.order_by(desc(Task.created_at)).limit(limit).offset(offset))).all()
    return [TaskResponse.model_validate(row) for row in rows]


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    user: User = Depends(require_permission("tasks:write")),
    session: AsyncSession = Depends(get_session),
) -> TaskResponse:
    row = Task(id=uuid4(), user_id=user.id, **body.model_dump())
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return TaskResponse.model_validate(row)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    user: User = Depends(require_permission("tasks:read")),
    session: AsyncSession = Depends(get_session),
) -> TaskResponse:
    row = await session.scalar(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return TaskResponse.model_validate(row)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    body: TaskUpdate,
    user: User = Depends(require_permission("tasks:write")),
    session: AsyncSession = Depends(get_session),
) -> TaskResponse:
    row = await session.scalar(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(row, key, value)
    if changes.get("status") == "completed":
        row.completed_at = datetime.now(UTC)
    elif changes.get("status") in {"pending", "in_progress", "cancelled"}:
        row.completed_at = None
    await session.commit()
    await session.refresh(row)
    return TaskResponse.model_validate(row)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: UUID,
    user: User = Depends(require_permission("tasks:delete")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.scalar(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    if row is not None:
        await session.delete(row)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
