// Helpers for the app's "YYYY-MM-DD" dates. No env or domain types, so server and client share them.

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

type YMD = { y: number; m: number; d: number };

function parseYMD(value: string | undefined): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** The last booked day: the end date, or the start of a single-day booking. */
function lastDay(from: string | undefined, to: string | undefined): YMD | null {
  return parseYMD(to) ?? parseYMD(from);
}

/** The "HH:mm" a booked value carries (the event room's), or "" for a bare date. */
function timeOf(value: string | undefined): string {
  return /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(value ?? "")?.[1] ?? "";
}

/** Compact DD/MM/YY for the dashboard table, e.g. "02/07/26". */
export function formatDMYShort(value: string | undefined): string {
  const p = parseYMD(value);
  return p ? `${pad2(p.d)}/${pad2(p.m)}/${String(p.y).slice(2)}` : "";
}

/** Compact range for the table: "30/06/26 → 02/07/26", keeping a time when sent: "12/10/26 11:00 → 14:00". */
export function formatDateRangeShort(
  from: string | undefined,
  to: string | undefined,
): string {
  const f = formatDMYShort(from);
  const t = formatDMYShort(to);
  if (!f && !t) return "-";
  const ft = timeOf(from);
  const tt = timeOf(to);
  const stamp = (date: string, time: string) =>
    time ? `${date} ${time}` : date;
  if (!f) return stamp(t, tt);
  if (!t || f === t) {
    return ft && tt && ft !== tt ? `${f} ${ft} → ${tt}` : stamp(f, ft);
  }
  return `${stamp(f, ft)} → ${stamp(t, tt)}`;
}

/** Spelled-out range for email copy: "1-3 July 2026" or "12 October 2026, 11:00-14:00". Null without a valid start. */
export function formatDateRangeLong(
  from: string | undefined,
  to: string | undefined,
): string | null {
  const f = parseYMD(from);
  if (!f) return null;
  const t = parseYMD(to);
  const ft = timeOf(from);
  const tt = timeOf(to);
  const day = (p: YMD) => `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  if (!t || (t.y === f.y && t.m === f.m && t.d === f.d)) {
    if (!ft) return day(f);
    return tt && tt !== ft ? `${day(f)}, ${ft}-${tt}` : `${day(f)}, ${ft}`;
  }
  // Times do not survive the collapsing below, so a timed range is spelled in full.
  if (ft || tt) {
    const at = (time: string) => (time ? `, ${time}` : "");
    return `${day(f)}${at(ft)} - ${day(t)}${at(tt)}`;
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
  const end = lastDay(from, to);
  if (!end) return false;
  return `${end.y}-${pad2(end.m)}-${pad2(end.d)}` < today;
}

/** Whole days from the last booked day to `today` (1 = it ended yesterday). Null for a missing or malformed date. */
export function daysSinceEnd(
  from: string | undefined,
  to: string | undefined,
  today: string,
): number | null {
  const end = lastDay(from, to);
  const now = parseYMD(today);
  if (!end || !now) return null;
  const utc = (p: YMD) => Date.UTC(p.y, p.m - 1, p.d);
  return Math.round((utc(now) - utc(end)) / 86_400_000);
}

/** `now` as the wall clock of an IANA time zone, "YYYY-MM-DDTHH:mm". */
export function zonedStamp(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")}T${at("hour")}:${at("minute")}`;
}

/** The calendar day ("YYYY-MM-DD") and hour (0-23) of `now` in an IANA time zone. */
export function zonedDay(
  now: Date,
  timeZone: string,
): { ymd: string; hour: number } {
  const stamp = zonedStamp(now, timeZone);
  return { ymd: stamp.slice(0, 10), hour: Number(stamp.slice(11, 13)) };
}

/** Compact date and time for the table, e.g. "02/07/26 14:30". Local timezone, so client-side only. */
export function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const yy = String(dt.getFullYear()).slice(2);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${yy} ${pad2(
    dt.getHours(),
  )}:${pad2(dt.getMinutes())}`;
}
