"""Add attendance import, approval evidence and month-close history only.

Prepared only. Does not seed employees or attendance and must not run at preview startup.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0029_attendance_management"
down_revision = "0028_case_operations"
branch_labels = None
depends_on = None


def fk(name, target, nullable=False, **kwargs):
    return sa.Column(name, sa.Uuid(), sa.ForeignKey(target), nullable=nullable, **kwargs)


def stamp(name="created_at", nullable=False):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def identifier():
    return sa.Column("id", sa.Uuid(), primary_key=True)


def upgrade():
    op.create_table("attendance_import_batches", identifier(), sa.Column("reference", sa.String(64), nullable=False, unique=True),
                    sa.Column("filename", sa.String(255), nullable=False), sa.Column("fingerprint", sa.String(64), nullable=False),
                    fk("office_id", "offices.id", True), fk("uploader_id", "users.id"), sa.Column("uploader_snapshot", JSONB, nullable=False),
                    sa.Column("rows", JSONB, nullable=False), stamp(), stamp("confirmed_at", True), fk("confirmed_by_id", "users.id", True),
                    sa.Column("confirmation_snapshot", JSONB), sa.Column("results", JSONB), sa.UniqueConstraint("uploader_id", "fingerprint"))
    op.create_table("attendance_provenance", fk("attendance_id", "attendance_records.id", primary_key=True), sa.Column("source", sa.String(32), nullable=False),
                    fk("office_id", "offices.id", True), fk("batch_id", "attendance_import_batches.id", True), sa.Column("actor_snapshot", JSONB, nullable=False), stamp())
    op.create_table("attendance_month_events", identifier(), fk("office_id", "offices.id"), sa.Column("month", sa.Date(), nullable=False),
                    sa.Column("action", sa.String(16), nullable=False), sa.Column("reason", sa.Text(), nullable=False), fk("actor_id", "users.id"),
                    sa.Column("actor_snapshot", JSONB, nullable=False), stamp(), sa.CheckConstraint("action IN ('closed','reopened') AND length(trim(reason)) > 0", name="ck_attendance_month_action"))
    op.create_index("ix_attendance_month_events_office_id", "attendance_month_events", ["office_id"])
    op.create_index("ix_attendance_month_events_month", "attendance_month_events", ["month"])
    op.create_table("attendance_leave_evidence", identifier(), fk("employee_id", "users.id"), fk("leave_type_id", "leave_types.id"), fk("office_id", "offices.id"),
                    sa.Column("start_date", sa.Date(), nullable=False), sa.Column("end_date", sa.Date(), nullable=False), sa.Column("approval_reference", sa.String(200), nullable=False),
                    sa.Column("note", sa.Text()), fk("actor_id", "users.id"), sa.Column("actor_snapshot", JSONB, nullable=False), stamp(),
                    sa.CheckConstraint("end_date >= start_date AND length(trim(approval_reference)) > 0", name="ck_attendance_leave_evidence_dates"))
    op.create_index("ix_attendance_leave_evidence_employee_id", "attendance_leave_evidence", ["employee_id"])
    op.create_table("attendance_office_holidays", identifier(), fk("office_id", "offices.id"), sa.Column("holiday_date", sa.Date(), nullable=False),
                    sa.Column("name", sa.String(200), nullable=False), fk("actor_id", "users.id"), stamp(), sa.UniqueConstraint("office_id", "holiday_date"))
    op.execute("""CREATE FUNCTION attendance_history_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Attendance history is immutable'; END $$""")
    for table in ("attendance_provenance", "attendance_month_events", "attendance_leave_evidence", "attendance_corrections"):
        op.execute(f"CREATE TRIGGER attendance_history_read_only BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION attendance_history_read_only()")
    op.execute("CREATE TRIGGER attendance_record_no_delete BEFORE DELETE ON attendance_records FOR EACH ROW EXECUTE FUNCTION attendance_history_read_only()")
    op.execute("""CREATE FUNCTION attendance_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Import history cannot be deleted'; END IF;
        IF OLD.confirmed_at IS NOT NULL OR NEW.id IS DISTINCT FROM OLD.id OR NEW.reference IS DISTINCT FROM OLD.reference
           OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
           OR NEW.office_id IS DISTINCT FROM OLD.office_id OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
           OR NEW.uploader_snapshot IS DISTINCT FROM OLD.uploader_snapshot OR NEW.rows IS DISTINCT FROM OLD.rows
           OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.confirmed_at IS NULL OR NEW.confirmed_by_id IS NULL
           OR NEW.confirmation_snapshot IS NULL OR NEW.results IS NULL THEN RAISE EXCEPTION 'Import evidence is immutable'; END IF;
        RETURN NEW; END $$""")
    op.execute("CREATE TRIGGER attendance_batch_guard BEFORE UPDATE OR DELETE ON attendance_import_batches FOR EACH ROW EXECUTE FUNCTION attendance_batch_guard()")
    for code, description in (("Attendance.CloseMonth", "Close scoped attendance months with an audit reason"), ("Attendance.ReopenMonth", "Reopen scoped attendance months with an audit reason")):
        op.execute(sa.text("INSERT INTO permissions (code, description) VALUES (:code, :description) ON CONFLICT (code) DO NOTHING").bindparams(code=code, description=description))
        op.execute(sa.text("INSERT INTO user_type_permissions (id, user_type_id, permission_code) SELECT gen_random_uuid(), id, :code FROM user_types WHERE code = 'OWNER' OR (code = 'HR' AND EXISTS (SELECT 1 FROM user_type_permissions p WHERE p.user_type_id = user_types.id AND p.permission_code = 'Attendance.Manage')) ON CONFLICT DO NOTHING").bindparams(code=code))


def downgrade():
    raise RuntimeError("Attendance evidence must be preserved. Use a reviewed forward migration instead.")
