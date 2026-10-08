import { NextRequest, NextResponse } from "next/server";
import { setReviewAsked, updateBookingStatus } from "@/lib/db";
import { sendCustomerStatusEmail } from "@/lib/email";
import { requireSession } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { BOOKING_STATUSES, type BookingStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Protected: update a booking's status, or its review-asked marker, from the dashboard. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const denied = requireSession(req);
  if (denied) return denied;

  const { id } = await params;
  const { status, emailBody, reviewAsked } = (await req
    .json()
    .catch(() => ({}))) as {
    status?: BookingStatus;
    emailBody?: string;
    reviewAsked?: unknown;
  };

  // The review marker is its own update: it never changes status or sends email.
  if (status === undefined && reviewAsked !== undefined) {
    if (typeof reviewAsked !== "boolean") {
      return jsonError("Invalid reviewAsked.", 400);
    }
    const marked = await setReviewAsked(id, reviewAsked);
    if (!marked) return jsonError("Not found.", 404);
    return NextResponse.json({ ok: true, booking: marked });
  }

  if (!status || !BOOKING_STATUSES.includes(status)) {
    return jsonError("Invalid status.", 400);
  }

  const booking = await updateBookingStatus(id, status);
  if (!booking) return jsonError("Not found.", 404);

  // Notify the customer on confirm/cancel. Never block the response on email.
  if (status === "confirmed" || status === "cancelled") {
    try {
      await sendCustomerStatusEmail(
        booking,
        status,
        typeof emailBody === "string" ? emailBody : undefined,
      );
    } catch (err) {
      console.error("[bookings] customer status email failed:", err);
    }
  }

  return NextResponse.json({ ok: true, booking });
}
