// The dashboard's own calls (src/app/dashboard/api.ts), run through the real handlers and a real database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, params, resetApp, sessionToken } from "../helpers/app";
import { SESSION_COOKIE } from "@/lib/auth";
import { INITIAL_VIEW, type ListView } from "@/lib/list-view";

vi.mock("@/lib/email", () => ({
  sendCustomerStatusEmail: vi.fn().mockResolvedValue(true),
}));

type Bookings = typeof import("@/app/api/bookings/route");
type ById = typeof import("@/app/api/bookings/[id]/route");
type Login = typeof import("@/app/api/login/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
type Api = typeof import("@/app/dashboard/api");
let bookings: Bookings;
let byId: ById;
let login: Login;
let db: Db;
let email: Email;
let api: Api;
let token: string | undefined;
let requested: string[];

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  email = await import("@/lib/email");
  bookings = await import("@/app/api/bookings/route");
  byId = await import("@/app/api/bookings/[id]/route");
  login = await import("@/app/api/login/route");
  api = await import("@/app/dashboard/api");
  token = sessionToken();
  requested = [];
  // The browser's fetch: each call goes to the handler serving its path, with the session cookie.
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    requested.push(`${method} ${url}`);
    const req = makeRequest(url, {
      method,
      rawBody: typeof init.body === "string" ? init.body : undefined,
      token,
    });
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/login") return login.DELETE(req);
    if (path === "/api/bookings") {
      return method === "DELETE" ? bookings.DELETE(req) : bookings.GET(req);
    }
    return byId.PATCH(req, params({ id: path.split("/").pop() ?? "" }));
  });
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** `count` bookings an hour apart, "Guest 01" the oldest; every third confirmed. */
async function seed(count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 1, i)));
    const { id } = await db.createBooking({
      fullName: `Guest ${String(i).padStart(2, "0")}`,
      email: `guest${i}@example.com`,
      plan: i % 2 ? "daily-pass" : "weekly-pass",
    });
    if (i % 3 === 0) await db.updateBookingStatus(id, "confirmed");
  }
}

const view = (change: Partial<ListView> = {}): ListView => ({
  ...INITIAL_VIEW,
  ...change,
});
const names = (page: { bookings: { fullName?: string }[] } | null) =>
  page?.bookings.map((b) => b.fullName);

describe("fetchBookings against GET /api/bookings", () => {
  it("opens on the newest 25 of every booking", async () => {
    await seed(30);
    const page = await api.fetchBookings(view());
    expect(page?.total).toBe(30);
    expect(page?.page).toBe(1);
    expect(page?.pageSize).toBe(25);
    expect(page?.bookings).toHaveLength(25);
    expect(names(page)?.[0]).toBe("Guest 30");
    expect(page?.counts).toEqual({
      total: 30,
      new: 20,
      confirmed: 10,
      cancelled: 0,
      deleted: 0,
    });
  });

  it("returns the page the view is on", async () => {
    await seed(30);
    const page = await api.fetchBookings(view({ page: 2 }));
    expect(page?.page).toBe(2);
    expect(names(page)).toEqual([
      "Guest 05",
      "Guest 04",
      "Guest 03",
      "Guest 02",
      "Guest 01",
    ]);
  });

  it("narrows to the view's filter", async () => {
    await seed(9);
    const page = await api.fetchBookings(view({ filter: "confirmed" }));
    expect(page?.total).toBe(3);
    expect(names(page)).toEqual(["Guest 09", "Guest 06", "Guest 03"]);
  });

  it("narrows to the view's search, spaces and all", async () => {
    await seed(12);
    const page = await api.fetchBookings(view({ search: "guest 1" }));
    expect(names(page)).toEqual(["Guest 12", "Guest 11", "Guest 10"]);
    expect(page?.total).toBe(3);
  });

  it("orders by the view's sort and direction", async () => {
    await seed(4);
    const sort = { key: "guest", dir: "asc" } as const;
    expect(names(await api.fetchBookings(view({ sort })))).toEqual([
      "Guest 01",
      "Guest 02",
      "Guest 03",
      "Guest 04",
    ]);
  });

  it("combines filter, search, sort and page in one request", async () => {
    await seed(30);
    const page = await api.fetchBookings(
      view({
        filter: "new",
        search: "weekly",
        sort: { key: "guest", dir: "asc" },
      }),
    );
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatch(/^GET \/api\/bookings\?/);
    // Even numbers that are not multiples of three: 2, 4, 8, 10, 14, ...
    expect(page?.total).toBe(10);
    expect(names(page)?.slice(0, 3)).toEqual([
      "Guest 02",
      "Guest 04",
      "Guest 08",
    ]);
  });

  it("answers an empty first page for a view nothing matches", async () => {
    await seed(3);
    const page = await api.fetchBookings(view({ search: "nobody" }));
    expect(page?.bookings).toEqual([]);
    expect(page?.total).toBe(0);
  });

  it("gives null, not a page, once the session is gone", async () => {
    await seed(3);
    token = undefined;
    expect(await api.fetchBookings(view())).toBeNull();
  });
});

