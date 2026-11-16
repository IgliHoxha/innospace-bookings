// Single source of truth for statuses. The DB's CHECK repeats them (migration 6), so a new status needs a migration.
export const BOOKING_STATUSES = [
  "new",
  "confirmed",
  "cancelled",
  "deleted",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// What the list can be narrowed to: one status, or "all" (everything not deleted).
export const BOOKING_FILTERS = ["all", ...BOOKING_STATUSES] as const;

export type BookingFilter = (typeof BOOKING_FILTERS)[number];

// Single source of truth for booking plans (the slugs the website sends). The route checks them; the DB does not.
export const BOOKING_PLANS = [
  "daily-pass",
  "weekly-pass",
  "monthly-pass",
  "event-room",
  "interview-room",
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
  /** When the guest was asked for a review (ISO timestamp), on any booking of theirs. */
  reviewAskedAt?: string;
  /** When the automatic review email went out; kept even if the marker above is undone. */
  reviewEmailedAt?: string;
}

/** Plan pricing shown in the confirmation email, built from PRICE_* (see env-app). */
export interface Pricing {
  currency: string;
  plans: Partial<Record<BookingPlan, string>>;
  // A pass priced in a currency of its own (the Day Pass is in lek); unset, `currency` applies.
  planCurrencies?: Partial<Record<BookingPlan, string>>;
  // Event Room is billed per hour (3h minimum), half day or day, optionally in its own currency.
  eventRoom?: {
    currency?: string;
    hour?: string;
    halfDay?: string;
    day?: string;
  };
}

/** Business contact details for the email footer, built from BUSINESS_* (see env-app). Only org and url are guaranteed. */
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
  /** Google review link the dashboard's review request points at; unset hides it. */
  reviewUrl?: string;
}
