# Assets and Attendance User Type authorization

Permissions belong only to editable User Types. OWNER retains implicit full access and its protected matrix. No per-user grants or account-specific permission exceptions are introduced.

## Permission mapping

| Permission code | Editor label | Registration |
| --- | --- | --- |
| Assets.View | View Assets | Reused |
| Assets.ManageStock | Register Assets | Reused |
| Assets.ManageMaster | Edit Assets and correct condition / identifiers | Reused |
| Assets.Allocate | Issue Assets | Reused |
| Assets.Return | Return Assets | Reused |
| Assets.Transfer | Transfer Assets | Reused |
| Assets.ManageStatus | Update lost or damaged asset status | Reused |
| Assets.ViewAudit | View Asset Lifecycle | Reused |
| Attendance.View | View Attendance | Reused |
| Attendance.Manage | Manage Shifts and Attendance Policies — Sensitive | Reused |
| Attendance.ManageOffice | Add Manual Attendance | Reused |
| Attendance.Correct | Correct Attendance — reason and immutable audit required | Reused |
| Attendance.Reports | View Attendance Reports | Reused |
| Attendance.CloseMonth | Close Attendance Month | Reused |
| Attendance.ReopenMonth | Reopen Attendance Month — Sensitive and mandatory reason | Reused |
| Assets.ManageCategories | Manage Asset Categories — Sensitive | Added |
| Assets.Repair | Send to Repair / Update Repair | Added |
| Assets.Retire | Retire Assets | Added |
| Assets.Reports | View Asset Reports | Added |
| Assets.Export | Export Asset Reports | Added |
| Attendance.Daily | View Daily Register | Added |
| Attendance.Calendar | View Employee Calendar | Added |
| Attendance.Upload | Upload and Validate Attendance CSV | Added |
| Attendance.ConfirmImport | Confirm Attendance Import | Added |
| Attendance.RecordApprovedLeave | Record External Approved Leave | Added |
| Attendance.Export | Export Attendance Reports | Added |
| Attendance.ManageHolidays | Manage Holidays — Sensitive | Added |
| Attendance.ManageLeaveTypes | Manage Leave Types — Sensitive | Added |

## Dependencies

Every Assets action requires Assets.View; every Attendance action requires Attendance.View. Assets.Export additionally requires Assets.Reports. Attendance.Export additionally requires Attendance.Reports. ConfirmImport and ReopenMonth are independent grants, not implied by Upload or CloseMonth. The editor includes required grants on selection, removes dependants when a requirement is cleared, and retains sensitive Select All confirmation. Backend assignment rejects incomplete dependencies; effective permission calculation removes orphan grants.

Existing visibility scopes alone continue controlling records; no account-type or management-permission exception selects a broader scope. Permission grants cannot widen office/employee scope. Global categories retain company scope. Company-wide attendance settings require company scope; office holiday and shift operations retain scoped validation. Existing reasons, corrections, import validation and immutable actor/audit history remain unchanged.

## Prepared database registration

0030_module_permissions follows the previously prepared 0029_attendance_management. It registers missing codes and splits equivalent historical User Type grants without changing users, office assignments or business records. It is NOT executed or run at startup. The editor lists new codes from the code-defined catalog. Saving unregistered grants returns a friendly 503 until separately authorized database registration; non-OWNER legacy bundled access is not fully activated under the split guards. Preview restart does not apply migrations or synthesize permissions.

No automated tests or real asset/attendance operations were run. Production frontend compilation and API packaging are build checks only; permission-combination browser/API regression verification remains incomplete.

## Files changed for this task

- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/identity/permissions.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/identity/access.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/identity/user_types_service.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/assets/api.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/assets/service.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/attendance/api.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/attendance/management_api.py`
- `C:/Projects/nexa-bos/apps/api/nexa_bos_api/attendance/management_guards.py`
- `C:/Projects/nexa-bos/apps/api/alembic/versions/0030_module_permissions.py`
- `C:/Projects/nexa-bos/apps/web/lib/module-permissions.ts`
- `C:/Projects/nexa-bos/apps/web/lib/auth-context.tsx`
- `C:/Projects/nexa-bos/apps/web/components/app-shell.tsx`
- `C:/Projects/nexa-bos/apps/web/app/user-types/[id]/page.tsx`
- `C:/Projects/nexa-bos/apps/web/app/assets/asset-workspace.tsx`
- `C:/Projects/nexa-bos/apps/web/app/assets/asset-details.tsx`
- `C:/Projects/nexa-bos/apps/web/app/assets/asset-lifecycle.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/page.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/reports/page.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/holidays/page.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/attendance-workspace.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/attendance-polish.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/attendance-management.tsx`
- `C:/Projects/nexa-bos/apps/web/app/attendance/attendance-records.tsx`
- `C:/Projects/nexa-bos/docs/assets-attendance-permissions.md`
