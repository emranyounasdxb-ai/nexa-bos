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

Part 1 changes shared visual primitives, tokens and shell only. Parts 2 and 3 adapt
existing role dashboards after inspecting their real data contracts. Part 4 covers
remaining page-specific styles and regression hardening. Each part has a separate
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
| Applications and customers | Tables, filters, dialogs, typography | Part 4; no workflow changes |
| Users and employee profiles | Shell, controls, sections, dialogs | Part 4; existing Basic/HR/PRO boundaries |
| Organization and catalogues | Tabs, tables, drawers, controls | Part 4; existing hierarchy and image rules |
| Attendance and HR lifecycle pages | Cards, forms, tables, calendars | Parts 3 and 4; existing operations only |
| Assets, Finance and approvals | Tables, forms, status badges, dialogs | Part 4; no new actions |
| Administration, security and notifications | Shell, lists, forms, empty states | Part 4; permission decisions unchanged |
| Account and public authentication/status | Typography, controls, surfaces | Part 4; authentication unchanged |

Shared inheritance is not a claim that every populated, empty, error or permission
state has been visually verified. Each delivery part records its actual coverage.
