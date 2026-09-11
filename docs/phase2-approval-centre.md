# Phase 2 Part 5 — Approval Centre

Single-company AMAFH workflow presentation and individual decisions. This is not
a second authorization engine or a generic approval-rule editor.

## Access and decisions

- `Approvals.View` permits the queue, subject to each underlying module's View
  permission and existing employee visibility. Leave manager review is limited
  to directly assigned employees, never all descendants or similarly named roles.
- `Approvals.Decide` is necessary but insufficient: each displayed action also
  requires the corresponding module permission, scope and valid current step.
  Employees and preparers cannot approve, return, reject or override their own requests.
- The queue delegates mutations to existing Leave, Contract, Transfer and Exit
  services. Those services retain locks, version checks, prerequisites, audit
  events and transaction boundaries. No bulk decisions or delegated approvers.
- Every central decision requires a nonblank comment. Contract approval means
  activation after signed-document validation. Transfer approval first means HR
  review, then independent OWNER approval. Exit approval first confirms notice;
  final completion still requires all clearance and asset checks.
- Exit return restores editable `Draft`, preserving the established lifecycle.
- Module/status/employee/requester/approver/department/requested-date filters
  operate only on authorized records. Queue summaries omit private reasons,
  salary values and documents. Links open existing module workspaces.

## Dashboards and reminders

HR receives current scoped leave, approval, contract-expiry, transfer and exit
counts. Personal HR sections accept no employee selector and expose only the
authenticated employee's authorized balances, requests and contract summary.
PRO's compliance dashboard is unchanged.

Overdue means the existing request/effective date has passed while an approval
step remains open; it is not a fabricated SLA. Refresh queue creates only the
actor's authorized in-app reminders (OWNER can see all overdue scoped records).
Unique notification keys prevent duplicate reminders for the same actor,
record and version. No email/SMTP or new background delivery infrastructure.

Migration `0024_approval_centre` adds explicit UUID, idempotent permission grants
to existing system User Types only. It creates no users or business records and
does not modify custom User Types. Runtime access remains permission/scope driven.

## Validation boundary

Use verified disposable PostgreSQL 18.6 and temporary uploads only. Regression
coverage exercises independent decisions, concurrent stale-version rejection,
own/direct-team/office denial, cancellation sequencing, reminder deduplication,
private summaries, production-shaped permission migration, keyboard/focus,
URL filters and desktop/mobile overflow. Canonical/VPS deployment is excluded.
