// Pure email-template helpers shared by the mailer and the dashboard preview,
// so the preview matches what's actually sent.
import type { Booking, BookingPlan, BookingStatus } from "./types";

export type EmailStatus = Extract<BookingStatus, "confirmed" | "cancelled">;

// Display label + billing period for each plan slug.
const PLAN_META: Record<BookingPlan, { label: string; period: string }> = {
  "daily-pass": { label: "Day Pass", period: "day" },
  "weekly-pass": { label: "Weekly Pass", period: "week" },
  "monthly-pass": { label: "Monthly Pass", period: "month" },
  "event-room": { label: "Event Room", period: "booking" },
};

export type Pricing = {
  currency: string;
  plans: Partial<Record<BookingPlan, string>>;
  // Event Room is billed by the hour (3h min) or by the day.
  eventRoom?: { hour?: string; day?: string };
};

// Server-only: PRICE_* aren't exposed to the browser.
export function getPricingFromEnv(): Pricing {
  return {
    currency: process.env.PRICE_CURRENCY || "€",
    plans: {
      "daily-pass": process.env.PRICE_DAILY_PASS,
      "weekly-pass": process.env.PRICE_WEEKLY_PASS,
      "monthly-pass": process.env.PRICE_MONTHLY_PASS,
    },
    eventRoom: {
      hour: process.env.PRICE_EVENT_ROOM_HOUR,
      day: process.env.PRICE_EVENT_ROOM_DAY,
    },
  };
}

// Real contact/access details live in env, not in this (public) source. Any
// field left unset is simply omitted from the email footer.
export type ContactInfo = {
  name?: string; // who signs off the confirmation
  org?: string;
  address?: string;
  accessApt1?: string;
  accessApt2?: string;
  mapsUrl?: string;
  phone?: string;
  email?: string;
  nid?: string;
};

// Server-only: BUSINESS_* / EMAIL_SIGNOFF_NAME aren't exposed to the browser.
export function getContactFromEnv(): ContactInfo {
  return {
    name: process.env.EMAIL_SIGNOFF_NAME,
    org: process.env.BUSINESS_NAME,
    address: process.env.BUSINESS_ADDRESS,
    accessApt1: process.env.BUSINESS_ACCESS_APT1,
    accessApt2: process.env.BUSINESS_ACCESS_APT2,
    mapsUrl: process.env.BUSINESS_MAPS_URL,
    phone: process.env.BUSINESS_PHONE,
    email: process.env.BUSINESS_EMAIL,
    nid: process.env.BUSINESS_NID,
  };
}

// Sign-off + contact/access block for the confirmation email. Built from env, so
// only the details actually configured appear.
function signOff(contact?: ContactInfo): string[] {
  const c = contact ?? {};
  const lines: string[] = [];
  if (c.name) lines.push(c.name);
  lines.push("", c.org || "InnoSpace Tirana");
  if (c.address) lines.push(c.address);
  const access = [c.accessApt1, c.accessApt2].filter(Boolean) as string[];
  if (access.length) {
    lines.push("", "⚠️ Important access instructions:");
    for (const a of access) lines.push("", a);
  }
  if (c.mapsUrl) lines.push("", `View on Google Maps: ${c.mapsUrl}`);
  const rows: string[] = [];
  if (c.phone) rows.push(`Phone: ${c.phone}`);
  if (c.email) rows.push(`Email: ${c.email}`);
  if (c.nid) rows.push(`NID: ${c.nid}`);
  if (rows.length) lines.push("", ...rows);
  return lines;
}

export function priceLineFor(
  booking: Booking,
  pricing?: Pricing,
): string | null {
  if (!pricing || !booking.plan) return null;
  const cur = pricing.currency || "€";

  if (booking.plan === "event-room") {
    const { hour, day } = pricing.eventRoom ?? {};
    const parts: string[] = [];
    if (hour) parts.push(`${hour}${cur} per hour (minimum 3 hours)`);
    if (day) parts.push(`${day}${cur} per day`);
    return parts.length
      ? `The Event Room rate is ${parts.join(" or ")}.`
      : null;
  }

  const meta = PLAN_META[booking.plan];
  const amount = pricing.plans[booking.plan];
  if (!meta || !amount) return null;
  return `The ${meta.label} rate is ${amount}${cur} per ${meta.period}.`;
}

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

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Compact DD/MM/YY for the dashboard table, e.g. "02/07/26". */
export function formatDMYShort(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "";
}

