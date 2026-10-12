// Telegram's sendMessage, stubbed so no request ever leaves the process.
import { vi } from "vitest";
import { BOT_CHAT, BOT_TOKEN } from "./fixtures";

export const SEND_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

type FetchMock = ReturnType<typeof vi.fn>;

/** Stub global fetch to answer every call with `reply` as its JSON body. */
export function stubFetch(reply: unknown = { ok: true }): FetchMock {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ json: () => Promise.resolve(reply) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Switch the alert on and stub Telegram's answer. Undo with vi.unstubAll*. */
export function stubTelegram(reply: unknown = { ok: true }): FetchMock {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  vi.stubEnv("TELEGRAM_CHAT_ID", BOT_CHAT);
  return stubFetch(reply);
}

/** The JSON body of a sendMessage call, as Telegram would have received it. */
export function sentMessage(
  fetchMock: FetchMock,
  call: number = 0,
): {
  chat_id: string;
  text: string;
  link_preview_options: { is_disabled: boolean };
} {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}
