"""Business units and permanent organization-master deletion evidence.

Existing assignments are deliberately left unmapped. No organization records are seeded.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0027_org_business_units"
down_revision = "0026_terminate_sessions"
branch_labels = None
depends_on = None

HISTORIES = (
    ("office_name_history", "office_id", "offices"),
    ("department_name_history", "department_id", "departments"),
    ("designation_name_history", "designation_id", "designations"),
    ("team_name_history", "team_id", "teams"),
)


def upgrade():
    op.create_table(
        "business_units",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("office_id", sa.Uuid(), sa.ForeignKey("offices.id"), nullable=False),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id"), nullable=False),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
    )
    for table in ("teams", "users"):
        op.add_column(table, sa.Column("business_unit_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_business_unit_id", table, "business_units", ["business_unit_id"], ["id"]
        )
    op.create_table(
        "business_unit_name_history",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("original_record_id", sa.Uuid(), nullable=False),
        sa.Column(
            "business_unit_id", sa.Uuid(), sa.ForeignKey("business_units.id", ondelete="RESTRICT")
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "organization_master_deletions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("record_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("record_type", sa.String(32), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("name_history", JSONB(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
    )
    inspector = sa.inspect(op.get_bind())
    for table, column, parent in HISTORIES:
        op.add_column(table, sa.Column("original_record_id", sa.Uuid(), nullable=True))
        op.execute(sa.text(f'UPDATE "{table}" SET original_record_id = "{column}"'))
        op.alter_column(table, "original_record_id", nullable=False)
        for fk in inspector.get_foreign_keys(table):
            if fk["constrained_columns"] == [column]:
                op.drop_constraint(fk["name"], table, type_="foreignkey")
        op.alter_column(table, column, nullable=True)
        op.create_foreign_key(
            f"fk_{table}_live_master", table, parent, [column], ["id"], ondelete="RESTRICT"
        )
    for fk in inspector.get_foreign_keys("team_leader_history"):
        if fk["constrained_columns"] == ["team_id"]:
            op.drop_constraint(fk["name"], "team_leader_history", type_="foreignkey")
    op.create_foreign_key(
        "fk_team_leader_history_team",
        "team_leader_history",
        "teams",
        ["team_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Name changes remain supported while live. Detached history is immutable forever.
    op.execute("""
        CREATE FUNCTION preserve_org_name_history() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE live_id uuid; old_live_id uuid;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Organization name history cannot be deleted';
          END IF;
          live_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
          IF TG_OP = 'INSERT' THEN
            IF live_id IS NULL THEN RAISE EXCEPTION 'A live master is required'; END IF;
            NEW.original_record_id := live_id;
          ELSE
            old_live_id := (to_jsonb(OLD)->>TG_ARGV[0])::uuid;
            IF old_live_id IS NULL OR
               NEW.original_record_id IS DISTINCT FROM OLD.original_record_id THEN
              RAISE EXCEPTION 'Archived organization name history is immutable';
            END IF;
            IF live_id IS NOT NULL AND live_id IS DISTINCT FROM old_live_id THEN
              RAISE EXCEPTION 'Organization name history cannot be reassigned';
            END IF;
            IF live_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM organization_master_deletions WHERE record_id = OLD.original_record_id
            ) THEN RAISE EXCEPTION 'A permanent deletion snapshot is required'; END IF;
          END IF;
          RETURN NEW;
        END $$
    """)
    for table, column, _ in (
        *HISTORIES,
        ("business_unit_name_history", "business_unit_id", "business_units"),
    ):
        op.execute(
            f"CREATE TRIGGER preserve_history BEFORE INSERT OR UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION preserve_org_name_history('{column}')"
        )
    op.execute("""
        CREATE FUNCTION reject_org_deletion_evidence_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Organization deletion evidence is immutable'; END $$
    """)
    op.execute(
        "CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE "
        "ON organization_master_deletions FOR EACH ROW "
        "EXECUTE FUNCTION reject_org_deletion_evidence_mutation()"
    )


def downgrade():
    raise NotImplementedError("NEXA BOS migrations are forward-only")
