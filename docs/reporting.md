# Task 8 — Performance / MIS reporting

NEXA BOS derives dashboard and report figures from operational application data and existing owner / organization history. There are no snapshot tables, Redis caches, or background workers.

## Reporting periods

Dashboard default is **MTD**. Supported periods:

- Today
- MTD
- Previous Month
- QTD
- Previous Quarter
- Half-Year
- YTD
- Since Joining (employee joining date through today)
- Custom (From / To via the NEXA BOS Date Picker)

Bounds are inclusive UTC calendar days. Each metric uses the business-event timestamp for that metric, not “now”, except **Pending** which is a current-state cutoff metric.

## Event-time attribution

Performance credit belongs to the Case Owner (and office / team snapshot) on `application_owner_history` at the event timestamp:

| Metric | Event date |
| --- | --- |
| Applications Owned | Application created |
| Submitted | Original `submitted_at` |
| Approved | Approval event |
| Booked | Booking event |
| Funded | Fund release event |
| Terminal outcomes | Actual terminal event |
| Returned / Resubmitted | Those workflow events |

Reassignment after an event does not move historical credit. Historical organization attribution uses the owner-history office / department / team captured at the event.

## Pending

Pending counts applications that exist at the selected period **cutoff** and are not yet terminal at that cutoff. Applications created in an earlier period can appear in current Pending. Stage breakdown and Pending drill-down use occupancy at cutoff.

## Roll-up

Employee → Team → Reporting Hierarchy → Office → Company, using event-time owner history. Team reporting scope follows the reporting-manager hierarchy (including effective-dated manager history).

## Reporting scopes

Configured on User Types (`reporting_visibility_scope`), independent of directory / customer / application visibility:

- Company-wide
- Office
- Team / Reporting Hierarchy
- Own Performance

OWNER is always company-wide. Dashboard / Reports permission with **no** reporting scope returns empty data (zeros, no identities). Scope is derived from the authenticated session, never from client-supplied scope parameters.

## Permissions

User-type only:

- `Dashboard.View`
- `Reports.View`
- `Reports.ExportExcel`
- `Reports.ExportPDF`
- `Reports.Print`

## Primary endpoints

All under `/api/v1`:

- `GET /reports/dashboard`
- `GET /reports/applications` (drill-down)
- `GET /reports/rankings`
- `GET /reports/comparisons`
- `GET /reports/employees/{id}`
- `GET /reports/filters`
- `POST /reports/export` (`xlsx` | `pdf` | `print`)
- `PUT /user-types/{id}/reporting-scope`

## Rankings and comparisons

Selectable ranking metrics: Submitted Value, Booked Value, Funded Value, Case Count. Exact equal performance shares the same rank (competition ranking).

Period comparisons: current vs previous month / quarter / half-year / year, or custom vs custom. Entity comparisons: employee, team, office, bank, product. Zero denominators and zero baselines return `null` / `n/a`, never Infinity or NaN.

## Exports

Excel is a real `.xlsx` workbook (`openpyxl==3.1.5`). PDF is generated with `fpdf2==2.8.8`. Print returns HTML. Each file includes report title, generated timestamp, period, active filters, reporting scope, generated-by, and row/total counts where relevant. Export actions are audited (`reports.export`) without storing file contents.

These two libraries were added because Tasks 1–7 had no spreadsheet or PDF generator, and the Task 8 contract forbids substituting CSV for Excel.

## Migration

`0007_reporting_mis` adds `user_types.reporting_visibility_scope` and the five reporting permission rows.
