// SQLite (better-sqlite3) DB on the persistent volume. One file, indexed, ACID.
// Two tables: `guests` holds what is true of a person (their email address and
// whether they were asked for a review), `bookings` holds each request and
// points at its guest.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  BOOKING_PLANS,
  BOOKING_STATUSES,
  type Booking,
  type BookingFilter,
  type BookingInput,
  type BookingPlan,
  type BookingStatus,
} from "./types";
import { optionalEnv } from "./env-app";
import { BOOKING_SORTS, type BookingSort, type SortDir } from "./sort";

/** Where the SQLite file lives. Read lazily so tests can point it at a temp file. */
function dbFile(): string {
  return (
    optionalEnv("DATA_FILE") ?? path.join(process.cwd(), "data", "bookings.db")
  );
}

const inList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const TABLE_BODY = `(
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${inList(BOOKING_STATUSES)})),
  source TEXT,
  fullName TEXT, email TEXT, phoneNumber TEXT,
  plan TEXT CHECK (plan IN (${inList(BOOKING_PLANS)})),
  "from" TEXT, "to" TEXT,
  note TEXT
)`;

type Row = Record<string, string | number | null>;

// Ordered schema migrations keyed by target `PRAGMA user_version`: each runs once,
// in a transaction, on any DB below its version, then bumps it. To change the
// schema, append a new { version: N+1, up } entry - never edit a shipped one.
type Migration = { version: number; up: (db: Database.Database) => void };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS bookings ${TABLE_BODY};`);
      // Serves the list's ORDER BY createdAt DESC: reverse-scanned, so LIMIT
      // stops early without a sort.
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_bookings_createdAt ON bookings(createdAt);`,
      );
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`ALTER TABLE bookings ADD COLUMN reviewAskedAt TEXT;`);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`ALTER TABLE bookings ADD COLUMN reviewEmailedAt TEXT;`);
    },
  },
  {
    // Moves the email address and the review stamps off the booking and onto one
    // `guests` row per person, which every booking by that person points at.
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE guests (
          id INTEGER PRIMARY KEY,
          -- One guest per address, whatever its casing. NULL, any number of
          -- times, for a booking that left none.
          email TEXT UNIQUE COLLATE NOCASE,
          reviewAskedAt TEXT,
          reviewEmailedAt TEXT
        );
        ALTER TABLE bookings ADD COLUMN guestId INTEGER REFERENCES guests(id);
        CREATE INDEX idx_bookings_guestId ON bookings(guestId);

        -- One guest per address, spelled as on that person's first booking
        -- (the bare column follows MIN's row).
        INSERT INTO guests (email)
          SELECT TRIM(email) FROM (
            SELECT email, MIN(createdAt) FROM bookings
            WHERE TRIM(IFNULL(email, '')) <> ''
            GROUP BY LOWER(TRIM(email))
          );
        UPDATE bookings
          SET guestId = (SELECT id FROM guests WHERE guests.email = TRIM(bookings.email))
          WHERE TRIM(IFNULL(email, '')) <> '';
      `);

      // No address means nothing to match on, so each such booking gets its own guest.
      const addGuest = db.prepare("INSERT INTO guests (email) VALUES (NULL)");
      const link = db.prepare("UPDATE bookings SET guestId = ? WHERE id = ?");
      const unlinked = db
        .prepare("SELECT id FROM bookings WHERE guestId IS NULL")
        .all() as { id: string }[];
      for (const { id } of unlinked)
        link.run(addGuest.run().lastInsertRowid, id);

      db.exec(`
        -- A guest was asked if any of their bookings was; keep the latest stamp.
        UPDATE guests SET
          reviewAskedAt = (SELECT MAX(reviewAskedAt) FROM bookings WHERE guestId = guests.id),
          reviewEmailedAt = (SELECT MAX(reviewEmailedAt) FROM bookings WHERE guestId = guests.id);

        ALTER TABLE bookings DROP COLUMN email;
        ALTER TABLE bookings DROP COLUMN reviewAskedAt;
        ALTER TABLE bookings DROP COLUMN reviewEmailedAt;
      `);
    },
  },
  {
    version: 5,
    up: (db) => {
      // Serves a status tab's newest-first page, the view the dashboard opens
      // on. The createdAt index alone has to walk every booking whenever the
      // tab holds less than a page, which is the usual state of "new".
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_bookings_status_createdAt ON bookings(status, createdAt);`,
      );
    },
  },
];

/** The schema version this build expects: the highest migration defined. */
export const SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

/** Apply any migrations newer than the DB's current `user_version`. */
function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // DDL + the version bump in one transaction: a failed migration rolls back
    // wholesale, so we never leave the DB half-migrated.
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

