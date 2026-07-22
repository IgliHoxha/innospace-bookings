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
