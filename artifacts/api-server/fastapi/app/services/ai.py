from anthropic import APIConnectionError, APIStatusError
from fastapi import HTTPException, status

from app.core.config import settings


def get_anthropic_client():
    if settings.anthropic_api_key is None or not settings.anthropic_api_key.get_secret_value():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ANTHROPIC_API_KEY is required for this AI feature",
        )
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(
        api_key=settings.anthropic_api_key.get_secret_value(),
        timeout=60.0,
        max_retries=2,
    )


async def complete(
    *,
    system: str,
    prompt: str,
    max_tokens: int = 2500,
    image: dict[str, str] | None = None,
) -> tuple[str, int, int]:
    client = get_anthropic_client()
    content = [{"type": "text", "text": prompt}]
    if image is not None:
        content.insert(
            0,
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image["mime_type"],
                    "data": image["data"],
                },
            },
        )
    try:
        async with client:
            response = await client.messages.create(
                model=settings.anthropic_model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
            )
    except APIConnectionError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The AI provider could not be reached",
        ) from exc
    except APIStatusError as exc:
        code = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if exc.status_code == 429 or exc.status_code >= 500
            else status.HTTP_502_BAD_GATEWAY
        )
        raise HTTPException(code, "The AI provider could not complete this request") from exc
    text = "\n".join(block.text for block in response.content if block.type == "text")
    return text, response.usage.input_tokens, response.usage.output_tokens
