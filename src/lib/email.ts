import { Resend } from "resend";
import {
  appBaseUrl,
  getContactFromEnv,
  getPricingFromEnv,
  optionalEnv,
  requireEnv,
} from "./env-app";
import type { Booking, ContactInfo } from "./types";
import {
  emailBodyText,
  emailHeading,
  emailPreheader,
  emailSubject,
  type EmailStatus,
} from "./templates";

const BRAND = "#25bdad";
// Body copy is a neutral ink, not the brand plum. Clients that dark-mode invert
// flip lightness but keep hue, so a plum-tinted grey comes back pink; a
// zero-saturation grey comes back white. Saturated brand colours survive
// inversion untouched, which is why BRAND and RED stay as they are.
const INK = "#000000";
const RED = "#b91c1c";

// Gmail proxies every image through googleusercontent and rasterises SVG to PNG
// on its own servers (verified: the proxy responds content-type image/png). It
// can recolour HTML for dark mode but never the inside of an image, so a wordmark
// shipped as artwork is stuck on one fixed colour and loses either light or dark.
//
// So only the teal mark stays an image (teal reads on both backgrounds) and the
// wordmark is HTML text: a dark-mode client then inverts it exactly as it does
// the body copy, black on a white card and white on a dark shell.
//
// Served under APP_BASE_URL. In dev that's localhost (unfetchable by mail
// clients), but dev normally skips sending.
//
// The proxy caches per source URL, so an edit to the file alone never reaches a
// recipient already sent the old one. Bump this whenever the artwork changes.
const LOGO_VERSION = "6";

function emailLogoUrl(): string {
  return `${appBaseUrl().replace(/\/$/, "")}/logo-mark.svg?v=${LOGO_VERSION}`;
}

// logo-mark.svg is 329x308, so a 32px-tall render is 34px wide. Mail clients that
// ignore CSS need the width attribute or they reserve the full intrinsic size.
const MARK_HEIGHT = 32;
const MARK_WIDTH = 34;

const FONT_STACK =
  "'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif" as const;

// The wordmark text is the brand lockup, not the configurable BUSINESS_NAME, for
// the same reason the mark is fixed artwork: both are the logo.
//
// Built from inline spans rather than a table or nested divs. Gmail cut the card
// container in two at the table version of this, and the header sits inside a
// bordered, rounded wrapper that renders badly when split, so keep the markup
// here as flat as the plain <img> it replaced.
function logoLockup(org: string): string {
  return `<img src="${escapeHtml(emailLogoUrl())}" alt="${escapeHtml(org)}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" style="width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;vertical-align:middle;border:0" /><span style="display:inline-block;vertical-align:middle;padding-left:11px;font-family:${FONT_STACK}"><span style="display:block;font-size:23px;line-height:1;letter-spacing:-0.3px;color:${INK}"><span style="font-weight:700">inno</span><span style="font-weight:400">space</span></span><span style="display:block;font-size:9px;line-height:1;letter-spacing:2.1px;padding-top:4px;color:${BRAND}">TIRANA</span></span>`;
}

// Lazy singleton: one Resend client for the process, built on first send (not at
// import, so tests/dev with no key never construct it). RESEND_API_KEY is an
// optional feature-flag: unset skips email. A null isn't cached, so a later key works.
let _resend: Resend | null = null;
function client(): Resend | null {
  if (_resend) return _resend;
  const apiKey = optionalEnv("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set: skipping email.");
    return null;
  }
  _resend = new Resend(apiKey);
  return _resend;
}

