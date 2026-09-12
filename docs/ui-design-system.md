# AMAFH CORE — approved application design system

Status: **Visual direction approved; implementation and release pending.**

Approval: the OWNER navigation preview was accepted in this task, followed by explicit authorization to update the complete frontend, push a PR, pass CI and merge to `main`. This is not deployment authorization.

Baseline: `emranyounasdxb-ai/nexa-bos`, `main` at `4ecf3b2facfddc47a4495ddbd18b708bec93df79`. Implementation branch: `codex/approved-ui-redesign`.

## 1. Approved visual authority

The supplied Finexy reference and the accepted **AMAFH-branded navigation preview** are the visual authority. Earlier rejected artboards and historical design documents are not design inputs.

- Accepted code reference: `docs/ui-preview/owner/app/owner-preview.jsx`, `owner.css`, `brand-review.css`, `navigation-review.css`.
- Accepted desktop: `docs/assets/ui-redesign/owner-navigation-review/dashboard-light-1440x900.png` and `dashboard-dark-1440x900.png`.
- Accepted submenu style: corresponding `people-*`, `operations-*`, `performance-*`, `assets-*` and `administration-*` captures.
- Mobile authority: corresponding 390×844 captures.
- Official artwork folder: `apps/web/public/brand/`. Use `amafh-core-full-logo-exact.svg` in light theme and `amafh-core-full-logo-dark.svg` in dark theme for all full-logo placements. Switch through the existing root theme attribute before paint. Use `amafh-core-mark-exact.svg` in the compact sidebar in both themes. Preserve all three assets, their native aspect ratios and transparency unchanged; never recolour or crop them.

The accepted preview and screenshot paths above identify local visual-authority artifacts; they are intentionally excluded from the implementation commit. They are not runtime dependencies. Rendered verification evidence is stored outside Git under `C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/`; do not add it, temporary capture helpers or generated preview output to the repository.

The design is a structural application redesign: floating application frame, three-capsule navigation rail, grouped submenu dialogs, contextual page navigation, bento dashboard composition and unified light/dark surfaces. It must not be reduced to enlarged typography, extra padding or palette changes on the old shell.

## 2. Non-negotiable preservation boundary

Preserve every existing route, permission predicate, role/scope rule, action, field, validation, state transition, API request, export and business calculation. Backend authorization remains authoritative. The frontend must never substitute its own broader permission policy.

No backend implementation change, schema change, new migration, seed, canonical-data mutation, fabricated application content, dependency upgrade, unrelated refactoring, production deployment or NexaHR work is included. Do not access or stop ports 3000/8000. The accepted preview on 3010 must remain available during integration.

The preview's fixture identity, archived numbers, partial tables, sample target chart, navigation-only page bodies and explanatory placeholder messages **must not enter production application components**. Real pages keep their existing data sources and complete capabilities. A group submenu is navigation, not a substitute for its destination page.

## 3. Colour tokens

| Purpose | Light | Dark |
| --- | --- | --- |
| Outer canvas | `#EAE9ED` | `#111015` |
| Application frame | `#F6F5F8` | `#1B191F` |
| Card/dialog surface | `#FFFFFF` | `#25222A` |
| Nested panel/field/row surface | `#F5F5F5` | `#302C36` |
| Primary text | `#27242D` | `#F3EFF7` |
| Supporting text | `#6E6976` | `#B9B0C4` |
| Hairline border | `#ECE9EF` | `#403A49` |
| Necessary field boundary | `#8A8194` | `#8B7B9B` |
| Neutral primary action | `#28242E` / white text | `#ECE5F2` / `#251E2D` text |
| Brand foreground | `#6F0D83` | `#E4B5FA` |
| Brand-soft surface | `#F5EDF9` | `#41304F` |
| Brand edge | `#D9B9E5` | `#755788` |

Brand gradient: `linear-gradient(135deg, #F450B2 0%, #E026AA 48%, #6F0D83 100%)`. The mark contains embedded raster artwork; these are a UI adaptation of its pink/magenta/purple palette, not a claim about original vector gradient stops.

