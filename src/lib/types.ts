// Single source of truth for booking statuses. The type, the API validators,
// and the DB CHECK constraint are all derived from this array.
export const BOOKING_STATUSES = [
  "new",
  "confirmed",
  "cancelled",
  "deleted",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Single source of truth for booking plans (the slugs the website sends).
export const BOOKING_PLANS = [
  "daily-pass",
  "weekly-pass",
  "monthly-pass",
  "event-room",
] as const;

export type BookingPlan = (typeof BOOKING_PLANS)[number];

/** The fields the website booking form posts. */
export interface BookingInput {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  /** One of BOOKING_PLANS, e.g. "daily-pass". */
  plan?: BookingPlan;
  from?: string;
  to?: string;
  note?: string;
}

export interface Booking extends BookingInput {
  id: string;
  createdAt: string;
  status: BookingStatus;
  source?: string;
}

/** Plan pricing shown in the confirmation email, built from PRICE_* (see env-app). */
export interface Pricing {
  currency: string;
  plans: Partial<Record<BookingPlan, string>>;
  // Event Room is billed by the hour (3h min) or by the day.
  eventRoom?: { hour?: string; day?: string };
}

/**
 * Business contact / access details for the email footer, built from BUSINESS_*
 * (see env-app). Only org + url are guaranteed; any unset field is omitted.
 */
export interface ContactInfo {
  org: string;
  url: string;
  /** Who signs off the confirmation. */
  name?: string;
  address?: string;
  accessApt1?: string;
  accessApt2?: string;
  mapsUrl?: string;
  phone?: string;
  email?: string;
  nid?: string;
}
