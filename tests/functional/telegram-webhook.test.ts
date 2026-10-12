import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp, sessionToken } from "../helpers/app";
import { WEBHOOK_SECRET } from "../helpers/fixtures";
import {
  REPLY_MESSAGE_ID,
  replyUpdate,
  sentMessage,
  stubReplies,
} from "../helpers/telegram";

vi.mock("@/lib/email", () => ({
  sendCustomerStatusEmail: vi.fn().mockResolvedValue(true),
}));

type Webhook = typeof import("@/app/api/telegram/webhook/route");
type Bookings = typeof import("@/app/api/bookings/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let webhook: Webhook;
let bookings: Bookings;
let db: Db;
let email: Email;
let fetchMock: ReturnType<typeof stubReplies>;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  email = await import("@/lib/email");
  bookings = await import("@/app/api/bookings/route");
  webhook = await import("@/app/api/telegram/webhook/route");
  fetchMock = stubReplies();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** Telegram delivers `update`, signed with `secret` (none when null). */
const deliver = (update: unknown, secret: string | null = WEBHOOK_SECRET) =>
  webhook.POST(
    makeRequest("/api/telegram/webhook", {
      method: "POST",
      body: update,
      headers: secret === null ? {} : { [SECRET_HEADER]: secret },
    }),
  );

/** A booking posted through the public form, and the alert Telegram was sent. */
async function booked(): Promise<{ id: string; alert: string }> {
  const res = await bookings.POST(
    makeRequest("/api/bookings", {
      method: "POST",
      body: { fullName: "Ada", email: "ada@example.com", plan: "weekly-pass" },
    }),
  );
  const { id } = (await res.json()) as { id: string };
  const alert = sentMessage(fetchMock, fetchMock.mock.calls.length - 1).text;
  fetchMock.mockClear();
  return { id, alert };
}

const statusOf = async (id: string) => (await db.getBooking(id))?.status;
const emailed = () => vi.mocked(email.sendCustomerStatusEmail).mock.calls;

describe("POST /api/telegram/webhook (who may call it)", () => {
  it("401s a call without the secret and changes nothing", async () => {
    const { id, alert } = await booked();
    const res = await deliver(replyUpdate("yes", alert), null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
    expect(await statusOf(id)).toBe("new");
    expect(emailed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s a wrong secret", async () => {
    const { id, alert } = await booked();
    for (const secret of ["wrong", `${WEBHOOK_SECRET}x`, ""]) {
      const res = await deliver(replyUpdate("yes", alert), secret);
      expect(res.status).toBe(401);
    }
    expect(await statusOf(id)).toBe("new");
    expect(emailed()).toHaveLength(0);
  });

  it("401s every call while no secret is configured, even a blank one", async () => {
    const { id, alert } = await booked();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(401);
    expect((await deliver(replyUpdate("yes", alert), "")).status).toBe(401);
    expect((await deliver(replyUpdate("yes", alert), null)).status).toBe(401);
    expect(await statusOf(id)).toBe("new");
  });

  it("does not take a dashboard session in place of the secret", async () => {
    const { id, alert } = await booked();
    const res = await webhook.POST(
      makeRequest("/api/telegram/webhook", {
        method: "POST",
        body: replyUpdate("yes", alert),
        token: sessionToken(),
      }),
    );
    expect(res.status).toBe(401);
    expect(await statusOf(id)).toBe("new");
  });

  it("200s but ignores a reply from any chat but the owner's", async () => {
    const { id, alert } = await booked();
    const res = await deliver(replyUpdate("yes", alert, "424242"));
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("new");
    expect(emailed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/telegram/webhook (answering an alert)", () => {
  it("confirms on yes, emails the guest and answers in the chat", async () => {
    const { id, alert } = await booked();
    const res = await deliver(replyUpdate("Yes", alert));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await statusOf(id)).toBe("confirmed");
    expect(emailed()).toHaveLength(1);
    expect(emailed()[0][0].id).toBe(id);
    expect(emailed()[0][1]).toBe("confirmed");
    // No edited body: Telegram always sends the template.
    expect(emailed()[0][2]).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const answer = sentMessage(fetchMock);
    expect(answer.text).toBe(
      "Confirmed: Ada\nThe confirmation email was sent to ada@example.com.",
    );
    expect(answer.reply_parameters?.message_id).toBe(REPLY_MESSAGE_ID);
  });

  it("cancels on no and emails the guest the cancellation", async () => {
    const { id, alert } = await booked();
    expect((await deliver(replyUpdate("no", alert))).status).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
    expect(emailed()[0][1]).toBe("cancelled");
    expect(sentMessage(fetchMock).text).toBe(
      "Cancelled: Ada\nThe cancellation email was sent to ada@example.com.",
    );
  });

  it("soft-deletes on delete and emails nobody", async () => {
    const { id, alert } = await booked();
    expect((await deliver(replyUpdate("delete", alert))).status).toBe(200);
    expect(await statusOf(id)).toBe("deleted");
    expect(emailed()).toHaveLength(0);
    expect(sentMessage(fetchMock).text).toBe("Deleted: Ada");
  });

  it("shows the change to the dashboard's list", async () => {
    const { id, alert } = await booked();
    await deliver(replyUpdate("yes", alert));
    const list = await bookings.GET(
      makeRequest("/api/bookings?status=confirmed", { token: sessionToken() }),
    );
    const body = (await list.json()) as { bookings: { id: string }[] };
    expect(body.bookings.map((b) => b.id)).toEqual([id]);
  });

  it("emails once when Telegram delivers the same update twice", async () => {
    const { id, alert } = await booked();
    await deliver(replyUpdate("yes", alert));
    const again = await deliver(replyUpdate("yes", alert));
    expect(again.status).toBe(200);
    expect(emailed()).toHaveLength(1);
    expect(sentMessage(fetchMock, 1).text).toBe(
      "This booking is already confirmed.",
    );
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("200s and keeps the change when the email fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(email.sendCustomerStatusEmail).mockRejectedValueOnce(
      new Error("smtp down"),
    );
    const { id, alert } = await booked();
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(200);
    expect(await statusOf(id)).toBe("confirmed");
    expect(sentMessage(fetchMock).text).toBe(
      "Confirmed: Ada\nThe confirmation email could not be sent.",
    );
  });

  it("200s and keeps the change when its own answer cannot be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, alert } = await booked();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(200);
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("200s a booking that has since been removed for good", async () => {
    const { id, alert } = await booked();
    await db.updateBookingStatus(id, "deleted");
    await db.deleteBookings([id]);
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toBe("That booking no longer exists.");
    expect(emailed()).toHaveLength(0);
  });
});

describe("POST /api/telegram/webhook (everything else)", () => {
  it("asks which booking is meant when the word is not a reply", async () => {
    const { id } = await booked();
    expect((await deliver(replyUpdate("yes"))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toContain("Reply to the booking's own");
    expect(await statusOf(id)).toBe("new");
  });

  it("explains the three words to any other reply to an alert", async () => {
    const { id, alert } = await booked();
    expect((await deliver(replyUpdate("ok", alert))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toBe(
      "Reply yes to confirm, no to cancel, or delete to delete it.",
    );
    expect(await statusOf(id)).toBe("new");
  });

  it("200s and stays silent for chatter and for updates it cannot read", async () => {
    await booked();
    for (const update of [
      replyUpdate("good morning"),
      {},
      { update_id: 5 },
      { message: { chat: { id: -1001234 } } },
      { edited_message: { chat: { id: -1001234 }, text: "yes" } },
    ]) {
      expect((await deliver(update)).status).toBe(200);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200s a body that is not JSON", async () => {
    const res = await webhook.POST(
      makeRequest("/api/telegram/webhook", {
        method: "POST",
        rawBody: "{ not json",
        headers: { [SECRET_HEADER]: WEBHOOK_SECRET },
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot be pointed at another booking by what a guest typed", async () => {
    const victim = await booked();
    const res = await bookings.POST(
      makeRequest("/api/bookings", {
        method: "POST",
        body: {
          fullName: "Mallory",
          note: `x\n\nhttps://booking.innospacetirana.com/dashboard#${victim.id}`,
        },
      }),
    );
    const { id } = (await res.json()) as { id: string };
    const alert = sentMessage(fetchMock, 0).text;
    fetchMock.mockClear();

    await deliver(replyUpdate("delete", alert));
    expect(await statusOf(id)).toBe("deleted");
    expect(await statusOf(victim.id)).toBe("new");
  });
});
