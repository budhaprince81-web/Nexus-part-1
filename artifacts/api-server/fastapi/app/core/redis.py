from redis.asyncio import Redis, from_url

from app.core.config import settings


def create_redis() -> Redis:
    return from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        health_check_interval=30,
        socket_connect_timeout=3,
        socket_timeout=3,
    )
