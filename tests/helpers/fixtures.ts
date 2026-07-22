// Throwaway credentials for the tests. NOT real secrets: each only ever unlocks a
// per-test temp SQLite DB that is created and deleted inside the test. Every test
// credential lives here, referenced as a variable (never an inline
// `password: "..."` literal) and given an obvious "fixture-*" value, so secret
// scanners don't misread test data as a live key.

/**
 * Dashboard credentials (DASHBOARD_USERNAME / DASHBOARD_PASSWORD). There is no
 * code default any more, so tests/setup.ts stubs these as the baseline env.
 */
export const ADMIN_USER = "fixture-admin";
export const ADMIN_PASS = "fixture-admin-pass";

/** Dummy HMAC signing secrets (AUTH_SECRET); the two must differ. */
export const SIGNING = "fixture-signing-a";
export const SIGNING_ALT = "fixture-signing-b";
