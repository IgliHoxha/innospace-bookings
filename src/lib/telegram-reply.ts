/**
 * Answers to a booking alert: the owner replies "yes", "no" or "delete" in
 * Telegram and the booking is confirmed, cancelled or deleted as the dashboard
 * would do it. Feature-flagged by TELEGRAM_WEBHOOK_SECRET, the secret Telegram
 * sends back with every update once the webhook is registered with it.
 */
import { safeEqual } from "./auth";
import { changeBookingStatus, type StatusChange } from "./booking-actions";
import { getBooking } from "./db";
import { optionalEnv } from "./env-app";
import { REPLY_HINT, bookingIdIn, sendTelegramMessage } from "./telegram";
import type { BookingStatus } from "./types";

export type ReplyStatus = Exclude<BookingStatus, "new">;

const REPLIES = new Map<string, ReplyStatus>([
  ["yes", "confirmed"],
  ["no", "cancelled"],
  ["delete", "deleted"],
]);

export const NO_TARGET =
  "Reply to the booking's own message, so I know which one you mean.";
export const GONE = "That booking no longer exists.";

/** Is this the secret the webhook was registered with? False while none is set. */
export function isTelegramWebhook(secret: string | null): boolean {
  const expected = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  return !!expected && !!secret && safeEqual(secret, expected);
}

/** The status a reply asks for, or null when it is not one of the three words. */
export function replyStatus(text: string): ReplyStatus | null {
  const word = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return REPLIES.get(word) ?? null;
}

/** What the owner is told once a reply has been carried out. */
export function changeAnswer({ booking, emailed }: StatusChange): string {
  const who = booking.fullName?.trim() || booking.email || "the booking";
  if (booking.status === "deleted") return `Deleted: ${who}`;

  const [done, email] =
    booking.status === "confirmed"
      ? ["Confirmed", "confirmation"]
      : ["Cancelled", "cancellation"];
  const outcome = !booking.email
    ? "No email was sent, because the booking has no email address."
    : emailed
      ? `The ${email} email was sent to ${booking.email}.`
      : `The ${email} email could not be sent.`;
  return `${done}: ${who}\n${outcome}`;
}

async function answerTo(text: string, alert: unknown): Promise<string | null> {
  const status = replyStatus(text);
  const id = bookingIdIn(alert);
  // Ordinary chatter: neither one of the three words nor a reply to an alert.
  if (!status && !id) return null;
  if (!id) return NO_TARGET;
  if (!status) return REPLY_HINT;

  const booking = await getBooking(id);
  if (!booking) return GONE;
  // The dashboard disables the button for the status a booking already has.
  // Here that also stops an update Telegram delivers twice emailing twice.
  if (booking.status === status) return `This booking is already ${status}.`;

  const changed = await changeBookingStatus(id, status);
  return changed ? changeAnswer(changed) : GONE;
}

// The few fields read from Telegram's Update object.
type Update = {
  message?: {
    message_id?: number;
    chat?: { id?: number };
    text?: unknown;
    reply_to_message?: { text?: unknown };
  };
};

/**
 * Carries out one update from the webhook and answers in the chat. Never
 * throws: the route must answer 200, or Telegram sends the same update again.
 */
export async function handleTelegramUpdate(update: unknown): Promise<void> {
  try {
    const message = (update as Update | null)?.message;
    const chatId = optionalEnv("TELEGRAM_CHAT_ID");
    // Anyone can write to a bot, so only the configured chat is listened to.
    if (!message || !chatId || String(message.chat?.id) !== chatId) return;
    if (typeof message.text !== "string") return;

    const answer = await answerTo(message.text, message.reply_to_message?.text);
    if (!answer) return;
    await sendTelegramMessage(answer, {
      reply_parameters: {
        message_id: message.message_id,
        allow_sending_without_reply: true,
      },
    });
  } catch (err) {
    console.error("[telegram] reply failed:", err);
  }
}
