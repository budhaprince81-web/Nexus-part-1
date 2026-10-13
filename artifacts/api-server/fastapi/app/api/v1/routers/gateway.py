from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.core.permissions import has_permission, require_permission
from app.db.session import get_session
from app.models import User
from app.services.gateway import get_gateway_manifest

router = APIRouter(prefix="/gateway", tags=["API Gateway"])


@router.get("/manifest")
async def api_manifest() -> dict:
    return {
        "name": "NEXUS API",
        "version": "1",
        "authentication": ["JWT access token", "scoped developer API key"],
        "modules": get_gateway_manifest(),
        "websocket": "/ws/events",
    }


@router.get("/health")
async def gateway_health(request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    await session.execute(text("SELECT 1"))
    await request.app.state.redis.ping()
    return {"status": "ready", "dependencies": {"postgres": "ok", "redis": "ok"}}


@router.post("/permissions/check")
async def check_permission(
    permission: str,
    request: Request,
    user: User = Depends(require_permission("permissions:read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    from app.core.permissions import PERMISSION_DESCRIPTIONS

    if permission not in PERMISSION_DESCRIPTIONS:
        return {"known": False, "allowed": False}
    allowed = await has_permission(
        session, user.role, permission, getattr(request.state, "api_key_scopes", None)
    )
    return {"known": True, "allowed": allowed}


@router.get("/identity")
async def gateway_identity(user: User = Depends(get_current_user)) -> dict:
    return {"id": str(user.id), "role": user.role, "active": user.is_active}
