import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", latencyMs: Date.now() - started, integrations: { email: process.env.EMAIL_PROVIDER ?? "mock", ai: process.env.AI_PROVIDER ?? "mock", payments: process.env.PAYMENT_PROVIDER ?? "mock" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
