import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeAnswer,
  isTelegramWebhook,
  replyStatus,
} from "@/lib/telegram-reply";
import type { Booking } from "@/lib/types";
import { WEBHOOK_SECRET } from "../helpers/fixtures";

afterEach(() => vi.unstubAllEnvs());

describe("replyStatus", () => {
  it.each([
    ["yes", "confirmed"],
    ["no", "cancelled"],
    ["delete", "deleted"],
  ] as const)("reads %s as %s", (word, status) => {
    expect(replyStatus(word)).toBe(status);
  });

  it.each([["Yes"], ["YES"], ["  yes  "], ["yes."], ["Yes!"], ["yes!!\n"]])(
    "forgives the casing, spacing and full stop a phone adds (%j)",
    (text) => {
      expect(replyStatus(text)).toBe("confirmed");
    },
  );

  it.each([
    [""],
    ["   "],
    ["yes please"],
    ["not yet"],
    ["nope"],
    ["y"],
    ["confirmed"],
    ["cancel"],
    ["deleted"],
    ["delete all"],
    ["/yes"],
    ["yes?"],
    ["constructor"],
    ["__proto__"],
  ])("reads nothing into %j", (text) => {
    expect(replyStatus(text)).toBeNull();
  });
});

describe("isTelegramWebhook", () => {
  it("accepts only the exact secret the webhook was registered with", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    expect(isTelegramWebhook(WEBHOOK_SECRET)).toBe(true);
    expect(isTelegramWebhook(`${WEBHOOK_SECRET}x`)).toBe(false);
    expect(isTelegramWebhook(WEBHOOK_SECRET.slice(1))).toBe(false);
    expect(isTelegramWebhook(WEBHOOK_SECRET.toUpperCase())).toBe(false);
    expect(isTelegramWebhook("")).toBe(false);
    expect(isTelegramWebhook(null)).toBe(false);
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
  ] as const)(
    "refuses every caller while the secret is %s",
    (_state, value) => {
      if (value !== undefined) vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", value);
      expect(isTelegramWebhook(WEBHOOK_SECRET)).toBe(false);
      expect(isTelegramWebhook("")).toBe(false);
      expect(isTelegramWebhook(null)).toBe(false);
    },
  );
});

describe("changeAnswer", () => {
  const booking = (over: Partial<Booking>): Booking => ({
    id: "36added1-cecc-494d-bce9-1809dd7eb4b2",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    status: "confirmed",
    createdAt: "2026-10-12T08:30:00.000Z",
    ...over,
  });

  it("says a confirmation went out, and to whom", () => {
    expect(changeAnswer({ booking: booking({}), emailed: true })).toBe(
      "Confirmed: Ada Lovelace\nThe confirmation email was sent to ada@example.com.",
    );
  });

  it("says a cancellation went out, and to whom", () => {
    expect(
      changeAnswer({
        booking: booking({ status: "cancelled" }),
        emailed: true,
      }),
    ).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email was sent to ada@example.com.",
    );
  });

  it("admits when the email did not go out", () => {
    expect(changeAnswer({ booking: booking({}), emailed: false })).toBe(
      "Confirmed: Ada Lovelace\nThe confirmation email could not be sent.",
    );
    expect(
      changeAnswer({
        booking: booking({ status: "cancelled" }),
        emailed: false,
      }),
    ).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email could not be sent.",
    );
  });

  it("explains that a booking with no address gets no email", () => {
    expect(
      changeAnswer({ booking: booking({ email: undefined }), emailed: false }),
    ).toBe(
      "Confirmed: Ada Lovelace\nNo email was sent, because the booking has no email address.",
    );
  });

  it("mentions no email for a delete, which never sends one", () => {
    expect(
      changeAnswer({ booking: booking({ status: "deleted" }), emailed: false }),
    ).toBe("Deleted: Ada Lovelace");
  });

  it("falls back to the address, then to plain words, for a nameless booking", () => {
    expect(
      changeAnswer({
        booking: booking({ status: "deleted", fullName: "  " }),
        emailed: false,
      }),
    ).toBe("Deleted: ada@example.com");
    expect(
      changeAnswer({
        booking: booking({
          status: "deleted",
          fullName: undefined,
          email: undefined,
        }),
        emailed: false,
      }),
    ).toBe("Deleted: the booking");
  });
});
