# AMAFH CORE design follow-up

This follow-up is separate from PR #117, merged at
`38d7372a9aa8fa11b171fccba66982dfa4fb567e`. Its six application files
were preserved locally after that release and are reviewed here for a new PR.

## Application fixes

- Approval Centre: bind the focus-return reference directly to its portaled
  Refresh queue action.
- Transfers and Exits: retain the original dialog trigger when connected;
  otherwise restore focus to an enabled header action, with the existing
  workspace fallback.
- TL desktop workspace: remove the empty compact page-header card and its
  reserved height. Responsive headings and actions remain available.
- Header appearance control: use the approved magenta light-theme background
  and accessible dark action colors. Existing sun/moon controls, switching,
  persistence, navigation grouping and centering are retained.
- OWNER overview: refine desktop hero spacing, section typography, card shadow
  and stage-card radius. Render the existing top six stage counts as compact
  icon/name/track rows, retaining ranking, totals and stage drill-downs.
- OWNER pipeline: apply tinted metric tiles and footer bands to existing values
  and empty-state text. No sample comparisons, additional metrics or dummy data
  are introduced. Footer bands retain readable Customers-based secondary text.

The approved compact/collapsible dashboard arrangement, official branding,
Customers list fonts and accessible token adjustments are preserved. API calls,
permission checks, fields, calculations and submission workflows are unchanged.
No dependency, configuration or database migration changes are included.

## Test-only support included

- Approval Centre, Exits and Transfers retain their workflow, focus, permission
  and validation assertions. Their closed mobile-navigation assertion now
  targets the approved More navigation control at widths below 640px; the
  existing tested desktop/mobile viewports remain unchanged.
- TL adds a desktop geometry assertion that the compact header reserves no
  height. Existing assertions are retained in the committed version.

Unfinished Attendance, catalog, create-user, Customers, COD/SE dashboard,
date-picker, Finance and login test edits, two other TL test hunks and the
untracked populated-state spec remain local and are excluded from this PR.

## Verification and limitations

- ESLint and TypeScript: passed on the reviewed source.
- Production build: passed with webpack, including all 51 static pages, from an
  isolated source-only copy so the running development output was preserved.
  CI also runs the repository's default production build for the final PR head.
- Staged scope review: no changed API/permission call expressions, secrets or
  temporary exports/screenshots/test artifacts. All 142 app/component/library
  source files match the isolated production-check source copy.
- Existing preview: `http://127.0.0.1:13117`, API `18117`. Read-only live
  environment and SQL checks confirm test mode, disposable database
  `nexa_figma_retry_test` on host port `25517`, database user `figma_v2`, container
  server `172.17.0.4:5432` and isolated upload storage. Services on `13000` and
  `18000` were preserved; no database reset, seeding or migration was run.
- A focused six-case browser run used exact staged Approval Centre, Exits and
  Transfers tests, one worker, no retries and no service startup. All six failed
  before their focus checks: SE exit creation returned permission-denied,
  SE Exits rendered its permission-denied state, and HR had no Prepare transfer
  action. These fixture permissions were not expanded, and assertions were not
  weakened. Consequently these are incomplete behavior checks, not passes.
- The running preview still serves the earlier `production-final-review`
  build. It contains the three focus fixes, but not the new TL/header/OWNER
  presentation changes. Their current rendered desktop/tablet/mobile and
  light/dark verification remains incomplete. The newly added TL geometry
  assertion was not run against that outdated preview.
- Previously supplied matching-size Figma/application comparisons are explicitly
  **BEFORE** screenshots, not corrected screenshots. Passing compilation or CI
  does not establish visual fidelity. No corrected matching-size visual evidence
  is claimed for this follow-up.

The earlier automatic approval review rejected frontend startup with
“blocked by policy.” That restriction was not retried or bypassed. No restart
was requested, no additional preview or port was introduced, and the broad
browser regression cycle was not restarted. The remaining rendered verification
requires a manually started build containing these corrections in the existing
disposable environment; the focused workflow fixtures also require appropriate
authorized roles before their existing assertions can complete.

GitHub's required Lint, test, and build check must pass for the final PR head
before merging. This follow-up does not authorize VPS deployment.
