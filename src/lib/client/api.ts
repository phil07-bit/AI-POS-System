"use client";

export interface ApiErrorShape { code: string; message: string; details?: { path: string; message: string }[] }

export class ApiError extends Error {
  constructor(public code: string, message: string, public details: { path: string; message: string }[] = [], public status = 0) { super(message); }
}

/** Fetch wrapper for the /api/v1 JSON envelope. Same-origin cookies carry the session. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path.startsWith("/api") ? path : `/api/v1${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  let json: { data?: T; error?: ApiErrorShape } = {};
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok || json.error) {
    const e = json.error ?? { code: "INTERNAL_ERROR", message: `Request failed (${res.status})` };
    throw new ApiError(e.code, e.message, e.details ?? [], res.status);
  }
  return json.data as T;
}

/** Convert "1,250.50" into pesewas using string maths (no floats). Mirrors src/lib/money. */
export function toMinor(input: string): number | null {
  const s = input.replace(/[\s,]/g, "").replace(/^(GH₵|GHS|₵)/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
