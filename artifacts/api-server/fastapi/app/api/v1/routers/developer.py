from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    PERMISSION_DESCRIPTIONS,
    permission_allowed,
    require_permission,
)
from app.core.security import generate_developer_key
from app.db.session import get_session
from app.models import ApiKey, User
from app.schemas.resources import ApiKeyCreate, ApiKeyResponse

router = APIRouter(prefix="/developer/keys", tags=["Developer API"])

RESTRICTED_SCOPES = {
    "permissions:admin", "analytics:admin", "telemetry:admin",
    "plugins:admin", "*",
}


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(
    user: User = Depends(require_permission("developer_keys:manage")),
    session: AsyncSession = Depends(get_session),
) -> list[ApiKeyResponse]:
    rows = (
        await session.scalars(
            select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None))
            .order_by(desc(ApiKey.created_at))
        )
    ).all()
    return [
        ApiKeyResponse(
            id=row.id, name=row.name, prefix=row.prefix, scopes=row.scopes,
            expires_at=row.expires_at, created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("", response_model=ApiKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    request: Request,
    body: ApiKeyCreate,
    user: User = Depends(require_permission("developer_keys:manage")),
    session: AsyncSession = Depends(get_session),
) -> ApiKeyResponse:
    unknown = set(body.scopes) - set(PERMISSION_DESCRIPTIONS)
    restricted = set(body.scopes) & RESTRICTED_SCOPES
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown scopes: {', '.join(sorted(unknown))}")
    if restricted and user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can grant administrative API key scopes")
    credential_scopes = getattr(request.state, "api_key_scopes", None)
    if credential_scopes is not None and not set(body.scopes).issubset(set(credential_scopes)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "An API key cannot grant scopes it does not have")
    if user.role != "admin":
        for scope in body.scopes:
            if not await permission_allowed(session, user.role, scope):
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    f"You cannot grant the {scope} scope",
                )
    if body.expires_at and body.expires_at <= datetime.now(UTC):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "expires_at must be in the future")

    token, prefix, secret_hash = generate_developer_key()
    row = ApiKey(
        id=uuid4(),
        user_id=user.id,
        name=body.name,
        prefix=prefix,
        secret_hash=secret_hash,
        scopes=body.scopes,
        expires_at=body.expires_at,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return ApiKeyResponse(
        id=row.id, name=row.name, prefix=row.prefix, scopes=row.scopes,
        expires_at=row.expires_at, created_at=row.created_at, key=token,
    )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: UUID,
    user: User = Depends(require_permission("developer_keys:manage")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.scalar(select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
    row.revoked_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
