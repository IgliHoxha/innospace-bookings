// Throwaway test credentials, NOT real secrets: each only unlocks a temp SQLite
// DB created and deleted inside the test. Kept here as "fixture-*" variables
// (never inline literals) so secret scanners don't read them as live keys.

/**
 * Dashboard credentials (DASHBOARD_USERNAME / DASHBOARD_PASSWORD). There is no
 * code default any more, so tests/setup.ts stubs these as the baseline env.
 */
export const ADMIN_USER = "fixture-admin";
export const ADMIN_PASS = "fixture-admin-pass";

/** Dummy HMAC signing secrets (AUTH_SECRET); the two must differ. */
export const SIGNING = "fixture-signing-a";
export const SIGNING_ALT = "fixture-signing-b";
