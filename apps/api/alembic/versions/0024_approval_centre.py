"""Approval Centre access; existing workflows remain authoritative."""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0024_approval_centre"
down_revision = "0023_exit_offboarding"
branch_labels = None
depends_on = None


def upgrade():
    for permission in ("Approvals.View", "Approvals.Decide"):
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO NOTHING"
            ).bindparams(
                code=permission, description=permission.replace("Approvals.", "Approval Centre: ")
            )
        )
        for code in ("OWNER", "HR", "GM", "BDM", "SM", "COD", "TL"):
            op.execute(
                sa.text(
                    "INSERT INTO user_type_permissions (id,user_type_id,permission_code) "
                    "SELECT :id,id,:permission FROM user_types WHERE code=:code "
                    "ON CONFLICT (user_type_id,permission_code) DO NOTHING"
                ).bindparams(id=uuid.uuid4(), code=code, permission=permission)
            )


def downgrade():
    raise NotImplementedError("NEXA BOS migrations are forward-only")
