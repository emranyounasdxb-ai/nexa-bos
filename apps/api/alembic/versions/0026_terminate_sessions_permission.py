"""Explicit OWNER-only default for granular session termination."""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0026_terminate_sessions"
down_revision = "0025_account_onboarding"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            "INSERT INTO permissions (code, description) VALUES (:code, :description) "
            "ON CONFLICT (code) DO NOTHING"
        ).bindparams(
            code="Users.TerminateSessions",
            description="Terminate user sessions without changing the account",
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
            "SELECT :id, id, :permission FROM user_types WHERE code='OWNER' "
            "ON CONFLICT (user_type_id, permission_code) DO NOTHING"
        ).bindparams(id=uuid.uuid4(), permission="Users.TerminateSessions")
    )


def downgrade():
    raise NotImplementedError("NEXA BOS migrations are forward-only")
