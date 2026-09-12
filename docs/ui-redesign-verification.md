# Approved UI redesign — verification ledger

Status: **Approved redesign implementation and local verification complete; GitHub delivery is pending.**

## Final local release gate — 13 September 2026

This section supersedes the historical checkpoint status and “pending” wording retained below as an audit trail. The approved frontend redesign is implemented across the complete routed application while preserving the existing route, permission, action and API contracts. Direct rendered review used the archived current-UI evidence plus the external light/dark 1440×900 and 390×844 capture sets. Six review registries contain 667 individual inspection entries (including intentional repeat inspections after corrections); loading-only captures were rejected from settled evidence. OWNER, TL, SE, COD, HR/PRO, operational registers, record/detail workspaces, forms/drawers, approval/workflow queues, tables/filters, public entry screens, and significant empty/error states were directly reviewed.

Final changed-scope validation:

- Web ESLint: passed.
- Web TypeScript (`tsc --noEmit`): passed.
- Next.js 16.3.3 production build: passed; 49 routes compiled, type-checked and generated.
- API Ruff: passed.
- Full API run: 336 passed and one document-expiry boundary failed at the UTC/UAE calendar rollover. Root cause was host-local `date.today()` in the employee-profile domain while the operational application uses the UAE business day. Employee document status, remaining-day summaries, HR new-joiner cut-off and date-of-birth validation now use the explicit existing `BUSINESS_TZ`; the boundary fixture uses `business_today()`. The complete affected employee-profile module then passed 6/6 on a fresh PostgreSQL 18.6 database after all existing migrations. The other 336 API tests had already passed unchanged in the full run.
- Affected staged browser coverage: every one of the 112 cases has a passing result across the reconciled runs. The first run was stopped after 73 passes and four failures when the same already-corrected focus expectation began repeating from its process-start test bundle. The fresh corrected-and-remaining run passed 46/47; its only failure was an obsolete `/status` card selector. The exact semantic public-surface locator retained the same surface assertions. A first focused rerun traversed the corrected status check but hit a cold Next development compile beyond 30 seconds; settled readiness remained mandatory with a 60-second route allowance. The final complete 1440×900/390×844 core-route matrix passed 1/1 in 8.0 minutes. No assertion, permission case, workflow action or route was skipped or disabled.
- Focused brand regression: 1/1 passed. Light uses `amafh-core-full-logo-exact.svg`, dark uses `amafh-core-full-logo-dark.svg`, and the compact/mobile rail uses `amafh-core-mark-exact.svg`; natural dimensions, aspect ratio, theme switching, responsive visibility and overflow were asserted.
- Security diff scan: 85/85 changed application-source files reviewed, zero candidate findings and zero validated findings. The only new HTML sink is the fixed local theme-bootstrap constant; it contains no request, API or user-controlled content. The staged SVG uses only an embedded `data:image/png` resource and contains no script or remote resource.
- Contract comparison: 221 original / 221 staged API expressions. The sole textual move is the unchanged `/api/v1/notifications/unread-count` request with `getBrowserApiUrl()` inlined in the extracted workspace frame. Permission-gated notification visibility and all replacement shell navigation/logout handlers are covered by the full role, popup, account, logout and notification regressions.
- Every disposable run verified its database name, host, port and server identity before migrations/tests. Only ownership-labelled containers, named volumes and per-run upload directories were removed. Ports 3000/8000, NexaHR, canonical/production data and VPS resources were not accessed.
- Pre-commit hygiene: exactly 125 allowlisted paths are staged. Staged whitespace and staged-blob secret-pattern scans passed. Full name/status, stat and manual diff reviews found only approved application source, the required dark-logo SVG, approved documentation and permanent API/browser regression tests. The 163 untracked paths are confined to `docs/assets/`, `docs/ui-preview/` and `docs/ui-redesign-research.md`; they remain preserved and excluded. Next's generated `apps/web/next-env.d.ts` development-path rewrite was restored and is not part of the diff.

GitHub PR/CI/merge results are recorded only after those gates actually complete; no delivery claim is made by this section.

## Mandatory pre-commit repository hygiene gate

Stage only exact, reviewed paths for intended application source, approved design/verification documentation and permanent regression tests. Never use `git add .` or `git add -A`. Preserve but exclude the local preview and research artifacts under `docs/assets/`, `docs/ui-preview/`, and the unapproved historical research report.

Before committing, inspect `git status --short`, the full untracked-file inventory, the staged name list and full staged diff; run staged whitespace and secret checks. Screenshots, videos, traces, logs, result folders, disposable uploads/databases, capture helpers, patch files, build output, caches, environment files and credentials must not enter the commit. Any accidental unrelated/temporary staged file stops the commit and is unstaged without deleting its working copy. The final delivery report must include the exact committed-file list. Initial check during V14: index empty; local preview screenshots/helpers remain untracked and excluded. This is not the final staged audit.

## V15 result and V16 correction checkpoint

V16 completed **25/25 passed, 13.6 minutes** (JUnit: 25 tests, zero failures/errors/skips). This includes all 13 role navigation cases, SE/COD scope/actions, assets, permissions, theme/navigation and the expanded settled record/tab capture. Guarded cleanup removed container `ce60e0a53635a5968892cb02e872b6f7bbd9f4f7d8d997088f07c7c38039c20c`, its labelled volume and disposable uploads; task-port and ownership-label queries returned none.