// Lazy singleton: opened on the first query, not at import (never runs at build).
// _stmts caches prepared statements for this connection (see prep); both reset
// together, so the cache can never outlive the connection it was compiled against.
let _db: Database.Database | null = null;
let _stmts: Map<string, Database.Statement> | null = null;
function getDb(): Database.Database {
  if (_db) return _db;
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  // Off by default in SQLite. Switched on only after migrating, since a
  // migration that rebuilds a table needs it off.
  db.pragma("foreign_keys = ON");
  _db = db;
  _stmts = new Map();
  return db;
}

// A prepared statement compiled once per connection and reused. Pass only SQL
// drawn from a fixed set of texts: one that grows with its input (a placeholder
// per id) would fill the cache with one-off entries, so that keeps using db.prepare.
function prep(sql: string): Database.Statement {
  const db = getDb();
  let stmt = _stmts!.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    _stmts!.set(sql, stmt);
  }
  return stmt;
}

function fromRow(r: Row): Booking {
  const s = (v: string | number | null) => (v == null ? undefined : String(v));
  return {
    id: String(r.id),
    createdAt: String(r.createdAt),
    status: String(r.status) as BookingStatus,
    source: s(r.source),
    fullName: s(r.fullName),
    email: s(r.email),
    phoneNumber: s(r.phoneNumber),
    plan: s(r.plan) as BookingPlan | undefined,
    from: s(r.from),
    to: s(r.to),
    note: s(r.note),
    reviewAskedAt: s(r.reviewAskedAt),
    reviewEmailedAt: s(r.reviewEmailedAt),
  };
}

// A booking as the app reads it: the row plus its guest's address and review
// stamps. `from`/`to` are SQL reserved words - keep them quoted.
const BOOKING_ROWS = `SELECT b.id, b.createdAt, b.status, b.source, b.fullName,
    g.email, b.phoneNumber, b.plan, b."from", b."to", b.note,
    g.reviewAskedAt, g.reviewEmailedAt
  FROM bookings b LEFT JOIN guests g ON g.id = b.guestId`;

function findBooking(id: string): Booking | null {
  const row = prep(`${BOOKING_ROWS} WHERE b.id = ?`).get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

// The guest of a booking, for statements that write to that guest.
const GUEST_OF = "(SELECT guestId FROM bookings WHERE id = @id)";

/** The guest behind an address, added on first sight. No address: a guest of their own. */
function guestIdFor(email: string | null): number | bigint {
  if (email) {
    const known = prep("SELECT id FROM guests WHERE email = ?").get(email) as
      { id: number } | undefined;
    if (known) return known.id;
  }
  return prep("INSERT INTO guests (email) VALUES (?)").run(email)
    .lastInsertRowid;
}

// The default order, and the tie-break under any column sort: the newest
// request on top.
const NEWEST_FIRST = "createdAt DESC";

// What each sortable column orders by. Only these fixed strings reach the SQL
// text: a sort key picks one and is never interpolated itself.
const SORT_SQL: Record<BookingSort, string> = {
  createdAt: "createdAt",
  guest: "fullName COLLATE NOCASE",
  plan: "plan",
  dates: `"from"`,
  note: "note COLLATE NOCASE",
  status: "status",
};

/** A column sort: blanks sink in either direction, and ties keep the default order. */
function orderBy(sort?: BookingSort, dir?: SortDir): string {
  if (!sort || !BOOKING_SORTS.includes(sort)) return `ORDER BY ${NEWEST_FIRST}`;
  const way = dir === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${SORT_SQL[sort]} ${way} NULLS LAST, ${NEWEST_FIRST}`;
}

export async function listBookings(): Promise<Booking[]> {
  const rows = prep(`${BOOKING_ROWS} ${orderBy()}`).all() as Row[];
  return rows.map(fromRow);
}

export interface BookingCounts {
  total: number;
  new: number;
  confirmed: number;
  cancelled: number;
  deleted: number;
}

export interface BookingPage {
  bookings: Booking[];
  total: number; // rows matching the current filter + search
  page: number; // 1-based
  pageSize: number;
  counts: BookingCounts; // global tallies for the stat boxes
}

export interface BookingQuery {
  filter?: BookingFilter;
  search?: string;
  sort?: BookingSort; // unset: newest request first
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

const SEARCH_COLS = ["fullName", "email", "phoneNumber", "plan", "note"];

function bookingCounts(): BookingCounts {
  const r = prep(
    `SELECT
         SUM(CASE WHEN status != 'deleted' THEN 1 ELSE 0 END) AS total,
         SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS "new",
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted
       FROM bookings`,
  ).get() as Record<string, number | null>;
  return {
    total: Number(r.total ?? 0),
    new: Number(r.new ?? 0),
    confirmed: Number(r.confirmed ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    deleted: Number(r.deleted ?? 0),
  };
}

/** Paginated, filtered, searchable, sortable list for the dashboard. */
export async function queryBookings(
  q: BookingQuery = {},
): Promise<BookingPage> {
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(q.pageSize ?? 25)));
  const filter = q.filter ?? "all";
  const counts = bookingCounts();

  const where: string[] = [];
  const params: (string | number)[] = [];

  // "all" (or unset) hides soft-deleted; any explicit status filters to it.
  if (filter === "all") {
    where.push("status != 'deleted'");
  } else {
    where.push("status = ?");
    params.push(filter);
  }

  const search = (q.search ?? "").trim().toLowerCase();
  if (search) {
    const like = `%${search}%`;
    where.push(
      "(" +
        SEARCH_COLS.map((c) => `LOWER(IFNULL(${c}, '')) LIKE ?`).join(" OR ") +
        ")",
    );
    SEARCH_COLS.forEach(() => params.push(like));
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  // Without a search the tab's tally is the answer, so only a search counts.
  const total = search
    ? (
        prep(
          `SELECT COUNT(*) AS n FROM bookings b LEFT JOIN guests g ON g.id = b.guestId ${whereSql}`,
        ).get(...params) as { n: number }
      ).n
    : filter === "all"
      ? counts.total
      : counts[filter];

  // Cached like the rest: filter, search and sort only ever combine into a few
  // dozen distinct texts.
  const rows = prep(
    `${BOOKING_ROWS} ${whereSql} ${orderBy(q.sort, q.dir)} LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, (page - 1) * pageSize) as Row[];

  return { bookings: rows.map(fromRow), total, page, pageSize, counts };
}

