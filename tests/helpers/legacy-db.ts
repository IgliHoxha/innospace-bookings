// A database file as versions 1 to 5 left one created before 2026-10-20, when "interview-room" joined the plans.
import Database from "better-sqlite3";

export interface LegacyBooking {
  id: string;
  createdAt?: string;
  status?: string;
  source?: string | null;
  fullName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  plan?: string | null;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  reviewAskedAt?: string | null;
  reviewEmailedAt?: string | null;
}

/** Write that file at DATA_FILE with `rows`, each given a guest of its own. Call it before the db module opens. */
export function version5File(rows: LegacyBooking[] = []): void {
  const old = new Database(process.env.DATA_FILE as string);
  // The table text is what SQLite itself holds for such a file, plan CHECK and all.
  old.exec(
    `CREATE TABLE guests (
       id INTEGER PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE,
       reviewAskedAt TEXT, reviewEmailedAt TEXT
     );
     CREATE TABLE bookings (
       id TEXT PRIMARY KEY,
       createdAt TEXT NOT NULL,
       status TEXT NOT NULL CHECK (status IN ('new', 'confirmed', 'cancelled', 'deleted')),
       source TEXT,
       fullName TEXT, phoneNumber TEXT,
       plan TEXT CHECK (plan IN ('daily-pass', 'weekly-pass', 'monthly-pass', 'event-room')),
       "from" TEXT, "to" TEXT,
       note TEXT
     , guestId INTEGER REFERENCES guests(id));
     CREATE INDEX idx_bookings_createdAt ON bookings(createdAt);
     CREATE INDEX idx_bookings_guestId ON bookings(guestId);
     CREATE INDEX idx_bookings_status_createdAt ON bookings(status, createdAt);`,
  );
  const addGuest = old.prepare(
    "INSERT INTO guests (email, reviewAskedAt, reviewEmailedAt) VALUES (?, ?, ?)",
  );
  const addBooking = old.prepare(
    `INSERT INTO bookings VALUES (@id, @createdAt, @status, @source, @fullName,
       @phoneNumber, @plan, @from, @to, @note, @guestId)`,
  );
  rows.forEach((row, i) => {
    const guestId = addGuest.run(
      row.email ?? null,
      row.reviewAskedAt ?? null,
      row.reviewEmailedAt ?? null,
    ).lastInsertRowid;
    addBooking.run({
      createdAt: `2026-07-01T08:0${i}:00.000Z`,
      status: "new",
      source: "website",
      fullName: null,
      phoneNumber: null,
      plan: null,
      from: null,
      to: null,
      note: null,
      ...row,
      guestId,
    });
  });
  old.pragma("user_version = 5");
  old.close();
}
