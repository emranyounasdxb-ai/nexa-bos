"""Employee HR and PRO profile foundation.

Revision ID: 0019_employee_profiles
Revises: 0018_catalogue_images
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_employee_profiles"
down_revision: str | Sequence[str] | None = "0018_catalogue_images"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("middle_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("personal_email", sa.String(length=320), nullable=True))
    op.add_column("users", sa.Column("personal_mobile", sa.String(length=32), nullable=True))

    op.create_table(
        "hr_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(length=40), nullable=True),
        sa.Column("nationality", sa.String(length=100), nullable=True),
        sa.Column("marital_status", sa.String(length=40), nullable=True),
        sa.Column("emergency_contact_name", sa.String(length=200), nullable=True),
        sa.Column("emergency_contact_relationship", sa.String(length=100), nullable=True),
        sa.Column("emergency_contact_mobile", sa.String(length=32), nullable=True),
        sa.Column("employee_type", sa.String(length=80), nullable=True),
        sa.Column("employment_type", sa.String(length=80), nullable=True),
        sa.Column("probation_end_date", sa.Date(), nullable=True),
        sa.Column("job_title", sa.String(length=160), nullable=True),
        sa.Column("business_unit", sa.String(length=160), nullable=True),
        sa.Column("location", sa.String(length=160), nullable=True),
        sa.Column("employee_grade", sa.String(length=80), nullable=True),
        sa.Column("basic_salary", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("housing_allowance", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("transport_allowance", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("other_allowances", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("payment_method", sa.String(length=80), nullable=True),
        sa.Column("bank_name", sa.String(length=160), nullable=True),
        sa.Column("bank_account_name", sa.String(length=200), nullable=True),
        sa.Column("iban", sa.String(length=34), nullable=True),
        sa.Column("bank_account_number", sa.String(length=80), nullable=True),
        sa.Column("hr_notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lock_version", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint("lock_version > 0", name="ck_hr_profiles_lock_version_positive"),
        sa.CheckConstraint("basic_salary >= 0", name="ck_hr_profiles_basic_salary_nonnegative"),
        sa.CheckConstraint(
            "housing_allowance >= 0", name="ck_hr_profiles_housing_allowance_nonnegative"
        ),
        sa.CheckConstraint(
            "transport_allowance >= 0", name="ck_hr_profiles_transport_allowance_nonnegative"
        ),
        sa.CheckConstraint(
            "other_allowances >= 0", name="ck_hr_profiles_other_allowances_nonnegative"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "employee_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("record_key", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=True),
        sa.Column("document_number", sa.String(length=120), nullable=True),
        sa.Column("visa_type", sa.String(length=100), nullable=True),
        sa.Column("medical_status", sa.String(length=80), nullable=True),
        sa.Column("insurance_provider", sa.String(length=160), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("declared_status", sa.String(length=80), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.String(length=255), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=80), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("replacement_reason", sa.String(length=500), nullable=True),
        sa.Column("uploaded_by_id", sa.Uuid(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version > 0", name="ck_employee_documents_version_positive"),
        sa.CheckConstraint(
            "size_bytes IS NULL OR size_bytes >= 0",
            name="ck_employee_documents_size_nonnegative",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "record_key", "version", name="uq_employee_doc_version"),
    )
    op.create_index("ix_employee_documents_user_id", "employee_documents", ["user_id"])
    op.create_index(
        "uq_employee_documents_active_record",
        "employee_documents",
        ["user_id", "record_key"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )

    permissions = {
        "UserProfiles.Basic.View": "View employee Basic profile data within User scope",
        "UserProfiles.Basic.Update": "Update employee Basic profile data within User scope",
        "UserProfiles.HR.View": "View sensitive HR profile data within User scope",
        "UserProfiles.HR.Update": "Update sensitive HR profile data within User scope",
        "UserProfiles.PRO.View": "View PRO and document metadata within User scope",
        "UserProfiles.PRO.Update": "Update PRO and document metadata within User scope",
        "UserDocuments.Upload": "Upload private employee documents within User scope",
        "UserDocuments.Replace": "Replace private employee documents with version history",
        "UserDocuments.View": "View private employee document attachments",
        "UserDocuments.Download": "Download private employee document attachments",
        "UserDocuments.Delete": "Inactivate current employee document records",
        "UserDocuments.History": "View immutable employee document version history",
        "UserDocuments.Purge": "Permanently purge employee document versions and files",
    }
    for code, description in permissions.items():
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description"
            ).bindparams(code=code, description=description)
        )
    role_permissions = {
        "OWNER": tuple(permissions),
        "HR": (
            "UserProfiles.Basic.View",
            "UserProfiles.HR.View",
            "UserProfiles.HR.Update",
        ),
        "PRO": (
            "UserProfiles.Basic.View",
            "UserProfiles.PRO.View",
            "UserProfiles.PRO.Update",
            "UserDocuments.Upload",
            "UserDocuments.Replace",
            "UserDocuments.View",
            "UserDocuments.Download",
            "UserDocuments.Delete",
            "UserDocuments.History",
        ),
    }
    for role_code, codes in role_permissions.items():
        for permission_code in codes:
            op.execute(
                sa.text(
                    "INSERT INTO user_type_permissions (user_type_id, permission_code) "
                    "SELECT id, :permission_code FROM user_types WHERE code = :role_code "
                    "ON CONFLICT DO NOTHING"
                ).bindparams(role_code=role_code, permission_code=permission_code)
            )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
