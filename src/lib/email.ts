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
  REVIEW_EMAIL_HEADING,
  reviewEmailPreheader,
  reviewEmailSubject,
  reviewEmailText,
} from "./review";
import {
  emailBodyText,
  emailHeading,
  emailPreheader,
  emailSubject,
  type EmailStatus,
} from "./templates";

const BRAND = "#25bdad";
// Neutral ink, not brand plum: dark-mode inversion keeps hue, so a plum-tinted grey comes back pink.
const INK = "#000000";
const RED = "#b91c1c";

// Gmail's image proxy caches per URL, so bump this whenever logo-mark.svg changes.
const LOGO_VERSION = "6";

function emailLogoUrl(): string {
  return `${appBaseUrl()}/logo-mark.svg?v=${LOGO_VERSION}`;
}

// 329x308 artwork at 32px tall. Clients that ignore CSS need the width attribute or reserve the full size.
const MARK_HEIGHT = 32;
const MARK_WIDTH = 34;

const FONT_STACK =
  "'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif" as const;

// Mark as image, wordmark as HTML text so dark mode can invert it. Flat spans: Gmail split the table version.
function logoLockup(org: string): string {
  return `<img src="${escapeHtml(emailLogoUrl())}" alt="${escapeHtml(org)}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" style="width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;vertical-align:middle;border:0" /><span style="display:inline-block;vertical-align:middle;padding-left:11px;font-family:${FONT_STACK}"><span style="display:block;font-size:23px;line-height:1;letter-spacing:-0.3px;color:${INK}"><span style="font-weight:700">inno</span><span style="font-weight:400">space</span></span><span style="display:block;font-size:9px;line-height:1;letter-spacing:2.1px;padding-top:4px;color:${BRAND}">TIRANA</span></span>`;
}

// Lazy singleton, built on first send. No RESEND_API_KEY skips email; a null is not cached, so a later key works.
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// URL first so it claims a URL holding "@" or "+"; phones need a leading "+" so years and prices never match.
const LINKABLE =
  /(https?:\/\/[^\s<]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+\d[\d\s().-]{7,}\d)/g;

// Plain text to safe HTML. Addresses and phones are linked here, or Gmail and iOS paint them their own blue.
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

// Stops a client scraping past the preheader. Zero-width characters only: Gmail showed real spaces as a gap.
const PREHEADER_PAD = "&#847;&#65279;".repeat(60);

// The notification snippet, hidden every way a client may respect: display:none, a zeroed box, mso-hide.
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
  // No border under the header: the accent rule closes it. The rule zeroes its type, or line-height fattens its 2px.
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

/** Hands one email to Resend. `what` names it in the log. True only when accepted. */
async function deliver(
  resend: Resend,
  what: string,
  mail: { to: string; subject: string; html: string },
): Promise<boolean> {
  const { error } = await resend.emails.send({
    from: requireEnv("EMAIL_FROM"),
    to: [mail.to],
    // Where a reply lands instead of the sender; unset keeps the sender replyable.
    replyTo: optionalEnv("EMAIL_REPLY_TO"),
    subject: mail.subject,
    html: mail.html,
  });
  if (error) {
    console.error(`[email] ${what} was rejected:`, error.message);
    return false;
  }
  return true;
}

/** Customer confirm/cancel email; customBody (a dashboard edit) replaces the template. True only when accepted. */
export async function sendCustomerStatusEmail(
  booking: Booking,
  status: EmailStatus,
  customBody?: string,
): Promise<boolean> {
  const resend = client();
  if (!resend) return false;
  if (!booking.email) {
    console.warn("[email] booking has no email: skipping customer email.");
    return false;
  }

  const contact = getContactFromEnv();
  const body = (
    customBody ?? emailBodyText(booking, status, getPricingFromEnv(), contact)
  ).trim();

  return deliver(resend, "status email", {
    to: booking.email,
    subject: emailSubject(status, booking),
    html: shell({
      accent: status === "confirmed" ? BRAND : RED,
      heading: emailHeading(status),
      bodyHtml: textToHtml(body),
      contact,
      // Built from the booking, never from `body`: an edited body could open with anything.
      preheader: emailPreheader(booking, status, contact),
    }),
  });
}

/** The automatic post-visit review request. True only when Resend accepted it. */
export async function sendReviewRequestEmail(
  booking: Booking,
): Promise<boolean> {
  const contact = getContactFromEnv();
  const body = reviewEmailText(booking, contact);
  const to = booking.email?.trim();
  if (!body || !to) return false;

  const resend = client();
  if (!resend) return false;

  return deliver(resend, "review request", {
    to,
    subject: reviewEmailSubject(contact),
    html: shell({
      accent: BRAND,
      heading: REVIEW_EMAIL_HEADING,
      bodyHtml: textToHtml(body),
      contact,
      preheader: reviewEmailPreheader(contact),
    }),
  });
}
