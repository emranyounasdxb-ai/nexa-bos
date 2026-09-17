# AMAFH CORE design release review — 2026-09-17

The owner authorized a reviewed commit, branch push and PR to `main`. Earlier local-only statements in the design evidence are historical scope boundaries. This review does not authorize deployment or override missing verification, automatic approval rejection, or protected-branch gates.

## Reviewed change

The branch applies the approved Manrope typography, accessible light/dark tokens and responsive desktop header/tablet rail/mobile navigation through existing components. It includes the approved menu grouping, centered desktop navigation, sun/moon theme controls, dashboard column flow and collapsible sections, responsive records and Customers-reference table/list sizes. Official logo assets and unified Designations remain intact. Global search remains a proposal requiring review; no dummy header search or new endpoint is implemented.

The diff contains frontend presentation, production font/icon assets and licensing, design documentation and E2E source. Backend code, API helpers, permission helpers, packages/lockfiles, CI configuration and migrations are unchanged. Read-only AST comparison found no changed existing API call expressions in modified TSX files. This is narrow review evidence, not proof that every workflow passes. The obsolete `components/app-shell.module.css` has no remaining imports or references and its replacement is the existing WorkspaceFrame stylesheet.

## Fresh rendered follow-up

The existing authorized Chrome OWNER session at `http://localhost:13000` was reused without logging in with disposable credentials, replacing sessions or modifying records. Native screenshots and measurements remain outside Git under `C:/Users/emran/Documents/NEXA-BOS-Evidence/figma-release-20260917/`.

| Surface | Fresh inspection | Limits |
| --- | --- | --- |
| OWNER My Workspace | Expanded full-page screenshots inspected at 1920×1031, 1194×834 and 393×852 in both themes; unassigned leave rows wrap without clipping or page overflow | Existing controls preserved; no submissions |
| Contracts register / reminders / types | Native screenshots inspected at all three widths in both themes; compact empty states and type form | No contracts or configured types available; populated rows unverified |
| Case Operations clawbacks / Stage CSV | Native screenshots inspected at all three widths in both themes; empty clawbacks and unchanged import controls | No upload/import or decisions performed |
| Case Operations reports | Existing six authorized cases generated through the page's read-only report action; native screenshots inspected at all three widths in both themes | Desktop/tablet table scrolling retained; mobile cards retain all columns |
| Case Operations routing | Desktop both themes and tablet light screenshots inspected | Remaining width/theme captures interrupted by browser screenshot timeout; empty assignments only |
| Workflow selected version | Existing active version selected; stages, transitions and accessible preview captured in both themes at all three widths | Desktop/tablet visible content inspected; mobile full preview inspected, remaining below-fold stage/transition details still need focused captures |

Earlier route/state coverage remains in [the typography review](ui-list-typography-review.md) and [Figma checklist](ui-figma-v2-checklist.md). Capturing or passing shared component tests does not certify an uninspected screen.

## Checks

- Web ESLint and TypeScript passed on the final frontend source.
- Ruff lint and formatting passed: 184 Python files already formatted.
- Production `next build --webpack` passed with 51 static pages in an external verification copy. Final app/component/lib source hashes match that copy. Local default Turbopack verification is limited by dependency junctions outside the copy; GitHub CI retains the unchanged default build command.
- Presentation-only chart tests passed 2/2. Playwright discovery passed: 158 tests in 51 files; discovery is not test execution.
- A full API regression run is in progress against a newly created, identity-verified disposable database in the existing task-owned PostgreSQL 18.6 container. Existing databases were not reset or seeded. Existing migrations were required only to initialize that empty test database; there is no release migration change. Its result must be read from the final run, not inferred from progress.
- Targeted staged-file checks exclude private configuration, environment files, screenshots, exports, logs, test outputs and build artifacts. Self-hosted Manrope includes its OFL license and third-party notice.

## Essential merge blockers

Keep the PR in draft until these are resolved:

1. Rendered TL and coordinator role dashboards lack existing authorized test identities/sessions; no role account was invented or reset. The full navigation/permission/browser regression suite has not run on the final branch.
2. Populated Finance, Contracts, Transfers, Exit/Offboarding and Attendance Reports, product-specific catalogue rules, conditional compliance/security forms and remaining record/history states lack complete rendered verification. Empty-state captures are not substitutes.
3. The isolated verification frontend on 13117 is stopped. Its restart was rejected twice by automatic approval review with `blocked by policy` and no more specific reason. No alternate method or port was used to bypass that rejection. Canonical preview 13000 remains available.
4. Required GitHub `Lint, test, and build` must pass on the exact PR head, with the strict up-to-date `main` ruleset satisfied. Local Webpack success does not replace this gate.

Do not merge, switch the checkout to main or delete the design branch while essential verification remains blocked. No VPS deployment has been performed. Deployment-relevant changes are the self-hosted font, production SVG glyphs and theme/PWA color metadata; there are no dependency, environment/configuration or database migration changes.
