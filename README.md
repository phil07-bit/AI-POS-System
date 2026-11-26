# AI-POS — AI Property Operating System (MVP, phases 1–3)

A multi-tenant property operations platform for landlords and property managers in Ghana.
This milestone covers spec phases 1–3: the operational core, built before any AI features.

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Sign-up/login, sessions, organizations, invitations, permission-key RBAC with property scope, audit log, app shell | Done |
| 2 Property ops | Properties, units, tenants (encrypted ID numbers), leases (draft → active → expired/terminated, renewals), occupancy | Done |
| 3 Rent & ledger | Charge generation, payments (idempotent), allocation, confirmation, reversal, receipts, credits/refunds, tenant ledger, arrears aging, rent roll, tenant portal | Done |
| 4–7 | Maintenance, reports/documents, AI, hardening | Not started (shown disabled in the nav) |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · PostgreSQL 16 · Prisma 6 · Zod · Vitest.
Auth is a small custom session layer instead of Auth.js (see [docs/DECISIONS.md](docs/DECISIONS.md)).

## Run it locally

```bash
docker compose up -d            # or any PostgreSQL 16 with databases aipos and aipos_test
cp .env.example .env            # set FIELD_ENCRYPTION_KEY
npm install                     # also runs prisma generate
npm run db:migrate              # applies prisma/migrations (tables, constraints, triggers)
npm run db:seed                 # fictional demo org "Caxaze Property Solutions"
npm run dev                     # http://localhost:3000
```

Demo logins (password `DemoPass2026!`, demo data only):

| Email | Role | Sees |
|---|---|---|
| owner@caxaze.demo | Organization owner | Everything |
| manager@caxaze.demo | Property manager | All properties, no financial reversal |
| finance@caxaze.demo | Finance officer | Payments, reversals, reports |
| kumasi.manager@caxaze.demo | Property manager | Only Adum Heights (property scope) |
| landlord@caxaze.demo | Owner viewer | Read-only, Adum Heights |
| auditor@caxaze.demo | Auditor | Read-only incl. audit log |
| tech@caxaze.demo / facility@caxaze.demo | Technician / Facility | Phase 4 roles, minimal access today |
| tenant@caxaze.demo | Tenant portal | Own lease, balance and receipts only |
| owner@osuhomes.demo | Owner of a second org | Used to show cross-org isolation |

The seed creates 3 properties (Accra residential, Spintex commercial, Kumasi mixed-use), 17 units, 12 tenants, 12 leases with monthly,
quarterly, half-yearly and yearly billing, ~85 charges, and payments that produce arrears in every aging band, a pending MoMo payment,
a reversed duplicate, an advance (credit) and an expiring lease. All names, numbers and references are synthetic.

## Tests

```bash
npm test                 # 59 tests: unit + integration (integration uses TEST_DATABASE_URL and truncates it)
npm run test:unit
npm run test:integration
npm run typecheck
```

Integration tests run the real service layer against PostgreSQL and cover cross-org isolation, property scope, tenant-portal
isolation, role limits, concurrent lease activation, idempotent and racing payments, over-allocation, reversal, credits/refunds,
voids and arrears consistency with the ledger.

## Scheduled jobs

```bash
npm run jobs:run -- all               # expire-leases, generate-charges, refresh-statuses (idempotent)
npm run jobs:run -- generate-charges --org <organizationId>
```

Run `all` daily (e.g. 02:00 Africa/Accra). Each run is recorded in `job_runs`.

## API

REST under `/api/v1`, JSON envelope `{ data, meta: { requestId } }` or `{ error: { code, message, details }, meta }`.
Mutations require a same-origin request (Origin/Referer check) and a session cookie. `POST /api/v1/payments` honours an
`Idempotency-Key` header. Resources: auth, me, organizations, members, invitations, properties, units, tenants, leases,
rent-charges, payments, refunds, reports (arrears, collection, rent-roll), dashboard/portfolio, audit-logs, portal, health.

## Layout

```
prisma/            schema, migrations (incl. raw SQL constraints/triggers), seed
src/app/           pages (app/, portal/, auth) and API routes (api/v1)
src/server/domain/ pure business rules (rent schedule, ledger maths, lease rules, occupancy)
src/server/services/ authorized service layer (every call checks org, permission and property scope)
src/server/jobs/   scheduled job CLI
src/lib/           money, dates, auth, permissions, validation, API helpers
tests/             unit and integration tests
docs/              decisions, assumptions, mocked integrations
```

More: [docs/DECISIONS.md](docs/DECISIONS.md) · [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) · [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
