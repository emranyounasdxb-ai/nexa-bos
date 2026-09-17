# Customers-reference list typography review — 2026-09-17

Work is local on `codex/figma-v2-app-design`. This task standardizes record typography; it does not authorize delivery or change Figma, navigation, page headings, business logic, APIs, permissions, columns or workflows. The inherited worktree is preserved.

## Rendered reference

Customers was measured in Chrome at 100% zoom, DPR 1 and visual viewport scale 1. Manrope is the computed family in both themes. The Customers source is byte-for-byte unchanged from this task's starting snapshot (SHA-256 `5CB46D0126F75448C833D974824FC171E737A6655CD2BD534C23CEA395F63853`).

| Role | Desktop 1920 × 1031 | Tablet 1194 × 834 | Mobile 393 × 852 |
| --- | --- | --- | --- |
| Visible table heading | 11px / 15.95px, weight 600 | 11px / 15.95px, weight 600 | Card labels replace headings |
| Table row / record link | 12px / 17.4px | Customers retains 12px / 17.4px | Card primary/name/link 14px / 21px |
| Secondary text | 11px / 20px | 12px / 20px in compact records | 12px / 20px |
| Status label | 11px / 20px, weight 500 | 12px / 20px | 12px / 20px |

Customer names use weight 500; desktop ordinary cells use weight 400. Tablet screens that already use record cards adopt the mobile primary 14px / 21px scale. Remaining scrollable tables keep 12px rows rather than shrinking their type to fit. Colors and previously approved accessibility adjustments are retained.

## Corrections

Shared TableShell and RecordIdentity/RecordCard consume measured table/list tokens. Row links, nested primary text, secondary text, badges, disclosure summaries and responsive column labels have explicit roles. Removed conflicting table typography in Applications, Organization, Designations, Assets, Asset Reports, catalogue and HR/PRO styles. Native TL case queues consume equivalent tokens. Corrected compact contract names, hierarchy identities, attendance impact-rule lists, personal HR lists, employee-report lists and KPI scorecard record names. Large business metric values remain prominent.

Applications desktop previously rendered 8px headings and 9px rows/links; it now renders 11px headings, 12px rows/links and 11px secondary text. Its compact record identities render 14px with 12px supporting/status text. Existing row geometry generally accommodates these sizes without extra padding. The unassigned leave list in My Workspace required responsive column wrapping: screenshot review found tablet overlap in its former two-column layout. The final wrapping correction has build/typecheck coverage but still requires a fresh rendered screenshot.

## Route and state coverage

All captured scenarios use the three viewports above in light and dark themes. Native viewport, full-page and focused record/disclosure captures are stored outside Git at `C:/Users/emran/Documents/NEXA-BOS-Evidence/list-typography-20260917/`. Contact sheets support visual review; focused locator screenshots can include fixed-header overlays during scrolling and are not standalone proof of an overlap. Native screenshots are retained for that distinction.