The V16 review now includes actual application correction forms (seven original actions, not merely the summary), full permission category names, mobile asset-report records, SE/COD personal performance and attendance, and corrected COD operational metric/staff layouts. HR/PRO desktop/mobile baseline screenshots were directly compared with four-theme/size current captures: the old full-width KPI strip is replaced by a nested metric/context column and an operational area; mobile preserves the same workflow data in a single column. Baseline and current disposable fixture populations differ.

V17 is a focused correction checkpoint, not final release validation. Catalog mobile actions were clipped in horizontal rows, so the same table DOM now becomes labelled cards with all original actions. A permanent catalog regression verifies each mobile action stays within the viewport and captures bank/product/mapping/variant records in both themes. `/status` now uses the approved public shell while retaining its existing health/readiness component and purpose marker. Lint, TypeScript and the production build passed before V17. The six-test V17 run also captures remaining lower public/HR/PRO/report surfaces; its source/build remain frozen while capturing.

Public brand-panel investigation during V16: the image-view output appeared to omit the logo/tagline in some desktop theme captures. Read-only inspection of the original V15 login/setup PNG pixels found the white logo surface in all four desktop files (576 sampled white pixels in the brand region in each). A fresh, unmodified browser element capture showed both official logo and tagline, and DOM/image readiness checks passed across light/dark switches. This did not establish an application paint defect; no speculative CSS fix was applied. Diagnostic files remain outside Git and are not substitutes for the required full-size captures.

V15 completed **23/23 passed, 9.2 minutes** including both formerly failed V14 assertions, approved theme/navigation, attendance, targets/KPI, permission editor, Workflow Designer, and external contract/record capture. Guarded cleanup removed container `453446365e5e4242807ec72a1454650642aa8bc53eba9948e3242de89f0cb4d5`, its labelled volume and disposable uploads. Label and task-port checks returned none.

Direct V15 review verifies the bounded stage dialog, permission contrast/mobile module controls, structured employee KPI results, full-width mobile attendance date, compact OWNER summary context, account profile-first layout and opened personal HR empty disclosures. Individual paths are recorded in external `visual-review-v15.json`. V14/V15 application-tab images showed only the top summary on mobile and were rejected as tab-content evidence. Selected-tab and individual section anchors were added to the external helper after V15 had loaded it; those new captures require V16, not V15.

After V15 cleanup, scoped remaining corrections were applied to Asset report mobile records (all original dynamic columns retained), personal performance/attendance metric grouping, COD workload names/activity explanation and full desktop permission-category labels. V16 must verify these changes. The broad release suite, final staged audit and GitHub delivery remain incomplete.

## Historical V14 result and V15 correction checkpoint

V14 finished with **66 passed, 2 failed, 20.7 minutes**. Both external settled-record and contract checkpoints passed. The two failures were obsolete public-card border-colour and forced mobile horizontal-scroll assertions. The permanent assertions now check the actual borderless card and the available scroll extent while retaining containment and overflow checks. Their rerun is still required.

The guarded runner removed owned container `c81e3242d6e56b11a247a62e795452e9fea9040ba42777f004692b7220def903`, its labelled volume and unique disposable upload directory. Subsequent ownership-label queries and port checks for 23092/28092/25492 returned none.

After cleanup, applied the directly observed corrections: bounded centred Workflow editors, theme-paired permission-category contrast, separate mobile permission bulk-action row, compact OWNER workspace context, full-width mobile attendance report date field, profile-first account layout with structured personal HR balances, and labelled employee performance/conversion results and mobile application cards. Frontend lint and type-check passed; production-build and V15 rendered verification remain required. No commit or release is claimed.

## Historical V13 result and V14 correction checkpoint

V13 completed on the approved branch against the same baseline SHA: **97 passed, 8 unsuccessful, 29.8 minutes**. The JUnit file records 105 tests, six failures and two timeout errors, zero skipped. All 13 role-menu regressions passed, as did the complete external record/tab/editor checkpoint and draft-to-active contract workflow. The eight unsuccessful cases cover the short-hex contrast parser, obsolete customer/TL geometry and GM navigation locators, UTC date helper, fieldset-column parser, integrated-filter card assertion, and a hidden desktop empty-state locator during mobile User Type capture. Targeted corrections retain functional and permission assertions; rerun remains required.

The guarded runner removed container `a7817d7351945a585d05e928d307630fc787f09a9c965f458da3d27e5c8c28d7`, its ownership-labelled volume and unique disposable uploads. Subsequent label-filtered container/volume checks and port checks on 23092/28092/25492 returned none. V13 evidence: external `family-checkpoint-v13.xml` and `family-checkpoint-v13-results/`. This is not the final release suite.

Direct inspection is recorded per image in external `approved-ui-redesign/visual-review-v13.json`; generated image count is never treated as reviewed coverage. Actual views inspected in all four combinations include Application create/detail, Approval queue/decision, Asset create/detail, Attendance save/correction/incomplete/report, COD overview, TL Review/Team/Analytics/Personal/monthly attendance, User create/profile, HR/PRO fields, Exit request/clearance/completed/empty, Leave balances/request/submitted/cancellation/calendar, Finance period/adjustment/clawback/calculation drawers, and Notification forms/rules/read/acknowledgement.

Corrections applied after V13 cleanup: Application completed-stage dark text; TL dark chart-axis title; mobile Attendance report records; Finance label baselines/recipient columns; mobile Notification rule/audit records and gradient contrast; HR compensation density; Organization and session/internal-review confirmation panels; mobile transfer assignment fields and contract register cards. Attendance schedules now have explicit working-day selection surfaces and mobile labelled records. Lower-section captures were added for user forms, customer/application detail, KPI, finance, notifications, exits, leave, organization and schedules. V14 must verify these changes; neither application nor build is changed while a checkpoint is capturing.

