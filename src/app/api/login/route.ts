import { NextRequest, NextResponse } from "next/server";
import {
  checkCredentials,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  if (!username || !password || !checkCredentials(username, password)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect username or password." },
      { status: 401 },
    );
  }

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

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
