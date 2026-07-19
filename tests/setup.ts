// Deterministic baseline env for every test file, then per-test temp-DB cleanup.
// Tests override individual vars with vi.stubEnv and restore them themselves.
import { afterEach, vi } from "vitest";
import { cleanupTmp } from "./helpers/app";
import { SIGNING } from "./helpers/fixtures";

// A fixed signing secret so minted session tokens verify inside the handlers.
process.env.AUTH_SECRET = SIGNING;

// Clear anything that would otherwise steer auth/email/turnstile/cors logic, so
// the suite runs against the documented code defaults regardless of the shell env.
for (const key of [
  "DASHBOARD_USERNAME",
  "DASHBOARD_PASSWORD",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
  "TURNSTILE_SECRET_KEY",
  "ALLOWED_ORIGINS",
  "DATA_FILE",
  "PRICE_CURRENCY",
  "PRICE_DAILY_PASS",
  "PRICE_WEEKLY_PASS",
  "PRICE_MONTHLY_PASS",
  "PRICE_EVENT_ROOM_HOUR",
  "PRICE_EVENT_ROOM_DAY",
]) {
  delete process.env[key];
}

// Mocks persist across vi.resetModules(), so clear call history each test (the
// mockResolvedValue implementations set in vi.mock factories survive a clear).
afterEach(() => {
  vi.clearAllMocks();
  cleanupTmp();
});
