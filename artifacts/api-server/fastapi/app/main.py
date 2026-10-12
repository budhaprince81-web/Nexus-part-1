import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.core.redis import create_redis
from app.db.session import engine
from app.middleware import (
    RedisRateLimitMiddleware,
    RequestContextMiddleware,
    RequestSizeLimitMiddleware,
)
from app.websocket import events_socket

logger = logging.getLogger("nexus.startup")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    redis = create_redis()
    app.state.redis = redis
    try:
        await redis.ping()
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            vector_available = await connection.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
            )
        if not vector_available:
            raise RuntimeError("pgvector extension is missing; run `alembic upgrade head`")
        logger.info("NEXUS Python API dependencies are ready")
        yield
    finally:
        await redis.aclose()
        await engine.dispose()


configure_logging()
app = FastAPI(
    title="NEXUS AI Operating System API",
    version="1.0.0",
    description="Async multi-tenant API for NEXUS AI OS.",
    lifespan=lifespan,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url="/redoc" if settings.app_env != "production" else None,
    openapi_url="/openapi.json" if settings.app_env != "production" else None,
)
install_error_handlers(app)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=settings.max_request_bytes)
app.add_middleware(RedisRateLimitMiddleware, requests_per_minute=settings.default_rate_limit)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Retry-After"],
)
app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/", tags=["API Gateway"])
async def root() -> dict[str, str]:
    return {"service": settings.app_name, "version": app.version, "docs": "/docs" if settings.app_env != "production" else "disabled"}


@app.get("/health/live", tags=["Health"])
async def liveness() -> dict[str, str]:
    return {"status": "alive"}


@app.get("/health/ready", tags=["Health"])
async def readiness(request: Request) -> dict[str, str]:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
        await connection.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
    await request.app.state.redis.ping()
    return {"status": "ready"}


@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket) -> None:
    await events_socket(websocket)
