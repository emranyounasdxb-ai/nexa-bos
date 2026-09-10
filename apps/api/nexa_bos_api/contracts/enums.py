from __future__ import annotations

from enum import StrEnum


class ContractStatus(StrEnum):
    DRAFT = "Draft"
    PENDING_APPROVAL = "Pending Approval"
    ACTIVE = "Active"
    EXPIRING_SOON = "Expiring Soon"
    EXPIRED = "Expired"
    SUPERSEDED = "Superseded"
    CANCELLED = "Cancelled"


EDITABLE_CONTRACT_STATUSES = {ContractStatus.DRAFT}
CURRENT_CONTRACT_STATUSES = {ContractStatus.ACTIVE}
