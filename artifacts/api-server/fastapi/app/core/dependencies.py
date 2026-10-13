import hmac
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import InvalidTokenError, decode_token, hash_secret, token_subject_uuid
from app.db.session import get_session
from app.models import ApiKey, User

bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token or a scoped NEXUS API key")


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Valid authentication credentials are required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    token = credentials.credentials
    if token.startswith("nxs_"):
        prefix = token.split(".", 1)[0]
        api_key = await session.scalar(select(ApiKey).where(ApiKey.prefix == prefix))
        if (
            api_key is None
            or api_key.revoked_at is not None
            or (api_key.expires_at is not None and api_key.expires_at <= datetime.now(UTC))
            or not hmac.compare_digest(api_key.secret_hash, hash_secret(token))
        ):
            raise unauthorized
        user = await session.get(User, api_key.user_id)
        if user is None or not user.is_active:
            raise unauthorized
        api_key.last_used_at = datetime.now(UTC)
        request.state.api_key_scopes = api_key.scopes
        request.state.user_id = str(user.id)
        return user

    try:
        payload = decode_token(token, "access")
        user_id = token_subject_uuid(payload)
    except InvalidTokenError as exc:
        raise unauthorized from exc
    if await request.app.state.redis.get(f"nexus:revoked-access:{payload['jti']}"):
        raise unauthorized
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    request.state.api_key_scopes = None
    request.state.user_id = str(user.id)
    return user
