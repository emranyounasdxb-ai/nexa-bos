"""Periodic deadline checks for configured case-stage timeframes."""

import asyncio
import logging

from nexa_bos_api.case_operations.overdue import dispatch_overdue_notifications

logger = logging.getLogger(__name__)


async def run(stop: asyncio.Event, session_factory) -> None:
    while not stop.is_set():
        try:
            await dispatch_overdue_notifications(session_factory)
        except Exception:
            logger.exception("Case overdue notification cycle failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=300)
        except TimeoutError:
            pass
