from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    DEFAULT_ROLE_PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    permission_allowed,
    require_permission,
    set_permission_override,
)
from app.db.session import get_session
from app.models import PermissionOverride, User
from app.schemas.resources import PermissionUpdate

router = APIRouter(prefix="/permissions", tags=["Permission Manager"])


@router.get("/me")
async def effective_permissions(
    user: User = Depends(require_permission("permissions:read")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    permissions = []
    for key, description in PERMISSION_DESCRIPTIONS.items():
        if await permission_allowed(session, user.role, key):
            permissions.append({"permission": key, "description": description})
    return {"role": user.role, "permissions": permissions}


@router.get("/roles")
async def role_policy(
    user: User = Depends(require_permission("permissions:admin")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    del user
    overrides = (
        await session.scalars(select(PermissionOverride).order_by(PermissionOverride.role, PermissionOverride.permission))
    ).all()
    return {
        "defaults": {role: sorted(scopes) for role, scopes in DEFAULT_ROLE_PERMISSIONS.items()},
        "overrides": [
            {"role": row.role, "permission": row.permission, "allowed": row.allowed}
            for row in overrides
        ],
    }


@router.put("/roles/{role}/{permission:path}")
async def update_role_permission(
    role: str,
    permission: str,
    body: PermissionUpdate,
    user: User = Depends(require_permission("permissions:admin")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if role not in DEFAULT_ROLE_PERMISSIONS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if permission not in PERMISSION_DESCRIPTIONS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Permission not found")
    row = await set_permission_override(session, role, permission, body.allowed, user.id)
    await session.commit()
    return {"role": row.role, "permission": row.permission, "allowed": row.allowed}


@router.delete("/roles/{role}/{permission:path}", status_code=status.HTTP_204_NO_CONTENT)
async def reset_role_permission(
    role: str,
    permission: str,
    user: User = Depends(require_permission("permissions:admin")),
    session: AsyncSession = Depends(get_session),
):
    del user
    row = await session.scalar(
        select(PermissionOverride).where(
            PermissionOverride.role == role, PermissionOverride.permission == permission
        )
    )
    if row is not None:
        await session.delete(row)
        await session.commit()
    from fastapi import Response

    return Response(status_code=status.HTTP_204_NO_CONTENT)
