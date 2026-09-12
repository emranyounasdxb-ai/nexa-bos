# AMAFH reference-led UI system

## Reference lock and delivery boundaries

The supplied 15-screen Pinterest pack is research, not new workflow authorization.
Reference 01 (queue) and 09 (user management) establish the dominant neutral table-first
foundation. Reference 03 supplies grouped details; 04 and 08 supply a dominant trend
with supporting lists. 05 informs existing approval queues. Personal/work screens
10, 12 and 15 inform existing authorized personal content, not new metrics.
CSV references 06/07 do not authorize CSV import/export. No reference grants access,
adds roles, changes scope or introduces business data.

| Decision | Source | Adaptation |
| --- | --- | --- |
| Readable body/support type | User brief, 01/09 | 15px body, 13px metadata; compact controls remain 32px |
| Section hierarchy | User brief, 03 | 20px shared section titles, 22px detail headings where appropriate |
| Numeric emphasis | User brief, 04/08 | 32px primary KPI values; no fabricated trends |
| White work surfaces | 01/09 | Neutral #F7F8FA canvas, white surfaces, #E5E7EB borders |
| Color discipline | AMAFH brand and brief | Purple selection/actions; semantic status colors only |
| Spacing | 01/03 | 16px panel minimum, 20px desktop shared cards, 24px section rhythm |
| Navigation | Existing application | Preserve 3D icon identity, authorization, routes and keyboard controls |
| Tables | 01/05/09 | 15px rows, 13px headers, contained mobile scrolling |

Part 1 changes shared visual primitives, tokens and shell only. The continuation
assigns all role dashboards to Part 2, remaining page families to Part 3, and complete
visual/functional QA to Part 4. Each part has a separate
branch, PR and required automatic CI boundary. No VPS deployment is included.

## Token ownership

`app/globals.css` owns semantic colors and `--amafh-text-body`, `--amafh-text-support`,
`--amafh-text-section`, `--amafh-text-kpi`, `--amafh-space-panel` and
`--amafh-space-section`. Existing Tailwind `text-sm` and `text-xs` utilities inherit
these shared sizes; explicit page-specific chart/metric styles are reviewed in later
parts rather than overridden indiscriminately.

`components/ui.tsx` owns controls, work surfaces, headings, table rows, badges and
states. The shell retains independently scrolling navigation and anchored account
actions. Chart theme changes affect label readability only, never values or geometry.
Image logos and charts are excluded from shared UI icon depth.

## Verification boundary

Every database-backed check requires an explicitly configured, connected-identity
verified disposable PostgreSQL 18.6 database. Canonical/VPS databases and sessions
are excluded. Screenshots are exact 1440x900 and 390x844 viewport captures from
disposable fixtures. Role labels are not permission grants; existing API decisions
and the role regression matrix remain authoritative.

### Foundation regression maintenance

The TL fixture creates an explicit matching Business Unit before its Team, as
required by the existing organization contract. It does not relax server validation.
Calendar assertions exercise the existing employee edit date field: the approved
four-field Basic creation modal intentionally has no Joining Date or Designation.
The creation layout check still verifies every current field and the 32px controls.

The larger account labels require the account popup to anchor above the actual
trigger rather than a fixed footer offset. The all-role tests retain their exact
no-overlap, focus restoration, keyboard navigation and viewport assertions.
Long child-navigation labels wrap within the existing width rather than being
clipped; focusing Dashboard restores the first item and Workspace caption together.

## Page-family rollout ledger

| Existing family | Shared foundation | Page-specific review |
| --- | --- | --- |
| Reports and role dashboards | Shell, controls, cards, chart labels, tabs | Parts 2 and 3 |
| Applications and customers | Tables, filters, dialogs, typography | Parts 3 and 4; no workflow changes |
| Users and employee profiles | Shell, controls, sections, dialogs | Parts 3 and 4; existing Basic/HR/PRO boundaries |
| Organization and catalogues | Tabs, tables, drawers, controls | Parts 3 and 4; existing hierarchy and image rules |
| Attendance and HR lifecycle pages | Cards, forms, tables, calendars | Parts 3 and 4; existing operations only |
| Assets, Finance and approvals | Tables, forms, status badges, dialogs | Parts 3 and 4; no new actions |
| Administration, security and notifications | Shell, lists, forms, empty states | Parts 3 and 4; permission decisions unchanged |
| Account and public authentication/status | Typography, controls, surfaces | Parts 3 and 4; authentication unchanged |

