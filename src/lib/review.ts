// Pure helpers for asking a guest for a review: the dashboard's link and the
// automatic email. No env access (the caller passes contact), so this module is
// safe to import from a client component.
import { daysSinceEnd, hasEnded } from "./datetime";
import { firstName } from "./templates";
import type { Booking, ContactInfo } from "./types";

export type ReviewRequestLink = { channel: "whatsapp" | "email"; href: string };

/**
 * Digits-only international number for a wa.me link. Null unless the input
 * carries its country code: guessing one could message a stranger.
 */
export function whatsappNumber(phone: string | undefined): string | null {
  const raw = (phone ?? "").trim();
  const intl = raw.startsWith("+")
    ? raw.slice(1)
    : raw.startsWith("00")
      ? raw.slice(2)
      : null;
  if (intl === null) return null;
  const digits = intl.replace("(0)", "").replace(/[\s().-]/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/**
 * The message a guest receives, or null when no review link is configured. It
 * asks for an honest review in their own words and nothing more: Google forbids
 * suggesting a rating or wording, and offering anything in return.
 */
export function reviewRequestText(
  booking: Booking,
  contact: ContactInfo,
): string | null {
  if (!contact.reviewUrl) return null;
  return [
    `Hi ${firstName(booking) || "there"}, thank you for choosing ${contact.org}.`,
    "",
    "If you have a minute, we would be grateful for an honest Google review, in your own words:",
    contact.reviewUrl,
    "",
    "We hope to see you again.",
  ].join("\n");
}

/**
 * How long after a visit the automatic email may still go out. Older visits are
 * left to the dashboard link, so switching the feature on never mails a backlog.
 */
export const REVIEW_EMAIL_WINDOW_DAYS = 7;

/** True when a booking should get the automatic review email on `today`. */
export function isReviewEmailDue(booking: Booking, today: string): boolean {
  if (booking.status !== "confirmed") return false;
  if (booking.reviewAskedAt || booking.reviewEmailedAt) return false;
  if (!booking.email?.trim().includes("@")) return false;
  const days = daysSinceEnd(booking.from, booking.to, today);
  return days !== null && days >= 1 && days <= REVIEW_EMAIL_WINDOW_DAYS;
}

export const REVIEW_EMAIL_HEADING = "Thank you for visiting";

export function reviewEmailSubject(contact: ContactInfo): string {
  return `How was your time at ${contact.org}?`;
}

/** Long enough to fill a notification snippet by itself, like the status emails. */
export function reviewEmailPreheader(contact: ContactInfo): string {
  return `Thank you for working from ${contact.org}. If you have a minute, we would be grateful for an honest Google review, in your own words.`;
}

/**
 * The automatic email's body: the same neutral request as the dashboard link,
 * plus the promise that it is sent once. Null when no review link is configured.
 */
export function reviewEmailText(
  booking: Booking,
  contact: ContactInfo,
): string | null {
  const request = reviewRequestText(booking, contact);
  if (!request) return null;
  return `${request}\n\nThis is a one-off message about your visit. We will not send it again.`;
}

/**
 * A link that opens the review request ready to send, for a confirmed booking
 * whose dates have passed: WhatsApp when the phone allows it, otherwise email.
 * Null when there is nothing to ask yet or no way to reach the guest.
 */
export function reviewRequestLink(
  booking: Booking,
  contact: ContactInfo,
  today: string,
): ReviewRequestLink | null {
  const text = reviewRequestText(booking, contact);
  if (!text || booking.status !== "confirmed") return null;
  if (!hasEnded(booking.from, booking.to, today)) return null;

  const number = whatsappNumber(booking.phoneNumber);
  if (number) {
    return {
      channel: "whatsapp",
      href: `https://wa.me/${number}?text=${encodeURIComponent(text)}`,
    };
  }

  const email = booking.email?.trim();
  if (!email || !email.includes("@")) return null;
  // Encoding the address stops a "?" or "&" inside it from adding mail headers.
  const to = encodeURIComponent(email).replace("%40", "@");
  const subject = encodeURIComponent(`Your visit to ${contact.org}`);
  const body = encodeURIComponent(text.replace(/\n/g, "\r\n"));
  return {
    channel: "email",
    href: `mailto:${to}?subject=${subject}&body=${body}`,
  };
}
