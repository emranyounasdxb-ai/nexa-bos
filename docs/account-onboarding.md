# Basic onboarding and account access

The route-backed Create User dialog reserves a server-issued `USR-` code and submits
Full Name, Personal Email, Personal Mobile and that read-only code. Code reservations
are issued under the existing counter row lock, owned by the requesting administrator,
single-use and audited. Abandoned reservations are not recycled. The existing unique
User Code constraint remains authoritative.

New Basic users have the existing API account status `pending` (Pending Setup in the
UI), no assigned User Type, and no invented employment date, Employee Code or designation.
The successful redirect remains the employee profile. The prior complete-user API
payload remains compatible; the UI does not submit or display those legacy fields.

Account & Security remains in Organization & Access. Setup requires an assigned active
non-PENDING type and no existing password; consuming the existing one-time setup link
activates the account atomically. Configured expiry/password policy and reset semantics
remain unchanged. OWNER cannot be reassigned or deactivated. The separate granular
session action is documented in [session-management.md](session-management.md).

Personal Email is the initial login identity. HR Work Email/Work Mobile are separate
fields and do not change login identity. Existing work contacts are backfilled verbatim.
Full Name is canonical for the new Basic form/edit surfaces; historical first/middle/last
name data is retained. Employee Code is entered in HR Profile, case-insensitively unique,
and immutable once assigned, including rehire. Existing historical reservations remain
effective. An HR employment period is created only after code and joining date exist.

Migration `0025_account_onboarding` preserves existing identity values, makes unassigned
employment fields nullable, adds separate work contacts, and backfills only blank/missing
User Codes after advancing the locked counter beyond issued values. Ambiguous legacy
case-insensitive identifiers fail transactionally rather than rename or discard data.
Migration `0026_terminate_sessions` follows it; both are forward-only. No production
data, seeds, credentials, tenant model or Phase 2 workflow changes are included.

Validation uses only explicitly guarded disposable PostgreSQL and disposable browser
accounts. This document does not authorize deployment or production initialization.