function from(): string {
  return requireEnv("EMAIL_FROM");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// URLs, bare email addresses and international phone numbers, matched in one pass
// so the URL branch claims a URL carrying an "@" or a "+" rather than letting the
// later branches half-eat it. The address branch needs a word character after
// every dot and the phone branch must end on a digit, so trailing sentence
// punctuation stays outside the link. Phones require a leading "+" so years,
// prices and street numbers are never mistaken for one.
const LINKABLE =
  /(https?:\/\/[^\s<]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+\d[\d\s().-]{7,}\d)/g;

// Plain-text body -> safe HTML: escape, keep line breaks, linkify URLs, email
// addresses and phone numbers. The last two must be linked here rather than left
// bare: Gmail and iOS auto-link them and paint them their own default blue, which
// clashes with the brand-coloured URLs alongside.
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = escapeHtml(para)
        .replace(/\n/g, "<br/>")
        .replace(
          LINKABLE,
          (match, url?: string, mail?: string, phone?: string) => {
            const link = (href: string, label: string) =>
              `<a href="${href}" style="color:${BRAND}">${label}</a>`;
            if (url) return link(url, url);
            if (mail) return link(`mailto:${mail}`, mail);
            // tel: wants digits only; the visible text keeps its spacing.
            if (phone)
              return link(`tel:${phone.replace(/[^\d+]/g, "")}`, phone);
            return match;
          },
        );
      return `<p style="margin:0 0 14px;color:${INK};font-size:14px;line-height:1.6">${safe}</p>`;
    })
    .join("");
}

// Filler after the preheader text, for a client that would otherwise keep
// scraping the body and read on into the wordmark spans.
//
// Zero-width characters ONLY. The usual recipe for this pads with U+2007 FIGURE
// SPACE, which is a real space: Gmail rendered thirty of them as a thirty-space
// hole in the notification, between the preheader and the wordmark it failed to
// hide. A client that ignores these contributes nothing, which is why the
// preheader copy itself has to be long enough to fill the snippet on its own.
const PREHEADER_PAD = "&#847;&#65279;".repeat(60);

// The snippet a notification shows under the subject line. Hidden every way a
// mail client might respect, since only the snippet reader is meant to see it:
// Gmail honours display:none, others need the zeroed box, Outlook needs mso-hide.
function preheaderHtml(text: string): string {
  return `<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(text)}${PREHEADER_PAD}</div>`;
}

function shell(opts: {
  accent: string;
  heading: string;
  bodyHtml: string;
  contact: ContactInfo;
  preheader: string;
}): string {
  const { accent, heading, bodyHtml, contact, preheader } = opts;
  // Footer website link; visible text drops the scheme and any trailing slash.
  const website = contact.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // The header carries no border of its own: the accent rule directly below it
  // already closes it off, and two lines a pixel apart read as one furred edge
  // rather than as a deliberate divider.
  //
  // The rule zeroes its type as well as its height. An empty div still gets a
  // line box, and the client's own line-height then fattens what should be 2px.
  return `
  ${preheaderHtml(preheader)}
  <div style="background:#f4f6f8;padding:28px 12px;font-family:${FONT_STACK}">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="padding:22px 28px">
        ${logoLockup(contact.org)}
      </div>
      <div style="height:2px;line-height:2px;font-size:0;background:${accent}">&nbsp;</div>
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;color:${accent};font-size:22px">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;color:#a59ba5;font-size:12px">
        ${escapeHtml(contact.org)} · <a href="${escapeHtml(contact.url)}" style="color:${BRAND};text-decoration:none">${escapeHtml(website)}</a>
      </div>
    </div>
  </div>`;
}

// Customer confirm/cancel email; customBody (dashboard edit) overrides the template.
export async function sendCustomerStatusEmail(
  booking: Booking,
  status: EmailStatus,
  customBody?: string,
): Promise<void> {
  const resend = client();
  if (!resend) return;
  if (!booking.email) {
    console.warn("[email] booking has no email: skipping customer email.");
    return;
  }

  const contact = getContactFromEnv();
  const body = (
    customBody ?? emailBodyText(booking, status, getPricingFromEnv(), contact)
  ).trim();

  await resend.emails.send({
    from: from(),
    to: [booking.email],
    subject: emailSubject(status, booking),
    html: shell({
      accent: status === "confirmed" ? BRAND : RED,
      heading: emailHeading(status),
      bodyHtml: textToHtml(body),
      contact,
      // Built from the booking, never from `body`: an admin editing the copy in
      // the dashboard could otherwise open with anything, and the snippet is the
      // one line a recipient reads before deciding to open at all.
      preheader: emailPreheader(booking, status, contact),
    }),
  });
}
