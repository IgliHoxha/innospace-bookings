// Date-string helpers for the app's "YYYY-MM-DD" dates. No env or domain types,
// so the mailer, the dashboard table and the email copy all share one module.

export const pad2 = (n: number) => String(n).padStart(2, "0");

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseYMD(value: string | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** Compact DD/MM/YY for the dashboard table, e.g. "02/07/26". */
export function formatDMYShort(value: string | undefined): string {
  const p = parseYMD(value);
  return p ? `${pad2(p.d)}/${pad2(p.m)}/${String(p.y).slice(2)}` : "";
}

/** Compact date range for the table: "30/06/26 → 02/07/26" (or a single date). */
export function formatDateRangeShort(
  from: string | undefined,
  to: string | undefined,
): string {
  const f = formatDMYShort(from);
  const t = formatDMYShort(to);
  if (!f && !t) return "-";
  if (!f) return t;
  if (!t || f === t) return f;
  return `${f} → ${t}`;
}

/**
 * Spelled-out date range for email copy, collapsing the shared parts:
 * "1-3 July 2026", "30 July - 2 August 2026", "1 July 2026" for a single day.
 * Returns null when the start date is missing or malformed.
 */
export function formatDateRangeLong(
  from: string | undefined,
  to: string | undefined,
): string | null {
  const f = parseYMD(from);
  if (!f) return null;
  const t = parseYMD(to);
  if (!t || (t.y === f.y && t.m === f.m && t.d === f.d)) {
    return `${f.d} ${MONTHS[f.m - 1]} ${f.y}`;
  }
  if (t.y === f.y && t.m === f.m)
    return `${f.d}-${t.d} ${MONTHS[f.m - 1]} ${f.y}`;
  if (t.y === f.y)
    return `${f.d} ${MONTHS[f.m - 1]} - ${t.d} ${MONTHS[t.m - 1]} ${f.y}`;
  return `${f.d} ${MONTHS[f.m - 1]} ${f.y} - ${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
}

/** Today as "YYYY-MM-DD" in the local timezone, so call it client-side only. */
export function todayYMD(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** True once the last booked day lies before `today` (a "YYYY-MM-DD" string). */
export function hasEnded(
  from: string | undefined,
  to: string | undefined,
  today: string,
): boolean {
  const end = parseYMD(to) ?? parseYMD(from);
  if (!end) return false;
  return `${end.y}-${pad2(end.m)}-${pad2(end.d)}` < today;
}

/**
 * Whole days from the last booked day to `today` (1 means it ended yesterday).
 * Null when either date is missing or malformed.
 */
export function daysSinceEnd(
  from: string | undefined,
  to: string | undefined,
  today: string,
): number | null {
  const end = parseYMD(to) ?? parseYMD(from);
  const now = parseYMD(today);
  if (!end || !now) return null;
  const utc = (p: { y: number; m: number; d: number }) =>
    Date.UTC(p.y, p.m - 1, p.d);
  return Math.round((utc(now) - utc(end)) / 86_400_000);
}

/** The calendar day ("YYYY-MM-DD") and hour (0-23) of `now` in an IANA time zone. */
export function zonedDay(
  now: Date,
  timeZone: string,
): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    ymd: `${at("year")}-${at("month")}-${at("day")}`,
    hour: Number(at("hour")),
  };
}

/**
 * Compact date + time for the table, e.g. "02/07/26 14:30".
 * Uses the local timezone, so call it client-side only (hydration-safe).
 */
export function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const yy = String(dt.getFullYear()).slice(2);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${yy} ${pad2(
    dt.getHours(),
  )}:${pad2(dt.getMinutes())}`;
}
