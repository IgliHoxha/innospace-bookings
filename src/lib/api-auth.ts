// Auth guard for route handlers. Separate from auth.ts (pure crypto, no Next
// dep) since this pulls in Next types. Returns null when the session is valid, or
// a ready-made 401 to return as-is: `const denied = requireSession(req); if (denied) return denied;`
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "./auth";

/** Is this request carrying a valid dashboard session cookie? */
export function hasSession(req: NextRequest): boolean {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** 401 response when the request has no valid session, else null. */
export function requireSession(req: NextRequest): NextResponse | null {
  if (hasSession(req)) return null;
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401 },
  );
}
