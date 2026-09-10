# Leave management

Leave is a single-company AMAFH workflow built on the existing employee, User Type, reporting
manager, working-week and official-holiday records.

## Configuration and balances

The system-defined type names are Annual, Sick, Unpaid, Maternity, Parental, Bereavement, Study and
Other. They start with zero entitlement. `Leave.Settings` configures paid status, eligibility text,
yearly entitlement, monthly accrual, carry-forward controls, half-day availability and attachment
requirements. Balance exceptions and adjustments require explicit permission, a reason and audit
evidence.

Working days are calculated in Asia/Dubai from the configured company working weekdays and official
holidays. A missing working-week configuration fails closed. Overlapping active requests and
negative available balances are rejected unless OWNER uses the separately permissioned audited
override.

## Lifecycle and privacy

An employee manages Draft and Returned requests for themself; an explicitly permitted HR operator
may create or correct a request for an employee. Normal approval is direct Reporting Manager then
HR. Self-approval is forbidden. Approved cancellations follow manager then HR approval when a
reporting manager exists. Optimistic version checks reject stale writes.

Request events and balance adjustments are immutable. Private reasons, exception notes and
attachments are visible only to the employee, HR approvers and OWNER. Reporting managers receive
the decision context without private medical details. The team calendar contains employee name,
dates and status only.

Attachments reuse `FILE_STORAGE_DIR` under `leave-attachments`, accept only validated PDF, JPEG,
PNG or WebP content up to 10 MB, and use generated collision-resistant storage keys. Replacement
retains the earlier immutable version and every view/download is audited.
