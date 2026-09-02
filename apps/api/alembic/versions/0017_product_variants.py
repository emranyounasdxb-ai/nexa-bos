"""Bank product variants and application selection.

Revision ID: 0017_product_variants
Revises: 0016_asset_inventory
Create Date: 2026-09-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_product_variants"
down_revision: str | Sequence[str] | None = "0016_asset_inventory"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_variants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "bank_product_id",
            sa.Uuid(),
            sa.ForeignKey("bank_products.id"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "bank_product_id",
            "code",
            name="uq_product_variants_bank_product_code",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')",
            name="product_variants_status_check",
        ),
    )
    op.create_index(
        "ix_product_variants_bank_product_status",
        "product_variants",
        ["bank_product_id", "status"],
    )
    op.create_index(
        "uq_product_variants_bank_product_name_ci",
        "product_variants",
        ["bank_product_id", sa.text("lower(name)")],
        unique=True,
    )
    op.add_column(
        "applications",
        sa.Column(
            "product_variant_id",
            sa.Uuid(),
            sa.ForeignKey("product_variants.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_applications_product_variant_id",
        "applications",
        ["product_variant_id"],
    )

    permissions = sa.table(
        "permissions",
        sa.column("code", sa.String),
        sa.column("description", sa.String),
    )
    op.bulk_insert(
        permissions,
        [
            {
                "code": "ProductVariants.Create",
                "description": "Create product variants for valid bank-product mappings",
            },
            {
                "code": "ProductVariants.Edit",
                "description": "Edit product variant names and descriptions",
            },
            {
                "code": "ProductVariants.Activate",
                "description": "Activate product variants",
            },
            {
                "code": "ProductVariants.Deactivate",
                "description": "Deactivate product variants",
            },
        ],
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
