import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { ADMIN_PASS, ADMIN_USER } from "../helpers/fixtures";

// resetApp() re-imports the route (and with it a fresh in-memory limiter Map),
// so every test starts with a clean slate.
type Route = typeof import("@/app/api/login/route");
let route: Route;

beforeEach(async () => {
  resetApp();
  vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
  vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
  route = await import("@/app/api/login/route");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (body: unknown, ip = "1.1.1.1") =>
  route.POST(
    makeRequest("/api/login", {
      method: "POST",
      body,
      headers: { "x-forwarded-for": ip },
    }),
  );

const wrong = (ip?: string) =>
  post({ username: ADMIN_USER, password: "nope" }, ip);
const right = (ip?: string) =>
  post({ username: ADMIN_USER, password: ADMIN_PASS }, ip);

describe("POST /api/login brute-force throttling", () => {
  it("locks out with 429 + Retry-After after the attempt threshold", async () => {
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(401);
    const res = await wrong(); // 3rd failure trips the lockout
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).error).toMatch(/too many failed attempts/i);
  });

  it("blocks even a correct password while locked out", async () => {
    await wrong();
    await wrong();
    await wrong(); // locked now
    const res = await right();
    expect(res.status).toBe(429);
  });

  it("tracks each client IP independently", async () => {
    await wrong("2.2.2.2");
    await wrong("2.2.2.2");
    await wrong("2.2.2.2"); // 2.2.2.2 is locked

    // A different IP still has its full budget.
    expect((await wrong("3.3.3.3")).status).toBe(401);
    expect((await right("3.3.3.3")).status).toBe(200);
  });

  it("resets the failure counter after a successful login", async () => {
    await wrong();
    await wrong(); // 2 failures, not yet locked
    expect((await right()).status).toBe(200); // success clears history

    // Budget is restored: two more failures still don't lock out.
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(401);
  });
});
