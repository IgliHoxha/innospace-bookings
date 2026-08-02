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
function logoLockup(org: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;padding-right:11px"><img src="${emailLogoUrl()}" alt="${org}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" style="width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;display:block" /></td>
            <td style="vertical-align:middle;font-family:${FONT_STACK}">
              <div style="font-size:23px;line-height:1;letter-spacing:-0.3px;color:${INK}"><span style="font-weight:700">inno</span><span style="font-weight:400">space</span></div>
              <div style="font-size:9px;line-height:1;letter-spacing:2.1px;padding-top:4px;color:${BRAND}">TIRANA</div>
            </td>
          </tr>
        </table>`;
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

// Plain-text body -> safe HTML: escape, keep line breaks, linkify URLs.
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = escapeHtml(para)
        .replace(/\n/g, "<br/>")
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          `<a href="$1" style="color:${BRAND}">$1</a>`,
        );
      return `<p style="margin:0 0 14px;color:${INK};font-size:14px;line-height:1.6">${safe}</p>`;
    })
    .join("");
}

function shell(opts: {
  accent: string;
  heading: string;
  bodyHtml: string;
  contact: ContactInfo;
}): string {
  const { accent, heading, bodyHtml, contact } = opts;
  // Footer website link; visible text drops the scheme and any trailing slash.
  const website = contact.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `
  <div style="background:#f4f6f8;padding:28px 12px;font-family:${FONT_STACK}">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="padding:22px 28px;border-bottom:1px solid #eee">
        ${logoLockup(contact.org)}
      </div>
      <div style="height:4px;background:${accent}"></div>
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;color:${accent};font-size:22px">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;color:#a59ba5;font-size:12px">
        ${contact.org} · <a href="${contact.url}" style="color:${BRAND};text-decoration:none">${website}</a>
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
    }),
  });
}
