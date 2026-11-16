// Throwaway test credentials, not real secrets. Named "fixture-*" so secret scanners don't read them as live keys.

/** Dashboard credentials; there is no code default, so tests/setup.ts sets them as the baseline env. */
export const ADMIN_USER = "fixture-admin";
export const ADMIN_PASS = "fixture-admin-pass";

/** Dummy HMAC signing secrets (AUTH_SECRET); the two must differ. */
export const SIGNING = "fixture-signing-a";
export const SIGNING_ALT = "fixture-signing-b";

/** Dummy Telegram bot token (TELEGRAM_BOT_TOKEN) and the chat it alerts. */
export const BOT_TOKEN = "fixture-bot-token";
export const BOT_CHAT = "-1001234";
/** Dummy secret the Telegram webhook is registered with (TELEGRAM_WEBHOOK_SECRET). */
export const WEBHOOK_SECRET = "fixture-webhook-secret";
