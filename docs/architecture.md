# NEXA BOS architecture

NEXA BOS is a standalone modular monolith. This document describes the engineering foundation only.

## Runtime topology

```text
Browser
   ↓
Next.js Web
   ↓ HTTPS / REST JSON
FastAPI /api/v1
   ↓
PostgreSQL
```

- `apps/web` is the Next.js App Router UI process.
- `apps/api` is the FastAPI API process.
- PostgreSQL 18.6 is the only datastore in this foundation.
- Redis and background workers are not part of the initial implementation.

## API contract

- Versioned REST JSON under `/api/v1`.
- Foundation routes: `GET /api/v1/health`, `GET /api/v1/ready`.
- User management routes under `/api/v1/auth`, `/api/v1/users`, `/api/v1/user-types`, `/api/v1/permissions`, `/api/v1/security-settings`, `/api/v1/offices`, `/api/v1/departments`, `/api/v1/designations`, `/api/v1/teams`.
- Authentication is a server-side PostgreSQL session in an HttpOnly host-only cookie (`nexa_session`, SameSite=Lax, Secure in production). State-changing requests send `X-CSRF-Token`.
- First-time OWNER setup is `POST /api/v1/auth/bootstrap` with `BOOTSTRAP_SECRET`. It is permanently disabled after OWNER creation.
- OpenAPI is served at `/docs`, `/redoc`, and `/openapi.json` outside production.
- Errors use `{ "error": { "code", "message", "details", "requestId" } }`.
- Every response includes `X-Request-ID`. Incoming `X-Request-ID` is preserved.

## Frontend / backend boundary

- The browser talks only to FastAPI over HTTP JSON.
- Next.js does not own database access, RBAC, or business rules.
- `NEXT_PUBLIC_API_URL` is the browser-facing API origin.
- `API_URL` may override the server-side origin inside Docker.

## Database

- SQLAlchemy 2.0 async + asyncpg.
- Alembic is the only schema path.
- The baseline migration creates no business tables.
- Office is not a tenant. There is no `tenant_id`, tenant schema, or RLS.

## Explicitly not in this foundation

- HRMS integration
- Application, workflow, TAT, delay, finance, dashboards
- Redis / workers
- Multi-tenancy
- NexaHR IAM, packages, or database coupling