/** Compact date range for the table: "30/06/26 → 02/07/26" (or a single date). */
export function formatDateRangeShort(
  from: string | undefined,
  to: string | undefined,
): string {
  const f = formatDMYShort(from);
  const t = formatDMYShort(to);
  if (!f && !t) return "—";
  if (!f) return t;
  if (!t || f === t) return f;
  return `${f} → ${t}`;
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

function titleCase(s: string): string {
  return s
    .replace(/[-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function bookingTypeLabel(booking: Booking): string {
  if (!booking.plan) return "Booking";
  return PLAN_META[booking.plan]?.label ?? titleCase(booking.plan);
}

function parseYMD(v: string | undefined) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? { y: m[1], m: parseInt(m[2], 10), d: parseInt(m[3], 10) } : null;
}

export function datesText(booking: Booking): string {
  const f = parseYMD(booking.from);
  const t = parseYMD(booking.to);
  if (!f) return "your requested dates";
  if (t && (t.y !== f.y || t.m !== f.m || t.d !== f.d)) {
    if (t.y === f.y && t.m === f.m)
      return `${f.d}–${t.d} ${MONTHS[f.m - 1]} ${f.y}`;
    if (t.y === f.y)
      return `${f.d} ${MONTHS[f.m - 1]} – ${t.d} ${MONTHS[t.m - 1]} ${f.y}`;
    return `${f.d} ${MONTHS[f.m - 1]} ${f.y} – ${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
  }
  return `${f.d} ${MONTHS[f.m - 1]} ${f.y}`;
}

export function emailSubject(status: EmailStatus, booking?: Booking): string {
  if (status === "cancelled") return "Update on your Innospace booking";
  const type = booking ? bookingTypeLabel(booking) : "Booking";
  const dates = booking ? datesText(booking) : "";
  return `Re: ${type} Booking Confirmation${dates ? ` for ${dates}` : ""}`;
}

export function emailHeading(status: EmailStatus): string {
  return status === "confirmed" ? "Booking confirmed" : "Booking cancelled";
}

function confirmedBody(
  booking: Booking,
  pricing?: Pricing,
  contact?: ContactInfo,
): string {
  const first = booking.fullName?.trim()
    ? booking.fullName.trim().split(" ")[0]
    : "there";
  const type = bookingTypeLabel(booking).toLowerCase();
  const dates = datesText(booking);
  const priceLine = priceLineFor(booking, pricing);
  const lines = [
    `Hi ${first},`,
    "",
    `Thank you for your message and your interest in our ${type}.`,
    "",
    `We confirm that the ${type} is available for ${dates}.`,
  ];
  if (priceLine) lines.push("", priceLine);
  lines.push("", "Looking forward to your visit.", "", "Best regards,");
  lines.push(...signOff(contact));
  return lines.join("\n");
}

function cancelledBody(booking: Booking): string {
  const first = booking.fullName?.trim()
    ? booking.fullName.trim().split(" ")[0]
    : "";
  const greeting = first ? `Hello ${first},` : "Hello,";
  return [
    greeting,
    "",
    "Thank you for your request and your interest in InnoSpace Tirana.",
    "",
    "We are very sorry to inform you that, at the moment, we are fully booked and unfortunately unable to confirm your workspace reservation for the requested date.",
    "",
    "We sincerely apologize for the inconvenience and hope to have the opportunity to welcome you on another occasion.",
    "",
    "Thank you for your understanding.",
    "",
    "Best regards,",
    "InnoSpace Tirana",
  ].join("\n");
}

// Editable body shown in the dashboard textarea; subject/shell added by the mailer.
export function emailBodyText(
  booking: Booking,
  status: EmailStatus,
  pricing?: Pricing,
  contact?: ContactInfo,
): string {
  if (status === "confirmed") return confirmedBody(booking, pricing, contact);
  return cancelledBody(booking);
}
