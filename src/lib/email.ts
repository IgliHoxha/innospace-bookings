import { Resend } from "resend";
import type { Booking } from "./types";
import {
  emailBodyText,
  emailHeading,
  emailSubject,
  getContactFromEnv,
  getPricingFromEnv,
  type EmailStatus,
} from "./templates";

const BRAND = "#25bdad";
const PLUM = "#524552";

function baseUrl(): string {
  return process.env.APP_BASE_URL || "https://booking.innospacetirana.com";
}

function client(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set - skipping email.");
    return null;
  }
  return new Resend(apiKey);
}

function from(): string {
  return process.env.EMAIL_FROM || "onboarding@resend.dev";
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
}): string {
  const { accent, heading, bodyHtml } = opts;
  return `
  <div style="background:#f4f6f8;padding:28px 12px;font-family:'IBM Plex Sans',system-ui,Segoe UI,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="padding:22px 28px;border-bottom:1px solid #eee">
        <img src="${baseUrl()}/email-logo.png" alt="Innospace Tirana" height="30" style="height:30px;width:auto;display:block" />
      </div>
      <div style="height:4px;background:${accent}"></div>
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;color:${accent};font-size:22px">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;color:#a59ba5;font-size:12px">
        Innospace Tirana · <a href="https://innospacetirana.com" style="color:${BRAND};text-decoration:none">innospacetirana.com</a>
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
    console.warn("[email] booking has no email - skipping customer email.");
    return;
  }

  const body = (
    customBody ??
    emailBodyText(booking, status, getPricingFromEnv(), getContactFromEnv())
  ).trim();

  await resend.emails.send({
    from: from(),
    to: [booking.email],
    subject: emailSubject(status, booking),
    html: shell({
      accent: status === "confirmed" ? BRAND : "#b91c1c",
      heading: emailHeading(status),
      bodyHtml: textToHtml(body),
    }),
  });
}
