import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { loadDb } from "../helpers/app";
import type { BookingInput } from "@/lib/types";

type Db = Awaited<ReturnType<typeof loadDb>>;
let db: Db;

beforeEach(async () => {
  db = await loadDb();
});

const input = (over: Partial<BookingInput> = {}): BookingInput => ({
  fullName: "Ada",
  email: "ada@example.com",
  plan: "daily-pass",
  from: "2026-07-01",
  ...over,
});

/** Read straight from the file, past the module under test. */
function raw<T>(read: (file: Database.Database) => T): T {
  const file = new Database(process.env.DATA_FILE as string, {
    readonly: true,
  });
  try {
    return read(file);
  } finally {
    file.close();
  }
}
const guestCount = () =>
  raw(
    (f) => f.prepare("SELECT COUNT(*) AS n FROM guests").get() as { n: number },
  ).n;
const stored = async (id: string) =>
  (await db.listBookings()).find((b) => b.id === id);

describe("schema migration 4", () => {
  type Legacy = {
    id: string;
    createdAt?: string;
    status?: string;
    fullName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    plan?: string | null;
    from?: string | null;
    to?: string | null;
    note?: string | null;
    reviewAskedAt?: string | null;
    reviewEmailedAt?: string | null;
  };

  // The table as version 3 shipped it: address and review stamps on the booking.
  const legacyFile = (rows: Legacy[]) => {
    const old = new Database(process.env.DATA_FILE as string);
    old.exec(
      `CREATE TABLE bookings (
         id TEXT PRIMARY KEY, createdAt TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('new', 'confirmed', 'cancelled', 'deleted')),
         source TEXT, fullName TEXT, email TEXT, phoneNumber TEXT,
         plan TEXT CHECK (plan IN ('daily-pass', 'weekly-pass', 'monthly-pass', 'event-room')),
         "from" TEXT, "to" TEXT, note TEXT, reviewAskedAt TEXT, reviewEmailedAt TEXT
       );
       CREATE INDEX idx_bookings_createdAt ON bookings(createdAt);`,
    );
    const insert = old.prepare(
      `INSERT INTO bookings VALUES (@id, @createdAt, @status, 'website', @fullName, @email,
         @phoneNumber, @plan, @from, @to, @note, @reviewAskedAt, @reviewEmailedAt)`,
    );
    rows.forEach((row, i) =>
      insert.run({
        createdAt: `2026-07-01T08:0${i}:00.000Z`,
        status: "confirmed",
        fullName: null,
        email: null,
        phoneNumber: null,
        plan: null,
        from: null,
        to: null,
        note: null,
        reviewAskedAt: null,
        reviewEmailedAt: null,
        ...row,
      }),
    );
    old.pragma("user_version = 3");
    old.close();
  };

  const T1 = "2026-07-02T09:00:00.000Z";
  const T2 = "2026-07-05T09:00:00.000Z";

  it("keeps every booking and everything it showed", async () => {
    legacyFile([
      {
        id: "full",
        createdAt: "2026-06-30T10:00:00.000Z",
        status: "cancelled",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phoneNumber: "+355691234567",
        plan: "event-room",
        from: "2026-07-10",
        to: "2026-07-12",
        note: "Projector",
        reviewAskedAt: T1,
        reviewEmailedAt: T1,
      },
      { id: "bare", createdAt: "2026-06-30T11:00:00.000Z", status: "new" },
    ]);

    expect(await stored("full")).toEqual({
      id: "full",
      createdAt: "2026-06-30T10:00:00.000Z",
      status: "cancelled",
      source: "website",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phoneNumber: "+355691234567",
      plan: "event-room",
      from: "2026-07-10",
      to: "2026-07-12",
      note: "Projector",
      reviewAskedAt: T1,
      reviewEmailedAt: T1,
    });
    expect(await stored("bare")).toEqual({
      id: "bare",
      createdAt: "2026-06-30T11:00:00.000Z",
      status: "new",
      source: "website",
    });
    expect((await db.queryBookings()).counts).toMatchObject({
      total: 2,
      new: 1,
      cancelled: 1,
    });
  });

  it("folds one person's bookings into one guest, whatever the casing or spacing", async () => {
    legacyFile([
      { id: "a1", email: "Ada@Example.com" },
      { id: "a2", email: "  ada@example.com " },
      { id: "a3", email: "ADA@EXAMPLE.COM" },
      { id: "g1", email: "grace@example.com" },
    ]);

    // Spelled as on the person's first booking, without the stray spaces.
    for (const id of ["a1", "a2", "a3"]) {
      expect((await stored(id))?.email).toBe("Ada@Example.com");
    }
    expect((await stored("g1"))?.email).toBe("grace@example.com");
    expect(guestCount()).toBe(2);
  });

  it("picks the first booking's spelling by request time, not by row order", async () => {
    legacyFile([
      {
        id: "later",
        createdAt: "2026-07-03T08:00:00.000Z",
        email: "ADA@x.com",
      },
      {
        id: "first",
        createdAt: "2026-07-01T08:00:00.000Z",
        email: "ada@x.com",
      },
    ]);
    expect((await stored("later"))?.email).toBe("ada@x.com");
  });

  it("gives every booking without an address a guest of its own", async () => {
    legacyFile([
      { id: "none", email: null, reviewAskedAt: T1 },
      { id: "empty", email: "" },
      { id: "blank", email: "   " },
    ]);

    for (const id of ["none", "empty", "blank"]) {
      expect((await stored(id))?.email).toBeUndefined();
    }
    expect(guestCount()).toBe(3);
    // A stamp on one of them says nothing about the others.
    expect((await stored("none"))?.reviewAskedAt).toBe(T1);
    expect((await stored("empty"))?.reviewAskedAt).toBeUndefined();
    expect((await stored("blank"))?.reviewAskedAt).toBeUndefined();
  });

  it("carries a review stamp to the guest, so each of their bookings shows it", async () => {
    legacyFile([
      { id: "asked", email: "ada@example.com", reviewAskedAt: T1 },
      { id: "other", email: "Ada@example.com" },
      { id: "grace", email: "grace@example.com" },
    ]);

    expect((await stored("asked"))?.reviewAskedAt).toBe(T1);
    expect((await stored("other"))?.reviewAskedAt).toBe(T1);
    expect((await stored("grace"))?.reviewAskedAt).toBeUndefined();
    expect((await db.listReviewCandidates()).map((b) => b.id)).toEqual([
      "grace",
    ]);
  });

  it("keeps the latest stamp when a person was asked on two bookings", async () => {
    legacyFile([
      {
        id: "emailed",
        email: "ada@example.com",
        reviewAskedAt: T1,
        reviewEmailedAt: T1,
      },
      { id: "by-hand", email: "ada@example.com", reviewAskedAt: T2 },
    ]);
    expect(await stored("emailed")).toMatchObject({
      reviewAskedAt: T2,
      reviewEmailedAt: T1,
    });
  });

  it("still never emails a guest whose marker was undone after an automatic email", async () => {
    legacyFile([
      { id: "undone", email: "ada@example.com", reviewEmailedAt: T1 },
      { id: "again", email: "ada@example.com" },
    ]);

    expect(await stored("again")).toMatchObject({ reviewEmailedAt: T1 });
    expect((await stored("again"))?.reviewAskedAt).toBeUndefined();
    expect(await db.listReviewCandidates()).toEqual([]);
    expect(await db.claimReviewEmail("again", T2)).toBe(false);
  });

  it("lists the same review candidates the old schema did", async () => {
    legacyFile([
      { id: "due", email: "due@example.com" },
      { id: "asked-here", email: "a@example.com", reviewAskedAt: T1 },
      { id: "asked-elsewhere", email: "A@example.com" },
      { id: "no-address", email: null },
      { id: "not-confirmed", email: "new@example.com", status: "new" },
      { id: "due-twice", email: " DUE@example.com" },
    ]);
    // Every never-asked confirmed booking with an address, oldest first.
    expect((await db.listReviewCandidates()).map((b) => b.id)).toEqual([
      "due",
      "due-twice",
    ]);
  });

  it("moves the columns off the booking and leaves no broken links", async () => {
    legacyFile([
      { id: "a", email: "ada@example.com", reviewAskedAt: T1 },
      { id: "b", email: null },
    ]);
    await db.listBookings(); // opens the connection, running the migration

    raw((f) => {
      const columns = (table: string) =>
        (f.pragma(`table_info(${table})`) as { name: string }[]).map(
          (c) => c.name,
        );
      expect(columns("bookings")).toEqual([
        "id",
        "createdAt",
        "status",
        "source",
        "fullName",
        "phoneNumber",
        "plan",
        "from",
        "to",
        "note",
        "guestId",
      ]);
      expect(columns("guests")).toEqual([
        "id",
        "email",
        "reviewAskedAt",
        "reviewEmailedAt",
      ]);
      expect(f.pragma("foreign_key_check")).toEqual([]);
      expect(
        f
          .prepare("SELECT COUNT(*) AS n FROM bookings WHERE guestId IS NULL")
          .get(),
      ).toEqual({ n: 0 });
      expect(f.pragma("user_version", { simple: true })).toBe(
        db.SCHEMA_VERSION,
      );
    });
  });

  it("upgrades an empty version 3 file", async () => {
    legacyFile([]);
    expect(await db.listBookings()).toEqual([]);
    expect(guestCount()).toBe(0);
    const b = await db.createBooking(input());
    expect((await stored(b.id))?.email).toBe("ada@example.com");
  });

  it("is not run a second time when the file is opened again", async () => {
    legacyFile([{ id: "a", email: "ada@example.com", reviewAskedAt: T1 }]);
    await db.listBookings();
    const again = await loadDbOnSameFile();
    expect((await again.listBookings()).map((b) => b.reviewAskedAt)).toEqual([
      T1,
    ]);
    expect(guestCount()).toBe(1);
  });
});

