import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp, sessionToken } from "../helpers/app";

type Route = typeof import("@/app/api/bookings/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/bookings/route");
});

afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown, headers?: Record<string, string>) =>
  route.POST(makeRequest("/api/bookings", { method: "POST", body, headers }));

const good = { fullName: "Ada", email: "ada@example.com", plan: "daily-pass" };

describe("OPTIONS /api/bookings", () => {
  it("answers the CORS preflight with 204", async () => {
    const res = await route.OPTIONS(
      makeRequest("/api/bookings", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});

describe("POST /api/bookings (public)", () => {
  it("403s a request from a disallowed origin", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://ok.com");
    const res = await post(good, { origin: "https://evil.com" });
    expect(res.status).toBe(403);
  });

  it("silently accepts but stores nothing when the honeypot is filled", async () => {
    const res = await post({ ...good, company: "i-am-a-bot" });
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
    expect((await db.queryBookings()).total).toBe(0);
  });

  it("400s when neither name nor email is provided", async () => {
    const res = await post({ plan: "daily-pass" });
    expect(res.status).toBe(400);
  });

  it("400s a present-but-unknown plan", async () => {
    const res = await post({ ...good, plan: "platinum-pass" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Unknown plan");
  });

  it("201s a valid submission and stores it", async () => {
    const res = await post(good);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect((await db.queryBookings()).total).toBe(1);
  });

  it("201s a submission with no plan (defaults it) and blank fields", async () => {
    const res = await post({ fullName: "Ada", phoneNumber: "" });
    expect(res.status).toBe(201);
    const stored = (await db.queryBookings()).bookings[0];
    expect(stored.plan).toBe("daily-pass");
    expect(stored.phoneNumber).toBeUndefined();
  });

  it("400s on a malformed JSON body", async () => {
    const res = await route.POST(
      makeRequest("/api/bookings", { method: "POST", rawBody: "{ not json" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request.");
  });

  it("403s when Turnstile is enabled but no token is sent", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const res = await post(good);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Verification failed");
  });
});

describe("GET /api/bookings (protected)", () => {
  it("401s without a session", async () => {
    expect((await route.GET(makeRequest("/api/bookings"))).status).toBe(401);
  });

  it("returns a filtered, searchable, paginated page for a session", async () => {
    await db.createBooking({ fullName: "Ada", plan: "daily-pass" });
    await db.createBooking({ fullName: "Bob", plan: "weekly-pass" });

    const res = await route.GET(
      makeRequest("/api/bookings?status=all&q=bob&page=1&pageSize=25", {
        token: sessionToken(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.total).toBe(1);
    expect(body.counts.total).toBe(2);
    expect(body.bookings[0].fullName).toBe("Bob");
  });

  it("falls back to the 'all' filter for an unknown status param", async () => {
    await db.createBooking({ fullName: "Ada" });
    const res = await route.GET(
      makeRequest("/api/bookings?status=bogus", { token: sessionToken() }),
    );
    expect((await res.json()).total).toBe(1);
  });

  it("defaults filter/page/pageSize when no query params are given", async () => {
    await db.createBooking({ fullName: "Ada" });
    const res = await route.GET(
      makeRequest("/api/bookings", { token: sessionToken() }),
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
  });
});

describe("DELETE /api/bookings (protected)", () => {
  const del = (body: unknown, tok?: string) =>
    route.DELETE(
      makeRequest("/api/bookings", { method: "DELETE", body, token: tok }),
    );

  it("401s without a session", async () => {
    expect((await del({ ids: ["x"] })).status).toBe(401);
  });

  it("400s a malformed ids payload", async () => {
    expect((await del({ ids: "x" }, sessionToken())).status).toBe(400);
  });

  it("400s on a malformed JSON body", async () => {
    const res = await route.DELETE(
      makeRequest("/api/bookings", {
        method: "DELETE",
        rawBody: "{ not json",
        token: sessionToken(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("hard-deletes only soft-deleted rows", async () => {
    const b = await db.createBooking({ fullName: "Ada" });
    await db.updateBookingStatus(b.id, "deleted");
    const res = await del({ ids: [b.id] }, sessionToken());
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(1);
  });
});
