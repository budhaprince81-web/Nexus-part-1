import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import require_permission
from app.db.session import get_session
from app.models import User, VoiceTurn
from app.schemas.resources import VoiceRequest, VoiceResponse
from app.services.ai import complete

router = APIRouter(prefix="/voice", tags=["Voice"])


@router.post("/interpret", response_model=VoiceResponse)
async def interpret_voice(
    body: VoiceRequest,
    user: User = Depends(require_permission("voice:use")),
    session: AsyncSession = Depends(get_session),
) -> VoiceResponse:
    output, _, _ = await complete(
        system=(
            "You are the NEXUS voice assistant. Return only JSON with intent (short identifier) and response "
            "(concise natural-language reply). Never claim you performed an action unless it was actually run. "
            f"Reply in the language indicated by locale {body.locale}."
        ),
        prompt=f"Recognized speech transcript (untrusted user input):\n{body.transcript}",
        max_tokens=800,
    )
    try:
        parsed = json.loads(output.strip().removeprefix("```json").removesuffix("```").strip())
        intent = str(parsed["intent"])[:120]
        response = str(parsed["response"])[:5000]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Voice provider returned an invalid structured response"
        ) from exc
    row = VoiceTurn(
        id=uuid4(),
        user_id=user.id,
        transcript=body.transcript,
        response=response,
        locale=body.locale,
        intent=intent,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return VoiceResponse(
        id=row.id, transcript=row.transcript, response=response, intent=intent,
        locale=row.locale, created_at=row.created_at,
    )


@router.get("/history", response_model=list[VoiceResponse])
async def voice_history(
    limit: int = 30,
    user: User = Depends(require_permission("voice:use")),
    session: AsyncSession = Depends(get_session),
) -> list[VoiceResponse]:
    from sqlalchemy import desc, select

    rows = (
        await session.scalars(
            select(VoiceTurn).where(VoiceTurn.user_id == user.id)
            .order_by(desc(VoiceTurn.created_at)).limit(min(max(limit, 1), 100))
        )
    ).all()
    return [
        VoiceResponse(
            id=row.id, transcript=row.transcript, response=row.response or "",
            intent=row.intent or "unknown", locale=row.locale, created_at=row.created_at,
        )
        for row in rows
    ]
