/**
 * Cloudflare Turnstile server-side verification.
 *
 * Feature-flagged by TURNSTILE_SECRET_KEY: while the secret is unset, verification
 * is skipped entirely (returns { ok: true, skipped: true }) so the booking flow
 * works unchanged until you provision keys. Once the secret is set, a missing or
 * invalid token is rejected - so deploy the widget (website site key) at the same
 * time you set this secret.
 */
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  ok: boolean;
  skipped?: boolean;
  errors?: string[];
};

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true, skipped: true };

  if (!token) return { ok: false, errors: ["missing-input-response"] };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    return { ok: !!data.success, errors: data["error-codes"] };
  } catch (err) {
    console.error("[turnstile] verify request failed:", err);
    return { ok: false, errors: ["verify-request-failed"] };
  }
}
