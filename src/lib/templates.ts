// Pure email-template helpers shared by the mailer and the dashboard preview,
// so the preview matches what's actually sent. No env access (the caller passes
// pricing + contact), so this module is safe to import from a client component.
import { formatDateRangeLong } from "./datetime";
import type {
  Booking,
  BookingPlan,
  BookingStatus,
  ContactInfo,
  Pricing,
} from "./types";

export type EmailStatus = Extract<BookingStatus, "confirmed" | "cancelled">;

// Display label + billing period for each plan slug.
const PLAN_META: Record<BookingPlan, { label: string; period: string }> = {
  "daily-pass": { label: "Day Pass", period: "day" },
  "weekly-pass": { label: "Weekly Pass", period: "week" },
  "monthly-pass": { label: "Monthly Pass", period: "month" },
  "event-room": { label: "Event Room", period: "booking" },
};

// Sign-off + contact/access block for the confirmation email. Only the details
// actually configured appear; the org name always closes it.
function signOff(contact: ContactInfo): string[] {
  const lines: string[] = [];
  if (contact.name) lines.push(contact.name);
  lines.push("", contact.org);
  if (contact.address) lines.push(contact.address);
  const access = [contact.accessApt1, contact.accessApt2].filter(
    (a): a is string => !!a,
  );
  if (access.length) {
    lines.push("", "⚠️ Important access instructions:");
    for (const a of access) lines.push("", a);
  }
  if (contact.mapsUrl)
    lines.push("", `View on Google Maps: ${contact.mapsUrl}`);
  const rows: string[] = [];
  if (contact.phone) rows.push(`Phone: ${contact.phone}`);
  if (contact.email) rows.push(`Email: ${contact.email}`);
  if (contact.nid) rows.push(`NID: ${contact.nid}`);
  if (rows.length) lines.push("", ...rows);
  return lines;
}

/** The rate sentence for a booking's plan, or null when it isn't priced. */
export function priceLineFor(
  booking: Booking,
  pricing: Pricing,
): string | null {
  if (!booking.plan) return null;
  const cur = pricing.currency;

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

/** The booked dates as email copy, e.g. "1-3 July 2026". */
export function datesText(booking: Booking): string {
  return (
    formatDateRangeLong(booking.from, booking.to) ?? "your requested dates"
  );
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

function firstName(booking: Booking): string {
  return booking.fullName?.trim() ? booking.fullName.trim().split(" ")[0] : "";
}

function confirmedBody(
  booking: Booking,
  pricing: Pricing,
  contact: ContactInfo,
): string {
  const type = bookingTypeLabel(booking).toLowerCase();
  const dates = datesText(booking);
  const priceLine = priceLineFor(booking, pricing);
  const lines = [
    `Hi ${firstName(booking) || "there"},`,
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

function cancelledBody(booking: Booking, contact: ContactInfo): string {
  const first = firstName(booking);
  return [
    first ? `Hello ${first},` : "Hello,",
    "",
    `Thank you for your request and your interest in ${contact.org}.`,
    "",
    "We are very sorry to inform you that, at the moment, we are fully booked and unfortunately unable to confirm your workspace reservation for the requested date.",
    "",
    "We sincerely apologize for the inconvenience and hope to have the opportunity to welcome you on another occasion.",
    "",
    "Thank you for your understanding.",
    "",
    "Best regards,",
    contact.org,
  ].join("\n");
}

// Editable body shown in the dashboard textarea; subject/shell added by the mailer.
export function emailBodyText(
  booking: Booking,
  status: EmailStatus,
  pricing: Pricing,
  contact: ContactInfo,
): string {
  if (status === "confirmed") return confirmedBody(booking, pricing, contact);
  return cancelledBody(booking, contact);
}
