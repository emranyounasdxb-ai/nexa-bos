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
- Customer and catalog routes under `/api/v1/customers`, `/api/v1/banks`, `/api/v1/products`, `/api/v1/bank-products`.
- Application and workflow routes under `/api/v1/applications` and `/api/v1/workflows`.
- Performance / MIS reporting routes under `/api/v1/reports`.
- Attendance, holiday, and schedule routes under `/api/v1/attendance`.
- Target and KPI scorecard routes under `/api/v1/targets`.
- In-app alert and Notification Center routes under `/api/v1/notifications`.
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
- Customers have no permanent owner, creator-derived owner, or `owner_id`. Visibility is not inferred from who created the record.

## Customer visibility

Customer visibility is a separate user-type setting (`customer_visibility_scope`) from User Directory visibility (`visibility_scope`) and Application visibility (`application_visibility_scope`). The configured values are company, office, team, and own.

Company-wide customer visibility lists all customers. Office, Team/Reporting Hierarchy, and Own Customers are derived from Applications: Own Customers are those where the current user is Case Owner; office and team scopes use the current Case Owner's office or reporting hierarchy. Customer profiles list only applications the current user can see.

Customer deactivation is blocked while active applications exist. Customer merge relinks active and historical applications to the primary customer without changing application lifecycle history.

## Applications and workflows

Case Owner eligibility is a user-type flag that defaults to No. OWNER enables it per user type. Workflows are versioned per Bank and Product. Application Created is the only globally fixed entry stage; remaining stages and transitions are configured by authorized users and are not seeded.

## Explicitly not in this foundation

- External HRMS integration beyond the bounded employee Basic/HR/PRO profile foundation

## Bounded employee profile foundation

Nexa BOS owns a deliberately limited three-stage employee record: Basic identity and account
control, sensitive HR metadata, and PRO compliance-document metadata. It does not include Leave,
Contracts, Transfers, Exit/Offboarding, or HR approval workflows. Authorization is permission- and
scope-driven; labels such as HR and PRO never grant access by themselves.

Private employee attachments use `FILE_STORAGE_DIR/employee-documents`. PostgreSQL stores only
metadata and collision-resistant storage keys. Replacement creates an immutable prior version,
normal removal is a soft delete, and permanent file/database purge requires its own high-risk
permission. Other sessions observe profile revisions through authenticated polling/revalidation;
there is no new message broker or realtime infrastructure.
- External notifications (email/SMS/WhatsApp)
- Redis / workers
- Multi-tenancy
- NexaHR IAM, packages, or database coupling
