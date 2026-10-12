// What the dashboard's Confirm, Cancel and Delete buttons do, kept in one place
// so a Telegram reply does exactly the same thing.
import { updateBookingStatus } from "./db";
import { sendCustomerStatusEmail } from "./email";
import type { Booking, BookingStatus } from "./types";

export interface StatusChange {
  booking: Booking;
  /** True only when a confirm/cancel email was accepted for delivery. */
  emailed: boolean;
}

/**
 * Set a booking's status and, on confirm or cancel, email the customer.
 * `emailBody` replaces the template. Null for a missing id.
 */
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
