# NEXA BOS

Standalone brokerage operating system. This repository contains the engineering foundation, User Management & Access Control, Customer + Bank/Product masters, Application Master with configurable Bank/Product workflow and lifecycle, TAT/delay, Attendance, Performance/MIS reporting, and Targets/KPI.

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

## Out of scope

Finance, commission, full notifications, NexaHR, Redis, workers, and multi-tenancy are not implemented.
