"""Customer, bank, product, and bank-product masters.

Revision ID: 0004_customer_masters
Revises: 0003_session_csrf_token
Create Date: 2026-08-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_customer_masters"
down_revision: str | Sequence[str] | None = "0003_session_csrf_token"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customer_code_counters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "banks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_table(
        "bank_name_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bank_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_table(
        "product_name_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "bank_products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bank_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bank_id", "product_id"),
    )
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_code", sa.String(length=16), nullable=False),
        sa.Column("customer_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=True),
        sa.Column("company_name", sa.String(length=200), nullable=True),
        sa.Column("contact_person", sa.String(length=200), nullable=True),
        sa.Column("mobile", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("emirates_id", sa.String(length=64), nullable=True),
        sa.Column("passport", sa.String(length=64), nullable=True),
        sa.Column("employer", sa.String(length=200), nullable=True),
        sa.Column("trade_license", sa.String(length=64), nullable=True),
        sa.Column("merged_into_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["merged_into_id"], ["customers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_code"),
    )
    op.create_table(
        "customer_identifier_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("value_normalized", sa.String(length=64), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "value_normalized"),
    )
    op.create_index(
        "ix_customer_identifier_history_customer_id",
        "customer_identifier_history",
        ["customer_id"],
    )
    op.create_index(
        "ix_customer_identifier_history_value_normalized",
        "customer_identifier_history",
        ["value_normalized"],
    )
    op.create_table(
        "customer_field_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("field", sa.String(length=40), nullable=False),
        sa.Column("value", sa.String(length=320), nullable=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_field_history_customer_id", "customer_field_history", ["customer_id"]
    )
    op.create_table(
        "customer_merges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_customer_id", sa.Uuid(), nullable=False),
        sa.Column("primary_customer_id", sa.Uuid(), nullable=False),
        sa.Column("merged_by_id", sa.Uuid(), nullable=False),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_customer_code", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["merged_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["primary_customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["source_customer_id"], ["customers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_customer_id"),
    )
    op.create_index(
        "ix_customer_merges_primary_customer_id", "customer_merges", ["primary_customer_id"]
    )
    op.add_column(
        "user_types",
        sa.Column("customer_visibility_scope", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.execute("ALTER TABLE user_types DROP COLUMN IF EXISTS customer_visibility_scope")
    op.drop_index("ix_customer_merges_primary_customer_id", table_name="customer_merges")
    op.drop_table("customer_merges")
    op.drop_index("ix_customer_field_history_customer_id", table_name="customer_field_history")
    op.drop_table("customer_field_history")
    op.drop_index(
        "ix_customer_identifier_history_value_normalized",
        table_name="customer_identifier_history",
    )
    op.drop_index(
        "ix_customer_identifier_history_customer_id", table_name="customer_identifier_history"
    )
    op.drop_table("customer_identifier_history")
    op.drop_table("customers")
    op.drop_table("bank_products")
    op.drop_table("product_name_history")
    op.drop_table("products")
    op.drop_table("bank_name_history")
    op.drop_table("banks")
    op.drop_table("customer_code_counters")
