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
const PLUM = "#524552";
const RED = "#b91c1c";

// Logo is an app asset (public/email-logo.png) served under APP_BASE_URL. In dev
// that's localhost (unfetchable by mail clients), but dev normally skips sending.
function emailLogoUrl(): string {
  return `${appBaseUrl().replace(/\/$/, "")}/email-logo.png`;
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
      return `<p style="margin:0 0 14px;color:${PLUM};font-size:14px;line-height:1.6">${safe}</p>`;
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
  <div style="background:#f4f6f8;padding:28px 12px;font-family:'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="padding:22px 28px;border-bottom:1px solid #eee">
        <img src="${emailLogoUrl()}" alt="${contact.org}" height="30" style="height:30px;width:auto;display:block" />
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
