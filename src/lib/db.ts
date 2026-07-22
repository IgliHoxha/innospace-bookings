// SQLite (better-sqlite3) DB on the persistent volume. One file, indexed, ACID.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  BOOKING_PLANS,
  BOOKING_STATUSES,
  type Booking,
  type BookingInput,
  type BookingPlan,
  type BookingStatus,
} from "./types";
import { optionalEnv } from "./env-app";

/** Where the SQLite file lives. Read lazily so tests can point it at a temp file. */
function dbFile(): string {
  return (
    optionalEnv("DATA_FILE") ?? path.join(process.cwd(), "data", "bookings.db")
  );
}

// `from`/`to` are SQL reserved words - keep them quoted.
const COLS =
  'id,createdAt,status,source,fullName,email,phoneNumber,plan,"from","to",note';

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
  _db = db;
  _stmts = new Map();
  return db;
}

// A prepared statement compiled once per connection and reused. Pass only static
// SQL: a query whose text varies per call (dynamic WHERE / placeholder count)
// would fill the cache with one-off entries, so those keep using db.prepare.
function prep(sql: string): Database.Statement {
  const db = getDb();
  let stmt = _stmts!.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    _stmts!.set(sql, stmt);
  }
  return stmt;
}

function insert(b: Booking) {
  prep(
    `INSERT INTO bookings (${COLS}) VALUES (@id,@createdAt,@status,@source,@fullName,@email,@phoneNumber,@plan,@from,@to,@note)`,
  ).run(toRow(b));
}

function toRow(b: Booking): Row {
  return {
    id: b.id,
    createdAt: b.createdAt,
    status: b.status,
    source: b.source ?? "website",
    fullName: b.fullName ?? null,
    email: b.email ?? null,
    phoneNumber: b.phoneNumber ?? null,
    plan: b.plan ?? null,
    from: b.from ?? null,
    to: b.to ?? null,
    note: b.note ?? null,
  };
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
  };
}

export async function listBookings(): Promise<Booking[]> {
  const rows = prep(
    "SELECT * FROM bookings ORDER BY createdAt DESC",
  ).all() as Row[];
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
  filter?: "all" | BookingStatus;
  search?: string;
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

/** Paginated, filtered, searchable list for the dashboard. */
export async function queryBookings(
  q: BookingQuery = {},
): Promise<BookingPage> {
  const db = getDb();
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(q.pageSize ?? 25)));

  const where: string[] = [];
  const params: (string | number)[] = [];

  // "all" (or unset) hides soft-deleted; any explicit status filters to it.
  if (!q.filter || q.filter === "all") {
    where.push("status != 'deleted'");
  } else {
    where.push("status = ?");
    params.push(q.filter);
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

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM bookings ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT * FROM bookings ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Row[];

  return {
    bookings: rows.map(fromRow),
    total,
    page,
    pageSize,
    counts: bookingCounts(),
  };
}

export async function createBooking(input: BookingInput): Promise<Booking> {
  const booking: Booking = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "new",
    source: "website",
  };
  insert(booking);
  return booking;
}

/** Permanently remove rows - guarded to soft-deleted ones only. Returns the count removed. */
export async function deleteBookings(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const res = db
    .prepare(
      `DELETE FROM bookings WHERE status = 'deleted' AND id IN (${placeholders})`,
    )
    .run(...ids);
  return res.changes;
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
): Promise<Booking | null> {
  const res = prep("UPDATE bookings SET status = ? WHERE id = ?").run(
    status,
    id,
  );
  if (res.changes === 0) return null;
  const row = prep("SELECT * FROM bookings WHERE id = ?").get(id) as
    Row | undefined;
  return row ? fromRow(row) : null;
}
