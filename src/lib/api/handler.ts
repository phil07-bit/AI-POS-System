import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";
import { resolveContextFromSession } from "@/lib/auth/next";
import type { RequestContext } from "@/lib/auth/context";
import { logger } from "@/lib/logging";

type Params = Record<string, string>;

interface HandlerArgs { req: NextRequest; params: Params; requestId: string }
interface AuthedArgs extends HandlerArgs { ctx: RequestContext }

export function ok(data: unknown, requestId: string, init?: { status?: number; meta?: Record<string, unknown> }) {
  return NextResponse.json({ data, meta: { requestId, ...(init?.meta ?? {}) } }, { status: init?.status ?? 200, headers: { "x-request-id": requestId } });
}

export function errorResponse(e: unknown, requestId: string) {
  let err: AppError;
  if (e instanceof AppError) err = e;
  else if (e instanceof ZodError) {
    err = new AppError("VALIDATION_ERROR", "The supplied data is invalid.",
      e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = (e.meta?.target as string[] | undefined)?.join(", ");
    err = new AppError("CONFLICT", `A record with the same ${target ?? "unique value"} already exists.`);
  } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    err = new AppError("NOT_FOUND", "Record not found.");
  } else if (isPgExclusionViolation(e)) {
    err = new AppError("CONFLICT", "This unit already has an active lease overlapping these dates.");
  } else {
    logger.error("unhandled_error", { requestId, error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e) });
    err = new AppError("INTERNAL_ERROR", "An unexpected error occurred.");
  }
  if (err.status >= 500) logger.error("request_failed", { requestId, code: err.code });
  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details }, meta: { requestId } },
    { status: err.status, headers: { "x-request-id": requestId } },
  );
}

export function isPgExclusionViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return msg.includes("leases_active_no_overlap") || msg.includes("23P01");
}

/** CSRF defence for cookie-authenticated mutations: Origin (or Referer) must match our host. */
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw new AppError("FORBIDDEN", "Missing Origin header.");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { throw new AppError("FORBIDDEN", "Invalid Origin header."); }
  const allowed = new Set([host, process.env.APP_URL ? new URL(process.env.APP_URL).host : null].filter(Boolean));
  if (!allowed.has(originHost)) throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
}

type RouteCtx = { params: Promise<Params> };

/** Public route (no session required) with envelope + error handling. */
export function publicRoute(fn: (a: HandlerArgs) => Promise<NextResponse | unknown>) {
  return async (req: NextRequest, rc: RouteCtx) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      checkOrigin(req);
      const res = await fn({ req, params: (await rc?.params) ?? {}, requestId });
      return res instanceof NextResponse ? res : ok(res, requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

/** Authenticated route: resolves RequestContext from the session cookie (never from the body). */
export function authedRoute(fn: (a: AuthedArgs) => Promise<NextResponse | unknown>) {
  return async (req: NextRequest, rc: RouteCtx) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      checkOrigin(req);
      const ctx = await resolveContextFromSession(requestId);
      if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
      const res = await fn({ req, params: (await rc?.params) ?? {}, requestId, ctx });
      return res instanceof NextResponse ? res : ok(res, requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try { json = await req.json(); } catch { throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON."); }
  return schema.parse(json);
}

export function searchParamsObject(req: NextRequest): Record<string, string> {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}
