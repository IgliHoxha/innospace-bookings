import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "../helpers/app";

// Resend is stubbed at the class level, so the real mailer runs up to the send.
const send = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

type Db = Awaited<ReturnType<typeof loadDb>>;
type Actions = typeof import("@/lib/booking-actions");
let db: Db;
let actions: Actions;

beforeEach(async () => {
  db = await loadDb();
  actions = await import("@/lib/booking-actions");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const seed = (email: string | undefined = "ada@example.com") =>
  db.createBooking({ fullName: "Ada", email, plan: "daily-pass" });

describe("changeBookingStatus", () => {
  it.each(["confirmed", "cancelled"] as const)(
    "stores %s and emails the guest",
    async (status) => {
      const b = await seed();
      const changed = await actions.changeBookingStatus(b.id, status);
      expect(changed?.booking).toEqual({ ...b, status });
      expect(changed?.emailed).toBe(true);
      expect((await db.getBooking(b.id))?.status).toBe(status);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].to).toEqual(["ada@example.com"]);
    },
  );

  it.each(["deleted", "new"] as const)(
    "stores %s without emailing anyone",
    async (status) => {
      const b = await seed();
      await db.updateBookingStatus(b.id, "confirmed");
      const changed = await actions.changeBookingStatus(b.id, status);
      expect(changed?.booking.status).toBe(status);
      expect(changed?.emailed).toBe(false);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("sends an edited body in place of the template", async () => {
    const b = await seed();
    await actions.changeBookingStatus(b.id, "confirmed", "See you at nine.");
    expect(send.mock.calls[0][0].html).toContain("See you at nine.");
  });

  it("returns null for a missing booking and emails nobody", async () => {
    await seed();
    expect(await actions.changeBookingStatus("ghost", "confirmed")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the change and reports no email for a booking with no address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = await db.createBooking({ fullName: "Walk In" });
    const changed = await actions.changeBookingStatus(b.id, "confirmed");
    expect(changed?.emailed).toBe(false);
    expect((await db.getBooking(b.id))?.status).toBe("confirmed");
  });

  it("keeps the change and reports no email while email is switched off", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "");
    const b = await seed();
    const changed = await actions.changeBookingStatus(b.id, "cancelled");
    expect(changed?.emailed).toBe(false);
    expect((await db.getBooking(b.id))?.status).toBe("cancelled");
  });

  it("keeps the change when Resend rejects the email or the send throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = await seed();

    send.mockResolvedValueOnce({ data: null, error: { message: "bounced" } });
    const rejected = await actions.changeBookingStatus(b.id, "confirmed");
    expect(rejected?.emailed).toBe(false);

    send.mockRejectedValueOnce(new Error("network down"));
    const thrown = await actions.changeBookingStatus(b.id, "cancelled");
    expect(thrown?.emailed).toBe(false);
    expect((await db.getBooking(b.id))?.status).toBe("cancelled");
    expect(log).toHaveBeenCalledTimes(2);
  });
});
