"""In-process effective-date executor; no deployment scheduler dependency."""

import asyncio
import logging

from nexa_bos_api.transfers.service import apply_due_transfers

logger = logging.getLogger(__name__)


async def run(stop: asyncio.Event, session_factory):
    while not stop.is_set():
        try:
            await apply_due_transfers(session_factory)
        except Exception:
            # Do not swallow task failures or repeat potentially ambiguous work.
            logger.exception("Transfer effective-date executor stopped; operator review required")
            return
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            pass