Employee edit's apparent three-column failure was independently reproduced as a test-parser defect: Chromium returns `repeat(2, minmax(0px, 1fr))` for a fieldset; splitting on spaces yields three strings although the rendered labels occupy two columns. The assertion now counts actual child x-coordinates and still requires the approved one/two-column layout.

No final visual gate, full post-visual API/browser suite, commit, push, PR, CI or merge is claimed.

## Baseline and isolation

- Repository: `emranyounasdxb-ai/nexa-bos`, baseline `4ecf3b2facfddc47a4495ddbd18b708bec93df79`.
- Branch: `codex/approved-ui-redesign`.
- The user authorized existing migrations and fixtures only in fresh disposable PostgreSQL test databases and CI. No canonical/production mutations, NexaHR access, or local ports 3000/8000.
- Initial baseline runner/evidence: `C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/` (outside Git).
- Baseline test PostgreSQL: `127.0.0.1:25491/nexa_bos_test_redesign_baseline`; container `nexa_ui_test_redesign_baseline_20260912`; volume `nexa_ui_test_redesign_baseline_20260912_data`; ownership label `nexa.task=nexa-ui-redesign-baseline-20260912`.
- Connected database name, server address and server port were verified against the owned container before existing migrations and again before pytest. Existing migrations reached `0027_org_business_units`.
- API baseline suite: **337 passed, 0 failed, 0 errors, 0 skipped**, 1598.15s on local Python 3.14.6. One existing Alembic `path_separator` deprecation warning. JUnit evidence: `api-baseline.xml` in the external evidence folder. This is not pinned-runtime CI validation.
- Automatic cleanup failed closed on a PowerShell/Docker template-quoting error after tests passed. Container ID `8752fdb1879b25ebf3ffd5ce7f58523f43451578f9003498c0340c8b31d62483`, its exact name, sole named mount and both ownership labels were then verified using parsed JSON. Only that container and its named volume were removed. Label-filtered container/volume checks returned none; port 25491 was released. The external runner's cleanup parsing was corrected; no tests were rerun or modified for this cleanup issue.
- Accepted preview on `127.0.0.1:3010` is preserved and is not application validation evidence.

## Rendered before evidence

The Part 2 screenshot index, Part 3 final capture manifest and Part 4 release manifest were inspected under `C:/Users/emran/Documents/NEXA-BOS-Evidence/`. These historical documents are used only for current UI and functional evidence, never as the new visual direction.

Directly opened during baseline preparation:

- Part 4 `dashboard-tl-DXB-and-AUH-T-3d0c0-rumbs-and-responsive-queues-chromium/`: `tl-DXB-1440-team.png`, `tl-DXB-1440-review.png`, `tl-DXB-390-personal.png`.
- Part 4 `applications-application-d-8d1de-sions-and-responsive-layout-chromium/`: `application-detail-1440.png`, `application-detail-390.png`.
- Part 4 `ui-polish-shared-applicati-d81e0-low-free-across-core-routes-chromium/`: desktop finance, workflows, attendance, HR, catalog, users, approvals, assets, organization, reports-compare, notifications, security, leave, contracts, transfers and exits; mobile users, approvals and finance.

All Part 4 paths above are relative to `ui-reference-part4/browser-results-20260912-153807/`. These are archived disposable-test records, not current production data. This list records **actual direct inspection**, not all files listed in a manifest. Prefer final `finance-users-hotfix` captures for affected final-baseline screens when pairing after images.

## Required completion matrix

V14 directly compared final archived `app-wide-{desktop,mobile}-account.png` and `app-wide-{desktop,mobile}-attendance-reports.png` against current theme/size captures. V15 verified the resulting profile-first account layout, structured balances/opened personal workflows, and full-width mobile attendance date range. Baseline report captures are settled empty results; current result captures use different disposable fixtures. They demonstrate layout differences, not identical-record or production-data parity.

Every row needs actual rendered 1440×900 and 390×844 before/after evidence, both implemented themes, direct visual review and preserved functional assertions. A shared CSS change does not complete a row.

| Family | Integration / visual verification |
| --- | --- |
| Shell, popup submenus, contextual top navigation, account, responsive keyboard behavior | V16 all 13 role navigation cases passed; V15 account and opened HR disclosures inspected at both sizes/themes. Final consolidated release regression remains pending |
| OWNER/GM and other role dashboards | V15 executive summary inspected at both sizes/themes; remaining V16 lower executive sections require consolidated review |
| TL: Review, Team Performance, Analytics, Personal Performance & Attendance | Theme integration and four-tab real-fixture render check passed; complete interaction regression and paired visual review pending |
| SE and COD dashboards | V14 queues/stages and V16 structured personal performance/attendance inspected; V16 scoped interaction tests passed. Complete before/after index and remaining overview review pending |
| Customers and applications: lists, create, detail, timeline, corrections | V13/V14 create/detail and V16 actual seven correction forms inspected; remaining lists, timeline and workflow anchors require consolidation |
| Users: directory, create, profile, edit, HR/PRO sections | V13 profile sections/create and V14 HR compensation reviewed; directory/edit lower evidence requires consolidation |
| HR/PRO dashboard and organization/hierarchy | Four current overview variants directly compared with desktop/mobile archived baseline; V17 lower HR/PRO inspection pending. Organization forms already reviewed, tab/hierarchy consolidation pending |
| Attendance, reports, schedules, holidays | V13 saved/correction states, V14 schedule/impact forms and V15 report/date corrections inspected. Holiday record/editor evidence remains to consolidate |
| Leave, contracts, transfers, offboarding, Approval Centre | V13 request/review/clearance/completed/empty and V14 guarded dialogs inspected; consolidate latest before/after paths and any outstanding lower fields |
| Targets, KPI, comparisons, drill-down, employee reports | V13 configured targets/KPI and V15 employee KPI/attendance results inspected; consolidate comparisons/drill-down and employee report lower fields |
| Finance: payouts, commission rules, incentive plans, adjustments, clawbacks | V13 primary workflows and V14 lower editors inspected; consolidate latest tab states and before/after mapping |
| Assets: register, detail, categories, reports | V13 master/create/detail and V16 report cards inspected; V17 report lower-fields inspection pending |
| Catalog, Workflow Designer, User Types, security | Workflow dialog, permission editor/scopes and security inspected. V17 catalog card correction and lower amount-rule verification pending |
| Notifications, notification management, My profile | V13/V14 notification empty/list/rules/audit/acknowledgement and V15 profile inspected; consolidate baseline pair mapping |
| Public login/bootstrap/setup/reset/status and loading/error/empty states | Public forms inspected; V17 status-shell/transport-error and lower bootstrap captures pending. Significant loading states must be labelled separately and never count as settled evidence |

