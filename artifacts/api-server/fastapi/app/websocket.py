import asyncio
import logging
from contextlib import suppress

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.security import InvalidTokenError, decode_token, token_subject_uuid
from app.db.session import SessionFactory
from app.models import User

logger = logging.getLogger("nexus.websocket")


async def events_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        first = await asyncio.wait_for(websocket.receive_json(), timeout=8)
        if not isinstance(first, dict) or not isinstance(first.get("access_token"), str):
            await websocket.close(code=4401, reason="Send an access_token authentication message first")
            return
        try:
            payload = decode_token(first["access_token"], "access")
            user_id = token_subject_uuid(payload)
        except InvalidTokenError:
            await websocket.close(code=4401, reason="Invalid access token")
            return

        redis = websocket.app.state.redis
        if await redis.get(f"nexus:revoked-access:{payload['jti']}"):
            await websocket.close(code=4401, reason="Access token revoked")
            return
        async with SessionFactory() as session:
            user = await session.scalar(
                select(User).where(User.id == user_id, User.is_active.is_(True))
            )
        if user is None:
            await websocket.close(code=4401, reason="Account not found or disabled")
            return

        pubsub = redis.pubsub()
        channel = f"nexus:user:{user.id}:events"
        await pubsub.subscribe(channel)
        await websocket.send_json({"type": "ready", "user_id": str(user.id)})
        try:
            while True:
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if message and message.get("data"):
                        await websocket.send_text(str(message["data"]))
                    await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                except TimeoutError:
                    continue
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
    except WebSocketDisconnect:
        return
    except TimeoutError:
        await websocket.close(code=4408, reason="Authentication timed out")
    except Exception:
        logger.exception("WebSocket connection failed")
        with suppress(RuntimeError):
            await websocket.close(code=1011, reason="Connection error")
