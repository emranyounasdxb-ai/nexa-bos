# Phase 2 Part 4 — Exit and offboarding

Single-company AMAFH lifecycle; no payroll calculation, tenancy, new storage system,
production fixtures or external integrations.

## Workflow

Employees with `Exits.Request` prepare/submit their own resignation. Scoped HR/OWNER
operators can initiate Resignation, Termination, End of Contract or Other. One open
exit per employee is enforced by a partial unique index. OWNER cannot be offboarded.

Draft → Submitted → Notice Period → Clearance in Progress → Ready to Close → Completed.
Submitted requests can be returned to Draft or rejected to Cancelled with a reason.
Employees can cancel their own Draft/Submitted request; scoped operators can cancel
uncompleted exits. Submitted/approved information cannot be edited silently.

Manager handover, company assets, IT access, Finance clearance, HR documents and
final approval each carry an explicit assignee, status, note and timestamp. Only the
assigned authorized operator can decide an item. Assignment and clearance are separate
audited actions; reassignment resets clearance. The employee cannot clear their own exit.
Final approval requires an independent OWNER and cannot be marked not applicable.
Where no manager exists, an assigned operator must explicitly record not applicable
with a reason instead of inventing a manager or a successful handover.

Preparation and approval remain independent. HR-prepared requests need a different
operator for notice/ready decisions. OWNER-created requests cannot be self-approved.

## Completion and reopening

Completion requires all assigned clearance items, final OWNER approval, the reached
last-working date and no currently outstanding asset allocations. Assets must be returned
through their existing controlled workflow; no Asset records are changed here.
The existing employment update service runs inside the exit transaction: employment
status/history, account deactivation, session revocation and team-leadership safeguards
are committed together with immutable exit/audit events. Any failed constraint rolls
the entire operation back. Earlier statuses leave the employee account/session intact.

Only OWNER can reopen a completed exit with a reason. Reopening resets clearance for
review and preserves prior evidence; it does not reactivate the employee or restore
sessions. Any later rehire/reactivation remains a separate existing controlled action.
Settlement stores status/reference only, not salary or final-settlement calculations.

## Permissions and privacy

Separate ViewOwn, View, Request, Create, Edit, Progress, Assign, Clearance, Approve,
ReturnReject, Cancel and History permissions use the existing User Type architecture.
Operational access enforces existing directory scope. Assigned operators outside that
scope see only their clearance items, not the reason, settlement reference or full history.
Assignment access does not confer operational edit/approval rights. Employee own view
does not reveal other operators' clearance notes or settlement information.

OWNER receives protected complete access; HR receives operations but not final approval.
Other existing non-PRO system types receive own request/status and assigned clearance
only. PRO and unlisted custom types receive no automatic grant. No existing scopes change.
There are no configurable settings in this module, so no unused Settings permission is added.

## Migration, UI and tests

`0023_exit_offboarding` follows `0022_employee_transfers`, adds only exit/clearance/event
tables and idempotent explicit-UUID permission links. Existing employee rows remain unchanged.
Migrations remain forward-only. UI uses the existing neutral AMAFH workspace, compact
controls, shared dialogs/tables, URL status filter, confirmation comments and focus return.

Validation uses identity-verified disposable PostgreSQL 18.6, production-shaped existing
and absent role upgrades, real transactions/concurrency/session tests and desktop/mobile
browser flows. No VPS or canonical database/service operation is part of this delivery.