Use gradient emphasis selectively: principal dashboard metric, chart emphasis and small brand markers. Do not fill every button, status or section with it. Preserve the approved quiet neutral surfaces and black/light-neutral primary actions. Small text over the gradient needs a contrast-protecting treatment as in the accepted preview.

Semantic success, warning, danger and information remain distinct from brand colours. Preserve current status-to-meaning mapping and visible text. Adapt semantic foreground/background pairs for dark contrast; never make all statuses magenta. Verify normal text contrast ≥4.5:1, large text ≥3:1 and necessary non-text indicators/focus ≥3:1. Do not claim accessibility completion from palette names alone.

## 4. Typography, sizing and density

- Keep the existing installed/system font stack; no font download or package upgrade is required. Use normal/medium weights and restrained tracking rather than embossed icons or uniformly heavy labels.
- Page title: approximately 28–30px desktop, 24–25px mobile, subject to the accepted composition and actual long titles.
- Section headings: **16–18px**. Do not restore the old 20px default.
- Visual control height: **32px**. Do not silently increase to 36–40px.
- Body/form content: use the shared readable body token; compact labels/table cells and supporting metadata have a subordinate scale. Preserve field labels and full values; do not shrink critical information simply to force viewport fit.
- KPI value: approximately 30–32px; use tabular numerals where helpful. Do not increase counts or invent deltas to fill space.
- Spacing rhythm: 4/8/12/16/24/32px. Card gaps typically 16px desktop and 12px mobile. Dialog padding 24px desktop, 20px mobile.
- Application frame radius approximately 26px; cards 18–20px; nested tiles 12–16px; controls 10–12px; navigation pills/capsules fully rounded.
- Preserve 32px visible icon controls with sufficient separation and hit-target treatment. Test crowded mobile interactions, rather than claiming that size alone satisfies accessibility.

## 5. Shell and navigation

### Desktop

At 1440×900, a neutral outer canvas surrounds a rounded application frame. Its top bar contains the official brand, a compact pill-style contextual page strip and existing user/notification actions. The left rail is narrow and comprises three visually separate capsules: theme controls, application navigation and existing utility/account actions. Do not restore the old hover-expanded text sidebar.

The workspace uses the remaining width. A visible page title/breadcrumb context precedes its content. Long page names remain reachable, not ellipsized into ambiguity. Preserve existing deep-link parent breadcrumbs where applicable.

### Original submenu contract

Source of truth is the **existing permission-filtered** `groups` array in `apps/web/components/app-shell.tsx`, not the OWNER fixture in the preview.

| Parent / leaf | Destination behaviour |
| --- | --- |
| Dashboard | Direct `/reports`, only when permitted |
| Operations | Popup: Customers, Applications, Workflows |
| People | Popup: Users, HR Dashboard, PRO Dashboard, Organization, Hierarchy, Attendance, Leave, Contracts, Transfers, Exit and offboarding, Approval Centre, Attendance reports |
| Performance | Popup: Targets, KPI scorecards, Reports |
| Finance | Direct `/finance`, when permitted |
| Assets | Popup: Assets, Asset categories, Asset reports |
| Administration | Popup: Banks & products, User types, Security |

The OWNER reference contains 26 entries. Other roles retain their actual permission-filtered subset; empty groups disappear. Never infer OWNER access for another role or make role-only helper functions more permissive.

A grouped parent click opens its actual visible children in the approved rounded popup card. A child is a real route link, closes the popup and navigates to the existing page. Native modified-click/new-tab behaviour must work. A leaf navigates directly. Labels/order/canonical paths are unchanged.

The top bar displays permitted original sibling pages for the active group, with current-page indication. The dashboard uses permitted Dashboard, Applications, Targets and Reports shortcuts, as approved in the navigation preview. Filter these with the same visibility logic; do not expose shortcuts hidden by the sidebar. Keep account and notification permissions/behaviour intact.

