import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "../helpers/app";
import { sentMessage, stubTelegram } from "../helpers/telegram";

type Db = Awaited<ReturnType<typeof loadDb>>;
type Telegram = typeof import("@/lib/telegram");
let db: Db;
let telegram: Telegram;

beforeEach(async () => {
  db = await loadDb();
  telegram = await import("@/lib/telegram");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The alert is handed the row createBooking returns, whose address is joined in
// from the guests table rather than stored on the booking.
describe("the alert for a stored booking", () => {
  it("reports the booking exactly as the database returns it", async () => {
    const fetchMock = stubTelegram();
    const booking = await db.createBooking({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phoneNumber: "+355 69 123 4567",
      plan: "monthly-pass",
      from: "2026-11-02",
      to: "2026-12-01",
      note: "Window desk",
    });

    expect(await telegram.notifyNewBooking(booking)).toBe(true);
    expect(sentMessage(fetchMock).text.split("\n")).toEqual([
      "New booking",
      "",
      "Full name: Ada Lovelace",
      "Email: ada@example.com",
      "Phone: +355 69 123 4567",
      "Dates: 2 November - 1 December 2026",
      "Type: Monthly Pass",
      "Notes: Window desk",
      "",
      "https://booking.innospacetirana.com/dashboard",
    ]);
  });

  it("gives a returning guest's second request its own name and phone", async () => {
    const fetchMock = stubTelegram();
    await db.createBooking({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phoneNumber: "111",
    });
    const second = await db.createBooking({
      fullName: "A. King",
      email: "ADA@example.com",
      phoneNumber: "222",
    });

    await telegram.notifyNewBooking(second);
    const lines = sentMessage(fetchMock).text.split("\n");
    expect(lines).toContain("Full name: A. King");
    expect(lines).toContain("Phone: 222");
    expect(lines).not.toContain("Full name: Ada Lovelace");
    // One guest row holds the address, as first written.
    expect(lines).toContain("Email: ada@example.com");
  });

  it("reports a booking that has no address", async () => {
    const fetchMock = stubTelegram();
    const booking = await db.createBooking({ fullName: "Walk In" });

    expect(await telegram.notifyNewBooking(booking)).toBe(true);
    expect(sentMessage(fetchMock).text.split("\n").slice(0, 4)).toEqual([
      "New booking",
      "",
      "Full name: Walk In",
      "",
    ]);
  });

  it("leaves the stored booking untouched when Telegram refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Forbidden: bot was blocked" });
    const booking = await db.createBooking({
      fullName: "Ada",
      email: "ada@example.com",
    });

    expect(await telegram.notifyNewBooking(booking)).toBe(false);
    const [stored] = (await db.queryBookings()).bookings;
    expect(stored).toEqual(booking);
    expect(stored.status).toBe("new");
  });
});
