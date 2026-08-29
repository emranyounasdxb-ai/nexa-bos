# Task 9 — Attendance and Official Holidays

Attendance is daily BOS operational data. It does not change Task 8 business performance metrics. Attendance Score / Impact is a separate result for later KPI use.

Business date and clock times use **Asia/Dubai**. Attendance dates are calendar dates; Time In / Time Out are wall-clock times. Overnight shifts are not supported.

## Attendance statuses

Fixed, not user-configurable:

- Present
- Absent
- Leave
- Official Holiday
- Weekly Off

One active record per employee per date.

## Schedules and working days

Working days are company-wide and must be configured explicitly. There is no seeded default week. Until working days are saved, Weekly Off is not suggested. Official Holiday still takes precedence when a holiday exists.

Schedules are Office-wide or Department-within-Office. Each has start time, end time, and grace minutes. Department schedules take precedence over office schedules for employees in that department.

If Present attendance needs a late/early calculation and no schedule exists, the record is saved with `calculationState=schedule_missing`. Hours are not fabricated.

## Ramadan schedule

Kind `ramadan` requires explicit `ramadanFrom` / `ramadanTo`. Dates are never inferred from a calendar or employee religion.

## Late / Early / Incomplete

For Present (and not worked-on-holiday):

- Late starts after Start Time + Grace. Exact late minutes are stored. Equal to the boundary is not late.
- Early Exit when Time Out is before End Time. Exact minutes are stored. Time Out after End Time is not overtime.
- Time In without Time Out → Incomplete Attendance (a condition, not a status). Time Out is never auto-filled.

Official Holiday Present (worked on holiday) does not apply normal late/absence penalties.

## Corrections

`Attendance.Correct` requires a non-empty reason. Old and new values, actor, and timestamp are appended to immutable `attendance_corrections`. Late/early/incomplete are recalculated.

## Leave types

Leave types may be company-custom (`isSystem=false`) or system-defined (`isSystem=true`). System types cannot be deactivated or deleted. Task 9 does not ship a statutory leave-name catalog; an approved legal list is required before any system types are seeded. Leave is marked manually; there is no leave-request workflow or NexaHR integration.

## Official Holidays

Company-wide. They override working-day expectations. Employees are not auto-marked Absent on a holiday. Worked-on-holiday is Present on a holiday date. Holiday-work pay is out of scope.

Weekly Off comes from company working days. Official Holiday takes precedence for the suggested status.

## Holiday reminders

No Redis, workers, or queues. On `GET /api/v1/attendance/reminders` the API materializes an automatic in-app reminder when an Official Holiday is 0–7 Dubai days away. Urgent in-app holiday reminders require `Notifications.SendUrgent` (not `Attendance.Manage`). Email/SMS/WhatsApp are not implemented. Reminder rows are stored so a later Notifications module can consume them without rewriting holiday data.

## Permissions

User Type only:

- `Attendance.View`
- `Attendance.Manage`
- `Attendance.Correct`
- `Attendance.Reports`

Urgent holiday send uses the locked future Notifications permission `Notifications.SendUrgent`. The Notifications module is not implemented.

OWNER has all catalog permissions. OM/HR are not implied. Visibility uses existing user-directory scope (`visible_user_ids`). `Attendance.Reports` does not grant `Reports.View`, and `Reports.View` does not grant attendance reports.

## Attendance Score / Impact

Each rule is Points **or** Percentage for Absence, Late, Early Exit, Incomplete, or a Leave Type. Values are not hardcoded. Approved paid leave may be configured as zero. Score starts at 100 and subtracts configured values per matching record. This never mutates Submitted/Approved/Booked/Funded/PF/CC totals.

## Endpoints

Under `/api/v1/attendance`:

- `GET/PUT /working-days`
- `GET/POST /leave-types`, `PATCH /leave-types/{id}`
- `GET/POST /schedules`, `PATCH /schedules/{id}`
- `GET/POST /holidays`, `PATCH /holidays/{id}`, `POST /holidays/{id}/urgent-reminder`
- `GET /reminders`, `POST /reminders/{id}/dismiss`
- `GET/PUT /impact-rules`
- `GET /filters`, `GET /day`, `PUT /records`
- `GET /records/{id}`, `POST /records/{id}/corrections`
- `GET /reports`, `GET /employees/{id}/summary`

Employee Performance Profile (`GET /api/v1/reports/employees/{id}`) includes `attendanceSummary` when the actor has Attendance.View or Attendance.Reports and directory visibility to that employee. KPI cards are unchanged.

## Migration

`0008_attendance_holidays` adds attendance tables, working days, leave types, schedules, holidays, reminders, impact rules, corrections, the four attendance permission rows, and `Notifications.SendUrgent`.

No new Python/JS dependencies.
