// In-memory brute-force guard for the dashboard login. The app runs as a single
// long-lived Node process (one Fly machine), so a module-level Map is sufficient
// (no external store needed). State resets on redeploy/restart, which is fine for
// login throttling. Keyed by client IP.

import { requireIntEnv } from "./env-app";

type Attempt = {
  fails: number; // consecutive failures in the current window
  lockouts: number; // how many times this IP has been locked out (escalation)
  blockedUntil: number; // epoch ms; 0 when not blocked
  banned: boolean; // permanently blocked (too many lockouts)
  seen: number; // epoch ms of last activity (for pruning)
};

const attempts = new Map<string, Attempt>();

// Forget idle records after this long so the Map can't grow unbounded.
const IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour

function posIntEnv(name: string): number {
  const n = requireIntEnv(name);
  if (n <= 0) throw new Error(`${name} must be a positive integer.`);
  return n;
}

/** Failures allowed before a lockout kicks in. */
function maxAttempts(): number {
  return posIntEnv("LOGIN_MAX_ATTEMPTS");
}

/** Base lockout duration, in seconds. Escalates linearly per lockout. */
function blockBaseSeconds(): number {
  return posIntEnv("LOGIN_BLOCK_SECONDS");
}

/** Lockouts an IP may accrue before it is banned outright. */
function maxLockouts(): number {
  return posIntEnv("LOGIN_MAX_LOCKOUTS");
}

function prune(now: number) {
  for (const [key, a] of attempts) {
    if (now - a.seen > IDLE_TTL_MS && a.blockedUntil <= now) {
      attempts.delete(key);
    }
  }
}

export type RateStatus = {
  blocked: boolean;
  banned: boolean; // permanent block (won't clear on its own)
  retryAfterSeconds: number;
  remainingAttempts: number;
};

/** Is this client currently locked out or banned? Read-only (no counters change). */
export function checkBlocked(key: string): RateStatus {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.banned) {
    return {
      blocked: true,
      banned: true,
      retryAfterSeconds: 0,
      remainingAttempts: 0,
    };
  }
  if (a && a.blockedUntil > now) {
    return {
      blocked: true,
      banned: false,
      retryAfterSeconds: Math.ceil((a.blockedUntil - now) / 1000),
      remainingAttempts: 0,
    };
  }
  return {
    blocked: false,
    banned: false,
    retryAfterSeconds: 0,
    remainingAttempts: a ? Math.max(0, maxAttempts() - a.fails) : maxAttempts(),
  };
}

/**
 * Record a failed login. When failures reach the configured threshold the IP is
 * locked out; each successive lockout lasts longer (base × lockout count), so a
 * persistent attacker faces exponentially diminishing return.
 */
export function registerFailure(key: string): RateStatus {
  const now = Date.now();
  prune(now);
  const a: Attempt = attempts.get(key) ?? {
    fails: 0,
    lockouts: 0,
    blockedUntil: 0,
    banned: false,
    seen: now,
  };
  a.seen = now;

  // Already banned: nothing more to escalate.
  if (a.banned) {
    attempts.set(key, a);
    return {
      blocked: true,
      banned: true,
      retryAfterSeconds: 0,
      remainingAttempts: 0,
    };
  }

  // Already serving a lockout: extend nothing, just report the remaining time.
  if (a.blockedUntil > now) {
    attempts.set(key, a);
    return {
      blocked: true,
      banned: false,
      retryAfterSeconds: Math.ceil((a.blockedUntil - now) / 1000),
      remainingAttempts: 0,
    };
  }

  a.fails += 1;
  if (a.fails >= maxAttempts()) {
    a.lockouts += 1;
    a.fails = 0; // reset the window; the lockout is the penalty now

    // Too many lockouts: ban this IP outright (until process restart / reset).
    if (a.lockouts > maxLockouts()) {
      a.banned = true;
      a.blockedUntil = Number.MAX_SAFE_INTEGER;
      attempts.set(key, a);
      return {
        blocked: true,
        banned: true,
        retryAfterSeconds: 0,
        remainingAttempts: 0,
      };
    }

    const seconds = blockBaseSeconds() * a.lockouts; // 60s, 120s, 180s, …
    a.blockedUntil = now + seconds * 1000;
    attempts.set(key, a);
    return {
      blocked: true,
      banned: false,
      retryAfterSeconds: seconds,
      remainingAttempts: 0,
    };
  }

  attempts.set(key, a);
  return {
    blocked: false,
    banned: false,
    retryAfterSeconds: 0,
    remainingAttempts: maxAttempts() - a.fails,
  };
}

/** Successful login: clear the client's failure/lockout history. */
export function registerSuccess(key: string): void {
  attempts.delete(key);
}

/**
 * Best-effort client IP. Behind Cloudflare → Fly, the real IP is in
 * `cf-connecting-ip` / `fly-client-ip`; fall back to the first `x-forwarded-for`
 * hop. Returns a stable string so unknown clients still share one bucket.
 */
export function clientKey(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("fly-client-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
