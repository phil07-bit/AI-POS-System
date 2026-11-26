# Integrations: what is real and what is mocked

No credentialed third-party service is called in phases 1–3. Each integration sits behind an adapter chosen by an environment variable.

| Integration | Variable | Phase 1–3 behaviour | Production path |
|---|---|---|---|
| Email | `EMAIL_PROVIDER=mock` | `src/server/integrations/email` writes a `notifications` row with status `simulated` (idempotent by key). Invitation and password-reset links are visible at `/dev/outbox` when `DEMO_MODE=true` and not in production. | Add a provider adapter (e.g. an SMTP or transactional API) implementing the same `sendEmail` contract; keep the idempotency key. |
| Payment collection | `PAYMENT_PROVIDER=mock` | Disabled. Mobile money, bank transfer, cash and cheque are **recorded** payment methods with manual confirmation and reconciliation by reference. No money moves through the app. | A MoMo/card aggregator adapter would create `pending` payments from webhooks (verified signatures), then reuse the same confirm/allocate flow. |
| AI | `AI_PROVIDER=mock` | Not used yet (phase 6). | Phase 6. |
| SMS / WhatsApp | – | Out of MVP scope per spec. | Later phase. |
| File storage | – | Not used yet (documents are phase 5). | Local adapter first, then S3-compatible private storage. |

Phase 4 uses the email mock for emergency maintenance escalation, and writes in-app notification rows (no UI until phase 5) for emergencies and work-order assignments.

Nothing in the UI claims a message was delivered: simulated emails are labelled as such.
