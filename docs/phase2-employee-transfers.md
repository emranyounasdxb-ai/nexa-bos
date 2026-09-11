# Phase 2 Part 3 — Employee transfers

Single-company AMAFH assignment changes only. No tenant/company identifiers, payroll,
case ownership, attendance editing or production data are introduced.

## Workflow and authorization

- HR/OWNER can prepare a draft; a manager can recommend for a directly assigned
  employee in the same office and, when assigned, the same team. Employees cannot initiate.
- Draft/Returned → Submitted → Reviewed → Approved → Applied. Rejection,
  return and cancellation retain all prior evidence. Approved schedules can be
  superseded by a new independently reviewed transfer; they cannot be edited.
- Reviewer and approver cannot be the employee or requester. Separate HR operators
  can prepare and review; OWNER approval is additionally required. OWNER-created
  drafts cannot be self-approved.
- `Transfers.View` uses existing directory visibility scope. Recommendation scope
  is direct office/team reports, not every descendant or everyone in an office.
  `ViewOwn` returns only the authenticated employee's records. History is separately gated.
- OWNER receives all ten transfer permissions. HR receives operational permissions
  except final approval and manager recommendation. Existing manager types receive
  own view, recommendation and history; employee types receive own view. PRO and
  custom types receive no automatic grant. Existing scope configuration is unchanged.

## Effective dates and transaction safety

Dates use Asia/Dubai. A past date requires OWNER and an audit reason. Approval of a
due transfer applies it in the same transaction. Future approvals leave assignments
unchanged. The API lifespan executor checks due schedules at startup and once per
minute while the API is running. An unavailable API applies overdue schedules on
its next start; it cannot promise execution while offline.

Scheduled execution rechecks the original approver's active OWNER authority,
references, protected OWNER rules and current assignment snapshot. It uses the same
hierarchy advisory lock, employee/transfer row locks and optimistic versioning as
interactive application. Concurrent executors apply a transfer at most once.
An understood application conflict rolls back every assignment/history write and
records `application_error` plus `transfer.application_blocked` audit evidence.
That schedule is not automatically retried. OWNER can explicitly review/apply,
cancel or prepare a superseding record. An unexpected executor failure is logged
and stops that executor rather than silently looping over uncertain operations.

The five assignment fields use existing organization and hierarchy validation and
existing assignment/audit recording inside one transaction. A changed snapshot
fails closed; no silent overwrite of intervening organization changes is allowed.
Transfer events cannot be updated or deleted through the ORM or API.

## Migration and UI

`0022_employee_transfers` follows `0021_contract_register`. It creates nullable
approver/operational metadata and new transfer/event tables; existing employees
are not changed. Permission links use explicit UUIDs and the actual
`(user_type_id, permission_code)` conflict target. Migrations remain forward-only.

The `/transfers` workspace reuses the existing AMAFH Leave/Contracts visual system:
neutral canvas, white operational surfaces, 32px labeled controls, compact tables
and shared accessible dialogs. Status filtering is URL-backed. Draft preparation
has dependent Office → Department → Team controls. Details compare current/proposed
assignments, explain due application, show permission/state-aware actions, and
preserve focus return, confirmation, required comments and double-submit protection.

## Validation boundaries

Only identity-verified disposable PostgreSQL 18.6 and temporary uploads are used.
Tests cover production-shaped existing/absent types, overlap UUID preservation,
fresh head/schema checks, allow/deny scope, independent review, real concurrent
submissions, scheduled execution, supersession/cancellation and transaction rollback
under a real database constraint. Clock-controlled scheduler tests still execute
real authorization and PostgreSQL transactions. Browser tests use normal disposable
logins at 1440×900 and 390×844. No VPS or canonical service operation is authorized.
