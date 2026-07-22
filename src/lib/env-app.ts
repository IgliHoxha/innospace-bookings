// Central env access. Required vars throw at read time if unset/blank (no silent
// defaults) and are read lazily so tests can vi.stubEnv them. Optional vars are
// feature flags (unset = feature off) or detail lines that are simply omitted.
import type { ContactInfo, Pricing } from "./types";

/** A required string env var. Throws if unset or blank. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/** A required integer env var. Throws if unset, blank, or not an integer. */
export function requireIntEnv(name: string): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(
      `Env var ${name} must be an integer, got: ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

/** An optional env var: undefined when unset or blank. */
export function optionalEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

// Public, non-secret URLs. Optional so a deploy without them still renders the
// email logo and footer link; set them to point at another environment.
const DEFAULT_APP_BASE_URL = "https://booking.innospacetirana.com";
const DEFAULT_WEBSITE_URL = "https://innospacetirana.com";

/** Base URL this app is served from, used for absolute links in emails. */
export function appBaseUrl(): string {
  return optionalEnv("APP_BASE_URL") ?? DEFAULT_APP_BASE_URL;
}

/** Server-only: PRICE_* are never exposed to the browser. */
export function getPricingFromEnv(): Pricing {
  return {
    currency: requireEnv("PRICE_CURRENCY"),
    plans: {
      "daily-pass": optionalEnv("PRICE_DAILY_PASS"),
      "weekly-pass": optionalEnv("PRICE_WEEKLY_PASS"),
      "monthly-pass": optionalEnv("PRICE_MONTHLY_PASS"),
    },
    eventRoom: {
      hour: optionalEnv("PRICE_EVENT_ROOM_HOUR"),
      day: optionalEnv("PRICE_EVENT_ROOM_DAY"),
    },
  };
}

/**
 * Business contact block for emails. Server-only: BUSINESS_* / EMAIL_SIGNOFF_NAME
 * are never exposed to the browser. Only the org name and website are required;
 * every other line is optional and omitted from the footer when unset.
 */
export function getContactFromEnv(): ContactInfo {
  return {
    org: requireEnv("BUSINESS_NAME"),
    url: optionalEnv("BUSINESS_WEBSITE_URL") ?? DEFAULT_WEBSITE_URL,
    name: optionalEnv("EMAIL_SIGNOFF_NAME"),
    address: optionalEnv("BUSINESS_ADDRESS"),
    accessApt1: optionalEnv("BUSINESS_ACCESS_APT1"),
    accessApt2: optionalEnv("BUSINESS_ACCESS_APT2"),
    mapsUrl: optionalEnv("BUSINESS_MAPS_URL"),
    phone: optionalEnv("BUSINESS_PHONE"),
    email: optionalEnv("BUSINESS_EMAIL"),
    nid: optionalEnv("BUSINESS_NID"),
  };
}
