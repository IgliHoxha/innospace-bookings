// SQLite (better-sqlite3) DB on the persistent volume. One file, indexed, ACID.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { BOOKING_PLANS, BOOKING_STATUSES } from "./types";
import type {
  Booking,
  BookingInput,
  BookingPlan,
  BookingStatus,
} from "./types";

const DB_FILE =
  process.env.DATA_FILE || path.join(process.cwd(), "data", "bookings.db");

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

// Lazy singleton: open on first query, not at import time (avoids running during build).
let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS bookings ${TABLE_BODY};
CREATE INDEX IF NOT EXISTS idx_bookings_createdAt ON bookings(createdAt);`);
  _db = db;
  return db;
}

function insert(db: Database.Database, b: Booking) {
  db.prepare(
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
  const rows = getDb()
    .prepare("SELECT * FROM bookings ORDER BY createdAt DESC")
    .all() as Row[];
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

function bookingCounts(db: Database.Database): BookingCounts {
  const r = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status != 'deleted' THEN 1 ELSE 0 END) AS total,
         SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS "new",
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted
       FROM bookings`,
    )
    .get() as Record<string, number | null>;
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
    counts: bookingCounts(db),
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
  insert(getDb(), booking);
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
  const db = getDb();
  const res = db
    .prepare("UPDATE bookings SET status = ? WHERE id = ?")
    .run(status, id);
  if (res.changes === 0) return null;
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as
    Row | undefined;
  return row ? fromRow(row) : null;
}