| Page / tab | Captured coverage | Remaining limits |
| --- | --- | --- |
| Customers, Applications, Users, Designations | Six states each; populated rows and compact cards | Customers reference preserved |
| Organization: Offices, Departments, Business Units, Teams; Hierarchy | Six states each; populated records | — |
| Catalogue: Banks, Products, Variants, Mappings | Six states each; populated records | — |
| Catalogue: Amount & Target Rules | Six states; current form composition | Product-specific conditional content not exhaustively opened |
| Workflows | Six states; selection screen | Selected-version stages, transitions and preview not rendered in this run |
| Attendance, Holidays, Attendance Reports, Schedules | Six states each | Attendance Reports had an empty result; populated report and impact-rule variants not exhaustively verified |
| HR and PRO | Six states each; populated staff records and disclosures | Every conditional employee compliance state not exercised |
| Leave: My Leave, Approvals, Calendar, Settings | Six states each | Calendar was empty; no submission/approval actions performed |
| Contracts | Six states; My Contract empty state | Register, Expiry Reminders and Contract Types tabs need rendered verification |
| Transfers, Exit/Offboarding | Six states; empty registers | Populated rows need rendered verification |
| Approval Centre | Six states; populated records | No decisions submitted |
| Case Operations: Rules | Six states; empty rules table | Routing only partial; Clawbacks, Reports and Stage CSV not fully captured |
| Assets, Categories, Asset Reports register | Six states each; populated records/cards | Additional allocation/history disclosure variants not exhaustive |
| Asset report variants | Six states for each authorized option: Available Stock, Allocated Assets, Employee-wise Assets, Office-wise Inventory, Damaged, Lost, Under Repair, Returned, Asset History, Outstanding | Damaged/Lost/Under Repair/Outstanding had empty results |
| Finance: Payouts, Commission Rules, Incentive Plans | Six states each; current empty states | Populated finance records need rendered verification |
| Targets and KPI Scorecards | Six states; populated target rows and scorecard | Latest KPI record-name correction captured in batch D |
| OWNER Reports / My Workspace | Six states; HR lists inspected | Final unassigned-leave wrapping correction requires re-capture |
| Comparison, Drill-down, Employee Report | Six states each; populated drill-down/employee rows | Comparison had no populated ranking rows |
| Personal Notifications, Notification Administration, Security | Six states each; administration audit rows populated | Personal notifications empty; conditional security/form states not exhaustive |
| Application, Customer, Asset, Designation detail; User detail HR/PRO/Organization/Assets/History tabs | Eleven existing-record scenarios, six states each | Several tabs had no visible table rows; Owner asset allocations empty |
| SE Reports, Applications, Customers | Six states each using an existing SE test identity | Last HR wrapping change was not re-captured |
| TL / coordinator dashboards | Source styles reviewed; TL queue typography corrected | No existing disposable TL/coordinator identities; no rendered role verification claimed |

This is 65 complete OWNER route/tab captures plus three SE route captures, not a passing 68-scenario gallery or a full functional-suite result. Form-only create/edit screens and conditionally populated views are not marked visually verified. No dummy data or new accounts were created to fill missing states.

## Checks and runtime status

- Lint passed, including the final app/components lint; typecheck passed after the wrapping fix.
- Production `next build --webpack` passed after the wrapping fix (51 generated pages). The external verification checkout reuses installed dependencies; a default Turbopack invocation failed because its dependency junction points outside that checkout. No repository build configuration or dependency was changed for that limitation.
- Read-only Customers/record gallery batch A passed: first 18 route/tab scenarios, six states each. Later batches produced the captures listed above but failed before their final assertions: a hidden chart-list capture selector, one sign-in redirect, and a sidebar geometry assertion while the preview/build assets overlapped. These batches are not reported as passing.
- Applications search, page-size/pagination control and existing record-link regression passed. SE read-only responsive gallery passed. Sorting has no matching affordance on the inspected Applications table; no sorting interaction result is claimed. Business mutations and submission workflows were intentionally not executed for this typography task.
- Testing used the existing, identity-verified disposable PostgreSQL container `nexa-figma-v2-test-20260917`, database `nexa_figma_retry_test`, isolated API 18117 and verification frontend 13117. Canonical PostgreSQL 15432, API 18000 and frontend 13000 were preserved. No resets, seeds, migrations or backend changes were performed.
- After rebuilding, restarting only the isolated frontend was rejected twice by automatic approval review with `blocked by policy` and no more specific reason. The isolated frontend is therefore stopped. Final runtime checks listed as pending remain incomplete.
- The canonical branch preview remains available at `http://localhost:13000/applications`: HTTP 200 and updated typography CSS confirmed. The browser is open there at sign-in; its existing database/session was not replaced with disposable test credentials.

No files were removed, and no commit, push, merge or deployment was performed during this typography task. Temporary exports, screenshots and build checkout remain outside repository deployment output.

## Authorized release follow-up

The subsequent release request authorizes commit/push/PR, subject to completed verification and protected-main gates. Fresh rendered OWNER screenshots now verify the final My Workspace leave wrapping at all three reference widths in both themes. Additional Contracts, Case Operations and selected-version Workflow inspections and remaining blockers are recorded in [the release review](ui-figma-v2-release-review.md). Earlier pending entries above are preserved as historical evidence rather than silently treated as passed.