## Release gates

### Current visual correction queue (v11, not final approval)

Directly opened all four light/dark desktop/mobile v11 captures for Finance draft period, incentive slabs, Targets, Comparisons and Attendance. Finance editor grouping and the comparison context/result split are readable; lower portions of long editors still require scrolled viewport evidence. Targets mobile filters, Attendance mobile editing and Leave balance density need dedicated layout corrections before these rows can pass. Contract summary density and employee forms/profile grouping are also in the next correction batch. These generated images do not close the completion matrix.

The v11 browser checkpoint finished: **22 passed, 4 failed, 16.9 minutes**. Targets/KPI and scoped isolation passed, as did Finance calculation modes and view-only access. Failures were cold route-heading waits in Navigation, Assets and the external User Type detail capture, plus the external contract fixture using a superseded API session after browser login. These have targeted corrections; no functional/security assertions were removed. Container `41e498f2e14cb24ded456f13f39d00a184edb25702678a4820bd1c8db7b8ff68`, its ownership-labelled volume and the run-created disposable upload directory were removed by the guarded runner. Task-port and label-filtered checks returned no remaining resources. No production or canonical resources were used.

V11 generated 350 PNGs, **not 350 completed visual approvals**. It produced zero `*-tab-*` checkpoint captures because the already-loaded external spec still enumerated tabs before route readiness. V12 explicitly waits for tabs and asserts a nonempty list, then captures every selected tab. Application detail also now exposes its existing loading flag as `aria-busy`, preventing its primary record from being mistaken for the fully loaded workflow/review state.

The next layout batch groups user edit and bootstrap fields, reduces the mobile form guide, adds HR section-label/field columns and a collapsible missing-field review, compacts contract summaries and Leave balances, and gives the Attendance register a single-DOM mobile employee-card presentation. All existing controls, fields and event handlers remain. V12 is a 125-test broader visual/regression checkpoint using the complete original browser suite plus two external capture specs, with the same guarded disposable resources. It is not final post-visual release validation. TypeScript and ESLint passed before launch.

A fresh read-only TypeScript AST comparison covers 69 modified/new TS/TSX files and **221 original / 221 current API expressions**. The only textual move is notification count, whose former local `api = getBrowserApiUrl()` is now inlined at the same endpoint. Existing page permission-call expressions and click/change/submit handlers match exactly outside the replaced shell/theme components. Shell notification access still receives `can("Notifications.View")`; duplicate old presentation checks were consolidated. This scoped source check does not replace authorization, workflow or browser tests.

V12 closed with **95 passed, 30 failed, 1.1 hours**. Its owned container `ec44f0d6991a09d058fb092a2058c9d4bb83cf491843906464ede25923a3fb19`, volume and unique uploads were removed. Its duplicate global banner defect was corrected in the app before V13, not by weakening the original strict assertion. The following historical notes describe findings at that checkpoint, not current outstanding-run status.

V12 continuation: HR/PRO field values, attachment versioning and responsive grids; user-edit refresh races; complete Exit lifecycles at both sizes; Finance modes/view-only restrictions; Leave; directory pagination; navigation/breadcrumbs; notification acknowledgement/read actions; hierarchy scope isolation; and role-bound application stage metadata have passed their individual tests. The overall run remains open and failed checks remain unresolved until rerun. Obsolete tests still expected links outside the new submenu/Work areas disclosures, full-screen Organization drawers, and old form grid column counts; updated tests open the actual disclosures and retain all original permission, action, data and keyboard assertions.

Direct V12 review rejected Exit clearance light captures showing `Saving…` and lower-section HR/PRO captures whose anchors only reached the viewport edge. The helper now also excludes saving/submitting/processing states and explicitly aligns a requested section to the viewport start. Exit detail/register, Leave submitted rows and Approval queues need mobile-specific record layouts. Workflow and Asset creation drawers also still used the old full-height treatment. These corrections are prepared outside the app while the current capture run is frozen; they are not yet verified implementation. The next preview is planned against a local production-mode build with the disposable API address explicitly supplied at build time, following installed Next.js and Context7 guidance. This is not a deployment.

