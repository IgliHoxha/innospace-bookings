/**
 * Telegram alert to the owner when a booking arrives, feature-flagged by
 * TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID: either one unset skips it.
 */
import { appBaseUrl, optionalEnv } from "./env-app";
import { formatDateRangeLong } from "./datetime";
import { bookingTypeLabel } from "./templates";
import type { Booking } from "./types";

const API_URL = "https://api.telegram.org";

// The guest is waiting on the POST, so a slow Telegram is given up on.
const TIMEOUT_MS = 3000;

// Telegram refuses a message over 4096 characters and the form bounds nothing,
// so each field is cut short enough to keep the whole alert inside that.
const FIELD_MAX = 200;
const NOTE_MAX = 1000;

// Counted in code points, so the cut never lands inside an emoji.
function clip(value: string | undefined, max: number): string {
  const chars = Array.from((value ?? "").trim());
  return chars.length > max
    ? `${chars.slice(0, max).join("")}...`
    : chars.join("");
}

/**
 * The alert's text: one labelled line per detail the guest gave. Sent plain,
 * with no parse_mode: a guest's stray "_" or "<" would otherwise make Telegram
 * refuse the whole message.
 */
export function newBookingText(booking: Booking): string {
  const details: [label: string, value: string][] = [
    ["Full name", clip(booking.fullName, FIELD_MAX)],
    ["Email", clip(booking.email, FIELD_MAX)],
    ["Phone", clip(booking.phoneNumber, FIELD_MAX)],
    ["Dates", formatDateRangeLong(booking.from, booking.to) ?? ""],
    ["Type", booking.plan ? bookingTypeLabel(booking) : ""],
    ["Notes", clip(booking.note, NOTE_MAX)],
  ];
  return [
    "New booking",
    "",
    ...details
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`),
    "",
    `${appBaseUrl().replace(/\/$/, "")}/dashboard`,
  ].join("\n");
}

/**
 * Sends the alert. Resolves true only when Telegram accepted it and never
 * throws, so a failed alert cannot fail the booking that caused it.
 */
export async function notifyNewBooking(booking: Booking): Promise<boolean> {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = optionalEnv("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API_URL}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: newBookingText(booking),
        // The link is the login-gated dashboard, so a preview of it is noise.
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      console.error("[telegram] alert was rejected:", data.description);
      return false;
    }
    return true;
  } catch (err) {
    // The token is part of the URL, so it is struck from whatever gets logged.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      "[telegram] alert request failed:",
      reason.split(token).join("[token]"),
    );
    return false;
  }
}
