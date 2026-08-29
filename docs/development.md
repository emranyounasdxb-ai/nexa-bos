# Development

## Layout

```text
apps/web     Next.js 16.3.3 App Router
apps/api     FastAPI 0.141.1
docs         Architecture and development notes
tests/api    pytest + httpx
tests/e2e    Playwright smoke
.github      CI (no CD)
```

## Environment

Copy `.env.example` to `.env`. Database credentials come from environment variables. Do not commit `.env`.

Set `BOOTSTRAP_SECRET` before creating the first OWNER. After OWNER exists, bootstrap is permanently disabled even if the secret remains in the environment.

## API

From `apps/api`:

```bash
uv sync
uv run uvicorn nexa_bos_api.main:app --reload --host 0.0.0.0 --port 8000
uv run alembic current
uv run alembic upgrade head
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

`GET /api/v1/health` does not require PostgreSQL. `GET /api/v1/ready` requires a reachable PostgreSQL instance.

## Web

From the repository root:

```bash
npx pnpm@11.24.0 install
npx pnpm@11.24.0 --filter web dev
npx pnpm@11.24.0 lint:web
npx pnpm@11.24.0 typecheck:web
npx pnpm@11.24.0 build:web
```

Set `NEXT_PUBLIC_API_URL` before a production build if the API origin is not `http://localhost:8000`.

## Compose

```bash
docker compose config
docker compose up postgres -d
docker compose up --build
```

The official `node:24.20.0` image was not published on Docker Hub when this foundation was created. The web Dockerfile installs Node.js **24.20.0** from `nodejs.org`.

PostgreSQL 18 official images store data under `/var/lib/postgresql` (not `/var/lib/postgresql/data`).

Compose uses a NEXA BOS-only named volume `nexa-bos-pgdata`. Do not reuse NexaHR volumes. Credentials come from `NEXA_POSTGRES_*` so a machine-level `POSTGRES_PASSWORD` cannot initialize this database. The container still listens on 5432; the host mapping defaults to 15432 so a machine-level PostgreSQL on 5432 is not used. If host ports 3000 or 8000 are already in use, set `WEB_PORT`, `API_PORT`, and `NEXT_PUBLIC_API_URL` when starting Compose.

## Task 5 deferrals (Customer masters)

Customer visibility configuration is stored on user types as `customer_visibility_scope`. Company-wide enforcement is in Task 4. Do not invent a Customer Owner.

Deferred until Applications exist:

- Office, Team/Reporting Hierarchy, and Own Customers filtering (derived from Application Case Owner)
- Customer deactivation blocked by active Applications
- Merge relinking of Applications onto the primary customer

## Task 8 reporting

See `docs/reporting.md` for periods, event-time attribution, reporting scopes, permissions, endpoints, and export libraries (`openpyxl==3.1.5`, `fpdf2==2.8.8`).

## Task 9 attendance

See `docs/attendance.md` for statuses, schedules, Ramadan configuration, Late/Early/Incomplete rules, corrections, leave types, Official Holidays, in-app holiday reminders, permissions, Attendance Score/Impact, and migration `0008_attendance_holidays`.

## Host runtime notes

Project files pin the approved versions. If the developer machine has a nearby 24.x / 3.14.x patch, use Docker and CI as the source of truth for the exact approved runtimes. Do not change the machine-wide default Node or Python unless you intend to.
