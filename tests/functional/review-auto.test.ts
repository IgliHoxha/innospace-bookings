import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, params, resetApp, sessionToken } from "../helpers/app";
import type { BookingInput } from "@/lib/types";

// Resend is stubbed at the class level so no request ever leaves the process.
const send = vi.fn().mockResolvedValue({ data: { id: "mail_1" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

type ReviewAuto = typeof import("@/lib/review-auto");
type Db = typeof import("@/lib/db");
let auto: ReviewAuto;
let db: Db;

const REVIEW_URL = "https://g.page/r/fixture/review";
// 12:00 in Tirana on the day after VISIT_DAY.
const NOON = new Date("2026-07-02T10:00:00Z");
const VISIT_DAY = "2026-07-01";

beforeEach(async () => {
  resetApp();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("BUSINESS_REVIEW_URL", REVIEW_URL);
  vi.stubEnv("REVIEW_AUTO_EMAIL", "on");
  db = await import("@/lib/db");
  auto = await import("@/lib/review-auto");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const visit = async (over: Partial<BookingInput> = {}, confirm = true) => {
  const b = await db.createBooking({
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    plan: "daily-pass",
    from: VISIT_DAY,
    ...over,
  });
  if (confirm) await db.updateBookingStatus(b.id, "confirmed");
  return b;
};
const stored = async (id: string) =>
  (await db.listBookings()).find((b) => b.id === id);

describe("automatic review emails", () => {
  it("emails a guest the day after a confirmed visit and stamps the booking", async () => {
    const b = await visit();

    expect(await auto.sendDueReviewEmails(NOON)).toEqual({
      status: "ran",
      sent: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toEqual(["ada@example.com"]);
    expect(mail.subject).toBe("How was your time at Test Org?");
    expect(mail.html).toContain(`<a href="${REVIEW_URL}"`);
    expect(mail.html).toContain("Hi Ada,");

    expect(await stored(b.id)).toMatchObject({
      reviewAskedAt: NOON.toISOString(),
      reviewEmailedAt: NOON.toISOString(),
      status: "confirmed",
    });
  });

  it("never emails the same booking twice", async () => {
    await visit();
    await auto.sendDueReviewEmails(NOON);
    expect(
      await auto.sendDueReviewEmails(new Date("2026-07-03T10:00:00Z")),
    ).toEqual({ status: "ran", sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing until it is switched on", async () => {
    vi.stubEnv("REVIEW_AUTO_EMAIL", "");
    const b = await visit();
    expect(await auto.sendDueReviewEmails(NOON)).toEqual({
      status: "off",
      sent: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect((await stored(b.id))?.reviewEmailedAt).toBeUndefined();
  });

  it("holds back outside Tirana's daytime and sends once the day starts", async () => {
    await visit();
    // 04:00, 08:59 and 20:00 in Tirana.
    for (const quiet of [
      "2026-07-02T02:00:00Z",
      "2026-07-02T06:59:00Z",
      "2026-07-02T18:00:00Z",
    ]) {
      expect((await auto.sendDueReviewEmails(new Date(quiet))).status).toBe(
        "quiet",
      );
    }
    expect(send).not.toHaveBeenCalled();

    // 09:00 in Tirana.
    expect(
      (await auto.sendDueReviewEmails(new Date("2026-07-02T07:00:00Z"))).sent,
    ).toBe(1);
  });

  it("counts the day in Tirana, not in UTC", async () => {
    await visit({ from: "2026-07-01", to: "2026-07-02" });
    // Still 2 July in Tirana at 19:30, so the visit has not ended yet.
    expect(
      (await auto.sendDueReviewEmails(new Date("2026-07-02T17:30:00Z"))).sent,
    ).toBe(0);
    expect(
      (await auto.sendDueReviewEmails(new Date("2026-07-03T07:30:00Z"))).sent,
    ).toBe(1);
  });

  it("leaves alone every booking that is not due", async () => {
    await visit({ email: "today@example.com", from: "2026-07-02" });
    await visit({ email: "old@example.com", from: "2026-06-24" });
    await visit({ email: "new@example.com" }, false);
    const cancelled = await visit({ email: "cancelled@example.com" });
    await db.updateBookingStatus(cancelled.id, "cancelled");
    await visit({ email: undefined });

    expect(await auto.sendDueReviewEmails(NOON)).toEqual({
      status: "ran",
      sent: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("still reaches a visit that ended a week ago, the edge of the window", async () => {
    await visit({ from: "2026-06-25" });
    expect((await auto.sendDueReviewEmails(NOON)).sent).toBe(1);
  });

  it("asks a person once, however many bookings they have", async () => {
    const first = await visit({ email: "ada@example.com" });
    const second = await visit({ email: "ADA@example.com " });

    expect((await auto.sendDueReviewEmails(NOON)).sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    // One guest, one stamp: both bookings show the single email that went out.
    expect((await stored(first.id))?.reviewEmailedAt).toBe(NOON.toISOString());
    expect((await stored(second.id))?.reviewEmailedAt).toBe(NOON.toISOString());

    // A later visit by the same person is not followed up either.
    await visit({ email: "ada@example.com", from: "2026-07-05" });
    expect(
      (await auto.sendDueReviewEmails(new Date("2026-07-06T10:00:00Z"))).sent,
    ).toBe(0);
  });

  it("skips a guest the owner already asked from the dashboard", async () => {
    const b = await visit();
    await db.setReviewAsked(b.id, true);
    expect((await auto.sendDueReviewEmails(NOON)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("releases a booking Resend rejected and retries it on the next run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = await visit();
    send.mockResolvedValueOnce({
      data: null,
      error: { name: "rate_limit_exceeded", message: "slow down" },
    });

    expect(await auto.sendDueReviewEmails(NOON)).toEqual({
      status: "ran",
      sent: 0,
      failed: 1,
    });
    const row = await stored(b.id);
    expect(row?.reviewAskedAt).toBeUndefined();
    expect(row?.reviewEmailedAt).toBeUndefined();

    expect((await auto.sendDueReviewEmails(NOON)).sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("treats a thrown send the same way and carries on with the next guest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await visit({ email: "ada@example.com" });
    const second = await visit({ email: "grace@example.com" });
    send.mockRejectedValueOnce(new Error("network down"));

    expect(await auto.sendDueReviewEmails(NOON)).toEqual({
      status: "ran",
      sent: 1,
      failed: 1,
    });
    expect((await stored(first.id))?.reviewEmailedAt).toBeUndefined();
    expect((await stored(second.id))?.reviewEmailedAt).toBeTruthy();
    error.mockRestore();
  });

  it("shares one run between overlapping calls", async () => {
    await visit();
    const [a, b] = await Promise.all([
      auto.sendDueReviewEmails(NOON),
      auto.sendDueReviewEmails(NOON),
    ]);
    expect(a).toBe(b);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("undoing the marker after an automatic email", () => {
  it("clears the dashboard marker through the API but never emails again", async () => {
    const b = await visit();
    await auto.sendDueReviewEmails(NOON);

    const route = await import("@/app/api/bookings/[id]/route");
    const res = await route.PATCH(
      makeRequest(`/api/bookings/${b.id}`, {
        method: "PATCH",
        body: { reviewAsked: false },
        token: sessionToken(),
      }),
      params({ id: b.id }),
    );
    expect(res.status).toBe(200);
    const { booking } = await res.json();
    expect(booking.reviewAskedAt).toBeUndefined();
    expect(booking.reviewEmailedAt).toBe(NOON.toISOString());

    expect(
      (await auto.sendDueReviewEmails(new Date("2026-07-03T10:00:00Z"))).sent,
    ).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("server start (instrumentation)", () => {
  const register = async () => (await import("@/instrumentation")).register();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOON);
  });

  it("checks for due guests as soon as the Node server starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await visit();
    await register();
    // The check runs in the background; joining it waits for it to finish.
    await auto.sendDueReviewEmails();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("checks again every hour for as long as the server stays up", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    await auto.sendDueReviewEmails();
    expect(send).not.toHaveBeenCalled();

    await visit();
    vi.advanceTimersByTime(60 * 60 * 1000);
    await auto.sendDueReviewEmails();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing in any other runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await visit();
    await register();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(send).not.toHaveBeenCalled();
  });
});
