# Attendance Management workspace

The ADMIN_OFFICER workspace reuses existing attendance records, calculations, office visibility, schedules, working days, leave types and approved leave requests. Other user types retain their attendance navigation. New views are Overview, Daily Register, Bulk Upload, Employees, Leave & Holidays and Reports.

## Integrity and scope

Backend visibility combines existing employee visibility with the configured office for office attendance managers. Existing records cannot be silently overwritten: correction requires a reason and retains old/new values, authenticated actor snapshot, timestamp and source. Imports stage immutable file evidence before a separate confirmation; confirmation rechecks employee scope, policies, existing attendance and month locks in one transaction. Warnings require explicit row acknowledgement. Attendance history is not deletable.

Approved external leave evidence requires an actual approval reference and does not approve a leave request, change balances or expose confidential HR reasons/attachments. Existing approved half-day leave contributes half a staff-day to expected attendance. Missing records remain missing, not invented absences. Unknown historical employment start dates are not inferred; today's active staff can still appear. Missing working-week configuration leaves expected attendance and percentage unavailable.

## Additive storage, not applied

Prepared migration `0029_attendance_management` adds import batches, immutable record provenance, approved-leave evidence, office holidays and append-only month-close/reopen events. It also adds close/reopen permissions for OWNER and existing HR attendance-policy managers. It does not grant policy management to ADMIN_OFFICER or change user assignments. Original attendance record columns remain unchanged.

The migration has NOT been executed. With existing revision 0028, original attendance and read-only management reports remain available; imports, external approved-leave recording, office holiday editing and month closing respond with a clear setup-required message. No startup script runs migrations or bootstrap. Runtime review of those storage-backed features requires a separately authorized database update.

## Reports and preview

Ten attendance reports reuse scoped roster/audit data and support CSV, styled Excel, A4 portrait PDF and Print. Employee history requires a selected employee. Import history requires new storage. Basic employee information is available only within attendance scope. Month closing is office-specific; corrections respect the original recorded office as well as the employee's current office. Reopening requires a reason and explicit policy permission.

Preview remains frontend 13117 / API 18117 / disposable database nexa_figma_retry_test on 25517. Build preparation does not alter data. No automated tests, real attendance entries, imports, corrections or leave actions were executed. Browser/export rendering and storage-backed runtime behavior remain unverified under these restrictions.
