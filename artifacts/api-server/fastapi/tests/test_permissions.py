from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.permissions import has_permission, permission_allowed


@pytest.mark.asyncio
async def test_default_user_permissions_and_admin_policy():
    session = SimpleNamespace(scalar=AsyncMock(return_value=None))

    assert await permission_allowed(session, "user", "tasks:read")
    assert not await permission_allowed(session, "user", "permissions:admin")
    assert await permission_allowed(session, "admin", "permissions:admin")


@pytest.mark.asyncio
async def test_database_permission_override_replaces_default():
    session = SimpleNamespace(scalar=AsyncMock(return_value=SimpleNamespace(allowed=False)))

    assert not await permission_allowed(session, "user", "tasks:read")

    session.scalar.return_value = SimpleNamespace(allowed=True)
    assert await permission_allowed(session, "user", "permissions:admin")


@pytest.mark.asyncio
async def test_api_key_scopes_cannot_exceed_user_permissions():
    session = SimpleNamespace(scalar=AsyncMock(return_value=None))

    assert await has_permission(session, "user", "tasks:read", ["tasks:read"])
    assert not await has_permission(session, "user", "tasks:write", ["tasks:read"])
    assert await has_permission(session, "user", "tasks:write", ["*"])
