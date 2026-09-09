"""Optional catalogue entity images.

Revision ID: 0018_catalogue_images
Revises: 0017_product_variants
Create Date: 2026-09-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_catalogue_images"
down_revision: str | Sequence[str] | None = "0017_product_variants"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_image_columns(table: str) -> None:
    op.add_column(table, sa.Column("image_key", sa.String(length=255), nullable=True))
    op.add_column(table, sa.Column("image_content_type", sa.String(length=80), nullable=True))
    op.add_column(table, sa.Column("image_width", sa.Integer(), nullable=True))
    op.add_column(table, sa.Column("image_height", sa.Integer(), nullable=True))
    op.add_column(table, sa.Column("image_size_bytes", sa.Integer(), nullable=True))
    op.add_column(table, sa.Column("image_updated_at", sa.DateTime(timezone=True), nullable=True))


def upgrade() -> None:
    _add_image_columns("banks")
    _add_image_columns("products")
    _add_image_columns("product_variants")


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
