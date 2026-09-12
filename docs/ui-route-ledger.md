# Reference-led application route ledger

Inventory from tracked App Router pages, not the build's generated-page total.
There are 48 normal route entries and three parallel-modal implementations. Dynamic
records and query-backed tabs are states of these routes, not additional invented pages.

Permission names below describe the existing access contract, not new grants. OWNER
and all other roles retain their effective permissions and server-derived scopes.
The special organization/catalogue reader and OWNER/GM customer/workflow rules remain
in `lib/role-access.ts`. Direct API authorization remains authoritative.

`Shared` means the page inherits Part 1 controls/surfaces/tables; it is not a claim of
visual verification. `Refined` identifies Part 2/3 presentation changes. Part 4 records
actual captures and state limitations in its external evidence index.

| Route | Access / state | Design source and page family |
| --- | --- | --- |
| `/` | Auth-dependent redirect | Shared shell; redirect, no independent screen |
| `/login` | Public | Shared authentication form |
| `/bootstrap` | Public, bootstrap availability | Shared setup form; no canonical bootstrap |
| `/setup` | Public, valid one-time token | Shared account setup form |
| `/reset` | Public, valid one-time token | Shared reset form |
| `/status` | Public | Shared status/health surface |
| `/account` | Authenticated self | Shared personal identity, mobile/photo controls |
| `/security` | Existing OWNER security settings contract | Shared settings form |
| `/reports` | Dashboard.View / existing reporting scope | Refined: 13 role presentations; TL four URL tabs |
| `/reports/compare` | Reports.View and reporting scope | Shared reporting controls/charts |
| `/reports/drill-down` | Dashboard.View or Reports.View, reporting scope | Shared reporting table |
| `/reports/employees/[id]` | Existing scoped employee reporting access | Refined section headings; existing metrics |
| `/applications` | Applications.View and case scope | Shared queue/table/filter/create dialog |
| `/applications/new` | Authenticated compatibility redirect to `/applications` | No independent form; workspace Create action retains its existing permission gate and dialog |
| `/applications/[id]` | Applications.View and record scope | Refined detail headings/timeline metadata |
| `/customers` | Existing OWNER/GM master access | Refined directory heading; shared table |
| `/customers/new` | Existing OWNER/GM master access | Refined two-column desktop/single-column mobile form |
| `/customers/[id]` | Existing OWNER/GM master access | Refined detail/confirmation headings |
| `/users` | Users.View and directory scope | Refined directory heading; shared filters/table |
| `/users/new` | Existing Users.Create/OWNER creation contract | Shared Basic creation modal; no HR/PRO steps added |
| `/users/[id]` | Existing Users.View/self/profile permissions and record scope | Refined audit metadata/confirmation heading; shared employee tabs |
| `/users/[id]/edit` | Users.Edit and record scope | Refined two-column form, unchanged organization dependency rules |
| `/user-types` | UserTypes.View; creation separately gated | Refined persistent form labels/layout |
| `/user-types/[id]` | Existing UserTypes permissions | Refined module heading; unchanged permission editor |
| `/organization` | Existing organization-reader rule | Refined drawer headings; shared five master tabs |
| `/organization/hierarchy` | Users.View and directory scope | Refined readable node metadata; contained tree scrolling retained |
| `/catalog` | Existing catalogue-reader rule | Refined section headings; unframed authenticated images retained |
| `/workflows` | Existing OWNER/GM master access | Refined section headings/stage metadata; existing designer |
| `/attendance` | Attendance.View; write permissions separately gated | Refined correction heading; shared read/write modes |
| `/attendance/holidays` | Attendance.View; Attendance.Manage for writes | Shared calendar/table/form |
| `/attendance/reports` | Attendance.Reports and scope | Shared report filters/table |
| `/attendance/schedules` | Attendance.View; Attendance.Manage for writes | Refined section headings; existing schedules |
| `/hr` | UserProfiles.HR.View | Refined Part 2 workforce dashboard |
| `/pro` | UserProfiles.PRO.View | Refined Part 2 compliance dashboard |
| `/leave` | Existing Leave permissions and self/operational scope | Refined type headings; shared request/balance/dialog patterns |
| `/contracts` | Contracts.ViewOwn or Contracts.View; settings separately gated | Refined section headings; existing contract lifecycle |
| `/transfers` | Transfers.View, ViewOwn or Recommend | Refined history heading; shared decision dialogs |
| `/exits` | Exits.View, ViewOwn or Clearance | Refined detail headings; shared lifecycle/checklist |
| `/approvals` | Approvals.View and individual decision authority | Shared queue and decision dialogs |
| `/assets` | Assets.View and scope | Refined directory/drawer headings; shared register |
| `/assets/[id]` | Assets.View and record scope | Refined confirmation heading; shared details/actions |
| `/assets/categories` | Assets.ManageMaster | Refined section heading; shared form/table |
| `/assets/reports` | Assets.View and scope | Shared report filters/table |
| `/finance` | Finance.View or ViewCommissionRules; writes separately gated | Refined section/form headings; existing payout/rule tabs |
| `/targets` | Targets.View and scope | Refined section headings; existing target/period controls |
| `/targets/kpi` | Targets.View and scope | Refined section heading; existing scorecard editor |
| `/notifications` | Notifications.View and recipient scope | Shared list/empty state; existing notification actions |
| `/notifications/manage` | Existing ManageRules/SendUrgent/ViewAudit gates | Refined form/audit headings; existing administration |
| `@modal/(.)users/new` | Same `/users/new` contract | Shared route-backed modal; not a separate public URL |
| `@modal/page` | Parallel slot default | No independent visible page |
| `@modal/[...catchAll]` | Parallel slot fallback | No independent visible page |

## Part 3 boundaries

Presentation classes, label wrappers and regression coverage are the primary changes. Existing
field order, values, option dependencies, validation, endpoints and
permissions remain unchanged. Customer and employee forms gain a bounded desktop
grid; errors and action rows span both columns. Section headings use the Part 1
20px token, sub-sections use 18px, technical metadata uses the 13px support scale.
Notifications' individual item titles and workflow row titles are not enlarged as
if they were page sections. Working inherited pages are deliberately not edited.

Two proven frontend timing defects found by the full corpus are also corrected:
Targets ignores stale request completions; Users combines pending search with a
page-size/filter navigation and cancels the superseded debounce. Filter semantics,
API requests and business calculations are unchanged.

No backend, schema, migration, seed, canonical data, environment, deployment or
startup changes. CSV references do not authorize a CSV feature.
