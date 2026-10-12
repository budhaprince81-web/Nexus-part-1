import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.core.security import (
    InvalidTokenError,
    create_token,
    decode_token,
    hash_password,
    hash_secret,
    token_subject_uuid,
    verify_password,
)
from app.db.session import get_session
from app.models import RefreshSession, User
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
optional_bearer = HTTPBearer(auto_error=False)


async def _issue_session(
    user: User,
    session: AsyncSession,
    redis,
) -> TokenResponse:
    access_token, _ = create_token(str(user.id), "access", roles=[user.role])
    refresh_token, refresh_jti = create_token(str(user.id), "refresh")
    expires_at = datetime.now(UTC) + timedelta(days=settings.jwt_refresh_days)
    jti_hash = hash_secret(refresh_jti)
    session.add(
        RefreshSession(id=uuid4(), user_id=user.id, jti_hash=jti_hash, expires_at=expires_at)
    )
    await session.flush()
    await redis.set(f"nexus:refresh:{jti_hash}", str(user.id), ex=settings.jwt_refresh_days * 86400)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.jwt_access_minutes * 60,
        user=UserResponse.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    email = str(body.email).lower()
    exists = await session.scalar(select(User.id).where(User.email == email))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(
        id=uuid4(),
        email=email,
        display_name=body.display_name.strip(),
        password_hash=await asyncio.to_thread(hash_password, body.password),
        role="user",
    )
    session.add(user)
    await session.flush()
    response = await _issue_session(user, session, request.app.state.redis)
    await session.commit()
    return response


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    email = str(body.email).lower()
    ip = request.client.host if request.client else "unknown"
    attempts_key = f"nexus:login-attempts:{ip}:{hash_secret(email)}"
    attempts = await request.app.state.redis.incr(attempts_key)
    if attempts == 1:
        await request.app.state.redis.expire(attempts_key, 300)
    if attempts > settings.login_rate_limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts; try again later")

    user = await session.scalar(select(User).where(User.email == email))
    password_matches = (
        await asyncio.to_thread(verify_password, body.password, user.password_hash)
        if user is not None
        else False
    )
    if user is None or not user.is_active or not password_matches:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user.last_login_at = datetime.now(UTC)
    response = await _issue_session(user, session, request.app.state.redis)
    await session.commit()
    await request.app.state.redis.delete(attempts_key)
    return response


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token, "refresh")
        user_id = token_subject_uuid(payload)
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token") from exc

    jti_hash = hash_secret(payload["jti"])
    redis = request.app.state.redis
    # GETDEL makes refresh rotation single-use across concurrent requests.
    redis_user_id = await redis.getdel(f"nexus:refresh:{jti_hash}")
    if redis_user_id != str(user_id):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token has already been used or revoked")
    old_session = await session.scalar(
        select(RefreshSession).where(
            RefreshSession.jti_hash == jti_hash,
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > datetime.now(UTC),
        )
    )
    user = await session.get(User, user_id)
    if old_session is None or user is None or not user.is_active:
        await session.rollback()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh session is invalid")

    old_session.revoked_at = datetime.now(UTC)
    response = await _issue_session(user, session, redis)
    await session.commit()
    return response


@router.post("/logout")
async def logout(
    body: LogoutRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(
        optional_bearer
    ),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        payload = decode_token(body.refresh_token, "refresh")
    except InvalidTokenError:
        return {"message": "Session ended"}
    jti_hash = hash_secret(payload["jti"])
    refresh_session = await session.scalar(
        select(RefreshSession).where(RefreshSession.jti_hash == jti_hash)
    )
    if refresh_session is not None and refresh_session.revoked_at is None:
        refresh_session.revoked_at = datetime.now(UTC)
        await session.commit()
    await request.app.state.redis.delete(f"nexus:refresh:{jti_hash}")
    if credentials is not None:
        try:
            access_payload = decode_token(credentials.credentials, "access")
        except InvalidTokenError:
            access_payload = None
        if access_payload is not None and access_payload["sub"] == payload["sub"]:
            access_ttl = max(1, int(access_payload["exp"] - datetime.now(UTC).timestamp()))
            await request.app.state.redis.set(
                f"nexus:revoked-access:{access_payload['jti']}", "1", ex=access_ttl
            )
    return {"message": "Session ended"}


@router.get("/session", response_model=UserResponse)
async def current_session(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)