Long top strips scroll within themselves, reveal the selected page and do not move the page horizontally. They are navigation links, not ARIA tabs unless they actually control an existing tab panel. Existing in-page tabs retain their own URL/state behaviour.

### Mobile

At 390×844, use the compact brand/account row, horizontal page strip and a menu trigger exposing the same permitted rail/menu structure. Hide closed navigation from both keyboard and accessibility trees. A long submenu scrolls inside its card; neither backdrop nor page may create horizontal overflow. Opening/closing menus must preserve and restore useful focus.

## 6. Theme behaviour

Light and dark must be complete application themes, including public auth pages, dialogs rendered in portals, native field surfaces, charts, popovers, dropdowns, calendar widgets, error/loading/empty states and print considerations.

Theme is presentation-only, not a business preference API. Persist only the theme choice locally if implemented; store no credentials or business records. Respect the system preference when no explicit choice exists. Avoid a theme flash during startup, preserve server hydration, and respond to a theme switch without refetching/mutating business data. Reduced-motion preferences remain respected. Official logo artwork is not recoloured.

## 7. Component contracts

- **Cards:** borderless/quiet white or dark surfaces with generous rounding; nested neutral tiles for grouped supporting information. Avoid a wall of identical bordered boxes.
- **Buttons:** 32px, neutral primary pill, restrained secondary/ghost actions, explicit destructive tone. Preserve disabled/pending/submitting behaviour and click guards.
- **Fields:** visible labels, 32px single-line controls, existing validation/help; multiline fields remain naturally taller. Preserve keyboard/select/date behaviour and all original field options.
- **Tables:** integrated heading/action/filter area, quiet header, thin separators and subtle hover. Keep all columns/actions and sorting/pagination semantics. Horizontal scrolling is appropriate for genuinely dense operational tables; mobile record cards may replace presentation only when they preserve every action/value and accessibility relationship.
- **Filters:** visually integrated into the relevant list/card; preserve original query parameters, filter dependencies, Apply/Reset semantics and scope restrictions. Do not introduce saved views, new search semantics or bulk actions.
- **Statuses:** compact text plus marker/tint. Do not rely on colour alone or change workflow meaning.
- **Dialogs:** approved rounded card, subtle edge, blurred/dim backdrop; focus contained, Escape behaviour preserved, meaningful accessible title, focus restoration. Confirmation requirements and unsaved/pending protections remain unchanged. Do not replace existing workflow-specific dismissal rules with unconditional close.
- **Tooltips/popovers/calendars:** same semantic tokens, correct layering above dialogs when needed, viewport-safe positioning, keyboard support and no clipped focus ring.
- **Loading/error/empty:** honest state-specific messaging and original recovery actions. Never substitute fictitious rows, zeroes or chart points. A real zero is distinct from unavailable data.
- **Charts:** preserve underlying series, units, axes, filtering, accessible descriptions and export semantics. Adopt brand emphasis/neutral comparisons, soft grid lines and theme-readable labels/tooltips. Do not combine count and currency targets or manufacture historical periods.

## 8. Page-family application

