import { NextResponse, type NextRequest } from "next/server";

/** Attach a request ID to every request for structured logs and error envelopes. */
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
