"""Separate Basic onboarding from HR employment and login identity."""

import sqlalchemy as sa
from alembic import op

revision = "0025_account_onboarding"
down_revision = "0024_approval_centre"
branch_labels = None
depends_on = None


def upgrade():
    # Existing issued codes and contacts are preserved verbatim. Fail transactionally
    # on ambiguous legacy identifiers rather than choosing an employee or renaming data.
    bind = op.get_bind()
    conflict = bind.execute(
        sa.text(
            "SELECT 1 FROM reserved_employee_codes GROUP BY lower(employee_code) "
            "HAVING count(DISTINCT user_id) > 1 LIMIT 1"
        )
    ).first()
    if conflict:
        raise RuntimeError("Case-insensitive Employee Code conflict requires reviewed resolution")
    op.alter_column("users", "employee_code", existing_type=sa.String(64), nullable=True)
    op.alter_column("users", "designation_id", existing_type=sa.Uuid(), nullable=True)
    op.alter_column("users", "joining_date", existing_type=sa.Date(), nullable=True)
    op.add_column("users", sa.Column("work_email", sa.String(320)))
    op.add_column("users", sa.Column("work_mobile", sa.String(32)))
    op.execute("UPDATE users SET work_email=email, work_mobile=mobile")
    op.create_index(
        "uq_users_employee_code_ci", "users", [sa.text("lower(employee_code)")], unique=True
    )
    op.create_index("uq_users_login_email_ci", "users", [sa.text("lower(email)")], unique=True)
    op.create_table(
        "user_code_reservations",
        sa.Column("user_code", sa.String(16), primary_key=True),
        sa.Column("issued_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), unique=True),
    )
    # Lock the established allocator and advance past all existing issued identifiers.
    op.execute(
        "INSERT INTO user_code_counters (id,last_value) VALUES (1,0) ON CONFLICT (id) DO NOTHING"
    )
    op.execute("SELECT id FROM user_code_counters WHERE id=1 FOR UPDATE")
    op.execute(
        "UPDATE user_code_counters SET last_value=greatest(last_value, coalesce("
        "(SELECT max(substring(user_code from 5)::integer) FROM users "
        "WHERE user_code ~ '^USR-[0-9]+$'),0)) WHERE id=1"
    )
    missing = bind.execute(
        sa.text("SELECT id FROM users WHERE user_code IS NULL OR btrim(user_code)='' ORDER BY id")
    ).all()
    for (user_id,) in missing:
        number = bind.execute(
            sa.text(
                "UPDATE user_code_counters SET last_value=last_value+1 "
                "WHERE id=1 RETURNING last_value"
            )
        ).scalar_one()
        bind.execute(
            sa.text("UPDATE users SET user_code=:code WHERE id=:id"),
            {"code": f"USR-{number:06d}", "id": user_id},
        )


def downgrade():
    raise NotImplementedError("NEXA BOS migrations are forward-only")
