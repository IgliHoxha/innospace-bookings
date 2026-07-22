// Cookie auth: valid login mints an HMAC-signed token, verified on each request.
import { createHmac, timingSafeEqual } from "crypto";
import { requireEnv } from "./env-app";

export const SESSION_COOKIE = "innospace_session";
const PAYLOAD = "authenticated";

// Sessions expire after this long. The signed token carries its own expiry, so
// a leaked cookie stops working after TTL even if its max-age is tampered with.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  return requireEnv("AUTH_SECRET");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Mint a token of the form `<expiryMs>.<hmac>`, signed over the expiry. */
export function createSessionToken(ttlSeconds = SESSION_TTL_SECONDS): string {
  const exp = Date.now() + ttlSeconds * 1000;
  return `${exp}.${sign(`${PAYLOAD}:${exp}`)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expPart = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expPart);
  if (!Number.isInteger(exp)) return false;

  // Constant-time signature check, then expiry - order doesn't leak validity.
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(`${PAYLOAD}:${expPart}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  return exp > Date.now();
}

function safeEqual(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Verify dashboard credentials against the env-configured username/password.
export function checkCredentials(username: string, password: string): boolean {
  if (!username || !password) return false;
  const expectedUser = requireEnv("DASHBOARD_USERNAME");
  const expectedPass = requireEnv("DASHBOARD_PASSWORD");
  // Evaluate both (no short-circuit) so timing doesn't reveal which failed.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  return userOk && passOk;
}
