// Deterministic baseline env for every test file, then per-test cleanup. Tests override vars with vi.stubEnv.
import { afterEach, vi } from "vitest";
import { dropAfter, queueAfter } from "./helpers/after";
import { cleanupTmp } from "./helpers/app";
import { ADMIN_PASS, ADMIN_USER, SIGNING } from "./helpers/fixtures";

// Required vars have no code default, so the suite supplies a baseline that mirrors .env.example.
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

// Optional vars stay off for a deterministic suite. DATA_FILE is set per test by resetApp().
for (const key of [
  "RESEND_API_KEY",
  "EMAIL_REPLY_TO",
  "APP_BASE_URL",
  "TURNSTILE_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET",
  "ALLOWED_ORIGINS",
  "DATA_FILE",
  "PRICE_DAILY_PASS",
  "PRICE_WEEKLY_PASS",
  "PRICE_MONTHLY_PASS",
  "PRICE_DAILY_PASS_CURRENCY",
  "PRICE_WEEKLY_PASS_CURRENCY",
  "PRICE_MONTHLY_PASS_CURRENCY",
  "PRICE_INTERVIEW_ROOM",
  "PRICE_INTERVIEW_ROOM_CURRENCY",
  "PRICE_EVENT_ROOM_CURRENCY",
  "PRICE_EVENT_ROOM_HOUR",
  "PRICE_EVENT_ROOM_HALF_DAY",
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
  "BUSINESS_REVIEW_URL",
  "REVIEW_AUTO_EMAIL",
]) {
  delete process.env[key];
}

// after() throws outside a real request, so handlers queue their work and a test runs it with afterResponse().
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: queueAfter,
}));

// Mocks persist across vi.resetModules(), so clear call history each test (implementations survive a clear).
afterEach(() => {
  vi.clearAllMocks();
  dropAfter();
  cleanupTmp();
});
