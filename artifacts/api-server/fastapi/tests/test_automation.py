from uuid import UUID

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.automation import execute_file_operation, resolve_workspace_path


def test_path_resolver_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "workspace_path", str(tmp_path))

    with pytest.raises(HTTPException) as error:
        resolve_workspace_path("../outside.txt", UUID(int=1))

    assert error.value.status_code == 400


def test_path_resolver_rejects_symlink_escape(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    secret = tmp_path / "private"
    secret.mkdir()
    user_root = workspace / str(UUID(int=1))
    user_root.mkdir(parents=True)
    (user_root / "escape").symlink_to(secret, target_is_directory=True)
    monkeypatch.setattr(settings, "workspace_path", str(workspace))

    with pytest.raises(HTTPException) as error:
        resolve_workspace_path("escape/secret.txt", UUID(int=1))

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_workspace_file_operations_write_read_list_and_delete(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_path", str(workspace))

    user_id = UUID(int=1)
    written = await execute_file_operation(
        "write", "notes/today.txt", user_id=user_id, content="Ship the feature"
    )
    content = await execute_file_operation("read", "notes/today.txt", user_id=user_id)
    entries = await execute_file_operation("list", "notes", user_id=user_id)
    deleted = await execute_file_operation("delete", "notes/today.txt", user_id=user_id)

    assert written["bytes_written"] == len("Ship the feature")
    assert content == "Ship the feature"
    assert entries == [{"name": "today.txt", "type": "file"}]
    assert deleted == {"deleted": True}


def test_users_get_distinct_workspace_roots(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "workspace_path", str(tmp_path))

    first = resolve_workspace_path("notes/today.txt", UUID(int=1))
    second = resolve_workspace_path("notes/today.txt", UUID(int=2))

    assert first != second
    assert str(UUID(int=1)) in first.parts
    assert str(UUID(int=2)) in second.parts