Shared inheritance is not a claim that every populated, empty, error or permission
state has been visually verified. Each delivery part records its actual coverage.

## Part 2: role dashboard adaptation

The existing authenticated dashboard response is authoritative. Role names choose
presentation labels only; `can(...)` controls work links and `reportingScope` controls
whether aggregate reporting data is available. A null scope is not displayed as a
successful zero sales dashboard. No API, permission default or reporting filter changes.

| Roles | Existing contract and presentation |
| --- | --- |
| OWNER / GM | Organization / management overview; permitted approval, workforce and operational links; existing scoped reporting |
| SM / BDM | Sales team / business development workspace; existing server-derived reporting scope, not a new assumed department boundary |
| OM | Office operations and permitted attendance/assets work; existing reporting where assigned |
| FIN | Finance entry point and existing authorized reporting/personal information |
| ITM | Technology/assets and user work; personal-only when reporting scope is absent |
| AUDITOR | Review/assurance links; existing read permissions remain authoritative |
| HR / PRO | Existing employee dashboard when its explicit profile permission exists; otherwise permitted work and personal information |
| TL | Existing four URL-backed tabs, queues and exact progress geometry; shared readable typography |
| SE | Own action-required/recent lists before the primary trend; category counts as supporting lists |
| COD | Existing operational queues; four-column desktop summary; one primary trend and supporting workload/outcome lists |

References 01/05/15 establish queue priority; 04/08 establish a primary trend with
supporting breakdowns; 03/12 establish workforce grouping. No screenshot values,
new workflows, invented role permissions or unavailable business statistics are used.
Historical test IDs containing `chart` remain stable for category breakdowns that now
render accessible definition lists; they do not imply a canvas/chart implementation.

## Part 3: page-family alignment

The [route ledger](ui-route-ledger.md) distinguishes inherited styles from refined
pages. Customer Create and employee Edit use bounded two-column desktop forms and
single-column mobile forms. User Type creation retains its existing fields with
persistent accessible labels. Section headings use the shared 20px token; secondary
headings use 18px and technical metadata uses the 13px supporting scale. No data,
permission, schema or workflow changes are part of this alignment. Full-corpus QA
also proved two frontend timing defects: an older Targets response could replace
newer filtered results, and a pending Users search debounce could replace a page-size
navigation. Latest-request protection and combined pending URL updates correct these
without changing endpoints, filter meanings, calculations or authorization. Focused
regressions delay unchanged real responses to exercise both orderings.

Browser specs that deliberately change built-in role configuration restore their
original permissions/scopes through the existing authenticated APIs and verify the
restoration. This isolates test fixtures without changing the role contracts or
weakening deny assertions. Exact viewport screenshots wait for sidebar geometry
and page scroll settlement; capture count is not a claim that every state was reviewed.

## Part 4: visual and functional closure

Breadcrumb labels no longer shrink into ellipses on narrow screens. The contained
strip keeps the current page visible on navigation/resizing and retains all
keyboard-accessible ancestor links without adding an empty navigation tab stop.
The links' focus outline is inset so scrolling does
not clip the indicator. TL's screen-reader-only dashboard title remains unchanged.

Horizontal tab strips reveal their selected tab on mounting, resizing and selection
changes without moving the page, selecting another tab or changing keyboard focus.
Subsequent manual strip scrolling remains available. Existing tab keyboard/URL
handlers and TL's navigation controls are retained.

The public status screen renders its existing page title itself because it has no
authenticated shell heading. Its health checks are unchanged.

Mobile empty-table messages fit the visible scroll container and remain readable
when its columns are scrolled. This does not collapse, hide or reorder populated
columns; desktop table sizing is unchanged.
Table scrollers establish a positioning context so visually hidden absolute table
headings remain inside their scroll container instead of extending the page width.
The application dialog's customer-type choices retain 32px controls; the longer
Company / Business label receives more mobile width and stacks on smaller screens
instead of wrapping outside its control. Desktop choices remain equal-width.

The route sweep covers every static authenticated route family; record-based tests
capture real disposable detail records at both review sizes. Role captures settle
sidebar geometry and page scroll. Public account screens without a submitted valid
token, controlled loading, and simulated refresh errors are labelled as those states,
not successful live account operations. See the external Part 4 capture/coverage
index for direct visual review versus shared inheritance and state limitations.
