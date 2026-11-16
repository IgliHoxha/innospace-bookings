import type { NextResponse } from "next/server";
import { jsonError } from "./api-response";
import { optionalEnv } from "./env-app";

/** ALLOWED_ORIGINS parsed; defaults to "*" (allow any) when unset (optional flag). */
function allowedOrigins(): string[] {
  return (optionalEnv("ALLOWED_ORIGINS") ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this origin on ALLOWED_ORIGINS? "*" allows all; a missing origin cannot be checked, so it passes. */
export function isOriginAllowed(origin: string | null): boolean {
  const allowed = allowedOrigins();
  if (allowed.includes("*")) return true;
  if (!origin) return true;
  return allowed.includes(origin);
}

/** The Origin header, falling back to the Referer's origin. */
export function requestOrigin(headers: Headers): string | null {
  const origin = headers.get("origin");
  if (origin) return origin;
  const referer = headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* malformed Referer */
    }
  }
  return null;
}

/** Is the Origin our own host? The dashboard calling its own API must pass without being listed in ALLOWED_ORIGINS. */
function isSameOrigin(origin: string, headers: Headers): boolean {
  const host = headers.get("host");
  if (!host) return false;
  try {
    // Host-only compare: the scheme ends at Cloudflare/Fly, so the forwarded one is unreliable.
    return new URL(origin).host === host;
  } catch {
    return false; // malformed Origin
  }
}

/** The origin gate: same-origin and missing origins pass, anything else must be on ALLOWED_ORIGINS. */
export function isRequestOriginAllowed(headers: Headers): boolean {
  const origin = requestOrigin(headers);
  if (!origin) return true;
  if (isSameOrigin(origin, headers)) return true;
  return isOriginAllowed(origin);
}

/** Origin guard for mutating handlers (CSRF defence beside the sameSite cookie): a 403, or null when allowed. */
export function requireAllowedOrigin(headers: Headers): NextResponse | null {
  return isRequestOriginAllowed(headers) ? null : jsonError("Forbidden", 403);
}

/** Resolve the CORS headers for a given request origin against ALLOWED_ORIGINS. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();

  const allowAll = allowed.includes("*");
  const allowOrigin =
    allowAll || (origin && allowed.includes(origin)) ? origin || "*" : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}