Additional archived **rendered** mobile baseline captures directly inspected in this continuation: `app-wide-mobile-{leave,exits,approvals,attendance,workflows,user-types,organization-hierarchy,catalog,security,notifications-manage}.png` under the final `finance-users-hotfix/browser-release-20260912-171857/ui-polish-shared-applicati-d81e0-low-free-across-core-routes-chromium/` directory. These are source images, not route-ledger inference. The Leave mobile before/after pair and settled PRO dark desktop editor were sent as representative evidence. The explicit external `visual-review-log.json` records individual inspected images and rejected/limited captures; generated image counts are never substituted for review.

Post-implementation visual verification, lint/types/build, applicable full API/E2E regression, reviewed diff, push, PR, required green CI, normal protected merge and remote-main/post-merge verification are **pending**. No deployment is authorized. Baseline test success cannot replace any of these gates.

V12 further individual results: stored-XSS rendering, confirmed session termination, targets/KPI scope and editing, target response races and period lock/reopen, transfer lifecycles at both sizes, User Type settings/permission saves, Workflow Designer, retained dashboard data after a failed refresh, chart drill-down, and original popup navigation tests passed. V12 is still running; these do not negate its failed cases. New failures identify an ambiguous KPI link selector, old horizontal Targets-filter expectations, a 30-second public-capture test budget, and border-colour assertions on intentionally borderless nested cards. Corrections retain route, data, authorization, focus and action assertions.

Direct V12 inspection additionally covers People popup, KPI configured scorecard and User Type detail in all four review views, Transfer form in all four views and applied detail on mobile, plus the dashboard retained-data error views. People popup is contained with all 12 permitted links. KPI cards expose real weights and lifecycle actions; mobile action-region capture was added. User Type scopes/permission sections require their own anchored captures. Mobile dashboard error captures were rejected because the expanded filters hid the error below the fold. Transfer form/detail grouping, compact report filters, and necessary input-border contrast are prepared outside application code for the post-run correction batch. Light status text and control contrast will be checked in the fresh browser build. No visual-completion claim is made from generated files alone.

## Frontend integration checkpoint

### V12 closed; V13 corrections applied

V13 uses the successful local production-mode build and 105 selected browser/checkpoint tests. Applications creation/detail/timeline, Approval decisions, Asset lifecycle, Attendance calculations/corrections, customer URL/history/merge and denial checks, SE/COD and full DXB/AUH TL scope/tab/chart/queue tests have passed individually. The overall run remains in progress. Contrast test parsing failed because production CSS can shorten hex values; the test now resolves real browser colour values rather than assuming six-digit hex. Customer create/name layout and GM popup selectors still encoded old presentation; targeted assertion updates retain their actions and permission checks.

Direct V13 review covers all four theme/size variants of Application create/detail, Approval queue records, Asset create, Attendance saved/correction/incomplete/schedule/report, COD overview, and TL Review/Team/Analytics/Personal/expanded monthly attendance. Important rejections: completed Application stage text and TL chart axis name in dark theme; mobile Attendance report density/name wrapping; mobile correction screenshot with the actual correction panel below the fold. Corrections and anchored recaptures are queued. Exact individual paths/assessments are in external `visual-review-v13.json`. These findings demonstrate why passing functional tests do not close the visual gate.

V12 completed **95 passed / 30 failed (1.1h)**. The external settled record checkpoint passed; the contract lifecycle did not. Failures were retained for correction, not treated as release success. Owned container `ec44f0d6991a09d058fb092a2058c9d4bb83cf491843906464ede25923a3fb19`, labelled volume and unique upload directory were removed. A subsequent exact-name resource check and task-port check returned none.

After cleanup, applied the prepared page-family corrections: semantic page heading, compact COD metrics, mobile approval/leave/exit/transfer record layouts, grouped transfer/workflow/asset forms, wider grouped exit details, TL primary review versus bank-progress regions and team-target versus comparison regions, mobile report filters, consolidated navigation scroll lock, and theme-aware accessible control boundaries. These now require new visual evidence. The contract capture fixture now uses HR preparation and distinct OWNER approval, preserving the backend self-approval prohibition.

ESLint and TypeScript passed after the batch. Source inventory now covers 61 modified/new TS/TSX files, with **217 original / 217 current API-call expressions**; notification count remains the sole expression-level difference described above. This is not full functional or visual verification.

Implemented locally, not committed or released:

- Floating application frame, three-capsule rail, actual permission-filtered submenu dialogs, contextual sibling-page links, header account and notifications.
- Persistent light/dark presentation with a pre-paint bootstrap and system-preference fallback. Context7's current Next.js guidance informed the hydration-safe theme integration; current ECharts documentation informed applying themed presentation options without changing series data.
- Neutral 32px actions, shared surfaces, pill tabs, rounded dialogs, semantic dark colours and theme-aware chart colour fields.
- Executive metrics grouped into a nested 2×2 block beside the trend panel, separate pipeline and existing analysis sections; all original drill-down destinations retained. Existing work-area links remain available in a disclosure.
- Integrated list/filter surfaces for Customers, Applications and Users. Other inherited surface changes are **not** a claim of completed page-family redesign.
- TL four-tab layout retains its original data and action implementation; presentation no longer uses embossed cards. Original navigation predicates, logout function and authentication wrapper were compared byte-for-byte against HEAD and are unchanged.

### Isolated browser checks

All three browser runs used fresh disposable PostgreSQL databases initialized solely with existing migrations and existing repository fixtures. Each run used `127.0.0.1:25492/nexa_bos_test_redesign_shell`, web port 23092 and API port 28092; the previous run's resources were removed before reuse of these task-specific names. No application responses were mocked.

