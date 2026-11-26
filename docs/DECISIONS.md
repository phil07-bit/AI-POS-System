# Architecture decisions and deviations from the spec

1. **Custom session auth instead of Auth.js.** A random 32-byte token in an httpOnly, SameSite=Lax (Secure in production) cookie; only its
   sha256 hash is stored. 12-hour sliding expiry, revocation on logout/password change, bcrypt (cost 12) passwords, in-memory login rate limit.
   Reason: the app needs org switching, membership checks and revocation on every request, which is simpler to own than to bend Auth.js to.
   CSRF protection is an Origin/Referer host check on every mutation.
2. **Authorization in the service layer, not the route.** Every service builds on a `RequestContext` loaded from the session and the DB
   (active user, active membership, active org, permission set, property scope). Records outside a user's org or property scope return
   NOT_FOUND, so existence is not leaked.
3. **Money is integer pesewas** (`Int`, GHS default). Formatting is `GH₵ 1,250.50`.
4. **Ledger is append-only.** Balances are derived from charges, active allocations of confirmed payments and credits. The `status`
   columns are caches refreshed after each change and by the daily job. Corrections are compensating entries (reversal, credit, void,
   refund); DELETE is blocked by database triggers on payments, allocations, adjustments, receipts and charges; audit_logs rejects UPDATE/DELETE.
5. **Database-enforced rules:** a btree_gist exclusion constraint prevents two active leases overlapping on one unit; a deferred trigger keeps
   allocations ≤ payment amount; uniqueness on (lease, charge type, period start) makes charge generation idempotent; uniqueness on
   (org, idempotency key) makes payment recording idempotent, including under concurrency.
6. **Tenant ID numbers** are encrypted with AES-256-GCM; lists show only the last 4 characters; revealing requires `tenant.sensitive.read`
   and is audited.
7. **UI** uses hand-written Tailwind components rather than shadcn/ui to keep dependencies small. Recharts is not used yet (dashboards are phase 5).
8. **No Playwright end-to-end tests yet**; coverage is unit + integration against PostgreSQL. E2E is planned for phase 7.

## Phase 4 — facilities

9. **Maintenance costs live on work orders, not the rent ledger.** Labour, materials, vendor and other costs are integer pesewas;
   the total is derived. They are operating expenditure, so they never post to a tenant's ledger. Recharging a tenant for damage
   would be a manual charge in Rent & Charges. Spend reports count only completed or closed work orders, by completion date.
10. **Two-step completion.** The person doing the work marks a work order *completed*; someone with `work_order.close` signs it
    off (*closed*) or returns it for rework. Closing a work order on an asset records the asset's service date and recomputes
    its next due date (spec §4.9 "a human manager approves and closes service records"). Closed work orders are frozen and
    cannot be deleted (DB trigger); cancellation keeps the record.
11. **Request status follows its work orders.** The least-advanced open work order sets the request's status
    (open → approved, assigned, in progress, waiting for parts; all done → completed). Cancelling every work order returns the
    request to *approved*. A manager closes the request after review, which needs every work order completed/closed/cancelled.
    A `closed` status was added to the spec's list so "close after authorized review" is a distinct step from "completed".
12. **Technician visibility.** Roles with `work_order.read` but not `work_order.assign` see only work orders assigned to them;
    anything else is NOT_FOUND. They can update progress, costs, checklist and notes, but not reassign, reprioritise or close.
13. **New permission keys:** `vendor.read` (directory for read-only roles) and `maintenance.report.read` (cost reports;
    not given to technicians or finance). Run `syncSystemRoles` (any seed or test reset does) after deploying.
14. **Preventive maintenance generation** creates one work order per plan occurrence once today ≥ due − lead days, then
    advances the plan. A long-overdue plan produces one catch-up work order (missed occurrences are noted in its scope), not a
    backlog. Plan rows are locked and `(plan, occurrence)` is unique, so concurrent or repeated runs are safe.
    Run daily with `npm run jobs:run -- generate-pm` (included in `all`). If a plan's assignee is no longer valid the work
    order is created unassigned.
15. **Emergency escalation** sends in-app notifications and (mock) emails to staff who can manage requests on that property
    plus its property manager, once per request. The UI states plainly that this is not a monitored 24/7 service.
