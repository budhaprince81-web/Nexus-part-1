import base64
import binascii
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import AgentRun, User
from app.schemas.resources import AgentResponse, VisionRequest
from app.services.ai import complete

router = APIRouter(prefix="/vision", tags=["Vision"])


@router.post("/analyze", response_model=AgentResponse)
async def analyze_image(
    body: VisionRequest,
    user: User = Depends(require_permission("vision:analyze")),
    session: AsyncSession = Depends(get_session),
) -> AgentResponse:
    try:
        raw_image = base64.b64decode(body.image_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "image_base64 is not valid base64") from exc
    if not raw_image or len(raw_image) > 8_000_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image must be no larger than 8 MB")
    run = AgentRun(
        id=uuid4(),
        user_id=user.id,
        agent_name="vision",
        prompt=body.prompt,
        status="running",
        model=settings.anthropic_model,
        metadata_json={"mime_type": body.mime_type, "image_bytes": len(raw_image)},
    )
    session.add(run)
    await session.commit()
    try:
        output, input_tokens, output_tokens = await complete(
            system=(
                "You are the NEXUS Vision agent. Analyze only the supplied image and prompt. "
                "Clearly distinguish visible facts from inferences. Do not infer a person's identity."
            ),
            prompt=body.prompt,
            image={"mime_type": body.mime_type, "data": body.image_base64},
        )
        run.output = output
        run.status = "complete"
        run.model = settings.anthropic_model
        run.tokens_in = input_tokens
        run.tokens_out = output_tokens
        run.completed_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(run)
        return AgentResponse.model_validate(run)
    except Exception as exc:
        run.status = "error"
        run.error_message = type(exc).__name__
        run.completed_at = datetime.now(UTC)
        await session.commit()
        raise
