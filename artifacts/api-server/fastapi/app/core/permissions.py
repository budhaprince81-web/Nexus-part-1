from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.session import get_session
from app.models import PermissionOverride, User

DEFAULT_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "user": {
        "profile:read", "profile:write",
        "memory:read", "memory:write", "memory:delete",
        "agents:read", "agents:invoke",
        "voice:use", "vision:analyze",
        "automation:read", "automation:write", "automation:delete",
        "research:run", "coding:run", "coding:read",
        "tasks:read", "tasks:write", "tasks:delete",
        "notifications:read", "notifications:write",
        "plugins:read", "plugins:write", "plugins:invoke",
        "developer_keys:manage",
        "settings:read", "settings:write",
        "telemetry:write", "analytics:read",
        "permissions:read",
    },
    "admin": {"*"},
}

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    "profile:read": "Read the authenticated user's profile",
    "profile:write": "Update the authenticated user's profile",
    "memory:read": "Search and retrieve private memory",
    "memory:write": "Create private memory entries",
    "memory:delete": "Delete private memory entries",
    "agents:read": "Read agent runs and status",
    "agents:invoke": "Run NEXUS AI agents",
    "voice:use": "Interpret voice transcripts",
    "vision:analyze": "Analyze user-provided images",
    "automation:read": "List and inspect workspace files",
    "automation:write": "Write or create workspace files",
    "automation:delete": "Delete or move files inside the authenticated user's workspace",
    "research:run": "Run and read research jobs",
    "coding:run": "Generate code sessions",
    "coding:read": "Read generated coding sessions",
    "tasks:read": "Read personal tasks",
    "tasks:write": "Create and update personal tasks",
    "tasks:delete": "Delete personal tasks",
    "notifications:read": "Read personal notifications",
    "notifications:write": "Create, mark, and dismiss notifications",
    "plugins:read": "Read registered plugins",
    "plugins:write": "Register and configure plugins",
    "plugins:invoke": "Invoke an enabled plugin endpoint",
    "developer_keys:manage": "Create and revoke developer API keys",
    "settings:read": "Read personal settings",
    "settings:write": "Update personal settings",
    "telemetry:write": "Record telemetry events",
    "analytics:read": "Read personal usage analytics",
    "permissions:read": "Read effective permissions",
    "permissions:admin": "Change global role permission policy",
    "plugins:admin": "Manage other users' plugins",
    "analytics:admin": "Read cross-user analytics",
    "telemetry:admin": "Read system telemetry",
}


async def permission_allowed(
    session: AsyncSession,
    role: str,
    permission: str,
) -> bool:
    default = role == "admin" or permission in DEFAULT_ROLE_PERMISSIONS.get(role, set())
    override = await session.scalar(
        select(PermissionOverride).where(
            PermissionOverride.role == role,
            PermissionOverride.permission == permission,
        )
    )
    return override.allowed if override else default


async def has_permission(
    session: AsyncSession,
    role: str,
    permission: str,
    api_key_scopes: list[str] | None = None,
) -> bool:
    if (
        api_key_scopes is not None
        and permission not in api_key_scopes
        and "*" not in api_key_scopes
    ):
        return False
    return await permission_allowed(session, role, permission)


def require_permission(permission: str):
    async def dependency(
        request: Request,
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> User:
        api_key_scopes = getattr(request.state, "api_key_scopes", None)
        if not await has_permission(session, user.role, permission, api_key_scopes):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permission denied")
        return user
    return dependency


async def set_permission_override(
    session: AsyncSession,
    role: str,
    permission: str,
    allowed: bool,
    updated_by: UUID,
) -> PermissionOverride:
    row = await session.scalar(
        select(PermissionOverride).where(
            PermissionOverride.role == role,
            PermissionOverride.permission == permission,
        )
    )
    if row is None:
        row = PermissionOverride(id=uuid4(), role=role, permission=permission, allowed=allowed, updated_by=updated_by)
        session.add(row)
    else:
        row.allowed = allowed
        row.updated_by = updated_by
    await session.flush()
    return row
