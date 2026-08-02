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

const htmlOf = (call: number = 0) => send.mock.calls[call][0].html as string;

async function sentHtml(): Promise<string> {
  await email.sendCustomerStatusEmail(BOOKING, "confirmed");
  return htmlOf();
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
  it("points at the versioned email asset, not the site logo", async () => {
    const html = await sentHtml();
    expect(html).toContain(
      '<img src="https://booking.innospacetirana.com/logo-email.svg?v=3"',
    );
    // Gmail caches per source URL, so the version must survive any edit here.
    expect(html).not.toContain('/logo.svg"');
  });

  it("uses APP_BASE_URL when set, without doubling the slash", async () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(await sentHtml()).toContain(
      'src="https://staging.example.com/logo-email.svg?v=3"',
    );
  });

  it("carries width/height attributes so CSS-stripping clients size it", async () => {
    const html = await sentHtml();
    expect(html).toContain('width="133" height="40"');
    expect(html).toContain("height:40px;width:133px");
  });

  it("falls back to the org name as alt text where the image is blocked", async () => {
    vi.stubEnv("BUSINESS_NAME", "Innospace Tirana");
    expect(await sentHtml()).toContain('alt="Innospace Tirana"');
  });

  // Gmail rasterises SVG to PNG on its own servers, so a prefers-color-scheme
  // rule resolves in Google's light context and arrives baked black. The email
  // asset must therefore carry an opaque panel and no media query at all: the
  // panel is pixels, which no client-side inversion can touch.
  it("ships an email asset with an opaque panel and no media query", () => {
    const svg = readFileSync(
      join(process.cwd(), "public", "logo-email.svg"),
      "utf8",
    );
    expect(svg).toContain(".bg{fill:#ffffff;}");
    expect(svg).toContain('<rect class="bg"');
    expect(svg).not.toContain("prefers-color-scheme");
    // A white panel demands a black wordmark, or it would be white on white.
    expect(svg).toContain(".cls-2{fill:#000;}");
  });

  // The site asset stays tight and transparent: no panel, no adaptive rule.
  it("keeps the site logo a plain black wordmark", () => {
    const svg = readFileSync(join(process.cwd(), "public", "logo.svg"), "utf8");
    expect(svg).toContain(".cls-2{fill:#000;}");
    expect(svg).not.toContain("prefers-color-scheme");
    expect(svg).not.toContain('class="bg"');
  });

  it("pins the site to a light colour scheme so native controls stay light", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    expect(css).toMatch(/color-scheme:\s*light/);
  });
});

describe("body copy colour", () => {
  // A mail client that dark-mode inverts keeps hue and flips lightness, so the
  // old plum ink (#524552) came back pink instead of white. Neutral ink only.
  it("inks paragraphs with a neutral black, never the brand plum", async () => {
    const html = await sentHtml();
    expect(html).toContain("color:#000000;font-size:14px");
    expect(html).not.toContain("#524552");
  });

  it("keeps the saturated brand colour on links, which inverts cleanly", async () => {
    await email.sendCustomerStatusEmail(
      { ...BOOKING, fullName: "Ada" },
      "confirmed",
      "See https://example.com for details",
    );
    expect(htmlOf()).toContain(
      '<a href="https://example.com" style="color:#25bdad"',
    );
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
