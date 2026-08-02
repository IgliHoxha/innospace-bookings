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
      '<img src="https://booking.innospacetirana.com/logo-mark.svg?v=6"',
    );
    // Gmail caches per source URL, so the version must survive any edit here.
    expect(html).not.toContain('/logo.svg"');
  });

  it("uses APP_BASE_URL when set, without doubling the slash", async () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(await sentHtml()).toContain(
      'src="https://staging.example.com/logo-mark.svg?v=6"',
    );
  });

  it("carries width/height attributes so CSS-stripping clients size it", async () => {
    const html = await sentHtml();
    expect(html).toContain('width="34" height="32"');
    expect(html).toContain("width:34px;height:32px");
  });

  it("falls back to the org name as alt text where the image is blocked", async () => {
    vi.stubEnv("BUSINESS_NAME", "Innospace Tirana");
    expect(await sentHtml()).toContain('alt="Innospace Tirana"');
  });

  // Gmail can recolour HTML but never the inside of an image, so the mark is the
  // only part shipped as artwork: teal, which reads on either background.
  it("ships a teal-only mark asset with no wordmark and no media query", () => {
    const svg = readFileSync(
      join(process.cwd(), "public", "logo-mark.svg"),
      "utf8",
    );
    expect(svg).toContain(".cls-1{fill:#25bdad;}");
    expect(svg).not.toContain("cls-2");
    expect(svg).not.toContain("prefers-color-scheme");
  });

  // The point of the whole exercise: the wordmark is HTML text inked neutral, so
  // a dark-mode client inverts it to white exactly as it does the body copy.
  // A <table> here made Gmail cut the bordered card container in two, rendering
  // the header as a detached box above a "show trimmed content" expander. Keep
  // the header markup flat: inline spans only.
  it("builds the header without a table, so the card is not split", async () => {
    const html = await sentHtml();
    expect(html).not.toContain("<table");
    expect(html).toContain("display:inline-block;vertical-align:middle");
  });

  it("renders the wordmark as HTML text in neutral ink, not as artwork", async () => {
    const html = await sentHtml();
    expect(html).toContain('<span style="font-weight:700">inno</span>');
    expect(html).toContain('<span style="font-weight:400">space</span>');
    expect(html).toContain("color:#000000");
    expect(html).toContain(">TIRANA<");
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

describe("linkified body", () => {
  it("links a bare email address in the brand colour, not Gmail's blue", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "Email: info@innospacetirana.com",
    );
    expect(htmlOf()).toContain(
      '<a href="mailto:info@innospacetirana.com" style="color:#25bdad">info@innospacetirana.com</a>',
    );
  });

  it("gives URLs and addresses the same colour", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "See https://maps.google.com/?q=x or mail info@innospacetirana.com",
    );
    const html = htmlOf();
    const colours = [
      ...html.matchAll(/<a href="[^"]*" style="color:(#[0-9a-f]{6})"/g),
    ].map((m) => m[1]);
    expect(colours.length).toBe(2);
    expect(new Set(colours).size).toBe(1);
  });

  it("leaves trailing sentence punctuation outside the link", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "Write to info@innospacetirana.com.",
    );
    expect(htmlOf()).toContain(">info@innospacetirana.com</a>.");
  });

  it("links a phone number as tel: in the brand colour, not the client's blue", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "Phone: +355 69 219 2666",
    );
    expect(htmlOf()).toContain(
      '<a href="tel:+355692192666" style="color:#25bdad">+355 69 219 2666</a>',
    );
  });

  it("leaves years, prices and street numbers alone", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "15 EUR per day on 4 August 2026 at Nd 10, H 5, Apt 1",
    );
    expect(htmlOf()).not.toContain("tel:");
  });

  it("does not mistake the + separators in a maps URL for a phone number", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "https://maps.google.com/?q=Rr.+Pjeter+Bogdani+Tirana",
    );
    const html = htmlOf();
    expect(html).not.toContain("tel:");
    expect(html).toContain(
      'href="https://maps.google.com/?q=Rr.+Pjeter+Bogdani+Tirana"',
    );
  });

  it("treats a URL containing an @ as one URL, not a stray address", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "Open https://example.com/p?e=a@b.com now",
    );
    const html = htmlOf();
    expect(html).toContain('href="https://example.com/p?e=a@b.com"');
    expect(html).not.toContain("mailto:");
  });
});
