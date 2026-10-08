import { useState } from "react";
import { emailBodyText, emailSubject, type EmailStatus } from "@/lib/templates";
import type { Booking, ContactInfo, Pricing } from "@/lib/types";

/** One booking's edited email bodies, by the status that would send them. */
export type EmailDrafts = Partial<Record<EmailStatus, string>>;

/** Per-row, editable email body with Confirm / Cancel tabs. */
export default function EmailPreview({
  booking,
  drafts,
  pricing,
  contact,
  onChange,
}: {
  booking: Booking;
  drafts: EmailDrafts;
  pricing: Pricing;
  contact: ContactInfo;
  onChange: (status: EmailStatus, value: string) => void;
}) {
  const [tab, setTab] = useState<EmailStatus>("confirmed");

  // Deleted bookings have no associated email.
  if (booking.status === "deleted") {
    return <span className="muted">-</span>;
  }

  // Once actioned, the email is locked - show only the one that was sent.
  if (booking.status !== "new") {
    const sent = booking.status as EmailStatus;
    const value =
      drafts[sent] ?? emailBodyText(booking, sent, pricing, contact);
    return (
      <div className="email-preview">
        <div className={`email-sent ${sent}`}>
          {sent === "confirmed" ? "Confirmation sent" : "Cancellation sent"}
        </div>
        <div className="email-subject">
          Subject: {emailSubject(sent, booking)}
        </div>
        <textarea
          id={`email-${booking.id}-${sent}`}
          name={`email-${booking.id}-${sent}`}
          className="email-text"
          rows={7}
          value={value}
          readOnly
          aria-label={`${sent} email body (sent)`}
        />
      </div>
    );
  }

  const value = drafts[tab] ?? emailBodyText(booking, tab, pricing, contact);
  return (
    <div className="email-preview">
      <div className="email-tabs">
        <button
          type="button"
          className={`email-tab ${tab === "confirmed" ? "active" : ""}`}
          onClick={() => setTab("confirmed")}
        >
          Confirm
        </button>
        <button
          type="button"
          className={`email-tab ${tab === "cancelled" ? "active cancel" : ""}`}
          onClick={() => setTab("cancelled")}
        >
          Cancel
        </button>
      </div>
      <div className="email-subject">Subject: {emailSubject(tab, booking)}</div>
      <textarea
        id={`email-${booking.id}-${tab}`}
        name={`email-${booking.id}-${tab}`}
        className="email-text"
        rows={7}
        value={value}
        onChange={(e) => onChange(tab, e.target.value)}
        aria-label={`${tab} email body`}
      />
    </div>
  );
}
