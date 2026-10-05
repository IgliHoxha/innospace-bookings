// Pure helpers for the dashboard's "ask for a review" link. No env access (the
// caller passes contact), so this module is safe to import from a client component.
import { hasEnded } from "./datetime";
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
