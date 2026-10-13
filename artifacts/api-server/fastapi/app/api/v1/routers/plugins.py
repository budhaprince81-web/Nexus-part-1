import asyncio
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import Plugin, User
from app.schemas.resources import PluginCreate, PluginInvokeRequest, PluginResponse

router = APIRouter(prefix="/plugins", tags=["Plugins"])
MAX_PLUGIN_RESPONSE_BYTES = 2_000_000


async def validate_public_https_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Plugin endpoints must be public HTTPS URLs")
    try:
        records = await asyncio.to_thread(
            socket.getaddrinfo, parsed.hostname, parsed.port or 443, 0, socket.SOCK_STREAM
        )
    except OSError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Plugin host did not resolve") from exc
    addresses = {ipaddress.ip_address(record[4][0]) for record in records}
    if not addresses or any(not address.is_global for address in addresses):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Plugin host resolves to a non-public address")
    return value.rstrip("/") + "/"


def validate_manifest(manifest: dict) -> dict:
    actions = manifest.get("actions")
    if not isinstance(actions, list) or not 1 <= len(actions) <= 50:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Plugin manifest must declare 1-50 actions")
    names: set[str] = set()
    clean = []
    for action in actions:
        if not isinstance(action, dict):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Every plugin action must be an object")
        name = action.get("name")
        method = str(action.get("method", "GET")).upper()
        path = action.get("path")
        if (
            not isinstance(name, str) or not name or len(name) > 120 or name in names
            or method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}
            or not isinstance(path, str)
            or not re.fullmatch(r"/(?:[A-Za-z0-9_~-]+(?:/[A-Za-z0-9_~-]+)*)?/?", path)
        ):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Plugin action has an invalid name, method, or path")
        names.add(name)
        clean.append({"name": name, "method": method, "path": path})
    return {"actions": clean}


@router.get("", response_model=list[PluginResponse])
async def list_plugins(
    user: User = Depends(require_permission("plugins:read")),
    session: AsyncSession = Depends(get_session),
) -> list[PluginResponse]:
    rows = (
        await session.scalars(
            select(Plugin).where(Plugin.owner_id == user.id).order_by(desc(Plugin.created_at))
        )
    ).all()
    return [PluginResponse.model_validate(row) for row in rows]


@router.post("", response_model=PluginResponse, status_code=status.HTTP_201_CREATED)
async def register_plugin(
    body: PluginCreate,
    user: User = Depends(require_permission("plugins:write")),
    session: AsyncSession = Depends(get_session),
) -> PluginResponse:
    base_url = await validate_public_https_url(str(body.base_url))
    plugin = Plugin(
        id=uuid4(),
        owner_id=user.id,
        name=body.name,
        description=body.description,
        base_url=base_url,
        enabled=False,
        manifest=validate_manifest(body.manifest),
    )
    session.add(plugin)
    await session.commit()
    await session.refresh(plugin)
    return PluginResponse.model_validate(plugin)


@router.patch("/{plugin_id}/enabled")
async def set_plugin_enabled(
    plugin_id: UUID,
    enabled: bool,
    user: User = Depends(require_permission("plugins:write")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    plugin = await session.scalar(select(Plugin).where(Plugin.id == plugin_id, Plugin.owner_id == user.id))
    if plugin is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plugin not found")
    plugin.enabled = enabled
    await session.commit()
    return {"enabled": plugin.enabled}


@router.post("/{plugin_id}/invoke")
async def invoke_plugin(
    plugin_id: UUID,
    body: PluginInvokeRequest,
    user: User = Depends(require_permission("plugins:invoke")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    plugin = await session.scalar(
        select(Plugin).where(Plugin.id == plugin_id, Plugin.owner_id == user.id, Plugin.enabled.is_(True))
    )
    if plugin is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enabled plugin not found")
    actions = plugin.manifest.get("actions", [])
    action = next((item for item in actions if item["name"] == body.action), None)
    if action is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plugin action not found in its manifest")

    # Re-resolve on every invocation to mitigate DNS rebinding between registration and use.
    base_url = await validate_public_https_url(plugin.base_url)
    target_url = urljoin(base_url, action["path"].lstrip("/"))
    target = urlsplit(target_url)
    base = urlsplit(base_url)
    if target.scheme != "https" or target.hostname != base.hostname or target.port != base.port:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Plugin action URL escaped its registered origin")
    timeout = httpx.Timeout(8.0, connect=3.0)
    async with (
        httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client,
        client.stream(
            action["method"],
            target_url,
            params=body.query,
            json=body.body if action["method"] not in {"GET", "DELETE"} else None,
        ) as response,
    ):
        content = bytearray()
        async for chunk in response.aiter_bytes():
            content.extend(chunk)
            if len(content) > MAX_PLUGIN_RESPONSE_BYTES:
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Plugin response exceeded the 2 MB limit")
        decoded = bytes(content).decode("utf-8", errors="replace")
        return {
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type", "application/octet-stream"),
            "body": decoded,
        }


@router.delete("/{plugin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plugin(
    plugin_id: UUID,
    user: User = Depends(require_permission("plugins:write")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    plugin = await session.scalar(select(Plugin).where(Plugin.id == plugin_id, Plugin.owner_id == user.id))
    if plugin is not None:
        await session.delete(plugin)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
