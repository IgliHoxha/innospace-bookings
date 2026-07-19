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
