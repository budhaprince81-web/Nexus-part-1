import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("nexus.errors")


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        issues: list[dict[str, Any]] = [
            {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": "Request validation failed", "details": issues},
                     "request_id": _request_id(request)},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            headers=exc.headers,
            content={"error": {"code": "http_error", "message": detail},
                     "request_id": _request_id(request)},
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        logger.info("Database constraint rejected request", extra={"request_id": _request_id(request)})
        return JSONResponse(
            status_code=409,
            content={"error": {"code": "conflict", "message": "A record with those values already exists"},
                     "request_id": _request_id(request)},
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled request exception", extra={"request_id": _request_id(request)})
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "An internal error occurred"},
                     "request_id": _request_id(request)},
        )
