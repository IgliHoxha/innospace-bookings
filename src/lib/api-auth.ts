// Session guard for route handlers. Apart from auth.ts (pure crypto) because this needs Next types.
import type { NextRequest, NextResponse } from "next/server";
import { jsonError } from "./api-response";
import { verifySessionToken, SESSION_COOKIE } from "./auth";

/** Is this request carrying a valid dashboard session cookie? */
function hasSession(req: NextRequest): boolean {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** 401 response when the request has no valid session, else null. */
export function requireSession(req: NextRequest): NextResponse | null {
  return hasSession(req) ? null : jsonError("Unauthorized", 401);
}
