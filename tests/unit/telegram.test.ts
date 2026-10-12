import { afterEach, describe, expect, it, vi } from "vitest";
import { newBookingText, notifyNewBooking } from "@/lib/telegram";
import type { Booking } from "@/lib/types";
import { BOT_CHAT, BOT_TOKEN } from "../helpers/fixtures";
import {
  SEND_URL,
  sentMessage,
  stubFetch,
  stubTelegram,
} from "../helpers/telegram";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BOOKING: Booking = {
  id: "bk_1",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phoneNumber: "+355 69 123 4567",
  plan: "event-room",
  from: "2026-10-14T11:00",
  to: "2026-10-14T14:00",
  note: "Need a projector",
  status: "new",
  createdAt: "2026-10-12T08:30:00.000Z",
};

const DASHBOARD = "https://booking.innospacetirana.com/dashboard";

describe("newBookingText", () => {
  it("labels the full name, email, phone, dates, type and notes, then links", () => {
    expect(newBookingText(BOOKING)).toBe(
      [
        "New booking",
        "",
        "Full name: Ada Lovelace",
        "Email: ada@example.com",
        "Phone: +355 69 123 4567",
        "Dates: 14 October 2026, 11:00-14:00",
        "Type: Event Room",
        "Notes: Need a projector",
        "",
        DASHBOARD,
      ].join("\n"),
    );
  });

  it("spells a pass's bare dates as a range", () => {
    const lines = newBookingText({
      ...BOOKING,
      plan: "weekly-pass",
      from: "2026-10-12",
      to: "2026-10-16",
    }).split("\n");
    expect(lines).toContain("Dates: 12-16 October 2026");
    expect(lines).toContain("Type: Weekly Pass");
  });

  it("leaves out every detail the guest did not give", () => {
    expect(
      newBookingText({
        id: "bk_2",
        fullName: "Ada",
        status: "new",
        createdAt: BOOKING.createdAt,
      }),
    ).toBe(["New booking", "", "Full name: Ada", "", DASHBOARD].join("\n"));
  });

  it("has no notes line for a booking without a note", () => {
    const text = newBookingText({ ...BOOKING, note: undefined });
    expect(text).not.toContain("Notes:");
    expect(text).toContain("Type: Event Room\n\n");
  });

  it("has no dates line when there are no dates", () => {
    const text = newBookingText({ ...BOOKING, from: undefined, to: undefined });
    expect(text).not.toContain("Dates:");
    expect(text).toContain("Type: Event Room");
  });

  it("treats a blank detail as missing", () => {
    const text = newBookingText({ ...BOOKING, phoneNumber: "  ", note: "" });
    expect(text).not.toContain("Phone:");
    expect(text).not.toContain("Notes:");
    expect(text.split("\n")).toHaveLength(8);
  });

  it("keeps a note's own line breaks", () => {
    const text = newBookingText({ ...BOOKING, note: "Projector\nTwo mics" });
    expect(text).toContain("Notes: Projector\nTwo mics\n\n");
  });

  it("links to APP_BASE_URL when set, without doubling the slash", () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(newBookingText(BOOKING)).toMatch(
      /\n\nhttps:\/\/staging\.example\.com\/dashboard$/,
    );
  });

  it("keeps a guest's markup characters exactly as typed", () => {
    const note = "<b>bold</b> _under_ *star* [x](y) & `tick`";
    expect(newBookingText({ ...BOOKING, note })).toContain(`Notes: ${note}`);
  });

  it("cuts oversized fields so the alert stays inside Telegram's limit", () => {
    const text = newBookingText({
      ...BOOKING,
      fullName: "n".repeat(5000),
      email: "e".repeat(5000),
      phoneNumber: "9".repeat(5000),
      note: "x".repeat(5000),
    });
    expect(text.length).toBeLessThan(4096);
    expect(text).toContain(`Full name: ${"n".repeat(200)}...\n`);
    expect(text).toContain(`Notes: ${"x".repeat(1000)}...\n`);
    expect(text.endsWith(DASHBOARD)).toBe(true);
  });

  it("keeps a field that sits exactly on the limit whole", () => {
    const text = newBookingText({ ...BOOKING, fullName: "n".repeat(200) });
    expect(text).toContain(`Full name: ${"n".repeat(200)}\n`);
  });

  it("never cuts through an emoji, and fits even when every field is full of them", () => {
    const party = "🎉".repeat(1001);
    const text = newBookingText({
      ...BOOKING,
      fullName: party,
      email: party,
      phoneNumber: party,
      note: party,
    });
    expect(text).toContain(`Notes: ${"🎉".repeat(1000)}...\n`);
    expect(text).toContain(`Full name: ${"🎉".repeat(200)}...\n`);
    // An emoji is two UTF-16 units, the stricter of the ways to count.
    expect(text.length).toBeLessThan(4096);
  });
});

describe("notifyNewBooking", () => {
  it.each([
    ["the token", "TELEGRAM_CHAT_ID", BOT_CHAT],
    ["the chat id", "TELEGRAM_BOT_TOKEN", BOT_TOKEN],
  ])("sends nothing while %s is unset", async (_missing, name, value) => {
    vi.stubEnv(name, value);
    const fetchMock = stubFetch();
    expect(await notifyNewBooking(BOOKING)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing while both are blank", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "  ");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const fetchMock = stubFetch();
    expect(await notifyNewBooking(BOOKING)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the alert to the bot's sendMessage as plain text", async () => {
    const fetchMock = stubTelegram();
    expect(await notifyNewBooking(BOOKING)).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SEND_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(sentMessage(fetchMock)).toEqual({
      chat_id: BOT_CHAT,
      text: newBookingText(BOOKING),
      link_preview_options: { is_disabled: true },
    });
  });

  it("gives the request three seconds before giving up", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = stubTelegram();
    await notifyNewBooking(BOOKING);
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      timeout.mock.results[0].value,
    );
  });

  it("reports false and logs Telegram's reason when it refuses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Bad Request: chat not found" });
    expect(await notifyNewBooking(BOOKING)).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "[telegram] alert was rejected:",
      "Bad Request: chat not found",
    );
  });

  it("reports false instead of throwing when the request fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect(await notifyNewBooking(BOOKING)).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "[telegram] alert request failed:",
      "timed out",
    );
  });

  it("reports false when the answer is not JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      }),
    );
    expect(await notifyNewBooking(BOOKING)).toBe(false);
  });

  it("keeps the bot token out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`Failed to parse URL ${SEND_URL}`)),
    );
    await notifyNewBooking(BOOKING);
    expect(JSON.stringify(log.mock.calls)).not.toContain(BOT_TOKEN);
    expect(log.mock.calls[0][1]).toContain("bot[token]/sendMessage");
  });

  it("survives a rejection that is not an Error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("socket hang up"));
    expect(await notifyNewBooking(BOOKING)).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "[telegram] alert request failed:",
      "socket hang up",
    );
  });
});
