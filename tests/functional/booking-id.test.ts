import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, params, resetApp, sessionToken } from "../helpers/app";

vi.mock("@/lib/email", () => ({
  sendCustomerStatusEmail: vi.fn().mockResolvedValue(undefined),
}));

type Route = typeof import("@/app/api/bookings/[id]/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  email = await import("@/lib/email");
  route = await import("@/app/api/bookings/[id]/route");
});

const seed = () =>
  db.createBooking({
    fullName: "Ada",
    email: "ada@example.com",
    plan: "daily-pass",
    from: "2026-07-01",
  });

const patch = (id: string, body: unknown, tok?: string) =>
  route.PATCH(
    makeRequest(`/api/bookings/${id}`, { method: "PATCH", body, token: tok }),
    params({ id }),
  );

describe("PATCH /api/bookings/[id]", () => {
  it("401s without a session", async () => {
    const b = await seed();
    expect((await patch(b.id, { status: "confirmed" })).status).toBe(401);
  });

  it("400s an invalid status", async () => {
    const b = await seed();
    expect(
      (await patch(b.id, { status: "bogus" }, sessionToken())).status,
    ).toBe(400);
  });

  it("400s on a malformed JSON body", async () => {
    const res = await route.PATCH(
      makeRequest("/api/bookings/any", {
        method: "PATCH",
        rawBody: "{ not json",
        token: sessionToken(),
      }),
      params({ id: "any" }),
    );
    expect(res.status).toBe(400);
  });

  it("404s a missing booking", async () => {
    expect(
      (await patch("ghost", { status: "confirmed" }, sessionToken())).status,
    ).toBe(404);
  });

  it("confirms a booking and emails the customer a confirmation", async () => {
    const b = await seed();
    const res = await patch(b.id, { status: "confirmed" }, sessionToken());
    expect(res.status).toBe(200);
    expect((await res.json()).booking.status).toBe("confirmed");
    expect(vi.mocked(email.sendCustomerStatusEmail).mock.calls[0][1]).toBe(
      "confirmed",
    );
  });

  it("passes a dashboard-edited body through to the mailer", async () => {
    const b = await seed();
    await patch(
      b.id,
      { status: "cancelled", emailBody: "Custom copy" },
      sessionToken(),
    );
    const call = vi.mocked(email.sendCustomerStatusEmail).mock.calls[0];
    expect(call[1]).toBe("cancelled");
    expect(call[2]).toBe("Custom copy");
  });

  it("does not email on a non-notifying status change", async () => {
    const b = await seed();
    await patch(b.id, { status: "deleted" }, sessionToken());
    expect(email.sendCustomerStatusEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 if the customer email fails to send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(email.sendCustomerStatusEmail).mockRejectedValueOnce(
      new Error("smtp down"),
    );
    const b = await seed();
    const res = await patch(b.id, { status: "confirmed" }, sessionToken());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/bookings/[id] review marker", () => {
  it("401s without a session and stores nothing", async () => {
    const b = await seed();
    expect((await patch(b.id, { reviewAsked: true })).status).toBe(401);
    expect((await db.listBookings())[0].reviewAskedAt).toBeUndefined();
  });

  it("marks a booking as asked without touching its status or emailing", async () => {
    const b = await seed();
    await db.updateBookingStatus(b.id, "confirmed");
    const res = await patch(b.id, { reviewAsked: true }, sessionToken());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.booking.status).toBe("confirmed");
    expect(Number.isNaN(Date.parse(json.booking.reviewAskedAt))).toBe(false);
    expect((await db.listBookings())[0].reviewAskedAt).toBe(
      json.booking.reviewAskedAt,
    );
    expect(email.sendCustomerStatusEmail).not.toHaveBeenCalled();
  });

  it("clears the marker", async () => {
    const b = await seed();
    await patch(b.id, { reviewAsked: true }, sessionToken());
    const res = await patch(b.id, { reviewAsked: false }, sessionToken());
    expect(res.status).toBe(200);
    expect((await res.json()).booking.reviewAskedAt).toBeUndefined();
    expect((await db.listBookings())[0].reviewAskedAt).toBeUndefined();
  });

  it("400s a marker that is not a boolean", async () => {
    const b = await seed();
    for (const reviewAsked of ["yes", 1, null]) {
      const res = await patch(b.id, { reviewAsked }, sessionToken());
      expect(res.status).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect((await db.listBookings())[0].reviewAskedAt).toBeUndefined();
  });

  it("404s a missing booking", async () => {
    expect(
      (await patch("ghost", { reviewAsked: true }, sessionToken())).status,
    ).toBe(404);
  });

  it("leaves the marker alone when a status is sent with it", async () => {
    const b = await seed();
    const res = await patch(
      b.id,
      { status: "confirmed", reviewAsked: true },
      sessionToken(),
    );
    expect(res.status).toBe(200);
    const { booking } = await res.json();
    expect(booking.status).toBe("confirmed");
    expect(booking.reviewAskedAt).toBeUndefined();
    expect(email.sendCustomerStatusEmail).toHaveBeenCalledTimes(1);
  });
});
