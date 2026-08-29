# Security Engineering Standard

## Status and scope

This is the locked development-phase Security Engineering Standard for NEXA BOS. It preserves the security and conformance protections established through Tasks 1–10 while the remaining business modules are under active development.

This standard does not authorize Task 11, new business functionality, deployment work, new authentication mechanisms, new export formats, deletion capabilities, Document Management, or integration of additional security scanners. The stricter GitHub security-gate and external-scanner phase is deferred until the remaining NEXA BOS business modules are feature-complete.

## Authoritative enforcement boundary

- Backend authentication and authorization are authoritative.
- Permission, scope, and object-level authorization must be enforced server-side on every protected operation.
- Frontend visibility and disabled controls are usability measures, not security boundaries.
- Client-provided identifiers, filters, scope values, relationship IDs, or payload fields must never expand the caller's effective authorization scope.
- Direct API requests must receive the same authorization decision as requests initiated through the frontend.
- Existing pytest, Playwright, security-baseline, and conformance regression tests must not be weakened, bypassed, deleted, or reinterpreted merely to make future code pass.
- Every confirmed security defect requires a root-cause fix and permanent regression coverage.

## Severity and development-phase disposition

| Severity | Required disposition |
| --- | --- |
| Critical | **BLOCK.** The affected change cannot proceed or merge until the finding is fixed and retested. |
| High | **BLOCK.** The affected change cannot proceed or merge until the finding is fixed and retested. |
| Medium | Fix is preferred. Deferral requires a documented risk, compensating controls where applicable, named approval, and a tracked remediation decision. |
| Low | Documented remediation is allowed. Record the evidence, owner, and intended treatment. |
| Informational | Record as an observation; it is not a defect by itself. |

Severity must reflect demonstrated impact and reachability. A passing unrelated test or a frontend restriction does not reduce the severity of a server-side authorization defect.

## Security finding lifecycle

Every confirmed finding follows this lifecycle:

> Finding → Evidence → Severity → Reproduce → Root-cause Fix → Permanent Regression Test → Full Regression → Independent Review → Retest → Closed

A finding is closed only after the root cause is fixed, permanent regression coverage exists, the relevant full regression suite passes, and independent retest confirms the locked requirement. Implementation complete, local test success, CI success, merge, and production activation are distinct states and must be reported separately.

## Locked security baseline domains

The following eleven domains are permanent regression boundaries:

1. **Authentication & Session** — authentication failures, session issuance, idle and absolute expiry, single active session, account lockout, deactivation, inactive User Type handling, MFA state transitions, and session invalidation.
2. **Authorization — original six scenarios** — the six authorization invariants in the next section must remain continuously enforced.
3. **IDOR / BOLA** — guessed or supplied object identifiers must not expose or mutate resources outside the caller's effective permissions and scope.
4. **Scope Tampering** — query parameters, body fields, filters, reporting scope, Office, Team, hierarchy, employee, customer, application, target, or similar identifiers cannot broaden server-derived scope.
5. **CSRF** — authenticated state-changing requests require the valid session-bound CSRF control; missing or forged values remain rejected.
6. **Privilege Escalation** — users cannot grant themselves or others unauthorized roles, permissions, scopes, eligibility flags, account state, or OWNER status.
7. **Export Leakage** — export authorization and reporting scope are enforced server-side and exported data cannot exceed the caller's visible population.
8. **Mass Assignment** — unapproved payload fields must be ignored or rejected and must never mutate protected state.
9. **XSS / Injection Basics** — stored content must render safely, database queries remain parameterized, and basic injection payloads must not alter query semantics or execute active content.
10. **Bootstrap / Reset Protections** — OWNER bootstrap remains single-use and concurrency-safe; setup/reset tokens remain purpose-bound, time-bound, one-time, and protected from replay.
11. **Audit / Existing File Upload Security** — audit visibility follows authorization scope; existing upload surfaces enforce authorization, size/type validation, safe server-side filenames, and path-traversal resistance.

The canonical automated guards include `tests/api/test_security_baseline.py`, the related auth and scope suites under `tests/api`, `tests/e2e/security-baseline.spec.ts`, and the conformance regression tests. Later tests may extend this baseline but must not reduce it.