const one = () =>
  db.createBooking({
    fullName: "Ada",
    email: "ada@example.com",
    plan: "daily-pass",
  });
const emails = () => vi.mocked(email.sendCustomerStatusEmail).mock.calls;

describe("updateStatus against PATCH /api/bookings/[id]", () => {
  it("confirms the booking and sends the email body as edited", async () => {
    const { id } = await one();
    const res = await api.updateStatus(id, "confirmed", "Edited body");
    expect(res.status).toBe(200);
    expect(requested).toEqual([`PATCH /api/bookings/${id}`]);
    expect((await db.getBooking(id))?.status).toBe("confirmed");
    expect(emails()).toHaveLength(1);
    expect(emails()[0].slice(1)).toEqual(["confirmed", "Edited body"]);
  });

  it("cancels with the template when no body is passed", async () => {
    const { id } = await one();
    expect((await api.updateStatus(id, "cancelled")).status).toBe(200);
    expect((await db.getBooking(id))?.status).toBe("cancelled");
    expect(emails()[0].slice(1)).toEqual(["cancelled", undefined]);
  });

  it("soft-deletes without emailing anyone", async () => {
    const { id } = await one();
    expect((await api.updateStatus(id, "deleted", "")).status).toBe(200);
    expect((await db.getBooking(id))?.status).toBe("deleted");
    expect(emails()).toHaveLength(0);
  });

  it("is turned down, and changes nothing, once the session is gone", async () => {
    const { id } = await one();
    token = undefined;
    expect((await api.updateStatus(id, "confirmed")).status).toBe(401);
    expect((await db.getBooking(id))?.status).toBe("new");
    expect(emails()).toHaveLength(0);
  });

  it("answers 404 for a booking that no longer exists", async () => {
    expect((await api.updateStatus("gone", "confirmed")).status).toBe(404);
  });
});

describe("markReviewAsked against PATCH /api/bookings/[id]", () => {
  it("stamps the guest as asked, then clears it on undo", async () => {
    const { id } = await one();
    vi.setSystemTime(new Date("2026-10-12T08:30:00Z"));

    expect((await api.markReviewAsked(id, true)).status).toBe(200);
    expect((await db.getBooking(id))?.reviewAskedAt).toBe(
      "2026-10-12T08:30:00.000Z",
    );

    expect((await api.markReviewAsked(id, false)).status).toBe(200);
    expect((await db.getBooking(id))?.reviewAskedAt).toBeUndefined();
  });

  it("neither changes the status nor sends an email", async () => {
    const { id } = await one();
    await api.markReviewAsked(id, true);
    expect((await db.getBooking(id))?.status).toBe("new");
    expect(emails()).toHaveLength(0);
  });

  it("is turned down once the session is gone", async () => {
    const { id } = await one();
    token = undefined;
    expect((await api.markReviewAsked(id, true)).status).toBe(401);
    expect((await db.getBooking(id))?.reviewAskedAt).toBeUndefined();
  });
});

describe("purgeBookings against DELETE /api/bookings", () => {
  it("removes the soft-deleted bookings it names and leaves the rest", async () => {
    const [gone, kept] = [await one(), await one()];
    await db.updateBookingStatus(gone.id, "deleted");

    const res = await api.purgeBookings([gone.id, kept.id]);
    expect(await res.json()).toEqual({ ok: true, removed: 1 });
    expect(requested).toEqual(["DELETE /api/bookings"]);
    expect(await db.getBooking(gone.id)).toBeNull();
    expect((await db.getBooking(kept.id))?.status).toBe("new");
  });

  it("is turned down, and removes nothing, once the session is gone", async () => {
    const { id } = await one();
    await db.updateBookingStatus(id, "deleted");
    token = undefined;
    expect((await api.purgeBookings([id])).status).toBe(401);
    expect(await db.getBooking(id)).not.toBeNull();
  });
});

describe("logout against DELETE /api/login", () => {
  it("clears the session cookie", async () => {
    const res = (await api.logout()) as Awaited<ReturnType<Login["DELETE"]>>;
    expect(res.status).toBe(200);
    expect(requested).toEqual(["DELETE /api/login"]);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("is turned down without a session", async () => {
    token = undefined;
    expect((await api.logout()).status).toBe(401);
  });
});
