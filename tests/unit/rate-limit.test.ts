import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter keeps a module-level Map, so re-import it fresh per test to reset
// state. Fake timers drive Date.now() for lockout-expiry / escalation logic.
type RateLimit = typeof import("@/lib/rate-limit");
let rl: RateLimit;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  rl = await import("@/lib/rate-limit");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Fail `n` times for a key, returning the last status. */
function failN(key: string, n: number) {
  let status = rl.checkBlocked(key);
  for (let i = 0; i < n; i++) status = rl.registerFailure(key);
  return status;
}

describe("checkBlocked", () => {
  it("reports a fresh key as unblocked with the full attempt budget", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "5");
    const s = rl.checkBlocked("1.1.1.1");
    expect(s).toEqual({
      blocked: false,
      banned: false,
      retryAfterSeconds: 0,
      remainingAttempts: 5,
    });
  });
});

describe("registerFailure", () => {
  it("counts down remaining attempts before the threshold", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    expect(rl.registerFailure("ip").remainingAttempts).toBe(2);
    expect(rl.registerFailure("ip").remainingAttempts).toBe(1);
  });

  it("locks out once failures reach the threshold", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    const s = failN("ip", 3);
    expect(s.blocked).toBe(true);
    expect(s.banned).toBe(false);
    expect(s.retryAfterSeconds).toBe(60);
  });

  it("does not increment further while already locked out", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    failN("ip", 3);
    vi.advanceTimersByTime(10_000); // 10s into the lockout
    const s = rl.registerFailure("ip");
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSeconds).toBe(50); // just the remaining time
  });

  it("escalates the lockout duration linearly per lockout", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    expect(failN("ip", 2).retryAfterSeconds).toBe(60); // 1st lockout: 60s
    vi.advanceTimersByTime(61_000);
    expect(failN("ip", 2).retryAfterSeconds).toBe(120); // 2nd lockout: 120s
    vi.advanceTimersByTime(121_000);
    expect(failN("ip", 2).retryAfterSeconds).toBe(180); // 3rd lockout: 180s
  });

  it("bans the IP once lockouts exceed the max", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "1");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "2");

    // 2 lockouts are allowed; the 3rd trips the ban.
    expect(failN("ip", 2).banned).toBe(false); // lockout 1
    vi.advanceTimersByTime(2_000);
    expect(failN("ip", 2).banned).toBe(false); // lockout 2
    vi.advanceTimersByTime(3_000);
    const s = failN("ip", 2); // lockout 3 -> ban
    expect(s.banned).toBe(true);
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSeconds).toBe(0);
  });

  it("keeps a ban in force even far in the future", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "1");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "1");
    failN("ip", 1); // lockout 1
    vi.advanceTimersByTime(2_000);
    expect(failN("ip", 1).banned).toBe(true); // lockout 2 -> ban
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000); // a year later
    expect(rl.checkBlocked("ip").banned).toBe(true);
  });

  it("defaults to 5 attempts / 60s / 10 lockouts when env is unset or invalid", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "not-a-number");
    const s = failN("ip", 5);
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSeconds).toBe(60);
  });
});

describe("registerSuccess", () => {
  it("clears the failure history so the budget is restored", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    rl.registerFailure("ip");
    rl.registerFailure("ip");
    rl.registerSuccess("ip");
    expect(rl.checkBlocked("ip").remainingAttempts).toBe(3);
  });
});

describe("clientKey", () => {
  it("prefers cf-connecting-ip, then fly-client-ip, then x-forwarded-for", () => {
    expect(
      rl.clientKey(
        new Headers({
          "cf-connecting-ip": "1.1.1.1",
          "fly-client-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3",
        }),
      ),
    ).toBe("1.1.1.1");
    expect(rl.clientKey(new Headers({ "fly-client-ip": "2.2.2.2" }))).toBe(
      "2.2.2.2",
    );
  });

  it("takes the first hop of a multi-value x-forwarded-for", () => {
    expect(
      rl.clientKey(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })),
    ).toBe("9.9.9.9");
  });

  it("falls back to 'unknown' when no IP header is present", () => {
    expect(rl.clientKey(new Headers())).toBe("unknown");
  });
});
