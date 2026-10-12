import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { BOT_CHAT, WEBHOOK_SECRET } from "../helpers/fixtures";
import { SEND_URL, sentMessage, stubTelegram } from "../helpers/telegram";

type Route = typeof import("@/app/api/bookings/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/bookings/route");
  // Monday 12 October 2026, 10:30 in Tirana (08:30 UTC).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T08:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body: unknown, headers?: Record<string, string>) =>
  route.POST(makeRequest("/api/bookings", { method: "POST", body, headers }));

const good = { fullName: "Ada", email: "ada@example.com", plan: "daily-pass" };
const total = async () => (await db.queryBookings()).total;

describe("POST /api/bookings (Telegram alert)", () => {
  it("alerts the owner once with the booking it has just stored", async () => {
    const fetchMock = stubTelegram();
    const res = await post({
      ...good,
      phoneNumber: "+355 69 123 4567",
      plan: "event-room",
      from: "2026-10-13T11:00",
      to: "2026-10-13T14:00",
      note: "Need a projector",
    });
    expect(res.status).toBe(201);
    expect(await total()).toBe(1);
    const { id } = (await res.json()) as { id: string };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SEND_URL);
    const message = sentMessage(fetchMock);
    expect(message.chat_id).toBe(BOT_CHAT);
    expect(message.text.split("\n")).toEqual([
      "New booking",
      "",
      "Full name: Ada",
      "Email: ada@example.com",
      "Phone: +355 69 123 4567",
      "Dates: 13 October 2026, 11:00-14:00",
      "Type: Event Room",
      "Notes: Need a projector",
      "",
      `https://booking.innospacetirana.com/dashboard#${id}`,
    ]);
    expect(message.reply_markup).toBeUndefined();
  });

  it("invites a reply once the webhook secret is set", async () => {
    const fetchMock = stubTelegram();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    expect((await post(good)).status).toBe(201);
    const message = sentMessage(fetchMock);
    expect(message.text).toContain(
      "\n\nReply yes to confirm, no to cancel, or delete to delete it.\n\n",
    );
    expect(message.reply_markup?.force_reply).toBe(true);
  });

  it("names the default plan for a request that sent none", async () => {
    const fetchMock = stubTelegram();
    expect((await post({ fullName: "Ada" })).status).toBe(201);
    expect(sentMessage(fetchMock).text.split("\n").slice(0, 5)).toEqual([
      "New booking",
      "",
      "Full name: Ada",
      "Type: Day Pass",
      "",
    ]);
  });

  it("adds the notes line only for a guest who wrote one", async () => {
    const fetchMock = stubTelegram();
    await post(good);
    await post({ ...good, note: "Window desk" });
    expect(sentMessage(fetchMock, 0).text).not.toContain("Notes:");
    expect(sentMessage(fetchMock, 1).text).toContain("Notes: Window desk\n");
  });

  it("sends nothing while the bot is not configured", async () => {
    const fetchMock = stubTelegram();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await post(good)).status).toBe(201);
    expect(await total()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still 201s and stores the booking when Telegram refuses the alert", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Unauthorized" });
    const res = await post(good);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe((await db.queryBookings()).bookings[0].id);
  });

  it("still 201s and stores the booking when Telegram cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    const res = await post(good);
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
    expect(await total()).toBe(1);
  });

  it("does not alert for a honeypot submission", async () => {
    const fetchMock = stubTelegram();
    expect((await post({ ...good, company: "i-am-a-bot" })).status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not alert for a request it refuses", async () => {
    const fetchMock = stubTelegram();
    vi.stubEnv("ALLOWED_ORIGINS", "https://ok.com");

    const refused = [
      await post(good, { origin: "https://evil.com" }),
      await post({ plan: "daily-pass" }),
      await post({ ...good, plan: "platinum-pass" }),
      await post({ ...good, from: "2026-10-17", to: "2026-10-17" }),
      await route.POST(
        makeRequest("/api/bookings", { method: "POST", rawBody: "{ not json" }),
      ),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 400, 400, 400, 400]);

    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect((await post(good)).status).toBe(403);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await total()).toBe(0);
  });

  it("answers an alerted booking with the CORS headers", async () => {
    stubTelegram();
    const res = await post(good, { origin: "https://example.com" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });
});
