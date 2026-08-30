# NEXA BOS

Standalone brokerage operating system. This repository contains the engineering foundation, User Management & Access Control, current Organization Hierarchy, Customer + Bank/Product masters, Application Master with configurable Bank/Product workflow and lifecycle, TAT/delay, Attendance, Performance/MIS reporting, Targets/KPI, Finance, in-app Notifications, and Asset/Inventory management.

## Architecture

```text
Browser
   ↓
Next.js Web  (apps/web)
   ↓ HTTPS / REST JSON
FastAPI /api/v1  (apps/api)
   ↓
PostgreSQL 18.6
```

Frontend and backend are separate processes in one repository. See [docs/architecture.md](docs/architecture.md).

## Prerequisites

Approved runtimes:

| Runtime | Version |
| --- | --- |
| Node.js | 24.20.0 |
| pnpm | 11.24.0 |
| Python | 3.14.7 |
| uv | current stable |
| Docker / Docker Compose | current stable |
| PostgreSQL | 18.6 (via Compose) |

## Local setup

```bash
copy .env.example .env
npx pnpm@11.24.0 install
uv sync --directory apps/api
docker compose up postgres -d
```

Run the API:

```bash
uv run --directory apps/api uvicorn nexa_bos_api.main:app --reload --host 0.0.0.0 --port 8000
```

Run the web app:

```bash
npx pnpm@11.24.0 --filter web dev
```

- Web: http://localhost:3000
- API health: http://localhost:8000/api/v1/health
- API ready: http://localhost:8000/api/v1/ready
- OpenAPI (non-production): http://localhost:8000/docs

First-time OWNER setup: set `BOOTSTRAP_SECRET`, open `/bootstrap`, then sign in with email and password. After OWNER is created, bootstrap is permanently disabled. Sessions use an HttpOnly cookie plus `X-CSRF-Token`; the browser does not store an auth token.

## Checks

```bash
uv run --directory apps/api ruff check .
uv run --directory apps/api ruff format --check .
npx pnpm@11.24.0 lint:web
npx pnpm@11.24.0 typecheck:web
uv run --directory apps/api pytest
npx pnpm@11.24.0 build:web
npx pnpm@11.24.0 --filter web exec playwright install chromium
npx pnpm@11.24.0 test:e2e
```

## Docker

```bash
docker compose build
docker compose up
```

Do not commit `.env`. Use `.env.example` as the placeholder template.

## Release candidate status

Tasks 1–14 are integrated and the Task 15 full integration/UAT/stabilization pass is complete. The current database migration head is `0016_asset_inventory`.

Local release-candidate validation completed with:

- 189 API tests passed, including all 7 Security Baseline scenarios.
- 25 Playwright workflows passed across OWNER, restricted-scope, security, and cross-module journeys.
- Ruff check and format check, ESLint, TypeScript, and the Next.js production build passed.
- A fresh PostgreSQL database upgraded from `0001_baseline` through `0016_asset_inventory`; `alembic current` and `alembic check` passed.

Task 15 stabilized notification-rule replacement when targets are unchanged, controlled missing-user responses, application-list query growth, repeatable hierarchy-search test data, and major-screen OWNER browser navigation.

Accepted release-candidate residuals:

- The Notification Center returns the newest 100 deliveries without pagination. Older deliveries remain persisted and counted, but browsing them requires a future product/API pagination decision.
- Contextual notification links use a same-origin route-prefix allowlist. Producers emit fixed routes and destination authorization remains authoritative; exact route-segment matching is a defense-in-depth follow-up.

This is a Release Candidate pending pull-request review and CI. It is not a production deployment.

## Out of scope

External notifications, NexaHR, Redis, workers, and multi-tenancy are not implemented.
