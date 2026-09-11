# Granular session termination

`Users.TerminateSessions` is separate from `Users.Deactivate`. Migration
`0026_terminate_sessions` inserts the permission and grants it only to an existing
OWNER User Type, using an explicit UUID and the `(user_type_id, permission_code)`
conflict target. Reapplying the grant preserves its existing ID. Fresh bootstrap's
existing OWNER-all-permissions behavior also includes it. There are no additional
HR, PRO, GM or other default grants.

`POST /api/v1/users/{user_id}/terminate-sessions` requires an authenticated session,
CSRF protection, the granular permission and existing user-directory object scope.
Non-OWNER actors cannot terminate OWNER sessions even if explicitly granted the
permission later. The body contains only a nonblank `reason` (maximum 1000 characters).

The action atomically deletes all sessions currently belonging to the target and
records `user.sessions.terminate` with actor, target, reason and count. An audit-write
failure rolls back revocation. It does not update the user row, profile, password,
login identity, account status, one-time links or unrelated users' sessions. A normal
subsequent login remains possible. Deactivation retains its existing separate behavior.

The existing Organization & Access / Account & Security area shows the action only
with this permission. Confirmation and a reason are required, with keyboard focus
restoration and double-submit protection. Terminating one's own sessions signs out
the caller too; it does not deactivate or lock the account.

Regression coverage: `test_session_management.py`, `test_session_permission_migration.py`
and `session-management.spec.ts`. All database-backed execution must use the existing
guarded disposable PostgreSQL workflow. This documentation is not deployment approval.
