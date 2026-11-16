/** Telegram alert to the owner for a new booking. Skipped unless TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are both set. */
import { appBaseUrl, optionalEnv } from "./env-app";
import { formatDateRangeLong } from "./datetime";
import { bookingTypeLabel } from "./templates";
import type { Booking } from "./types";

const API_URL = "https://api.telegram.org";

// The alert runs after the response; a slow Telegram is still given up on so requests cannot pile up.
const TIMEOUT_MS = 3000;

// Telegram refuses messages over 4096 characters and the form bounds nothing, so each field is clipped.
const FIELD_MAX = 200;
const NOTE_MAX = 1000;

export const REPLY_HINT =
  "Reply yes to confirm, no to cancel, or delete to delete it.";

/** True once the webhook secret is set, which is what lets an alert be answered. */
export function repliesEnabled(): boolean {
  return !!optionalEnv("TELEGRAM_WEBHOOK_SECRET");
}

// Counted in code points, so the cut never lands inside an emoji.
function clip(value: string | undefined, max: number): string {
  const chars = Array.from((value ?? "").trim());
  return chars.length > max
    ? `${chars.slice(0, max).join("")}...`
    : chars.join("");
}

/** The alert's text, one line per detail given. Sent without parse_mode: a guest's stray "_" or "<" would be refused. */
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
    ...(repliesEnabled() ? [REPLY_HINT, ""] : []),
    // Must stay the last line: a reply finds its booking by this link's id, and guest text cannot follow it.
    `${appBaseUrl()}/dashboard#${booking.id}`,
  ].join("\n");
}

const ALERT_ID =
  /\/dashboard#([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\s*$/;

/** The booking an alert is about, read from its closing link. Null for other text. */
export function bookingIdIn(text: unknown): string | null {
  return typeof text === "string" ? (ALERT_ID.exec(text)?.[1] ?? null) : null;
}

// The message is built inside the try, so nothing about it can throw past here.
async function send(message: () => Record<string, unknown>): Promise<boolean> {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = optionalEnv("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API_URL}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        // The only link is the login-gated dashboard, so a preview is noise.
        link_preview_options: { is_disabled: true },
        ...message(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      console.error("[telegram] message was rejected:", data.description);
      return false;
    }
    return true;
  } catch (err) {
    // The token is part of the URL, so it is struck from whatever gets logged.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      "[telegram] request failed:",
      reason.split(token).join("[token]"),
    );
    return false;
  }
}

/** Sends the alert. True only when Telegram accepted it; never throws, so it cannot fail the booking. */
export async function notifyNewBooking(booking: Booking): Promise<boolean> {
  return send(() => ({
    text: newBookingText(booking),
    // Opens the reply box on this alert, so a typed "yes" is a reply to it.
    ...(repliesEnabled() && {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "yes, no or delete",
      },
    }),
  }));
}

/** Sends `text` to the owner's chat, with the same promise as the alert. */
export async function sendTelegramMessage(
  text: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  return send(() => ({ text, ...extra }));
}
