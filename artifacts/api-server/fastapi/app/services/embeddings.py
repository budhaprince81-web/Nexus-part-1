import asyncio
from collections.abc import Sequence
from threading import Lock

from app.core.config import settings

_model = None
_model_lock = Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=settings.embedding_model)
    return _model


def _embed_sync(texts: Sequence[str], query: bool) -> list[list[float]]:
    model = _get_model()
    generator = model.query_embed(list(texts)) if query else model.passage_embed(list(texts))
    vectors = [vector.tolist() for vector in generator]
    if any(len(vector) != settings.embedding_dimensions for vector in vectors):
        raise RuntimeError("Embedding model output does not match configured vector dimensions")
    return vectors


async def embed_passages(texts: Sequence[str]) -> list[list[float]]:
    if not texts:
        return []
    return await asyncio.to_thread(_embed_sync, texts, False)


async def embed_query(text: str) -> list[float]:
    return (await asyncio.to_thread(_embed_sync, [text], True))[0]
