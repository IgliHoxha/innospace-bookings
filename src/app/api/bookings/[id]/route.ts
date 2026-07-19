import { NextRequest, NextResponse } from "next/server";
import { updateBookingStatus } from "@/lib/db";
import { sendCustomerStatusEmail } from "@/lib/email";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { BOOKING_STATUSES } from "@/lib/types";
import type { BookingStatus } from "@/lib/types";

export const runtime = "nodejs";

/** Protected: update a booking's status from the dashboard. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const { status, emailBody } = (await req.json().catch(() => ({}))) as {
    status?: BookingStatus;
    emailBody?: string;
  };

  if (!status || !BOOKING_STATUSES.includes(status)) {
    return NextResponse.json(
      { ok: false, error: "Invalid status." },
      { status: 400 },
    );
  }

  const booking = await updateBookingStatus(id, status);
  if (!booking) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }

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