| Run | Result | Evidence / limitation |
| --- | --- | --- |
| Initial shell | 1 passed; 1.8m total | `shell-results/`: OWNER dashboard and People popup, both viewports/themes; popup Escape/focus restoration and hidden mobile rail checks. Initial theme screenshots were not treated as final visual evidence |
| Integration v2 | 1 passed; 2.0m total | `integration-v2-results/`: 68 viewport captures covering dashboard/popup plus 15 core routes in both themes/sizes. Some captures show transient loading and must be recaptured with explicit page readiness; this is not 68 completed-screen approvals |
| TL integration | 1 passed; 1.4m total | `role-integration-results/`: 16 exact viewport captures plus 16 separately labelled panel captures, four TL URL-backed tabs in both themes/sizes, using the existing DXB/AUH TL fixture setup. Four-tab selection, accessible heading, team-target and attendance surfaces, overflow and browser errors checked |

Paths above are relative to `C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/`. External runner/spec files are evidence helpers, not substitutes for the permanent regression suite.

Directly inspected v2 captures: OWNER light/dark desktop; Customers dark mobile; Applications dark desktop (loading); Users dark desktop (loading); Finance dark mobile; Catalog dark desktop; Attendance dark desktop; Workflow Designer dark mobile; Organization dark desktop. Directly inspected TL captures: Review light desktop and dark mobile; Team dark desktop; Personal dark mobile panel. Unlisted captures are generated but not yet individually reviewed. No identical-data before/after claim is made.

Each browser run's ownership-labelled container and named volume was removed after its test. Container IDs were `f54269b9d823862dd03fa395c1a0e281c7b4535382837c208e5b3b6b7dd1a20b`, `decef7987845cdded8fc144b828a8d0487c541b530da7c720770e55ea9278d11`, and `d326eb936824385a8b9f406d700ce7b0881cfde6ba2f7bcc7abb3bb7306fea87`; ownership label `nexa.task=nexa-ui-redesign-shell-20260912`, volume `nexa_ui_test_redesign_shell_20260912_data`. Screenshots remain outside Git; disposable fixture data was intentionally removed.

### Remaining work — do not bypass

- Complete all page-family layouts, populated detail/forms/queues, SE/COD and remaining roles; verify every route/action/permission and every significant state.
- Finish field-radius consistency and keyboard edge cases, including breakpoint changes and account-menu outside dismissal. Check every portal, chart, empty/error/loading state in both themes.
- Replace obsolete hover-expanded-sidebar/embossed-card/underline-tab visual assertions with approved-design assertions while retaining functional and security checks; add permanent theme/navigation regression coverage.
- Explicit readiness before captures, direct paired before/after evidence for every family at both requested sizes, and individual visual inspection. The captures in this checkpoint do not satisfy that release gate.
- Then required full validations, reviewed commit, PR, green CI and normal merge. No push, PR or merge has occurred at this checkpoint.

## Continued implementation checkpoint — 12 September

Still **not a completed verification matrix**. Changes below are frontend presentation changes; API/permissions/workflow handlers were retained.

- Record frames now separate identity summaries from the application, customer, employee and asset workspaces; account uses the same identity/content pattern. Forms have contextual guidance and separate form bodies.
- Operational attendance and asset lists/reports combine filters and results in one workspace. Approval Centre, transfers and exits use integrated queue/register regions. Schedules, holidays and asset categories place existing editors alongside the register on desktop and stack on mobile.
- SE metrics sit beside the existing trend; COD metrics sit beside its unchanged operational queues. HR/PRO use a grouped metric panel and separate operational area. Workflow Designer separates Bank/Product/Version context from configuration content.
- Public screens use a two-region brand/authentication composition, responsive to a stacked mobile layout. Existing auth behavior is unchanged.
- A type-check exposed the pre-existing unsupported named `DashboardInner` export from the Next page module. The helper is now local; its invocation and logic are unchanged. Subsequent type-check passed. This does not replace final build/CI.
- The empty, untracked directory tree `apps/web/app/users/@modal` made Next treat it as a missing-default parallel slot and prevented user-detail rendering. It contained only empty `(.)new` and `[...catchAll]` directories, no files or links, and no tracked entries. It was preserved (moved, not deleted) at external `empty-users-modal-preserved/`. The actual tracked root `app/@modal` remains untouched. Installed Next parallel-route docs and Context7 were consulted; no route fallback or new route was added.
- Permanent theme persistence / popup keyboard regression coverage was added in `tests/e2e/approved-ui.spec.ts`; execution and obsolete-test expectation updates remain pending.

### Iterative settled-render evidence

All paths are under the external `approved-ui-redesign/` evidence directory. Each run used a newly created, identity-verified PostgreSQL container at the documented test ports, existing migrations and the existing TL fixture. Every completed run removed only its own labelled container and volume.

| Run | Result and evidence |
| --- | --- |
| `record-checkpoint-results/` | Failed on a capture-helper visibility assertion: mobile Customers intentionally hides its desktop table. Login, OWNER and Applications captures are settled; not whole-run completion. Container `a98220f227ea9c3885049455d40b3d5f9db3e651cea39137749f98eeb4df3ab3` removed |
| `record-checkpoint-v2-results/` | Found real Application detail mobile overflow. Failed capture is not final evidence. Scoped zero-minimum grid/field sizing corrected. Container `4c49275e4db158c9a8fcca404216de5272107b183763774752f4af23850f53a9` removed |
| `record-checkpoint-v3-results/` | Application detail both themes/sizes passed overflow checks; user-detail blocked by the empty local parallel-slot directory above. Container `3f983d7c39def518fd078cc5bcebd5dfdd3a29a55cc70fd672434c33a2bb36c1` removed |
| `record-checkpoint-v4-results/` | User/customer details rendered; user-edit mobile intrinsic input width caused overflow. Scoped form grid/label sizing corrected; needs recapture. Container `fef780225f4e2a60eed4451d799541fd43f6e0dc0e33e3f4084d781e0ccb5deb` removed |

