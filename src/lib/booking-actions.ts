// What the dashboard's Confirm, Cancel and Delete do, in one place so a Telegram reply does exactly the same.
import { updateBookingStatus } from "./db";
import { sendCustomerStatusEmail } from "./email";
import type { Booking, BookingStatus } from "./types";

export interface StatusChange {
  booking: Booking;
  /** True only when a confirm/cancel email was accepted for delivery. */
  emailed: boolean;
}

/** Sets the status and emails the customer on confirm or cancel; `emailBody` replaces the template. Null if missing. */
export async function changeBookingStatus(
  id: string,
  status: BookingStatus,
  emailBody?: string,
): Promise<StatusChange | null> {
  const booking = await updateBookingStatus(id, status);
  if (!booking) return null;

  // A failed email never undoes the change or fails the caller.
  let emailed = false;
  if (status === "confirmed" || status === "cancelled") {
    try {
      emailed = await sendCustomerStatusEmail(booking, status, emailBody);
    } catch (err) {
      console.error("[bookings] customer status email failed:", err);
    }
  }
  return { booking, emailed };
}
