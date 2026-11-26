import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulated outbox" };

/**
 * Demo-only view of SIMULATED emails (mock email adapter). Disabled unless DEMO_MODE=true,
 * EMAIL_PROVIDER=mock and NODE_ENV is not production — it exposes reset/invite links.
 */
export default async function Outbox() {
  if (process.env.DEMO_MODE !== "true" || (process.env.EMAIL_PROVIDER ?? "mock") !== "mock" || process.env.NODE_ENV === "production") notFound();
  const msgs = await prisma.notification.findMany({ where: { channel: "email" }, orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <main id="main" className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Simulated email outbox</h1>
      <p className="mb-4 text-sm text-amber-800">Mock email provider — none of these messages were actually sent.</p>
      <ul className="space-y-3">
        {msgs.map((m) => (
          <li key={m.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
            <div className="flex justify-between text-xs text-slate-500"><span>To {m.recipient} · {m.eventType}</span><span>{formatDateTime(m.createdAt)} · {m.status}</span></div>
            <div className="font-medium">{m.subject}</div>
            <p className="mt-1 whitespace-pre-wrap break-all text-slate-700">{m.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