/** A fresh module instance (and connection) against the file already in use. */
async function loadDbOnSameFile(): Promise<Db> {
  vi.resetModules();
  return import("@/lib/db");
}

describe("guests", () => {
  it("links a second booking to the guest already known by that address", async () => {
    const first = await db.createBooking(input({ email: "Ada@Example.com" }));
    const second = await db.createBooking(
      input({ email: " ada@example.COM " }),
    );
    const other = await db.createBooking(input({ email: "grace@example.com" }));

    expect(guestCount()).toBe(2);
    // The guest keeps the spelling they first gave.
    expect(first.email).toBe("Ada@Example.com");
    expect(second.email).toBe("Ada@Example.com");
    expect(other.email).toBe("grace@example.com");
  });

  it("trims the address, and stores none for a blank one", async () => {
    const padded = await db.createBooking(
      input({ email: "  ada@example.com " }),
    );
    const blank = await db.createBooking(input({ email: "   " }));
    const none = await db.createBooking(input({ email: undefined }));

    expect(padded.email).toBe("ada@example.com");
    expect(blank.email).toBeUndefined();
    expect(none.email).toBeUndefined();
  });

  it("gives each booking without an address a guest of its own", async () => {
    const a = await db.createBooking(input({ email: undefined }));
    const b = await db.createBooking(input({ email: undefined }));
    expect(guestCount()).toBe(2);

    await db.setReviewAsked(a.id, true);
    expect((await stored(a.id))?.reviewAskedAt).toBeTruthy();
    expect((await stored(b.id))?.reviewAskedAt).toBeUndefined();
  });

  it("keeps the name and phone on the booking, as each request gave them", async () => {
    const first = await db.createBooking(
      input({ fullName: "Ada Lovelace", phoneNumber: "+355691111111" }),
    );
    const second = await db.createBooking(
      input({ fullName: "A. King", phoneNumber: "+355692222222" }),
    );

    expect(guestCount()).toBe(1);
    expect(await stored(first.id)).toMatchObject({
      fullName: "Ada Lovelace",
      phoneNumber: "+355691111111",
    });
    expect(await stored(second.id)).toMatchObject({
      fullName: "A. King",
      phoneNumber: "+355692222222",
    });
  });

  it("declares the link as a foreign key and never leaves one dangling", async () => {
    const b = await db.createBooking(input());
    await db.createBooking(input({ email: undefined }));
    await db.updateBookingStatus(b.id, "deleted");
    await db.deleteBookings([b.id]);

    raw((f) => {
      expect(f.pragma("foreign_key_list(bookings)")).toMatchObject([
        { table: "guests", from: "guestId", to: "id" },
      ]);
      expect(f.pragma("foreign_key_check")).toEqual([]);
    });
  });
});

