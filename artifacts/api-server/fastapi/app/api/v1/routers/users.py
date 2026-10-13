from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import User
from app.schemas.auth import UpdateUserRequest, UserResponse
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserResponse)
async def read_profile(user: User = Depends(require_permission("profile:read"))) -> UserResponse:
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateUserRequest,
    user: User = Depends(require_permission("profile:write")),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    await session.commit()
    await session.refresh(user)
    return UserResponse.model_validate(user)


@router.delete("/me", response_model=MessageResponse)
async def deactivate_account(
    user: User = Depends(require_permission("profile:write")),
    session: AsyncSession = Depends(get_session),
) -> MessageResponse:
    user.is_active = False
    await session.commit()
    return MessageResponse(message="Account deactivated; active access tokens will expire within 15 minutes")
