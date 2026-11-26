import { authedRoute, parseBody, ok, searchParamsObject } from "@/lib/api/handler";
import { listPayments, recordPayment, recordPaymentSchema } from "@/server/services/payment.service";

export const GET = authedRoute(async ({ req, ctx }) => listPayments(ctx, searchParamsObject(req)));
// Clients may also send the idempotency key as the Idempotency-Key header.
export const POST = authedRoute(async ({ req, ctx, requestId }) => {
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body = recordPaymentSchema.parse({ ...raw, idempotencyKey: raw.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined });
  const r = await recordPayment(ctx, body);
  return ok(r.payment, requestId, { status: r.replayed ? 200 : 201, meta: { replayed: r.replayed } });
});
void parseBody;