## Locked authorization invariants

1. User A cannot access User B outside authorized scope.
2. A normal user cannot successfully call an Admin API without the required permission.
3. A restricted user cannot modify protected data.
4. A user cannot access another Office, Team, or Reporting scope outside authorization.
5. Frontend restrictions cannot be bypassed by direct API requests.
6. A user cannot escalate their own role, permissions, scope, or OWNER status.

These invariants apply to read, create, update, action, report, export, and file endpoints wherever the protected object or population is in scope.

## Other locked security rules

- Approved report exports are Excel, PDF, and Print only. CSV must not be silently introduced.
- Unsupported `DELETE` operations remain rejected. Deletion functionality must not be added for the purpose of satisfying or expanding security tests.
- File-upload security applies only to upload surfaces that already exist. This standard does not authorize Document Management.
- Migrations are forward-only from the current point onward. Already-applied migrations must never be edited; corrections require a new forward migration.
- `.env` files, passwords, secrets, API keys, tokens, production credentials, runtime databases, and sensitive generated files must not be committed.
- Generated runtime artifacts, including changes generated in `next-env.d.ts`, must not be included in commits unless a separately approved framework change explicitly requires them.
- Existing security-baseline and conformance tests are permanent regression guards. A test may be strengthened or extended, but weakening requires explicit requirements authority and independent review.

## Development and review requirements

For changes that touch a protected surface:

1. Identify the applicable baseline domains and authorization invariants before implementation.
2. Preserve server-side permission, scope, and object-level checks.
3. Add permanent regression coverage for every confirmed security defect.
4. Run the targeted regression plus the full applicable pytest and Playwright suites.
5. Run the repository's existing lint, type, build, migration, and CI gates.
6. Review the final diff for secrets, generated artifacts, migration rewrites, accidental export formats, deletion endpoints, and unrelated scope expansion.
7. Obtain independent review and retest before closing a confirmed security finding.

No test result authorizes production deployment or activation by itself.

## Current GitHub development controls

The following is the inspected repository state on 2026-08-29. It is recorded for development continuity; changing it requires separate explicit approval.

- The active repository ruleset is **Protect main**, targeting the default branch.
- The ruleset blocks branch deletion and non-fast-forward updates.
- Changes to `main` require a pull request. The current rule does not require an approving review or resolved review threads.
- The required check is **Lint, test, and build**, with strict up-to-date status-check enforcement.
- There is no separate classic branch-protection configuration; protection is supplied by the active ruleset.
- GitHub Secret Scanning is enabled.
- GitHub Push Protection is enabled.
- Secret-scanning non-provider patterns and validity checks are currently disabled.
- Dependabot alerts are currently disabled, and Dependabot security updates are disabled.
- Code Scanning has no analysis recorded; CodeQL is not currently active.

Preserve these controls during feature development. Do not make **Security Regression**, **Dependency Review**, **CodeQL**, **Semgrep**, **Trivy**, **OWASP ZAP**, or **HexStrike-AI** new merge-blocking requirements without explicit approval. Do not enable stricter repository security settings as an incidental part of feature work.

## Deferred post-feature security phase

After the remaining NEXA BOS business modules are feature-complete, a separately authorized security phase is planned to evaluate and integrate:

- GitHub CodeQL;
- Dependency Review and Dependabot;
- Secret Scanning and Push Protection;
- Semgrep;
- Trivy;
- OWASP ZAP;
- the existing attacker-style API and security regressions;
- DLP and export checks;
- container and configuration scans; and
- a final independent HexStrike-AI offensive sweep from the isolated Kali/security VM.

This section is documentation only. These tools must not be integrated, executed, or made merge-blocking under this development-phase task.

## Explicit non-goals

This standard does not authorize or introduce:

- Task 11 Finance or Commission functionality;
- full Notifications;
- NexaHR integration;
- Redis, workers, queues, or microservices;
- deployment configuration, Cloudflare, or VPS work;
- new authentication mechanisms;
- new export formats;
- deletion capabilities; or
- Document Management.
