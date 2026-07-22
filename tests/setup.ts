// Deterministic baseline env for every test file, then per-test temp-DB cleanup.
// Tests override individual vars with vi.stubEnv and restore them themselves.
import { afterEach, vi } from "vitest";
import { cleanupTmp } from "./helpers/app";
import { ADMIN_PASS, ADMIN_USER, SIGNING } from "./helpers/fixtures";

// Required env vars have no code default (see lib/env-app), so the suite supplies
// a baseline. It mirrors .env.example, so value-dependent tests keep asserting
// the same numbers; individual tests still override with vi.stubEnv.
const REQUIRED_BASELINE: Record<string, string> = {
  AUTH_SECRET: SIGNING,
  DASHBOARD_USERNAME: ADMIN_USER,
  DASHBOARD_PASSWORD: ADMIN_PASS,
  LOGIN_MAX_ATTEMPTS: "5",
  LOGIN_BLOCK_SECONDS: "60",
  LOGIN_MAX_LOCKOUTS: "10",
  EMAIL_FROM: "onboarding@resend.dev",
  BUSINESS_NAME: "Test Org",
  PRICE_CURRENCY: "€",
};
for (const [key, value] of Object.entries(REQUIRED_BASELINE)) {
  process.env[key] = value;
}

// Optional vars stay OFF for a deterministic suite (email skipped, Turnstile
// skipped, CORS wildcard, contact footer minimal). DATA_FILE is set per-test by
// resetApp() to a temp file.
for (const key of [
  "RESEND_API_KEY",
  "APP_BASE_URL",
  "TURNSTILE_SECRET_KEY",
  "ALLOWED_ORIGINS",
  "DATA_FILE",
  "PRICE_DAILY_PASS",
  "PRICE_WEEKLY_PASS",
  "PRICE_MONTHLY_PASS",
  "PRICE_EVENT_ROOM_HOUR",
  "PRICE_EVENT_ROOM_DAY",
  "BUSINESS_WEBSITE_URL",
  "EMAIL_SIGNOFF_NAME",
  "BUSINESS_ADDRESS",
  "BUSINESS_ACCESS_APT1",
  "BUSINESS_ACCESS_APT2",
  "BUSINESS_MAPS_URL",
  "BUSINESS_PHONE",
  "BUSINESS_EMAIL",
  "BUSINESS_NID",
]) {
  delete process.env[key];
}

// Mocks persist across vi.resetModules(), so clear call history each test (the
// mockResolvedValue implementations set in vi.mock factories survive a clear).
afterEach(() => {
  vi.clearAllMocks();
  cleanupTmp();
});
