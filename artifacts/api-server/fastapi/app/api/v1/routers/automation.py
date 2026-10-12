from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import has_permission, require_permission
from app.db.session import get_session
from app.models import AutomationAudit, User
from app.schemas.resources import AutomationRequest, AutomationResponse
from app.services.automation import DESTRUCTIVE_OPERATIONS, execute_file_operation

router = APIRouter(prefix="/automation", tags=["Automation"])


@router.post("/file", response_model=AutomationResponse)
async def file_operation(
    body: AutomationRequest,
    request: Request,
    user: User = Depends(require_permission("automation:read")),
    session: AsyncSession = Depends(get_session),
) -> AutomationResponse:
    permission = "automation:delete" if body.operation in DESTRUCTIVE_OPERATIONS else (
        "automation:write" if body.operation in {"write", "mkdir"} else "automation:read"
    )
    api_key_scopes = getattr(request.state, "api_key_scopes", None)
    if not await has_permission(session, user.role, permission, api_key_scopes):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Permission {permission} is required")
    try:
        result = await execute_file_operation(
            body.operation,
            body.path,
            user_id=user.id,
            content=body.content,
            destination=body.destination,
        )
        success = True
        details = {"destination": body.destination} if body.operation == "move" else {}
    except Exception as exc:
        from fastapi import HTTPException as FastAPIHTTPException

        if isinstance(exc, FastAPIHTTPException):
            success = False
            details = {"error": exc.detail}
        else:
            raise
        audit = AutomationAudit(
            id=uuid4(), user_id=user.id, operation=body.operation,
            target=body.path[:1024], success=False, details=details,
        )
        session.add(audit)
        await session.commit()
        raise
    audit = AutomationAudit(
        id=uuid4(),
        user_id=user.id,
        operation=body.operation,
        target=body.path[:1024],
        success=success,
        details=details,
    )
    session.add(audit)
    await session.commit()
    return AutomationResponse(operation=body.operation, path=body.path, success=success, result=result)


@router.get("/logs")
async def automation_logs(
    limit: int = 30,
    user: User = Depends(require_permission("automation:read")),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import desc, select

    rows = (
        await session.scalars(
            select(AutomationAudit).where(AutomationAudit.user_id == user.id)
            .order_by(desc(AutomationAudit.created_at)).limit(min(max(limit, 1), 100))
        )
    ).all()
    return [
        {"id": str(row.id), "operation": row.operation, "target": row.target,
         "success": row.success, "details": row.details, "created_at": row.created_at}
        for row in rows
    ]
