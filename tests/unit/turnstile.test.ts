import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stub global fetch to return a Turnstile siteverify payload. */
function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve(payload) }),
  );
}

describe("verifyTurnstile", () => {
  it("is skipped (and reports it) while the secret is unset", async () => {
    expect(await verifyTurnstile("any-token")).toEqual({
      ok: true,
      skipped: true,
    });
  });

  it("rejects a missing token once the secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(await verifyTurnstile(undefined)).toEqual({
      ok: false,
      errors: ["missing-input-response"],
    });
  });

  it("passes a token to siteverify and returns its verdict", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    stubFetch({ success: true });
    expect(await verifyTurnstile("good-token", "1.2.3.4")).toEqual({
      ok: true,
      errors: undefined,
    });
  });

  it("surfaces siteverify error codes on failure", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    stubFetch({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("bad-token")).toEqual({
      ok: false,
      errors: ["invalid-input-response"],
    });
  });

  it("fails closed if the siteverify request throws", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    expect(await verifyTurnstile("good-token")).toEqual({
      ok: false,
      errors: ["verify-request-failed"],
    });
  });
});
