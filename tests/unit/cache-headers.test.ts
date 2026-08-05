import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

// The Cache-Control table lives in next.config.mjs, so read it the way Next
// does: call headers() and resolve each path against the rules it returns.
type Rule = Awaited<ReturnType<NonNullable<typeof nextConfig.headers>>>[number];

async function rules(): Promise<Rule[]> {
  if (!nextConfig.headers)
    throw new Error("next.config.mjs defines no headers()");
  return nextConfig.headers();
}

// Approximates Next's matcher for the two source forms this config uses: a
// literal path, and a trailing `/:name*` wildcard (which matches zero segments).
function matches(source: string, path: string): boolean {
  const pattern = source
    .replace(/\./g, "\\.")
    .replace(/\/:[A-Za-z]+\*$/, "(?:/.*)?");
  return new RegExp(`^${pattern}$`).test(path);
}

/** Every Cache-Control value Next would emit for `path`. */
async function policyFor(path: string): Promise<string[]> {
  return (await rules())
    .filter((r) => matches(r.source, path))
    .flatMap((r) => r.headers.map((h) => h.value));
}

/** The single Cache-Control value for `path`, failing on none or two. */
async function onePolicy(path: string): Promise<string> {
  const values = await policyFor(path);
  expect(values).toHaveLength(1);
  return values[0];
}

const PRIVATE_PATHS = [
  "/",
  "/login",
  "/dashboard",
  "/dashboard/anything",
  "/api/bookings",
  "/api/bookings/9f1c-abc",
  "/api/login",
  // Nothing serves this today: the wildcard is what keeps a future endpoint
  // private by default rather than by remembering to add a rule.
  "/api/something-added-later",
];

describe("cache headers", () => {
  it("sets exactly one Cache-Control header per rule", async () => {
    for (const rule of await rules()) {
      expect(rule.headers).toHaveLength(1);
      expect(rule.headers[0].key).toBe("Cache-Control");
    }
  });

  it("declares each source once, so no path gets two conflicting values", async () => {
    const sources = (await rules()).map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it.each(PRIVATE_PATHS)("keeps %s out of every cache", async (path) => {
    expect(await onePolicy(path)).toBe("no-store");
  });

  it("never marks an authenticated path public", async () => {
    const assets = [
      "/logo-mark.svg",
      "/logo.svg",
      "/favicon.ico",
      "/favicon.png",
    ];
    for (const rule of await rules()) {
      if (!rule.headers[0].value.includes("public")) continue;
      expect(assets).toContain(rule.source);
    }
  });

  it("lets the edge hold the email logo for a year, since its URL is versioned", async () => {
    const value = await onePolicy("/logo-mark.svg");
    expect(value).toContain("public");
    expect(value).toContain("s-maxage=31536000");
    // email.ts bumps ?v=N when the file changes, so a stale copy is impossible.
    expect(value).toContain("immutable");
  });

  it.each(["/logo.svg", "/favicon.ico", "/favicon.png"])(
    "caches %s for a day and revalidates after, since its URL never changes",
    async (path) => {
      const value = await onePolicy(path);
      expect(value).toContain("public");
      expect(value).toContain("s-maxage=86400");
      expect(value).toContain("stale-while-revalidate=");
      expect(value).not.toContain("immutable");
    },
  );

  it("keeps browsers revalidating even where the edge caches", async () => {
    for (const rule of await rules()) {
      const value = rule.headers[0].value;
      if (!value.includes("s-maxage")) continue;
      // A visitor's own disk must never outlive the edge copy by much: the
      // longest private hold here is a day.
      const maxAge = Number(/(?:^|[ ,])max-age=(\d+)/.exec(value)?.[1]);
      expect(maxAge).toBeLessThanOrEqual(86400);
    }
  });
});