export async function createBooking(input: BookingInput): Promise<Booking> {
  const id = randomUUID();
  // The guest and the booking land together or not at all.
  getDb().transaction(() => {
    prep(
      `INSERT INTO bookings (id, createdAt, status, source, guestId, fullName, phoneNumber, plan, "from", "to", note)
       VALUES (@id, @createdAt, 'new', 'website', @guestId, @fullName, @phoneNumber, @plan, @from, @to, @note)`,
    ).run({
      id,
      createdAt: new Date().toISOString(),
      guestId: guestIdFor(input.email?.trim() || null),
      fullName: input.fullName ?? null,
      phoneNumber: input.phoneNumber ?? null,
      plan: input.plan ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      note: input.note ?? null,
    });
  })();
  return findBooking(id) as Booking;
}

/** Permanently remove rows - guarded to soft-deleted ones only. Returns the count removed. */
export async function deleteBookings(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  return db.transaction(() => {
    const removed = db
      .prepare(
        `DELETE FROM bookings WHERE status = 'deleted' AND id IN (${placeholders})`,
      )
      .run(...ids).changes;
    // A guest's address and review history leave with their last booking.
    if (removed > 0) {
      prep(
        `DELETE FROM guests WHERE NOT EXISTS
           (SELECT 1 FROM bookings WHERE bookings.guestId = guests.id)`,
      ).run();
    }
    return removed;
  })();
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
): Promise<Booking | null> {
  const res = prep("UPDATE bookings SET status = ? WHERE id = ?").run(
    status,
    id,
  );
  return res.changes === 0 ? null : findBooking(id);
}

// One person is asked once, however often they book: the stamps sit on the guest.
const NEVER_ASKED = "reviewAskedAt IS NULL AND reviewEmailedAt IS NULL";

/** Confirmed bookings with an email address whose guest has never been asked for a review. */
export async function listReviewCandidates(): Promise<Booking[]> {
  const rows = prep(
    `${BOOKING_ROWS}
     WHERE b.status = 'confirmed' AND g.email IS NOT NULL
       AND g.reviewAskedAt IS NULL AND g.reviewEmailedAt IS NULL
     ORDER BY b.createdAt`,
  ).all() as Row[];
  return rows.map(fromRow);
}

/**
 * Reserve a booking's guest for the automatic review email by stamping them
 * first, so two overlapping runs or two bookings by one person can never both
 * send. False when the booking is not confirmed or its guest was already asked.
 */
export async function claimReviewEmail(
  id: string,
  at: string,
): Promise<boolean> {
  const res = prep(
    `UPDATE guests SET reviewEmailedAt = @at, reviewAskedAt = @at
     WHERE ${NEVER_ASKED}
       AND id = (SELECT guestId FROM bookings WHERE id = @id AND status = 'confirmed')`,
  ).run({ id, at });
  return res.changes === 1;
}

/** Undo a claim whose email could not be sent, so the next run tries again. */
export async function releaseReviewEmail(id: string): Promise<void> {
  prep(
    `UPDATE guests SET reviewEmailedAt = NULL, reviewAskedAt = NULL WHERE id = ${GUEST_OF}`,
  ).run({ id });
}

/**
 * Stamp (or clear) when a booking's guest was asked for a review, which shows on
 * every booking of theirs. Null for a missing id.
 */
export async function setReviewAsked(
  id: string,
  asked: boolean,
): Promise<Booking | null> {
  const res = prep(
    `UPDATE guests SET reviewAskedAt = @at WHERE id = ${GUEST_OF}`,
  ).run({ id, at: asked ? new Date().toISOString() : null });
  return res.changes === 0 ? null : findBooking(id);
}
