from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import Notification, User
from app.schemas.resources import NotificationCreate, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/unread-count")
async def unread_count(
    user: User = Depends(require_permission("notifications:read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    count = await session.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id, Notification.read_at.is_(None)
        )
    )
    return {"unread": int(count or 0)}


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    user: User = Depends(require_permission("notifications:read")),
    session: AsyncSession = Depends(get_session),
) -> list[NotificationResponse]:
    statement = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    rows = (await session.scalars(statement.order_by(desc(Notification.created_at)).limit(limit))).all()
    return [
        NotificationResponse(
            id=row.id,
            kind=row.kind,
            title=row.title,
            message=row.message,
            read_at=row.read_at,
            metadata=row.metadata_json,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("", response_model=NotificationResponse, status_code=status.HTTP_201_CREATED)
async def create_notification(
    body: NotificationCreate,
    request: Request,
    user: User = Depends(require_permission("notifications:write")),
    session: AsyncSession = Depends(get_session),
) -> NotificationResponse:
    row = Notification(
        id=uuid4(),
        user_id=user.id,
        kind=body.kind,
        title=body.title,
        message=body.message,
        metadata_json=body.metadata,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    await request.app.state.redis.publish(
        f"nexus:user:{user.id}:events",
        __import__("json").dumps({"type": "notification", "id": str(row.id), "title": row.title}),
    )
    return NotificationResponse(
        id=row.id,
        kind=row.kind,
        title=row.title,
        message=row.message,
        read_at=row.read_at,
        metadata=row.metadata_json,
        created_at=row.created_at,
    )


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(
    notification_id: UUID,
    user: User = Depends(require_permission("notifications:write")),
    session: AsyncSession = Depends(get_session),
) -> NotificationResponse:
    row = await session.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id)
    )
    if row is None:
        from fastapi import HTTPException

        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    row.read_at = row.read_at or datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return NotificationResponse(
        id=row.id, kind=row.kind, title=row.title, message=row.message,
        read_at=row.read_at, metadata=row.metadata_json, created_at=row.created_at,
    )


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_notification(
    notification_id: UUID,
    user: User = Depends(require_permission("notifications:write")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id)
    )
    if row is not None:
        await session.delete(row)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_notifications(
    user: User = Depends(require_permission("notifications:write")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await session.execute(delete_notifications_statement(user.id))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def delete_notifications_statement(user_id: UUID):
    from sqlalchemy import delete

    return delete(Notification).where(Notification.user_id == user_id)
