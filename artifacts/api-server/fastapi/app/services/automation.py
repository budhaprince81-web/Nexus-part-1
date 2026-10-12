import asyncio
import os
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from app.core.config import settings

DESTRUCTIVE_OPERATIONS = {"delete", "move"}


def resolve_workspace_path(relative_path: str, user_id: UUID) -> Path:
    if not relative_path or "\x00" in relative_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A valid relative workspace path is required")
    supplied = Path(relative_path)
    if supplied.is_absolute():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Absolute paths are not allowed")
    workspace_root = Path(settings.workspace_path).resolve()
    root = (workspace_root / str(user_id)).resolve()
    try:
        root.relative_to(workspace_root)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid workspace owner") from exc
    candidate = (root / supplied).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Path escapes the NEXUS workspace") from exc
    return candidate


async def execute_file_operation(
    operation: str,
    path: str,
    user_id: UUID,
    *,
    content: str | None = None,
    destination: str | None = None,
) -> Any:
    target = resolve_workspace_path(path, user_id)
    root = (Path(settings.workspace_path).resolve() / str(user_id)).resolve()
    await asyncio.to_thread(root.mkdir, parents=True, exist_ok=True)

    if operation == "list":
        if not target.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace path not found")
        if not target.is_dir():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Path is not a directory")
        return await asyncio.to_thread(
            lambda: [
                {"name": item.name, "type": "directory" if item.is_dir() else "file"}
                for item in sorted(target.iterdir(), key=lambda entry: entry.name.lower())
            ]
        )
    if operation == "read":
        if not target.is_file():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace file not found")
        if target.stat().st_size > 2_000_000:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 2 MB read limit")
        return await asyncio.to_thread(target.read_text, encoding="utf-8")
    if operation == "write":
        if content is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "content is required for write")
        await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(target.write_text, content, encoding="utf-8")
        return {"bytes_written": len(content.encode("utf-8"))}
    if operation == "mkdir":
        await asyncio.to_thread(target.mkdir, parents=True, exist_ok=True)
        return {"created": True}
    if operation == "info":
        if not target.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace path not found")
        stat = await asyncio.to_thread(target.stat)
        return {"name": target.name, "is_directory": target.is_dir(), "size": stat.st_size}
    if operation == "delete":
        if not target.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace path not found")
        if target.is_dir():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Recursive directory deletion is not supported")
        await asyncio.to_thread(target.unlink)
        return {"deleted": True}
    if operation == "move":
        if not destination:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "destination is required for move")
        dest = resolve_workspace_path(destination, user_id)
        if not target.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace path not found")
        await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(os.replace, target, dest)
        return {"moved_to": destination}
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported file operation")
