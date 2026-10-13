import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

password_hash = PasswordHash.recommended()


class InvalidTokenError(Exception):
    """Raised when a JWT is invalid, expired, or intended for another use."""


def hash_password(password: str) -> str:
    if len(password) < 12 or len(password) > 256:
        raise ValueError("Password must be between 12 and 256 characters")
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return password_hash.verify(password, hashed_password)
    except (ValueError, TypeError):
        return False


def create_token(
    subject: str,
    token_type: Literal["access", "refresh"],
    *,
    roles: list[str] | None = None,
    expires_delta: timedelta | None = None,
) -> tuple[str, str]:
    now = datetime.now(UTC)
    if expires_delta is None:
        expires_delta = (
            timedelta(minutes=settings.jwt_access_minutes)
            if token_type == "access"
            else timedelta(days=settings.jwt_refresh_days)
        )
    jti = str(uuid4())
    audience = settings.access_token_audience if token_type == "access" else settings.refresh_token_audience
    payload: dict[str, Any] = {
        "sub": subject,
        "typ": token_type,
        "jti": jti,
        "iat": now,
        "exp": now + expires_delta,
        "aud": audience,
    }
    if roles:
        payload["roles"] = roles
    return jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm), jti


def decode_token(token: str, expected_type: Literal["access", "refresh"]) -> dict[str, Any]:
    audience = settings.access_token_audience if expected_type == "access" else settings.refresh_token_audience
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=audience,
            options={"require": ["exp", "iat", "sub", "jti", "typ"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError("Invalid or expired token") from exc
    if payload.get("typ") != expected_type:
        raise InvalidTokenError("Invalid token type")
    return payload


def token_subject_uuid(payload: dict[str, Any]) -> UUID:
    try:
        return UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("Token subject is not a valid user identifier") from exc


def make_refresh_secret() -> str:
    return secrets.token_urlsafe(48)


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_developer_key() -> tuple[str, str, str]:
    secret = secrets.token_urlsafe(36)
    prefix = f"nxs_{secrets.token_hex(5)}"
    token = f"{prefix}.{secret}"
    return token, prefix, hash_secret(token)
