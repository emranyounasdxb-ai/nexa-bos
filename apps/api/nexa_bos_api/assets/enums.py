from __future__ import annotations

from enum import StrEnum


class AssetStatus(StrEnum):
    IN_STOCK = "In Stock"
    ALLOCATED = "Allocated"
    UNDER_REPAIR = "Under Repair"
    DAMAGED = "Damaged"
    LOST = "Lost"
    RETIRED = "Retired"


class AssetCondition(StrEnum):
    NEW = "New"
    GOOD = "Good"
    FAIR = "Fair"
    DAMAGED = "Damaged"


class AllocationEndType(StrEnum):
    RETURN = "return"
    EMPLOYEE_TRANSFER = "employee_transfer"


class AssetReport(StrEnum):
    ASSET_REGISTER = "asset_register"
    AVAILABLE_STOCK = "available_stock"
    ALLOCATED_ASSETS = "allocated_assets"
    EMPLOYEE_ASSETS = "employee_assets"
    OFFICE_INVENTORY = "office_inventory"
    DAMAGED_ASSETS = "damaged_assets"
    LOST_ASSETS = "lost_assets"
    UNDER_REPAIR_ASSETS = "under_repair_assets"
    RETURNED_ASSETS = "returned_assets"
    ASSET_HISTORY = "asset_history"
    OUTSTANDING_ASSETS = "outstanding_assets"


REPORT_TITLES: dict[AssetReport, str] = {
    AssetReport.ASSET_REGISTER: "Asset Register",
    AssetReport.AVAILABLE_STOCK: "Available Stock",
    AssetReport.ALLOCATED_ASSETS: "Allocated Assets",
    AssetReport.EMPLOYEE_ASSETS: "Employee-wise Assets",
    AssetReport.OFFICE_INVENTORY: "Office-wise Inventory",
    AssetReport.DAMAGED_ASSETS: "Damaged Assets",
    AssetReport.LOST_ASSETS: "Lost Assets",
    AssetReport.UNDER_REPAIR_ASSETS: "Under Repair Assets",
    AssetReport.RETURNED_ASSETS: "Returned Assets",
    AssetReport.ASSET_HISTORY: "Asset History",
    AssetReport.OUTSTANDING_ASSETS: "Outstanding Assets",
}
