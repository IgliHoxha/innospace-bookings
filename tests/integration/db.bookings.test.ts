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

describe("schema migration 3", () => {
  it("upgrades a version 2 file in place, keeping its rows and review stamps", async () => {
    // The table as version 2 shipped it, before reviewEmailedAt existed.
    const Database = (await import("better-sqlite3")).default;
    const file = process.env.DATA_FILE as string;
    const old = new Database(file);
    old.exec(
      `CREATE TABLE bookings (
         id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, status TEXT NOT NULL,
         source TEXT, fullName TEXT, email TEXT, phoneNumber TEXT, plan TEXT,
         "from" TEXT, "to" TEXT, note TEXT, reviewAskedAt TEXT
       );
       INSERT INTO bookings (id, createdAt, status, fullName, reviewAskedAt)
         VALUES ('old-2', '2026-07-01T08:00:00.000Z', 'confirmed', 'Ada',
                 '2026-07-02T09:00:00.000Z');`,
    );
    old.pragma("user_version = 2");
    old.close();

    const [row] = await db.listBookings();
    expect(row).toMatchObject({
      id: "old-2",
      reviewAskedAt: "2026-07-02T09:00:00.000Z",
    });
    expect(row.reviewEmailedAt).toBeUndefined();

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

describe("list ordering", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  // Each booking is requested an hour after the one before it.
  let hour = 0;
  const book = (over: Partial<BookingInput>) => {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 1, hour++)));
    return db.createBooking(input(over));
  };
  const names = (list: { fullName?: string }[]) => list.map((b) => b.fullName);

  it("puts the latest booked day first, whatever order the requests came in", async () => {
    await book({ fullName: "Mid", from: "2026-08-01" });
    await book({ fullName: "Late", from: "2026-09-01" });
    await book({ fullName: "Early", from: "2026-07-01" });

    const expected = ["Late", "Mid", "Early"];
    expect(names(await db.listBookings())).toEqual(expected);
    expect(names((await db.queryBookings()).bookings)).toEqual(expected);
  });

  it("orders across a year boundary by the date, not the day or month", async () => {
    await book({ fullName: "January", from: "2027-01-02" });
    await book({ fullName: "December", from: "2026-12-31" });

    expect(names((await db.queryBookings()).bookings)).toEqual([
      "January",
      "December",
    ]);
  });

  it("orders a multi-day booking by its first day", async () => {
    await book({ fullName: "Long", from: "2026-07-01", to: "2026-07-30" });
    await book({ fullName: "Short", from: "2026-07-15" });

    expect(names((await db.queryBookings()).bookings)).toEqual([
      "Short",
      "Long",
    ]);
  });

  it("puts the newest request first among bookings for the same day", async () => {
    await book({ fullName: "First" });
    await book({ fullName: "Second" });

    const expected = ["Second", "First"];
    expect(names(await db.listBookings())).toEqual(expected);
    expect(names((await db.queryBookings()).bookings)).toEqual(expected);
  });

  it("puts bookings with no date last, newest request first among them", async () => {
    await book({ fullName: "Undated old", from: undefined });
    await book({ fullName: "Undated new", from: undefined });
    await book({ fullName: "Dated", from: "2026-07-01" });

    const expected = ["Dated", "Undated new", "Undated old"];
    expect(names(await db.listBookings())).toEqual(expected);
    expect(names((await db.queryBookings()).bookings)).toEqual(expected);
  });

  it("keeps the order on every status filter", async () => {
    for (const status of [
      "new",
      "confirmed",
      "cancelled",
      "deleted",
    ] as const) {
      const made = [
        await book({ fullName: `${status} mid`, from: "2026-08-01" }),
        await book({ fullName: `${status} late`, from: "2026-09-01" }),
        await book({ fullName: `${status} early`, from: "2026-07-01" }),
      ];
      for (const b of made) await db.updateBookingStatus(b.id, status);
    }

    for (const status of [
      "new",
      "confirmed",
      "cancelled",
      "deleted",
    ] as const) {
      const page = await db.queryBookings({ filter: status });
      expect(names(page.bookings)).toEqual([
        `${status} late`,
        `${status} mid`,
        `${status} early`,
      ]);
    }

    // "all" mixes the statuses by date; the newest request leads within a day.
    expect(names((await db.queryBookings({ filter: "all" })).bookings)).toEqual(
      [
        "cancelled late",
        "confirmed late",
        "new late",
        "cancelled mid",
        "confirmed mid",
        "new mid",
        "cancelled early",
        "confirmed early",
        "new early",
      ],
    );
  });

  it("keeps the order under a search", async () => {
    await book({ fullName: "Ada One", from: "2026-07-01" });
    await book({
      fullName: "Bob",
      email: "bob@example.com",
      from: "2026-10-01",
    });
    await book({ fullName: "Ada Two", from: "2026-09-01" });

    expect(names((await db.queryBookings({ search: "ada" })).bookings)).toEqual(
      ["Ada Two", "Ada One"],
    );
  });

  it("carries the order across pages", async () => {
    await book({ fullName: "Mid", from: "2026-08-01" });
    await book({ fullName: "Undated", from: undefined });
    await book({ fullName: "Late", from: "2026-09-01" });
    await book({ fullName: "Early", from: "2026-07-01" });

    const page = (n: number) => db.queryBookings({ page: n, pageSize: 2 });
    expect(names((await page(1)).bookings)).toEqual(["Late", "Mid"]);
    expect(names((await page(2)).bookings)).toEqual(["Early", "Undated"]);
  });

  describe("by column", () => {
    type Query = NonNullable<Parameters<Db["queryBookings"]>[0]>;
    const sorted = async (q: Query) =>
      names((await db.queryBookings(q)).bookings);

    // Mixed case on purpose: a byte-order sort would put "bea" after "Cy".
    const seed = async () => {
      const bea = await book({
        fullName: "bea",
        plan: "weekly-pass",
        from: "2026-08-01",
        note: "Zebra",
      });
      const ada = await book({
        fullName: "Ada",
        plan: "event-room",
        from: "2026-09-01",
        note: "apple",
      });
      await book({
        fullName: "Cy",
        plan: "daily-pass",
        from: "2026-07-01",
        note: "Mango",
      });
      await db.updateBookingStatus(bea.id, "confirmed");
      await db.updateBookingStatus(ada.id, "cancelled");
    };

    it.each([
      ["createdAt", ["bea", "Ada", "Cy"]],
      ["guest", ["Ada", "bea", "Cy"]],
      ["plan", ["Cy", "Ada", "bea"]],
      ["dates", ["Cy", "bea", "Ada"]],
      ["note", ["Ada", "Cy", "bea"]],
      ["status", ["Ada", "bea", "Cy"]],
    ] as const)("sorts by %s in both directions", async (sort, ascending) => {
      await seed();
      expect(await sorted({ sort, dir: "asc" })).toEqual(ascending);
      expect(await sorted({ sort, dir: "desc" })).toEqual(
        [...ascending].reverse(),
      );
    });

    it("sorts descending when only the column is given", async () => {
      await seed();
      expect(await sorted({ sort: "guest" })).toEqual(["Cy", "bea", "Ada"]);
    });

    it.each(["guest", "plan", "dates", "note"] as const)(
      "keeps a booking with no %s at the bottom in both directions",
      async (sort) => {
        await seed();
        vi.setSystemTime(new Date(Date.UTC(2026, 5, 2)));
        await db.createBooking({ email: "blank@example.com" });

        for (const dir of ["asc", "desc"] as const) {
          const list = await sorted({ sort, dir });
          expect(list).toHaveLength(4);
          expect(list.at(-1)).toBeUndefined();
        }
      },
    );

    it("keeps the default order among rows the column cannot separate", async () => {
      await book({ fullName: "Mid", from: "2026-08-01" });
      await book({ fullName: "Late old", from: "2026-09-01" });
      await book({ fullName: "Late new", from: "2026-09-01" });
      await book({ fullName: "Early", from: "2026-07-01" });

      // One plan and one status throughout, so either direction leaves the ties.
      const expected = ["Late new", "Late old", "Mid", "Early"];
      for (const sort of ["plan", "status"] as const) {
        expect(await sorted({ sort, dir: "asc" })).toEqual(expected);
        expect(await sorted({ sort, dir: "desc" })).toEqual(expected);
      }
    });

    it("falls back to the default order for a column it does not know", async () => {
      await seed();
      for (const sort of [
        "email",
        "constructor",
        "createdAt; DROP TABLE bookings",
      ]) {
        expect(
          await sorted({ sort: sort as Query["sort"], dir: "asc" }),
        ).toEqual(["Ada", "bea", "Cy"]);
      }
      expect(await db.listBookings()).toHaveLength(3);
    });

    it("treats an unknown direction as descending", async () => {
      await seed();
      expect(
        await sorted({ sort: "guest", dir: "ASC; --" as Query["dir"] }),
      ).toEqual(["Cy", "bea", "Ada"]);
    });

    it("sorts within a filter and a search, across pages", async () => {
      await seed();
      await book({ fullName: "Dee", email: "dee@other.test" });
      await book({ fullName: "abe" });

      // "example.com" leaves Dee out; "new" leaves bea and Ada out.
      expect(
        await sorted({ sort: "guest", dir: "asc", search: "example.com" }),
      ).toEqual(["abe", "Ada", "bea", "Cy"]);
      expect(
        await sorted({ sort: "guest", dir: "asc", filter: "new" }),
      ).toEqual(["abe", "Cy", "Dee"]);

      const page = (n: number) =>
        sorted({ sort: "guest", dir: "asc", page: n, pageSize: 2 });
      expect(await page(1)).toEqual(["abe", "Ada"]);
      expect(await page(2)).toEqual(["bea", "Cy"]);
      expect(await page(3)).toEqual(["Dee"]);
    });
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

  it("totals a tab the same with and without a search that matches it all", async () => {
    const made = [];
    for (const status of [
      "new",
      "confirmed",
      "cancelled",
      "deleted",
    ] as const) {
      for (
        let i = 0;
        i <= ["new", "confirmed", "cancelled", "deleted"].indexOf(status);
        i++
      ) {
        const b = await db.createBooking(input({ note: "shared note" }));
        await db.updateBookingStatus(b.id, status);
        made.push(b);
      }
    }

    // 1 new, 2 confirmed, 3 cancelled, 4 deleted: "all" leaves the deleted out.
    const expected = { all: 6, new: 1, confirmed: 2, cancelled: 3, deleted: 4 };
    for (const [filter, total] of Object.entries(expected)) {
      const f = filter as keyof typeof expected;
      expect((await db.queryBookings({ filter: f })).total).toBe(total);
      expect(
        (await db.queryBookings({ filter: f, search: "shared note" })).total,
      ).toBe(total);
      expect(
        (await db.queryBookings({ filter: f, search: "no such thing" })).total,
      ).toBe(0);
    }
    expect(made).toHaveLength(10);
  });

  it("finds a booking by its guest's email address", async () => {
    await db.createBooking(
      input({ fullName: "Ada", email: "ada@example.com" }),
    );
    const grace = await db.createBooking(
      input({ fullName: "Grace", email: "Hopper@Navy.example" }),
    );
    await db.createBooking(input({ fullName: "Nobody", email: undefined }));

    const found = await db.queryBookings({ search: "hopper@navy" });
    expect(found.total).toBe(1);
    expect(found.bookings.map((b) => b.id)).toEqual([grace.id]);
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

describe("review email queue", () => {
  const AT = "2026-07-02T09:30:00.000Z";

  const confirmed = async (over: Partial<BookingInput> = {}) => {
    const b = await db.createBooking(input(over));
    await db.updateBookingStatus(b.id, "confirmed");
    return b;
  };
  const candidateIds = async () =>
    (await db.listReviewCandidates()).map((b) => b.id);
  const stored = async (id: string) =>
    (await db.listBookings()).find((b) => b.id === id);

  it("lists confirmed bookings that have an email address, oldest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T08:00:00Z"));
    const first = await confirmed({ email: "ada@example.com" });
    vi.setSystemTime(new Date("2026-07-01T09:00:00Z"));
    const second = await confirmed({ email: "grace@example.com" });
    await db.createBooking(input({ email: "new@example.com" }));
    const cancelled = await db.createBooking(input({ email: "c@example.com" }));
    await db.updateBookingStatus(cancelled.id, "cancelled");
    await confirmed({ email: undefined });
    await confirmed({ email: "   " });
    vi.useRealTimers();

    expect(await candidateIds()).toEqual([first.id, second.id]);
  });

  it("leaves out a guest already asked by hand", async () => {
    const b = await confirmed();
    await db.setReviewAsked(b.id, true);
    expect(await candidateIds()).toEqual([]);
  });

  it("leaves out every booking of a guest asked on another one, whatever the casing", async () => {
    const asked = await confirmed({ email: "Ada@Example.com" });
    await confirmed({ email: " ada@example.com " });
    const other = await confirmed({ email: "grace@example.com" });
    await db.setReviewAsked(asked.id, true);
    expect(await candidateIds()).toEqual([other.id]);
  });

  it("claims a booking by stamping both review fields with the given time", async () => {
    const b = await confirmed();
    expect(await db.claimReviewEmail(b.id, AT)).toBe(true);
    expect(await stored(b.id)).toMatchObject({
      reviewAskedAt: AT,
      reviewEmailedAt: AT,
      status: "confirmed",
    });
    expect(await candidateIds()).toEqual([]);
  });

  it("refuses a second claim, so overlapping runs cannot both send", async () => {
    const b = await confirmed();
    expect(await db.claimReviewEmail(b.id, AT)).toBe(true);
    expect(await db.claimReviewEmail(b.id, "2026-07-03T09:30:00.000Z")).toBe(
      false,
    );
    expect((await stored(b.id))?.reviewEmailedAt).toBe(AT);
  });

  it("refuses a second booking by the same person once the first is claimed", async () => {
    const first = await confirmed({ email: "ada@example.com" });
    const second = await confirmed({ email: "ADA@example.com" });
    expect(await db.claimReviewEmail(first.id, AT)).toBe(true);
    expect(
      await db.claimReviewEmail(second.id, "2026-07-03T09:30:00.000Z"),
    ).toBe(false);
    // One guest, one stamp: the second booking shows the first one's claim.
    expect((await stored(second.id))?.reviewEmailedAt).toBe(AT);
  });

  it("refuses a booking that is not confirmed, already asked or unknown", async () => {
    const fresh = await db.createBooking(input());
    expect(await db.claimReviewEmail(fresh.id, AT)).toBe(false);

    const asked = await confirmed({ email: "grace@example.com" });
    await db.setReviewAsked(asked.id, true);
    expect(await db.claimReviewEmail(asked.id, AT)).toBe(false);
    expect((await stored(asked.id))?.reviewEmailedAt).toBeUndefined();

    expect(await db.claimReviewEmail("ghost", AT)).toBe(false);
  });

  it("releases a claim, putting the booking back in the queue", async () => {
    const b = await confirmed();
    await db.claimReviewEmail(b.id, AT);
    await db.releaseReviewEmail(b.id);
    const row = await stored(b.id);
    expect(row?.reviewAskedAt).toBeUndefined();
    expect(row?.reviewEmailedAt).toBeUndefined();
    expect(await candidateIds()).toEqual([b.id]);
  });

  it("keeps the email stamp when the marker is undone, so nobody is mailed twice", async () => {
    const b = await confirmed();
    await db.claimReviewEmail(b.id, AT);
    const undone = await db.setReviewAsked(b.id, false);
    expect(undone?.reviewAskedAt).toBeUndefined();
    expect(undone?.reviewEmailedAt).toBe(AT);
    expect(await candidateIds()).toEqual([]);
    expect(await db.claimReviewEmail(b.id, AT)).toBe(false);
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
