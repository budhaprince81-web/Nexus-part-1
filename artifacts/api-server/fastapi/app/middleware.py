import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

logger = logging.getLogger("nexus.http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id", "")[:80] or str(uuid.uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "Request failed",
                extra={"request_id": request_id, "method": request.method, "path": request.url.path},
            )
            raise
        response.headers["X-Request-ID"] = request_id
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info(
            "Request completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > self.max_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={"error": {"code": "payload_too_large", "message": "Request body is too large"}},
                    )
            except ValueError:
                return JSONResponse(status_code=400, content={"error": {"code": "invalid_content_length"}})
        if request.method in {"POST", "PUT", "PATCH"} and not content_length:
            body = await request.body()
            if len(body) > self.max_bytes:
                return JSONResponse(
                    status_code=413,
                    content={"error": {"code": "payload_too_large", "message": "Request body is too large"}},
                )
            request._body = body
        return await call_next(request)


class RedisRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, requests_per_minute: int) -> None:
        super().__init__(app)
        self.requests_per_minute = requests_per_minute

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in {"/health/live", "/health/ready"} or request.url.path.endswith("/openapi.json"):
            return await call_next(request)
        redis = getattr(request.app.state, "redis", None)
        if redis is None:
            return JSONResponse(
                status_code=503,
                content={"error": {"code": "rate_limiter_unavailable", "message": "Request service unavailable"}},
            )
        address = request.client.host if request.client else "unknown"
        bucket = int(time.time() // 60)
        key = f"nexus:rate:{address}:{bucket}"
        try:
            pipeline = redis.pipeline()
            pipeline.incr(key)
            pipeline.expire(key, 70)
            results = await pipeline.execute()
        except Exception:
            logger.exception("Redis rate limiter unavailable")
            return JSONResponse(
                status_code=503,
                content={"error": {"code": "rate_limiter_unavailable", "message": "Request service unavailable"}},
            )
        if int(results[0]) > self.requests_per_minute:
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(60 - int(time.time()) % 60)},
                content={"error": {"code": "rate_limited", "message": "Request rate limit exceeded"}},
            )
        return await call_next(request)
