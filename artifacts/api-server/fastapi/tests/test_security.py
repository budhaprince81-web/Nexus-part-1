from uuid import uuid4

from app.core.security import (
    InvalidTokenError,
    create_token,
    decode_token,
    hash_password,
    hash_secret,
    token_subject_uuid,
    verify_password,
)


def test_password_hash_verifies_without_storing_plaintext():
    password = "secure-example-password-1942"
    hashed = hash_password(password)

    assert hashed != password
    assert verify_password(password, hashed)
    assert not verify_password("incorrect-password", hashed)


def test_access_and_refresh_tokens_are_type_bound():
    access, access_jti = create_token("user-id", "access", roles=["user"])
    refresh, refresh_jti = create_token("user-id", "refresh")

    assert access_jti != refresh_jti
    assert decode_token(access, "access")["sub"] == "user-id"
    assert decode_token(refresh, "refresh")["sub"] == "user-id"
    try:
        decode_token(access, "refresh")
    except InvalidTokenError:
        pass
    else:
        raise AssertionError("An access token must not be accepted as a refresh token")


def test_secret_hash_is_deterministic_and_non_reversible():
    value = "api-secret-value"

    assert hash_secret(value) == hash_secret(value)
    assert hash_secret(value) != value


def test_token_subject_must_be_uuid_backed():
    subject = uuid4()
    assert token_subject_uuid({"sub": str(subject)}) == subject
    try:
        token_subject_uuid({"sub": "not-a-user-uuid"})
    except InvalidTokenError:
        pass
    else:
        raise AssertionError("Invalid user identifiers must be rejected")
