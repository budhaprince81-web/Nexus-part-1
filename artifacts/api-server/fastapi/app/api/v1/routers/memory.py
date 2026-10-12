from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import MemoryEntry, User
from app.schemas.resources import MemoryCreate, MemoryResponse
from app.services.embeddings import embed_passages, embed_query

router = APIRouter(prefix="/memory", tags=["Memory"])


def serialize_memory(row: MemoryEntry, score: float | None = None) -> MemoryResponse:
    return MemoryResponse(
        id=row.id,
        content=row.content,
        namespace=row.namespace,
        tags=row.tags,
        metadata=row.metadata_json,
        score=score,
        created_at=row.created_at,
    )


@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
async def store_memory(
    body: MemoryCreate,
    user: User = Depends(require_permission("memory:write")),
    session: AsyncSession = Depends(get_session),
) -> MemoryResponse:
    vector = (await embed_passages([body.content]))[0]
    row = MemoryEntry(
        id=uuid4(),
        user_id=user.id,
        namespace=body.namespace,
        content=body.content,
        tags=body.tags,
        metadata_json=body.metadata,
        embedding=vector,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_memory(row)


@router.get("", response_model=list[MemoryResponse])
async def search_memory(
    q: str = Query(min_length=1, max_length=2000),
    namespace: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=10, ge=1, le=50),
    user: User = Depends(require_permission("memory:read")),
    session: AsyncSession = Depends(get_session),
) -> list[MemoryResponse]:
    vector = await embed_query(q)
    distance = MemoryEntry.embedding.cosine_distance(vector).label("distance")
    statement = select(MemoryEntry, distance).where(MemoryEntry.user_id == user.id)
    if namespace:
        statement = statement.where(MemoryEntry.namespace == namespace)
    rows = (await session.execute(statement.order_by(distance).limit(limit))).all()
    return [serialize_memory(row, max(0.0, 1.0 - float(distance_value))) for row, distance_value in rows]


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    entry_id: UUID,
    user: User = Depends(require_permission("memory:delete")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.scalar(
        select(MemoryEntry).where(MemoryEntry.id == entry_id, MemoryEntry.user_id == user.id)
    )
    if row:
        await session.delete(row)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats")
async def memory_stats(
    user: User = Depends(require_permission("memory:read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    total = await session.scalar(
        select(func.count()).select_from(MemoryEntry).where(MemoryEntry.user_id == user.id)
    )
    return {"total": int(total or 0)}
