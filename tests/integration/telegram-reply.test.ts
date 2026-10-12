import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "../helpers/app";
import {
  REPLY_MESSAGE_ID,
  replyUpdate,
  sentMessage,
  stubReplies,
} from "../helpers/telegram";
import type { Booking, BookingInput } from "@/lib/types";

// Resend is stubbed at the class level, so the real mailer runs up to the send.
const send = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

type Db = Awaited<ReturnType<typeof loadDb>>;
type Telegram = typeof import("@/lib/telegram");
type Reply = typeof import("@/lib/telegram-reply");
let db: Db;
let telegram: Telegram;
let reply: Reply;
let fetchMock: ReturnType<typeof stubReplies>;

beforeEach(async () => {
  db = await loadDb();
  telegram = await import("@/lib/telegram");
  reply = await import("@/lib/telegram-reply");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  fetchMock = stubReplies();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seed = (over: Partial<BookingInput> = {}) =>
  db.createBooking({
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    plan: "daily-pass",
    from: "2026-11-02",
    ...over,
  });

/** The owner answers `booking`'s alert with `text`. Resolves the bot's answer. */
async function answer(text: string, booking: Booking): Promise<string> {
  fetchMock.mockClear();
  await reply.handleTelegramUpdate(
    replyUpdate(text, telegram.newBookingText(booking)),
  );
  return sentMessage(fetchMock).text;
}

const statusOf = async (id: string) => (await db.getBooking(id))?.status;

describe("answering a booking alert", () => {
  it("confirms the booking and emails the guest the confirmation", async () => {
    const b = await seed();
    expect(await answer("yes", b)).toBe(
      "Confirmed: Ada Lovelace\nThe confirmation email was sent to ada@example.com.",
    );
    expect(await statusOf(b.id)).toBe("confirmed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toEqual(["ada@example.com"]);
    expect(send.mock.calls[0][0].subject).toBe(
      "Re: Day Pass Booking Confirmation for 2 November 2026",
    );
  });

  it("cancels the booking and emails the guest the cancellation", async () => {
    const b = await seed();
    expect(await answer("no", b)).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email was sent to ada@example.com.",
    );
    expect(await statusOf(b.id)).toBe("cancelled");
    expect(send.mock.calls[0][0].subject).toBe(
      "Update on your Innospace booking",
    );
  });

  it("soft-deletes the booking, emails nobody and keeps the row", async () => {
    const b = await seed();
    expect(await answer("delete", b)).toBe("Deleted: Ada Lovelace");
    expect(await statusOf(b.id)).toBe("deleted");
    expect(send).not.toHaveBeenCalled();
    expect((await db.queryBookings()).total).toBe(0);
    expect((await db.queryBookings({ filter: "deleted" })).total).toBe(1);
  });

  it("answers under the owner's own message", async () => {
    await answer("yes", await seed());
    expect(sentMessage(fetchMock).reply_parameters).toEqual({
      message_id: REPLY_MESSAGE_ID,
      allow_sending_without_reply: true,
    });
  });

  it("acts on the booking that was replied to, not the newest one", async () => {
    const first = await seed({ fullName: "First" });
    const second = await seed({
      fullName: "Second",
      email: "second@example.com",
    });
    expect(await answer("no", first)).toContain("Cancelled: First");
    expect(await statusOf(first.id)).toBe("cancelled");
    expect(await statusOf(second.id)).toBe("new");
  });

  it("does nothing the second time, so a resent update cannot email twice", async () => {
    const b = await seed();
    await answer("yes", b);
    expect(await answer("yes", b)).toBe("This booking is already confirmed.");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("lets a decision be changed, as the dashboard's buttons do", async () => {
    const b = await seed();
    await answer("yes", b);
    expect(await answer("no", b)).toContain("Cancelled: Ada Lovelace");
    expect(await statusOf(b.id)).toBe("cancelled");
    expect(await answer("delete", b)).toBe("Deleted: Ada Lovelace");
    expect(await answer("yes", b)).toContain("Confirmed: Ada Lovelace");
    expect(await statusOf(b.id)).toBe("confirmed");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("confirms a booking with no address and says no email went", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = await seed({ email: undefined });
    expect(await answer("yes", b)).toBe(
      "Confirmed: Ada Lovelace\nNo email was sent, because the booking has no email address.",
    );
    expect(await statusOf(b.id)).toBe("confirmed");
    expect(send).not.toHaveBeenCalled();
  });

  it("still confirms when the email is refused, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValueOnce({ data: null, error: { message: "bounced" } });
    const b = await seed();
    expect(await answer("yes", b)).toBe(
      "Confirmed: Ada Lovelace\nThe confirmation email could not be sent.",
    );
    expect(await statusOf(b.id)).toBe("confirmed");
  });

  it("still confirms when the mailer throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("network down"));
    const b = await seed();
    expect(await answer("yes", b)).toContain(
      "The confirmation email could not be sent.",
    );
    expect(await statusOf(b.id)).toBe("confirmed");
  });

  it("says so when the booking has been removed for good", async () => {
    const b = await seed();
    await db.updateBookingStatus(b.id, "deleted");
    await db.deleteBookings([b.id]);
    expect(await answer("yes", b)).toBe("That booking no longer exists.");
    expect(send).not.toHaveBeenCalled();
  });

  it("explains itself to a reply that is none of the three words", async () => {
    const b = await seed();
    expect(await answer("maybe tomorrow", b)).toBe(telegram.REPLY_HINT);
    expect(await statusOf(b.id)).toBe("new");
  });
});

describe("messages that are not an answer to an alert", () => {
  const handle = async (update: unknown) => {
    fetchMock.mockClear();
    await reply.handleTelegramUpdate(update);
  };

  it("asks which booking is meant when a word arrives on its own", async () => {
    const b = await seed();
    await handle(replyUpdate("yes"));
    expect(sentMessage(fetchMock).text).toBe(reply.NO_TARGET);
    await handle(replyUpdate("delete", "Confirmed: Ada Lovelace"));
    expect(sentMessage(fetchMock).text).toBe(reply.NO_TARGET);
    expect(await statusOf(b.id)).toBe("new");
  });

  it("stays silent through ordinary chatter", async () => {
    await handle(replyUpdate("good morning"));
    await handle(replyUpdate("thanks", "see you at nine"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores every other chat, even one replying to a real alert", async () => {
    const b = await seed();
    await handle(replyUpdate("yes", telegram.newBookingText(b), "999"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await statusOf(b.id)).toBe("new");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores everything while no chat is configured", async () => {
    const b = await seed();
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    await handle(replyUpdate("yes", telegram.newBookingText(b)));
    expect(await statusOf(b.id)).toBe("new");
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "yes"],
    ["an empty object", {}],
    ["a message of the wrong type", { message: "yes" }],
    ["a message with no chat", { message: { text: "yes" } }],
    ["a photo with no text", { message: { chat: { id: -1001234 } } }],
    [
      "a text that is not a string",
      { message: { chat: { id: -1001234 }, text: { yes: true } } },
    ],
    [
      "an edited message",
      { edited_message: { chat: { id: -1001234 }, text: "yes" } },
    ],
  ])("shrugs off an update holding %s", async (_what, update) => {
    await expect(reply.handleTelegramUpdate(update)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, even when the database fails mid-reply", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const alert = telegram.newBookingText(await seed());
    const failure = new Error("disk gone");
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getBooking: vi.fn().mockRejectedValue(failure),
    }));
    try {
      const broken = await import("@/lib/telegram-reply");
      await expect(
        broken.handleTelegramUpdate(replyUpdate("yes", alert)),
      ).resolves.toBeUndefined();
    } finally {
      vi.doUnmock("@/lib/db");
    }
    expect(log).toHaveBeenCalledWith("[telegram] reply failed:", failure);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
