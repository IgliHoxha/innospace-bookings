import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "../helpers/app";
import type { BookingInput } from "@/lib/types";

type Db = Awaited<ReturnType<typeof loadDb>>;
let db: Db;

const input = (over: Partial<BookingInput> = {}): BookingInput => ({
  fullName: "Ada",
  email: "ada@example.com",
  plan: "daily-pass",
  from: "2026-07-01",
  ...over,
});

beforeEach(async () => {
  db = await loadDb();
});

describe("createBooking", () => {
  it("stamps a new website booking and returns it", async () => {
    const b = await db.createBooking(input());
    expect(b.id).toBeTruthy();
    expect(b.status).toBe("new");
    expect(b.source).toBe("website");
    expect(b.fullName).toBe("Ada");
    expect(await db.listBookings()).toHaveLength(1);
  });
});

describe("listBookings ordering", () => {
  afterEach(() => vi.useRealTimers());

  it("returns newest first by createdAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const first = await db.createBooking(input({ fullName: "First" }));
    vi.setSystemTime(new Date("2026-07-01T11:00:00Z"));
    const second = await db.createBooking(input({ fullName: "Second" }));

    const list = await db.listBookings();
    expect(list.map((b) => b.id)).toEqual([second.id, first.id]);
  });
});

describe("queryBookings", () => {
  it("filters, searches, paginates and tallies counts", async () => {
    const b1 = await db.createBooking(input({ fullName: "Ada" }));
    const b2 = await db.createBooking(input({ fullName: "Bob" }));
    const b3 = await db.createBooking(input({ fullName: "Cy" }));
    await db.updateBookingStatus(b2.id, "confirmed");
    await db.updateBookingStatus(b3.id, "deleted");

    const all = await db.queryBookings();
    expect(all.total).toBe(2); // "all" hides the deleted row
    expect(all.counts).toMatchObject({
      total: 2,
      new: 1,
      confirmed: 1,
      cancelled: 0,
      deleted: 1,
    });
    expect(all.bookings.map((b) => b.id)).not.toContain(b3.id);
    expect(b1.id).toBeTruthy();

    expect((await db.queryBookings({ filter: "deleted" })).total).toBe(1);
    expect((await db.queryBookings({ filter: "new" })).total).toBe(1);
    expect((await db.queryBookings({ search: "bob" })).total).toBe(1);
  });

  it("clamps page and pageSize to sane bounds", async () => {
    for (let i = 0; i < 3; i++) await db.createBooking(input());
    const page = await db.queryBookings({ page: 0, pageSize: 2 });
    expect(page.page).toBe(1); // 0 clamped up
    expect(page.pageSize).toBe(2);
    expect(page.bookings).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});

describe("createBooking with sparse input", () => {
  it("stores nulls for the fields the form left out", async () => {
    const b = await db.createBooking({ email: "only@example.com" });
    expect(b.fullName).toBeUndefined();
    expect(b.phoneNumber).toBeUndefined();
    expect(b.plan).toBeUndefined();
    expect(b.source).toBe("website");
    const round = (await db.listBookings())[0];
    expect(round.email).toBe("only@example.com");
    expect(round.note).toBeUndefined();
  });
});

describe("updateBookingStatus", () => {
  it("updates and returns the row, or null for a missing id", async () => {
    const b = await db.createBooking(input());
    const updated = await db.updateBookingStatus(b.id, "confirmed");
    expect(updated?.status).toBe("confirmed");
    expect(await db.updateBookingStatus("ghost", "confirmed")).toBeNull();
  });
});

describe("deleteBookings", () => {
  it("hard-deletes only soft-deleted rows", async () => {
    const live = await db.createBooking(input());
    expect(await db.deleteBookings([live.id])).toBe(0); // not soft-deleted yet
    expect(await db.deleteBookings([])).toBe(0); // nothing to do

    await db.updateBookingStatus(live.id, "deleted");
    expect(await db.deleteBookings([live.id])).toBe(1);
    expect((await db.queryBookings({ filter: "deleted" })).total).toBe(0);
  });
});
