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