describe("review marker across a guest's bookings", () => {
  it("shows on every booking of the guest, and clears from all of them", async () => {
    const first = await db.createBooking(input());
    const second = await db.createBooking(input({ email: "ADA@example.com" }));
    const other = await db.createBooking(input({ email: "grace@example.com" }));

    const asked = await db.setReviewAsked(second.id, true);
    expect((await stored(first.id))?.reviewAskedAt).toBe(asked?.reviewAskedAt);
    expect((await stored(second.id))?.reviewAskedAt).toBe(asked?.reviewAskedAt);
    expect((await stored(other.id))?.reviewAskedAt).toBeUndefined();

    await db.setReviewAsked(first.id, false);
    expect((await stored(first.id))?.reviewAskedAt).toBeUndefined();
    expect((await stored(second.id))?.reviewAskedAt).toBeUndefined();
  });

  it("releases a failed claim for the whole guest", async () => {
    const first = await db.createBooking(input());
    const second = await db.createBooking(input());
    await db.updateBookingStatus(first.id, "confirmed");
    await db.updateBookingStatus(second.id, "confirmed");

    expect(
      await db.claimReviewEmail(first.id, "2026-07-02T09:30:00.000Z"),
    ).toBe(true);
    await db.releaseReviewEmail(first.id);
    expect((await db.listReviewCandidates()).map((b) => b.id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});

describe("permanent delete and guests", () => {
  const purge = async (id: string) => {
    await db.updateBookingStatus(id, "deleted");
    return db.deleteBookings([id]);
  };

  it("removes a guest together with their last booking", async () => {
    const b = await db.createBooking(input());
    const other = await db.createBooking(input({ email: "grace@example.com" }));
    expect(guestCount()).toBe(2);

    expect(await purge(b.id)).toBe(1);
    expect(guestCount()).toBe(1);
    expect((await stored(other.id))?.email).toBe("grace@example.com");
  });

  it("keeps the guest, and that they were asked, while another booking remains", async () => {
    const gone = await db.createBooking(input());
    const kept = await db.createBooking(input());
    await db.setReviewAsked(gone.id, true);

    expect(await purge(gone.id)).toBe(1);
    expect(guestCount()).toBe(1);
    expect((await stored(kept.id))?.reviewAskedAt).toBeTruthy();
  });

  it("starts a returning address afresh once all its bookings are gone", async () => {
    const old = await db.createBooking(input({ email: "Ada@Example.com" }));
    await db.setReviewAsked(old.id, true);
    await purge(old.id);

    const back = await db.createBooking(input({ email: "ada@example.com" }));
    expect(back.email).toBe("ada@example.com");
    expect(back.reviewAskedAt).toBeUndefined();
  });

  it("leaves every guest alone when nothing was removed", async () => {
    const live = await db.createBooking(input());
    expect(await db.deleteBookings([live.id, "ghost"])).toBe(0);
    expect(guestCount()).toBe(1);
    expect((await stored(live.id))?.email).toBe("ada@example.com");
  });
});
