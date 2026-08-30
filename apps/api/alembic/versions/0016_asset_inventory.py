"""Asset and individually tracked inventory management.

Revision ID: 0016_asset_inventory
Revises: 0015_notifications
Create Date: 2026-08-30
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_asset_inventory"
down_revision: str | Sequence[str] | None = "0015_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "asset_code_counters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("last_value", sa.Integer(), nullable=False),
    )
    op.bulk_insert(
        sa.table(
            "asset_code_counters",
            sa.column("id", sa.Integer),
            sa.column("last_value", sa.Integer),
        ),
        [{"id": 1, "last_value": 0}],
    )

    op.create_table(
        "asset_categories",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("field_definitions", postgresql.JSONB(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')",
            name="asset_categories_status_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(field_definitions) = 'array'",
            name="asset_categories_field_definitions_check",
        ),
    )

    op.create_table(
        "assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("asset_code", sa.String(length=16), nullable=False, unique=True),
        sa.Column(
            "category_id",
            sa.Uuid(),
            sa.ForeignKey("asset_categories.id"),
            nullable=False,
        ),
        sa.Column("office_id", sa.Uuid(), sa.ForeignKey("offices.id"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("condition", sa.String(length=20), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=True),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("serial_number", sa.String(length=160), nullable=True),
        sa.Column("imei", sa.String(length=32), nullable=True),
        sa.Column("iccid", sa.String(length=64), nullable=True),
        sa.Column("mobile_number", sa.String(length=32), nullable=True),
        sa.Column("operator", sa.String(length=120), nullable=True),
        sa.Column("attributes", postgresql.JSONB(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('In Stock', 'Allocated', 'Under Repair', 'Damaged', 'Lost', 'Retired')",
            name="assets_status_check",
        ),
        sa.CheckConstraint(
            "condition IN ('New', 'Good', 'Fair', 'Damaged')",
            name="assets_condition_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(attributes) = 'object'",
            name="assets_attributes_check",
        ),
    )
    op.create_index("ix_assets_office_status", "assets", ["office_id", "status"])
    op.create_index("ix_assets_category_status", "assets", ["category_id", "status"])
    op.create_index(
        "uq_assets_serial_number",
        "assets",
        ["serial_number"],
        unique=True,
        postgresql_where=sa.text("serial_number IS NOT NULL"),
    )
    op.create_index(
        "uq_assets_imei",
        "assets",
        ["imei"],
        unique=True,
        postgresql_where=sa.text("imei IS NOT NULL"),
    )
    op.create_index(
        "uq_assets_iccid",
        "assets",
        ["iccid"],
        unique=True,
        postgresql_where=sa.text("iccid IS NOT NULL"),
    )

    op.create_table(
        "asset_allocations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("issued_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("condition_at_issue", sa.String(length=20), nullable=False),
        sa.Column("issue_remarks", sa.Text(), nullable=True),
        sa.Column("return_date", sa.Date(), nullable=True),
        sa.Column("received_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("return_condition", sa.String(length=20), nullable=True),
        sa.Column("return_remarks", sa.Text(), nullable=True),
        sa.Column("end_type", sa.String(length=30), nullable=True),
        sa.Column(
            "previous_allocation_id",
            sa.Uuid(),
            sa.ForeignKey("asset_allocations.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "condition_at_issue IN ('New', 'Good', 'Fair', 'Damaged')",
            name="asset_allocations_issue_condition_check",
        ),
        sa.CheckConstraint(
            "return_condition IS NULL OR return_condition IN ('New', 'Good', 'Fair', 'Damaged')",
            name="asset_allocations_return_condition_check",
        ),
        sa.CheckConstraint(
            "end_type IS NULL OR end_type IN ('return', 'employee_transfer')",
            name="asset_allocations_end_type_check",
        ),
        sa.CheckConstraint(
            "(return_date IS NULL AND received_by_id IS NULL AND return_condition IS NULL "
            "AND end_type IS NULL) OR "
            "(return_date IS NOT NULL AND received_by_id IS NOT NULL "
            "AND return_condition IS NOT NULL AND end_type IS NOT NULL)",
            name="asset_allocations_closure_check",
        ),
        sa.CheckConstraint(
            "return_date IS NULL OR return_date >= issue_date",
            name="asset_allocations_dates_check",
        ),
    )
    op.create_index(
        "uq_asset_allocations_active",
        "asset_allocations",
        ["asset_id"],
        unique=True,
        postgresql_where=sa.text("return_date IS NULL"),
    )
    op.create_index(
        "ix_asset_allocations_employee_active",
        "asset_allocations",
        ["employee_id", "return_date"],
    )

    op.create_table(
        "asset_office_custody_history",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("office_id", sa.Uuid(), sa.ForeignKey("offices.id"), nullable=False),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("ended_on", sa.Date(), nullable=True),
        sa.Column("transferred_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "previous_custody_id",
            sa.Uuid(),
            sa.ForeignKey("asset_office_custody_history.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "ended_on IS NULL OR ended_on >= started_on",
            name="asset_office_custody_dates_check",
        ),
    )
    op.create_index(
        "uq_asset_office_custody_active",
        "asset_office_custody_history",
        ["asset_id"],
        unique=True,
        postgresql_where=sa.text("ended_on IS NULL"),
    )
    op.create_index(
        "ix_asset_office_custody_office",
        "asset_office_custody_history",
        ["office_id", "ended_on"],
    )

    permissions = sa.table(
        "permissions",
        sa.column("code", sa.String),
        sa.column("description", sa.String),
    )
    op.bulk_insert(
        permissions,
        [
            {"code": "Assets.View", "description": "View authorized Asset data"},
            {
                "code": "Assets.ManageMaster",
                "description": "Manage Asset categories and master details within scope",
            },
            {
                "code": "Assets.ManageStock",
                "description": "Create and maintain authorized Asset stock and condition metadata",
            },
            {"code": "Assets.Allocate", "description": "Allocate Assets to eligible employees"},
            {
                "code": "Assets.Transfer",
                "description": "Transfer Asset employee or Office custody within scope",
            },
            {"code": "Assets.Return", "description": "Process explicit Asset returns"},
            {
                "code": "Assets.ManageStatus",
                "description": "Manage audited Lost, Damaged, Repair, and Retired status",
            },
            {"code": "Assets.ViewAudit", "description": "View authorized Asset history and audit"},
        ],
    )

    now = datetime.now(UTC)
    categories = sa.table(
        "asset_categories",
        sa.column("id", sa.Uuid),
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("status", sa.String),
        sa.column("field_definitions", postgresql.JSONB),
        sa.column("created_by_id", sa.Uuid),
        sa.column("updated_by_id", sa.Uuid),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        categories,
        [
            {
                "id": uuid.UUID("13000000-0000-0000-0000-000000000001"),
                "code": "PC",
                "name": "PC / Computer",
                "description": "Individually tracked desktop and laptop computers",
                "status": "active",
                "field_definitions": [
                    {"key": "brand", "label": "Brand", "required": True},
                    {"key": "model", "label": "Model", "required": True},
                    {
                        "key": "serial_number",
                        "label": "Serial Number / Service Tag",
                        "required": False,
                    },
                ],
                "created_by_id": None,
                "updated_by_id": None,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": uuid.UUID("13000000-0000-0000-0000-000000000002"),
                "code": "MOBILE",
                "name": "Mobile Phone",
                "description": "Individually tracked mobile phones",
                "status": "active",
                "field_definitions": [
                    {"key": "brand", "label": "Brand", "required": True},
                    {"key": "model", "label": "Model", "required": True},
                    {"key": "imei", "label": "IMEI", "required": False},
                    {"key": "serial_number", "label": "Serial Number", "required": False},
                ],
                "created_by_id": None,
                "updated_by_id": None,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": uuid.UUID("13000000-0000-0000-0000-000000000003"),
                "code": "SIM",
                "name": "SIM Card",
                "description": "Individually tracked SIM cards",
                "status": "active",
                "field_definitions": [
                    {"key": "mobile_number", "label": "Mobile Number", "required": True},
                    {"key": "iccid", "label": "ICCID / SIM Identifier", "required": False},
                    {"key": "operator", "label": "Operator / Provider", "required": True},
                ],
                "created_by_id": None,
                "updated_by_id": None,
                "created_at": now,
                "updated_at": now,
            },
        ],
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
