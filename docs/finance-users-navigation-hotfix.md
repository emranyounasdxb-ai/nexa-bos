# Finance shortcut and pending Users search

Baseline: `32db8e4b8244533a7e753b5b1a1da60c17fb72d6` (Parts 1–4 preserved).

## Confirmed causes

- `RoleWorkspace` checked only `Finance.View`, unlike the Finance page, which already accepts either `Finance.View` or `Finance.ViewCommissionRules`. The commission-rule-only fixture could open Finance and read commission rules, but had no dashboard shortcut. Neither permission remains denied. No backend authorization change is required.
- Users URL updates applied the pending search and cleared its page, then applied the old pagination action, overwriting that reset with page 2. Both Next and numbered-page clicks reproduced this on desktop and mobile; the browser displayed `Showing 26–1 of 1` for a single match with page size 25. Part 3's combined search/page-size handling did not cover pagination-action precedence, and Part 4 did not fix it.

## Narrow corrections

The Finance shortcut accepts the same two alternatives as the existing page. Users applies action parameters first, then applies a pending search and its page-1 reset last. Selected page size and other filters are retained. Search timer cancellation and push/replace behavior remain unchanged. No pagination display clamp masks a wrong URL or request.

## Permanent regression

`tests/e2e/hotfix-navigation.spec.ts` uses authenticated disposable API-created fixtures, not mocked authorization or list results. It checks all four Finance permission combinations, direct Finance access, rule/payout API allow/deny, shortcut visibility and keyboard navigation. Next and Page 2 are each checked at 1440×900 and 390×844 with page size 25 and a 26-record search group.

Playwright's clock is installed before application timers and paused after the initial results load. Typing leaves the old query and zero new-query requests before the real button click. Advancing the clock crosses the 300ms debounce without sleeping. Assertions verify the new URL query, page 1, page size 25, real matching row, absence of nonmatching rows, `Showing 1–1 of 1`, every observed new-query request's page/page size, and reload persistence. Retries are disabled.

On the unchanged baseline the valid fixture run produced 3 passing controls and 5 failures (commission-rule-only shortcut and four pending-search cases). An earlier fixture setup omitted `Dashboard.View`; that interrupted setup run is retained separately, not counted as application reproduction. Adding the actual dashboard permission fixed the fixture without changing application behavior.

Raw logs, traces and screenshots are retained outside Git. No migrations, API, RBAC, canonical data, credentials, startup settings or VPS deployment are changed by this hotfix.

## Full-gate focus failure

The first complete browser gate reported 119 passed / 1 failed: the unchanged catalogue test lost the Bank listbox in Create Application when background Applications data finished loading. `ApplicationsPageInner` supplied a new inline `onClose` callback on every render; the dialog's effect depends on that callback and focuses its Close button, dismissing the active select. A deterministic regression holds an actual Applications list response, opens Bank, and releases the unmodified response. The listbox disappeared before correction while the other eight hotfix cases passed.

The existing close callback is now memoized with its router/search-parameter dependencies, leaving closing, URL cleanup and trigger focus restoration unchanged. No catalogue assertion or select helper was altered, and no wait for background loading was added to conceal the interaction. This minimal additional source correction resolves the failure discovered by the required full gate.

## Local release validation

- Focused catalogue/hotfix gate: 10 passed, retries 0.
- Complete Playwright corpus on a fresh guarded database: 121 passed in 26.4m, retries 0, exit 0.
- Complete PostgreSQL API suite: 337 passed in 1877.28s, one existing Alembic configuration warning.
- Ruff check/format (171 files), ESLint, TypeScript, Next production build, Compose config/API-Web builds, Alembic current/check (0027_org_business_units; no new operations), secret scan and diff/whitespace checks passed.
