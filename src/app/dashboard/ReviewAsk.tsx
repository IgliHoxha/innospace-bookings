import { useEffect, useState } from "react";
import { formatDateTime, todayYMD } from "@/lib/datetime";
import { reviewRequestLink } from "@/lib/review";
import type { Booking, ContactInfo } from "@/lib/types";

/**
 * A row's review request: the link that asks or, once asked, when that was and
 * a way to undo it. Client-only: "today" is the browser's date, not the server's.
 */
export default function ReviewAsk({
  booking,
  contact,
  onAsked,
}: {
  booking: Booking;
  contact: ContactInfo;
  onAsked: (asked: boolean) => void;
}) {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(todayYMD());
  }, [booking]);

  const link = today ? reviewRequestLink(booking, contact, today) : null;
  if (!link) return null;

  if (booking.reviewAskedAt) {
    const when = formatDateTime(booking.reviewAskedAt);
    // The automatic email stamps both fields at once; a click stamps only this one.
    const emailed = booking.reviewEmailedAt === booking.reviewAskedAt;
    const how = emailed ? "Review request emailed" : "Asked for a review";
    return (
      <div
        className="review-asked"
        title={when ? `${how} on ${when}` : undefined}
      >
        <span>
          ✓ {emailed ? "Emailed" : "Asked"} {when.split(" ")[0]}
        </span>
        {/* Opening the link is all the dashboard sees, so a slip needs a way back. */}
        <button
          type="button"
          className="review-undo"
          onClick={() => onAsked(false)}
        >
          Undo
        </button>
      </div>
    );
  }

  const label =
    link.channel === "whatsapp"
      ? "Ask for a Google review on WhatsApp"
      : "Ask for a Google review by email";
  return (
    <a
      className="review-ask"
      href={link.href}
      target={link.channel === "whatsapp" ? "_blank" : undefined}
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      onClick={() => onAsked(true)}
    >
      ★ Ask for review
    </a>
  );
}
