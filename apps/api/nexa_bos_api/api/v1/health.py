from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from nexa_bos_api.db.session import SessionDep

router = APIRouter(tags=["system"])
logger = logging.getLogger("nexa_bos_api")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready(session: SessionDep) -> dict[str, str]:
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Readiness check failed")
        raise HTTPException(status_code=503, detail="Database is not reachable") from None
    return {"status": "ready"}