| Family | Existing routes / screens | Required presentation |
| --- | --- | --- |
| Executive/role dashboards | `/reports`: OWNER, GM and other permitted roles; dedicated TL/SE/COD views | Approved bento hierarchy, primary summary, compact metric grouping, relevant charts and operational sections; preserve complete role-specific content |
| TL workspace | `/reports` existing four URL-backed tabs | Preserve Team, review queue, analytics and Personal tab semantics; four internal-review KPIs; member target/achieved/remaining rows; Personal attendance; no owner-dashboard substitution |
| Operational lists | `/customers`, `/applications`, `/users`, `/notifications` | Integrated toolbar/filter/table, preserved scope, row actions and pagination |
| Record detail / edit | `/customers/[id]`, `/applications/[id]`, `/users/[id]`, `/users/[id]/edit`, `/assets/[id]`, `/user-types/[id]` | Clear record identity, grouped facts, original tabs/actions/history and contextual parent navigation |
| Creation and public entry | `/customers/new`, `/applications/new`, `/users/new`; `/login`, `/bootstrap`, `/setup`, `/reset`, `/status` | Approved card/field/dialog style with existing route interception, reservation, authentication and validation behaviour unchanged |
| People operations | `/hr`, `/pro`, `/organization`, `/organization/hierarchy` | Summary hierarchy, grouped operational cards, original filters/actions and hierarchy data |
| Attendance | `/attendance`, `/attendance/reports`, `/attendance/schedules`, `/attendance/holidays` | Existing calendar/schedule/attendance controls, summaries and tables in both themes |
| Lifecycle and review queues | `/leave`, `/contracts`, `/transfers`, `/exits`, `/approvals` | Distinct queue/detail/decision surfaces; preserve every role-specific workflow and confirmation |
| Performance | `/targets`, `/targets/kpi`, `/reports/compare`, `/reports/drill-down`, `/reports/employees/[id]` | Comparable units, truthful charts, readable scorecards/tables and existing reporting/export controls |
| Finance | `/finance` and existing tabs | Original periods, rules, components, payout/review state and permission-gated actions; presentation only |
| Assets | `/assets`, `/assets/categories`, `/assets/reports` plus detail | Register, detail drawer/page, categories and reports consistent with list/form/detail patterns |
| Administration | `/catalog`, `/workflows`, `/user-types`, `/security`, `/notifications/manage`, `/account` | Preserve masters, designer controls, permissions, security/session controls and profile actions; consistent theme and grouping |

Inventory found **51 `page.tsx` modules**, including root redirect, interception and catch-all placeholders. This is not a claim of 51 independent user-visible page families. Integration must track real routes, role views and significant dialog/tab states explicitly.

### Concrete family compositions

- Record pages separate identity/context from tabbed work, history and actions. Desktop uses a 240–280px summary column; mobile stacks readable two-column facts before the body. Organization aggregate counts use a keyboard-reachable horizontal mobile strip instead of consuming the first screen with five full cards.
- Catalog, target planning, workflow configuration and payout workspaces separate scope/filter controls from operational results on desktop. Mobile context controls stack or pair according to field width; result tables retain their own horizontal scroll where necessary.
- Registers with existing inline editors (categories, schedules, holidays, User Types) place records beside the editor on desktop, then stack without changing save/validation behavior.
- KPI directories use named scorecard articles with metric weights and original lifecycle actions, rather than a table of undifferentiated text. Employee reports separate identity, attendance, grouped production metrics, targets and component results.
- Leave separates balances from requests; contracts separate personal contract identity/download from summary; notifications separate unread context from the message/action feed. Review and lifecycle dialogs retain their module-specific confirmation and unsaved-change rules.
- Financial rule editors use explicit eligibility, calculation and recipient sections inside the rounded inset panel. Existing fixed, percentage, slab and independent-recipient modes remain unchanged.
- Employee edits group identity/contact, role/joining, organization and employment/reporting in labelled fieldsets. HR profile sections pair a section label with a three-column desktop field grid, becoming one column on small mobile. Read-only permissions and all original fields remain unchanged. Missing-field details stay available through per-employee disclosures.
- Mobile Attendance uses the same editable record DOM as desktop, reflowed into employee cards with visible time/notes labels; do not duplicate interactive inputs for alternate viewports. Leave balances and profile-completion summaries use keyboard-reachable horizontal strips on mobile. Capture long form bodies and their action regions separately at exact viewport sizes.
- TL Review places the four primary internal-review KPIs in a nested 2×2 region beside the secondary case/bank-progress region on desktop. Team Performance places member target/achieved/remaining cards beside the existing collapsible ownership comparison. Personal performance and attendance remain separate, responsive regions. Original four URL-backed tabs, queue selections, sparklines, focus and reduced-motion behavior remain authoritative.
- Approval, Leave, Transfer and Exit registers reflow the original table DOM into mobile records with visible value labels and all original actions. Desktop retains tabular comparison. Transfer preparation separates proposed assignment from timing/justification; detail compares each current snapshot and proposed value. Exit detail separates request context from clearance and history. Workflow and Asset editors use inset, rounded panels with labelled field groups, preserving pending and unsaved-change guards.

