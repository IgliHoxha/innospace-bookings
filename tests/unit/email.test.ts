import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Booking } from "@/lib/types";

// Resend is stubbed at the class level so no request ever leaves the process;
// `send` is shared across instances so the lazy singleton is still observable.
const send = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

type Email = typeof import("@/lib/email");
let email: Email;

const BOOKING: Booking = {
  id: "bk_1",
  fullName: "Ada",
  email: "ada@example.com",
  plan: "daily-pass",
  from: "2026-07-01",
  status: "new",
  createdAt: "2026-06-01T10:00:00.000Z",
};

async function sentHtml(): Promise<string> {
  await email.sendCustomerStatusEmail(BOOKING, "confirmed");
  return send.mock.calls[0][0].html as string;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  email = await import("@/lib/email");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("email logo", () => {
  it("points at logo.svg on the default app base URL", async () => {
    expect(await sentHtml()).toContain(
      '<img src="https://booking.innospacetirana.com/logo.svg"',
    );
  });

  it("uses APP_BASE_URL when set, without doubling the slash", async () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(await sentHtml()).toContain(
      'src="https://staging.example.com/logo.svg"',
    );
  });

  it("carries width/height attributes so CSS-stripping clients size it", async () => {
    const html = await sentHtml();
    expect(html).toContain('width="126" height="30"');
    expect(html).toContain("height:30px;width:126px");
  });

  it("falls back to the org name as alt text where SVG is blocked", async () => {
    vi.stubEnv("BUSINESS_NAME", "Innospace Tirana");
    expect(await sentHtml()).toContain('alt="Innospace Tirana"');
  });

  // The asset the email links to must exist and carry the black wordmark the
  // site uses; logo-white.svg is the white-background counterpart.
  it("ships logo.svg with a black wordmark and logo-white.svg with a white one", () => {
    const read = (name: string) =>
      readFileSync(join(process.cwd(), "public", name), "utf8");
    expect(read("logo.svg")).toContain(".cls-2{fill:#000;}");
    expect(read("logo-white.svg")).toContain(".cls-2{fill:#fff;}");
  });
});

describe("sendCustomerStatusEmail", () => {
  it("skips sending when RESEND_API_KEY is unset", async () => {
    vi.resetModules();
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/email");
    await mod.sendCustomerStatusEmail(BOOKING, "confirmed");
    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips a booking with no email address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await email.sendCustomerStatusEmail(
      { ...BOOKING, email: undefined },
      "cancelled",
    );
    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
