import { NextRequest, NextResponse } from "next/server";
import {
  checkCredentials,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";
import {
  checkBlocked,
  clientKey,
  registerFailure,
  registerSuccess,
} from "@/lib/rate-limit";
import { requireSession } from "@/lib/api-auth";
import { requireAllowedOrigin } from "@/lib/cors";

export const runtime = "nodejs";

// Human-friendly "in 2 minutes" / "in 45 seconds" for the lockout message.
function formatWait(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.ceil(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function bannedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Access blocked due to repeated failed logins. Contact the administrator.",
    },
    { status: 403 },
  );
}

function lockedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      ok: false,
      error: `Too many failed attempts. Try again in ${formatWait(retryAfterSeconds)}.`,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const key = clientKey(req.headers);

  // Reject early if this IP is already banned or locked out, before touching creds.
  const gate = checkBlocked(key);
  if (gate.banned) return bannedResponse();
  if (gate.blocked) return lockedResponse(gate.retryAfterSeconds);

  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  if (!username || !password || !checkCredentials(username, password)) {
    const status = registerFailure(key);
    if (status.banned) return bannedResponse();
    if (status.blocked) return lockedResponse(status.retryAfterSeconds);
    return NextResponse.json(
      { ok: false, error: "Incorrect username or password." },
      { status: 401 },
    );
  }

  registerSuccess(key); // clear the failure/lockout history on success

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS, // matches the token's signed expiry
  });
  return res;
}

// Logout. Require a valid session so a forged cross-site DELETE can't clear the
// cookie: with sameSite=lax the session cookie isn't sent cross-site on a DELETE,
// so requireSession rejects it. A real (same-site) logout carries the cookie.
export async function DELETE(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const denied = requireSession(req);
  if (denied) return denied;

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
