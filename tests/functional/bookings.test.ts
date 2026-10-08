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

  it("lists the latest booked day first on every status filter and page", async () => {
    // Requested in an order that matches neither the dates nor their reverse.
    const made = [
      await db.createBooking({ fullName: "Mid", from: "2026-08-01" }),
      await db.createBooking({ fullName: "Undated" }),
      await db.createBooking({ fullName: "Late", from: "2026-09-01" }),
      await db.createBooking({ fullName: "Early", from: "2026-07-01" }),
    ];
    const names = async (qs: string) => {
      const res = await route.GET(
        makeRequest(`/api/bookings?${qs}`, { token: sessionToken() }),
      );
      const body = (await res.json()) as { bookings: { fullName: string }[] };
      return body.bookings.map((b) => b.fullName);
    };
    const expected = ["Late", "Mid", "Early", "Undated"];

    expect(await names("status=all")).toEqual(expected);
    expect(await names("status=all&page=2&pageSize=2")).toEqual(
      expected.slice(2),
    );
    expect(await names("status=new")).toEqual(expected);
    for (const status of ["confirmed", "cancelled", "deleted"] as const) {
      for (const b of made) await db.updateBookingStatus(b.id, status);
      expect(await names(`status=${status}`)).toEqual(expected);
    }
  });

  describe("sort and dir params", () => {
    const names = async (qs: string) => {
      const res = await route.GET(
        makeRequest(`/api/bookings?${qs}`, { token: sessionToken() }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { bookings: { fullName: string }[] };
      return body.bookings.map((b) => b.fullName);
    };

    // Mixed case on purpose: a byte-order sort would put "bea" after "Cy".
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const rows = [
        { fullName: "bea", plan: "weekly-pass", from: "2026-08-01", note: "Z" },
        { fullName: "Ada", plan: "event-room", from: "2026-09-01", note: "a" },
        { fullName: "Cy", plan: "daily-pass", from: "2026-07-01", note: "M" },
      ] as const;
      const ids: string[] = [];
      for (const [hour, row] of rows.entries()) {
        vi.setSystemTime(new Date(Date.UTC(2026, 5, 1, hour)));
        ids.push((await db.createBooking(row)).id);
      }
      await db.updateBookingStatus(ids[0], "confirmed");
      await db.updateBookingStatus(ids[1], "cancelled");
    });
    afterEach(() => vi.useRealTimers());

    it.each([
      ["createdAt", ["bea", "Ada", "Cy"]],
      ["guest", ["Ada", "bea", "Cy"]],
      ["plan", ["Cy", "Ada", "bea"]],
      ["dates", ["Cy", "bea", "Ada"]],
      ["note", ["Ada", "Cy", "bea"]],
      ["status", ["Ada", "bea", "Cy"]],
    ] as const)("sorts by %s in both directions", async (sort, ascending) => {
      expect(await names(`sort=${sort}&dir=asc`)).toEqual(ascending);
      expect(await names(`sort=${sort}&dir=desc`)).toEqual(
        [...ascending].reverse(),
      );
    });

    it("sorts inside a status filter, a search and a page", async () => {
      expect(await names("status=new&sort=guest&dir=asc")).toEqual(["Cy"]);
      expect(await names("q=a&sort=guest&dir=desc&page=2&pageSize=1")).toEqual([
        "bea",
      ]);
    });

    it("ignores an unknown column or direction instead of failing", async () => {
      const byDate = ["Ada", "bea", "Cy"];
      expect(await names("sort=email&dir=asc")).toEqual(byDate);
      expect(await names("sort=constructor")).toEqual(byDate);
      expect(
        await names(
          `sort=${encodeURIComponent("createdAt; DROP TABLE bookings")}`,
        ),
      ).toEqual(byDate);
      expect(await names("sort=guest&dir=sideways")).toEqual([
        "Cy",
        "bea",
        "Ada",
      ]);
      expect((await db.queryBookings()).total).toBe(3);
    });

    it("401s without a session, whatever the sort", async () => {
      const res = await route.GET(makeRequest("/api/bookings?sort=guest"));
      expect(res.status).toBe(401);
    });
  });

  it("searches by the guest's email address and reports the matching total", async () => {
    await db.createBooking({ fullName: "Ada", email: "ada@example.com" });
    await db.createBooking({ fullName: "Grace", email: "Hopper@Navy.example" });
    await db.createBooking({ fullName: "Nobody" });

    const res = await route.GET(
      makeRequest("/api/bookings?status=all&q=HOPPER%40navy", {
        token: sessionToken(),
      }),
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.counts.total).toBe(3);
    expect(body.bookings.map((b: { email: string }) => b.email)).toEqual([
      "Hopper@Navy.example",
    ]);
  });

  it("totals each tab from its tally when there is no search", async () => {
    const made = [
      await db.createBooking({ fullName: "Ada" }),
      await db.createBooking({ fullName: "Bob" }),
      await db.createBooking({ fullName: "Cy" }),
    ];
    await db.updateBookingStatus(made[1].id, "confirmed");
    await db.updateBookingStatus(made[2].id, "deleted");

    for (const [status, total] of [
      ["all", 2],
      ["new", 1],
      ["confirmed", 1],
      ["cancelled", 0],
      ["deleted", 1],
    ] as const) {
      const res = await route.GET(
        makeRequest(`/api/bookings?status=${status}`, {
          token: sessionToken(),
        }),
      );
      const body = await res.json();
      expect(body.total).toBe(total);
      expect(body.bookings).toHaveLength(total);
    }
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

  it("forgets a guest with their last booking, so a return visit starts clean", async () => {
    const old = await db.createBooking({ email: "ada@example.com" });
    await db.setReviewAsked(old.id, true);
    await db.updateBookingStatus(old.id, "deleted");
    expect(
      (await (await del({ ids: [old.id] }, sessionToken())).json()).removed,
    ).toBe(1);

    const res = await post({ fullName: "Ada", email: "ada@example.com" });
    expect(res.status).toBe(201);
    const [back] = (await db.queryBookings()).bookings;
    expect(back.email).toBe("ada@example.com");
    expect(back.reviewAskedAt).toBeUndefined();
  });
});
