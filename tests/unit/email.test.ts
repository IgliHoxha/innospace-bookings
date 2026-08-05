import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Booking } from "@/lib/types";
import { emailPreheader } from "@/lib/templates";
import { getContactFromEnv } from "@/lib/env-app";

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

// Gmail builds its snippet from the first text in the body, which used to be the
// wordmark spans and showed up in the inbox as "innospaceTIRANA".
describe("the preheader", () => {
  it("comes before the logo lockup, or the client scrapes the wordmark instead", async () => {
    const html = await sentHtml();
    expect(html.indexOf("Confirmed:")).toBeGreaterThan(-1);
    expect(html.indexOf("Confirmed:")).toBeLessThan(html.indexOf(">inno<"));
  });

  it("names the booking and the organisation", async () => {
    expect(await sentHtml()).toContain(
      "Confirmed: Day Pass for 1 July 2026 at Test Org.",
    );
  });

  it("is hidden every way a client might respect", async () => {
    const div =
      /<div style="display:none;[^"]*">/.exec(await sentHtml())?.[0] ?? "";
    for (const rule of [
      "display:none",
      "font-size:0",
      "line-height:0",
      "max-height:0",
      "max-width:0",
      "opacity:0",
      "overflow:hidden",
      "mso-hide:all",
    ]) {
      expect(div).toContain(rule);
    }
  });

  // Without the filler the client runs out of preheader and reads on into the
  // logo, showing the wordmark anyway.
  it("pads past the length a snippet reads", async () => {
    expect(await sentHtml()).toContain("&#847;&#65279;".repeat(60));
  });

  // The usual recipe pads with U+2007 FIGURE SPACE, a real space: Gmail drew
  // thirty of them as a thirty-space hole in the notification.
  it("pads with zero-width characters only, so it leaves no visible gap", async () => {
    const hidden =
      /<div style="display:none;[^"]*">([\s\S]*?)<\/div>/.exec(
        await sentHtml(),
      )?.[1] ?? "";
    expect(hidden).not.toContain("&#8199;");
    expect(hidden).not.toContain("&nbsp;");
    expect(hidden).not.toMatch(/\u2007|\u00a0/);
  });

  // The pad may count for nothing, so the copy has to fill the snippet alone.
  it("is long enough to fill a snippet without leaning on the pad", async () => {
    const text = emailPreheader(BOOKING, "confirmed", getContactFromEnv());
    expect(text.length).toBeGreaterThan(140);
    expect(
      emailPreheader(BOOKING, "cancelled", getContactFromEnv()).length,
    ).toBeGreaterThan(140);
  });

  it("describes a cancellation as cancelled, since its subject only says 'Update'", async () => {
    await email.sendCustomerStatusEmail(BOOKING, "cancelled");
    expect(htmlOf()).toContain("Cancelled: Day Pass for 1 July 2026");
  });

  // An admin can rewrite the body from the dashboard, so the snippet cannot be
  // taken from it: it would otherwise open with whatever they typed.
  it("ignores a custom body and keeps describing the booking", async () => {
    await email.sendCustomerStatusEmail(
      BOOKING,
      "confirmed",
      "<script>x</script> hi",
    );
    expect(htmlOf()).toContain("Confirmed: Day Pass");
  });

  // The org is env copy, so an angle bracket in it would close the hidden div
  // early and spill the rest of the preheader into the visible email.
  it("escapes the text it is given, so no markup can break out of the hidden div", async () => {
    vi.stubEnv("BUSINESS_NAME", "</div><b>Sale!</b>");
    const hidden =
      /<div style="display:none;[^"]*">([\s\S]*?)<\/div>/.exec(
        await sentHtml(),
      )?.[1] ?? "";
    expect(hidden).toContain("&lt;/div&gt;&lt;b&gt;Sale!&lt;/b&gt;");
    expect(hidden).not.toContain("<b>");
  });
});

// Env copy reaches the HTML verbatim, so a legitimate "&" or "<" in a business
// name must not become markup, and a quote must not break out of an attribute.
describe("escaping the env-supplied copy", () => {
  it("escapes the org in the footer and in the logo's alt text", async () => {
    vi.stubEnv("BUSINESS_NAME", 'Smith & Sons <"Tirana">');
    const html = await sentHtml();
    expect(html).toContain('alt="Smith &amp; Sons &lt;&quot;Tirana&quot;&gt;"');
    expect(html).toContain("Smith &amp; Sons &lt;&quot;Tirana&quot;&gt; · <a");
    expect(html).not.toContain("Smith & Sons");
  });

  // A quote in the URL would end the href and let the rest become attributes.
  it("escapes the website URL in both the href and the visible text", async () => {
    vi.stubEnv(
      "BUSINESS_WEBSITE_URL",
      'https://x.test/?a=1&b=2"onclick="evil()',
    );
    const html = await sentHtml();
    expect(html).toContain(
      'href="https://x.test/?a=1&amp;b=2&quot;onclick=&quot;evil()"',
    );
    expect(html).not.toContain('"onclick="evil()');
  });

  it("escapes the logo src, which carries the base URL from env", async () => {
    vi.stubEnv("APP_BASE_URL", 'https://x.test/"onerror="evil()');
    const html = await sentHtml();
    expect(html).toContain("&quot;onerror=&quot;evil()/logo-mark.svg");
    expect(html).not.toContain('"onerror="evil()');
  });

  it("leaves ordinary copy untouched", async () => {
    vi.stubEnv("BUSINESS_NAME", "Innospace Tirana");
    const html = await sentHtml();
    expect(html).toContain('alt="Innospace Tirana"');
    expect(html).not.toContain("&amp;");
  });
});

describe("the accent rule under the header", () => {
  it("is a 2px band in the status colour", async () => {
    expect(await sentHtml()).toContain(
      'style="height:2px;line-height:2px;font-size:0;background:#25bdad"',
    );
  });

  // An empty div still gets a line box, so a client's own line-height would
  // thicken what is meant to be a 2px hairline.
  it("pins its line-height and font-size so no client can fatten it", async () => {
    const rule =
      /<div style="height:2px;[^"]*">.*?<\/div>/.exec(await sentHtml())?.[0] ??
      "";
    expect(rule).toContain("line-height:2px");
    expect(rule).toContain("font-size:0");
    // Outlook drops a truly empty box, so the rule carries a space it cannot see.
    expect(rule).toContain("&nbsp;");
  });

  it("takes the colour of the status, so a cancellation reads red", async () => {
    await email.sendCustomerStatusEmail(BOOKING, "cancelled");
    expect(htmlOf()).toContain(
      "height:2px;line-height:2px;font-size:0;background:#b91c1c",
    );
  });

  // Two stacked lines a pixel apart read as one furred edge, and at 2px the grey
  // one shows through rather than sitting behind.
  it("is the only thing closing the header, which carries no border of its own", async () => {
    const html = await sentHtml();
    expect(html).toContain('<div style="padding:22px 28px">');
    expect(html).not.toContain("padding:22px 28px;border-bottom");
  });
});