Directly inspected: first checkpoint login dark desktop, OWNER light desktop/dark mobile and Applications light desktop; v2 Application detail dark desktop/light mobile; v4 User detail light desktop, Customer detail dark desktop and Application detail dark mobile. Representative OWNER, Applications, User profile and mobile Application detail screenshots were sent during implementation. All data in these captures are genuine disposable-fixture API results, not production/canonical data or mocked responses. OWNER's one-period trend correctly shows insufficient-data state, not a fabricated chart.

### Expanded passes and additional family layouts

`record-checkpoint-v5` passed its single checkpoint test (3.5m total), but direct review rejected Attendance desktop because it showed loading and Schedules desktop because it preceded its settled API result. Its container `05ad479c0f2f7ab9e17fcfc68fa6300490397d5dde0949214e6ac7b40ea38ff5` and owned volume were removed. A green capture script did not make those images final evidence.

`record-checkpoint-v6` passed (one test, 5.3m total). Readiness is now rechecked after each viewport/theme change: network idle, no visible loading text, no busy region, fonts ready. Container `16f10701398a090c998380f305ba69a572fe6bdf2fca1ceefd8d158c2af1c5d6` and owned volume were removed. Directly reviewed v6: Attendance light desktop (populated), Schedules dark desktop (populated), SE light desktop, COD dark desktop, Finance light desktop/dark mobile, Catalog dark desktop, Organization light desktop. Other generated captures remain individually unreviewed. Attendance desktop and Finance dark mobile were sent to the user as intermediate evidence, not completion.

Additional local presentation work after v6:

- Leave balances and request register have separate summary/work regions; notification inbox has an unread summary and message/action feed.
- Organization totals form a summary column beside tabs and operational records. Hierarchy filters are separate from the reporting canvas and employee context.
- User Type identity and operational eligibility sit beside data-access scopes and the original permission matrix. All protected OWNER/system-type predicates are unchanged.
- KPI scorecards use metric-composition cards with status, exact weight, configured metric labels and the original permission-gated actions. This changes the directory from table rows to cards; regression locators must follow the new semantic structure without removing lifecycle checks.
- Targets and catalog master lists have separate context/filter regions. Notification rule and urgent-message forms have explicit context regions. Personal contract identity/download actions are separate from its existing summary.
- Target, KPI and organization drawers use inset rounded panels with dimmed/blurred backdrops. Their save/close/discard handlers remain in place.
- Repeated `tsc --noEmit` checks passed after these changes; final build and release validation remain pending.

`record-checkpoint-v7` finished with **one checkpoint passed and one permanent regression failed** (7.0m). The failure was the first login's 5-second visibility timeout; that wait was aligned with the existing 30-second login timeout. Its owned container `615cc9d7f848f9347bef7a46f55fc9d383f59c5e1a06aa2e5855eaf169a42b30` and volume were removed. Direct review nevertheless rejected the desktop Catalog filter overlap: its constrained context column now stacks fields/actions explicitly. A passing overflow assertion did not detect that internal overlap.

`record-checkpoint-v8` finished **four passed, four failed** (9.7m), not a release pass. Failures: real popup Tab-cycle defect; obsolete sidebar-footer locator; first-compilation Security navigation wait; and an intentionally stopped capture worker stalled on an incorrect `Team Leader` link locator (the actual User Type link is `TL`). Only worker PID 31328 was stopped after verifying its parent runner and repository-specific worker command. Playwright then shut down its own servers and the runner removed owned container `76b1649ba81ae5b7f9251eeacda75878699f6daf794d9524b68c8c6c3b910ec0` and volume. No protected runtime was stopped. The helper now has a bounded 30-second action timeout, the correct `TL` link, and the valid `submitted` drill-down metric.

Direct v8 review: Catalog, Targets, Organization and Employee report, each light/dark at 1440×900 and 390×844. Catalog desktop overlap is resolved. Employee report mobile identity columns required better readability; changed to two columns, and its attendance summary is now two-column on mobile. Organization counts now use an internally scrolling summary strip on mobile so the register is reachable sooner. Catalog mobile filters now share a two-column context region. Those subsequent changes require new captures; v8 is not their final evidence. Catalog light desktop was sent as an intermediate representative.

The real popup focus defect was fixed with explicit first/last Tab wrapping while preserving native Escape and trigger restoration. KPI editor numbered markers now use paired action/action-text tokens for dark contrast. Finance editors use inset rounded panels and grouped sections. Employee performance and report drill-down have explicit context/content regions. Type-check passed after these changes.

Permanent regression updates retain original data/action/permission assertions while replacing obsolete hover-sidebar, embossed-icon and underline-tab expectations. Lifecycle capture helpers now preserve each real workflow state while recording both themes. Existing leave, contract, transfer, offboarding, approval, finance and KPI fixtures are used only in the disposable database. A focused v9 navigation/theme/chart regression is running; final family and release gates remain open.

`approved-regression-v9` finished **six passed, two failed** (5.6m). Popup focus wrapping passed; remaining failures were a test clicking the portion of the heading covered by the open account popup and a locator excluding the intentionally hidden mobile rail. Corrected the click position and hidden-element lookup without removing the dismissal/inert assertions. Owned container `5fe9ab2d00a6a2fb5b02103234169c76a5016ea22ac8911afd7fcced98712fd0` and volume were removed.