## 9. Visual evidence gate

Current rendered evidence is intentionally outside Git. Baseline inspection includes Part 2 `screenshot-index.md`, Part 3 `final-capture-manifest.md`, Part 4 `release-capture-manifest.md` and final `finance-users-hotfix` release captures under `C:/Users/emran/Documents/NEXA-BOS-Evidence/`.

For **every changed page family**, provide direct before/after captures at 1440×900 and 390×844. Capture both implemented themes, significant menus/dialogs, role-specific dashboards and important loading/empty/error/validation states. Record the source commit, route, role, viewport, theme, data environment and image path. Label scrolled/full-page captures separately. A test-generated screenshot is not automatically visually reviewed.

Existing archived screenshots are valid rendered before evidence, not live-data snapshots. If compared against a different disposable fixture population, disclose the difference; do not claim identical-data comparison. Prefer paired before/after capture using the same isolated data snapshot when authorized and available.

Every family must be visually inspected against this approved direction before the release gate. Shared CSS coverage or green tests alone cannot establish visual completion. Maintain a route/state evidence ledger with explicit gaps; do not mark pending pages done because they inherit tokens.

## 10. Validation and delivery sequence

1. Preserve the approved preview and existing untracked research artifacts. Use the implementation branch; no direct changes/push to `main`.
2. Implement shared shell/theme/component primitives, then role dashboard and page-family layouts. Keep application payload/action/permission contracts unchanged.
3. Render each family on isolated repository-approved ports; inspect and correct screenshots. Do not use the canonical database for state-changing tests.
4. Only after visual verification, run required lint, types, build, relevant/full regression suites and security/conformance guards. Visual assertions that encode the replaced layout may be updated to the expressly approved layout, but must preserve or strengthen functional/accessibility/security invariants; no tests may be skipped merely to obtain green results.
5. Review the diff for backend/data changes, generated artifacts, secrets, copied preview fixture data, missing routes/actions and unrelated changes.
6. Stage exact reviewed paths only: intended application source, approved documentation and permanent regression tests. Never use `git add .` or `git add -A`. Screenshots, videos, traces, logs, test results, disposable data/uploads, temporary helpers, patches, build output, caches, environment files and credentials are excluded. Verify status, full untracked inventory, staged file list, full staged diff, whitespace and staged-blob secret scan. Unstage any unrelated or temporary file before committing, preserving its working copy. The delivery report must include the exact committed-file list.
7. Push branch, open PR, inspect actual GitHub required checks/rules, wait for green CI, then merge normally without bypasses. Recheck remote `main` SHA and post-merge CI. Merge does not authorize deployment.

## 11. Disposable validation authorization

At kickoff, no application code has been changed. The historical disposable containers `nexa_test_hotfix_20260912`, `nexa_ui_test_20260912_part2`, `nexa_ui_test_20260912_part3` and `nexa_ui_test_20260912_part4` all returned **no such object**. The evidence tree contains no discovered reusable `*storage*.json`, `*auth*.json` or HAR response captures.

The repository's Playwright configuration executes `alembic upgrade head`; tests bootstrap disposable users and create workflow fixtures. The CI workflow also runs existing migrations and database-mutating tests against its disposable PostgreSQL service.

The user explicitly authorized **existing migrations and repository test fixtures only inside a new isolated disposable PostgreSQL test database and CI**. Verify the connected database identity before migrations and suites. After testing, remove only this task's explicitly identified disposable container and volume. Preserve production/canonical data, NexaHR, ports 3000/8000 and the accepted preview. No new migration, canonical initialization, unrelated resource cleanup or deployment is authorized. Baseline testing is not post-implementation visual or release validation.
