import { prisma } from "@/lib/db";
import { logger } from "@/lib/logging";

/**
 * Email adapter. EMAIL_PROVIDER=mock (default) records the message in the notifications table
 * with status "simulated" and logs it — NOTHING is actually sent. A real provider (e.g. Resend,
 * Postmark, Hubtel email) can be added by implementing EmailProvider and selecting it via env.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  eventType: string;
  idempotencyKey: string;
  organizationId?: string | null;
  userId?: string | null;
}

interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<{ status: "sent" | "simulated"; providerMessageId?: string }>;
}

const mockProvider: EmailProvider = {
  name: "mock",
  async send(msg) {
    logger.info("email.simulated", { to: msg.to, subject: msg.subject, eventType: msg.eventType });
    return { status: "simulated" };
  },
};

function provider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? "mock";
  if (name !== "mock") logger.warn("email.provider_not_implemented_falling_back_to_mock", { name });
  return mockProvider;
}

/** Idempotent send: a second call with the same key is a no-op. */
export async function sendEmail(msg: EmailMessage) {
  const existing = await prisma.notification.findUnique({ where: { idempotencyKey: msg.idempotencyKey } });
  if (existing) return existing;
  const p = provider();
  const n = await prisma.notification.create({
    data: {
      organizationId: msg.organizationId ?? null, userId: msg.userId ?? null, recipient: msg.to,
      eventType: msg.eventType, channel: "email", subject: msg.subject, body: msg.body,
      provider: p.name, status: "pending", idempotencyKey: msg.idempotencyKey,
    },
  });
  try {
    const res = await p.send(msg);
    return prisma.notification.update({ where: { id: n.id }, data: { status: res.status, sentAt: new Date() } });
  } catch (e) {
    return prisma.notification.update({ where: { id: n.id }, data: { status: "failed", failureReason: String(e).slice(0, 500) } });
  }
}