The v10 expanded family regression finished **17 passed, eight failed** (17.1m), not a final pass. Leave, contract preparation, desktop approval/transfer/exit lifecycles and all three Assets tests passed. Failures include a transient Next development JSON parse error, first-compilation navigation waits, obsolete mobile logout navigation and an ambiguous Targets link locator. Record checkpoint failures were the empty-only Assets marker after assets had been created and the TL link outside the first User Types page. Owned container `e5fd7f4afba64f6a3862bd912c1e170b14a5f3bbbd929798dda7900a7a301eab` and volume were removed. Corrected tests require the frozen-application v11 rerun.

Direct v10 inspection, each in both themes and exact review sizes: contract preparation, approval decision, asset detail and leave balances. Approval decision has readable, reachable actions. Asset mobile master facts need two-column packing. Leave balance cards are excessively tall and push requests below the first screen; these are explicitly rejected as final evidence despite the passing workflow test. Contract preparation needs clearer field groups. Direct v8 Users and Applications review also found overly tall mobile filters; correction and recapture are pending.

Further v10 direct review: Leave request form and empty team calendar, Workflow preview, SE dashboard, Notification administration (all four views each). Notification desktop captures were premature: permission-gated configuration options had not rendered yet although the empty rule/audit regions had. Those desktop captures are rejected; the page now explicitly presents configuration loading and the capture waits for the real form. Tab-loop capture also now requires a visible tab before enumerating labels; a zero-tab loop cannot count as coverage.

Before v11: Users and Applications mobile filters use two columns with full-width search/date and original apply/clear actions. Asset master facts use two columns. Leave balances use compact label/value rows rather than full-height cards. Workflow configuration uses a two-column mobile context. Contract preparation has separate employee/identity and term/compensation fieldsets, retaining every original field and handler. Type-check passed. Loading-only regression captures are explicitly named `STATE-ONLY` and do not use the settled-page helper or count toward final page evidence.

Future browser runs isolate attachment storage as well as PostgreSQL: a uniquely named external `disposable-uploads-<guid>` directory is passed via `FILE_STORAGE_DIR`. Cleanup validates its exact evidence-folder parent, name and absence of reparse points before deleting only that owned temporary directory. Existing upload trees are not cleanup targets. A contract lifecycle capture using the existing API fixture payload is prepared, not yet executed.

A read-only AST comparison found 115 original API-call expressions across 52 modified TSX files unchanged except notification polling moved from AppShell to WorkspaceFrame; that move requires explicit final review. This is narrow evidence, not feature-parity proof.

Remaining family/state/role coverage, direct paired-before comparisons, individual visual corrections, full regression and delivery gates remain open. No commit, push, PR, CI or merge has yet been claimed.

## Direct rendered comparison checkpoints

These are directly inspected intermediate pairs, not release approval. Before is archived light-theme baseline; dark is newly implemented, with no invented dark-before image. Fixture populations differ. All linked images have the exact stated viewport; lower sections still require their own state captures.

| Family | Before 1440 / 390 | After light 1440 / 390 | After dark 1440 / 390 |
| --- | --- | --- | --- |
| Customer detail | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/finance-users-hotfix/browser-release-20260912-171857/customers-customer-detail--97ebe--irreversible-merge-actions-chromium/customer-detail-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/finance-users-hotfix/browser-release-20260912-171857/customers-customer-detail--97ebe--irreversible-merge-actions-chromium/customer-detail-390.png) | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/customer-detail-light-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/customer-detail-light-390.png) | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/customer-detail-dark-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/customer-detail-dark-390.png) |
| PRO dashboard | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/finance-users-hotfix/browser-release-20260912-171857/ui-polish-shared-applicati-d81e0-low-free-across-core-routes-chromium/app-wide-desktop-pro.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/finance-users-hotfix/browser-release-20260912-171857/ui-polish-shared-applicati-d81e0-low-free-across-core-routes-chromium/app-wide-mobile-pro.png) | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/pro-light-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/pro-light-390.png) | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/pro-dark-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v10-results/record-checkpoint-settled-record-and-role-layout-checkpoint-chromium/pro-dark-390.png) |
| Asset master detail | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/finance-users-hotfix/browser-release-20260912-171857/assets-Asset-drawer-and-cu-bd1b7-and-avoid-viewport-overflow-chromium/asset-detail-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/finance-users-hotfix/browser-release-20260912-171857/assets-Asset-drawer-and-cu-bd1b7-and-avoid-viewport-overflow-chromium/asset-detail-390.png) | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v11-results/family-regression-Asset-dr-4d933-and-avoid-viewport-overflow-chromium/asset-detail-light-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v11-results/family-regression-Asset-dr-4d933-and-avoid-viewport-overflow-chromium/asset-detail-light-390.png) | [1440](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v11-results/family-regression-Asset-dr-4d933-and-avoid-viewport-overflow-chromium/asset-detail-dark-1440.png) · [390](C:/Users/emran/Documents/NEXA-BOS-Evidence/approved-ui-redesign/family-checkpoint-v11-results/family-regression-Asset-dr-4d933-and-avoid-viewport-overflow-chromium/asset-detail-dark-390.png) |

Customer and Asset detail move identity/actions from a full-width banner into a dedicated desktop context panel alongside the tabbed editing workspace. Asset mobile identity/master values now use two columns instead of a long single-column stack. PRO moves the five full-width-row KPIs into a nested summary block beside compliance records. These use the approved rail/popups, contextual page capsule and theme treatment; these are structural changes, not only font or spacing changes.
