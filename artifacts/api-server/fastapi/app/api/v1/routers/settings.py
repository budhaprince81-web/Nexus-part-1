import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import User, UserSetting
from app.schemas.resources import SettingsUpdate

router = APIRouter(prefix="/settings", tags=["Settings"])
SETTING_KEY = re.compile(r"^[a-z][a-z0-9_.-]{0,119}$")
PROTECTED_KEYS = {"role", "is_admin", "password", "password_hash", "api_key", "session_secret"}


@router.get("")
async def list_settings(
    user: User = Depends(require_permission("settings:read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, dict]:
    rows = (await session.scalars(select(UserSetting).where(UserSetting.user_id == user.id))).all()
    return {row.key: row.value for row in rows}


@router.put("/{key}")
async def set_setting(
    key: str,
    body: SettingsUpdate,
    user: User = Depends(require_permission("settings:write")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    normalized = key.lower()
    if not SETTING_KEY.fullmatch(normalized) or normalized in PROTECTED_KEYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or protected setting key")
    row = await session.scalar(
        select(UserSetting).where(UserSetting.user_id == user.id, UserSetting.key == normalized)
    )
    if row is None:
        row = UserSetting(id=uuid4(), user_id=user.id, key=normalized, value=body.value)
        session.add(row)
    else:
        row.value = body.value
    await session.commit()
    return {"key": normalized, "value": row.value}


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_setting(
    key: str,
    user: User = Depends(require_permission("settings:write")),
    session: AsyncSession = Depends(get_session),
):
    row = await session.scalar(
        select(UserSetting).where(UserSetting.user_id == user.id, UserSetting.key == key.lower())
    )
    if row is not None:
        await session.delete(row)
        await session.commit()
    from fastapi import Response

    return Response(status_code=status.HTTP_204_NO_CONTENT)
