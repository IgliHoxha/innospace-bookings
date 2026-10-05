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

describe("schema migrations", () => {
  it("stamps the DB's user_version once the schema is applied", async () => {
    await db.createBooking(input()); // opens the connection, running migrations
    const Database = (await import("better-sqlite3")).default;
    const file = process.env.DATA_FILE as string;
    const raw = new Database(file, { readonly: true });
    try {
      expect(raw.pragma("user_version", { simple: true })).toBe(
        db.SCHEMA_VERSION,
      );
    } finally {
      raw.close();
    }
  });

  it("is idempotent: re-opening an already migrated file is a no-op", async () => {
    const b = await db.createBooking(input());
    // A fresh module instance against the same file re-runs migrate().
    vi.resetModules();
    const again = await import("@/lib/db");
    expect((await again.listBookings()).map((r) => r.id)).toEqual([b.id]);
  });

  it("upgrades a version 1 file in place, keeping its rows", async () => {
    // The table as version 1 shipped it, before reviewAskedAt existed.
    const Database = (await import("better-sqlite3")).default;
    const file = process.env.DATA_FILE as string;
    const old = new Database(file);
    old.exec(
      `CREATE TABLE bookings (
         id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, status TEXT NOT NULL,
         source TEXT, fullName TEXT, email TEXT, phoneNumber TEXT, plan TEXT,
         "from" TEXT, "to" TEXT, note TEXT
       );
       INSERT INTO bookings (id, createdAt, status, fullName)
         VALUES ('old-1', '2026-07-01T08:00:00.000Z', 'confirmed', 'Ada');`,
    );
    old.pragma("user_version = 1");
    old.close();

    const [row] = await db.listBookings();
    expect(row).toMatchObject({ id: "old-1", status: "confirmed" });
    expect(row.reviewAskedAt).toBeUndefined();
    expect(
      (await db.setReviewAsked("old-1", true))?.reviewAskedAt,
    ).toBeTruthy();

    const raw = new Database(file, { readonly: true });
    try {
      expect(raw.pragma("user_version", { simple: true })).toBe(
        db.SCHEMA_VERSION,
      );
    } finally {
      raw.close();
    }
  });
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

describe("setReviewAsked", () => {
  afterEach(() => vi.useRealTimers());

  it("starts unset on a new booking", async () => {
    await db.createBooking(input());
    expect((await db.listBookings())[0].reviewAskedAt).toBeUndefined();
  });

  it("stamps the time, persists it and leaves the status alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T09:30:00Z"));
    const b = await db.createBooking(input());
    await db.updateBookingStatus(b.id, "confirmed");

    const asked = await db.setReviewAsked(b.id, true);
    expect(asked?.reviewAskedAt).toBe("2026-07-02T09:30:00.000Z");
    expect(asked?.status).toBe("confirmed");
    expect((await db.listBookings())[0].reviewAskedAt).toBe(
      "2026-07-02T09:30:00.000Z",
    );
  });

  it("clears the stamp again", async () => {
    const b = await db.createBooking(input());
    await db.setReviewAsked(b.id, true);
    expect(
      (await db.setReviewAsked(b.id, false))?.reviewAskedAt,
    ).toBeUndefined();
    expect((await db.listBookings())[0].reviewAskedAt).toBeUndefined();
  });

  it("survives a later status change", async () => {
    const b = await db.createBooking(input());
    await db.setReviewAsked(b.id, true);
    expect(
      (await db.updateBookingStatus(b.id, "confirmed"))?.reviewAskedAt,
    ).toBeTruthy();
  });

  it("returns null for a missing id", async () => {
    expect(await db.setReviewAsked("ghost", true)).toBeNull();
    expect(await db.setReviewAsked("ghost", false)).toBeNull();
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
