import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PASS, ADMIN_USER, SIGNING_ALT } from "../helpers/fixtures";
import {
  checkCredentials,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth";

afterEach(() => vi.unstubAllEnvs());

describe("session tokens", () => {
  it("round-trips a freshly minted token", () => {
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });

  it("rejects a missing, malformed, or non-numeric token", () => {
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("no-dot-here")).toBe(false);
    expect(verifySessionToken("abc.def")).toBe(false); // expiry is not an integer
  });

  it("rejects a tampered token (signature no longer matches)", () => {
    const tok = createSessionToken();
    const [exp, sig] = tok.split(".");
    expect(verifySessionToken(`${Number(exp) + 1}.${sig}`)).toBe(false);
  });

  it("rejects an expired token", () => {
    expect(verifySessionToken(createSessionToken(-10))).toBe(false);
  });

  it("is scoped by AUTH_SECRET (a token minted under a different secret fails)", () => {
    const tok = createSessionToken();
    vi.stubEnv("AUTH_SECRET", SIGNING_ALT);
    expect(verifySessionToken(tok)).toBe(false);
  });

  it("throws rather than signing with a fallback when AUTH_SECRET is unset", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => createSessionToken()).toThrow(/AUTH_SECRET/);
  });
});

describe("dashboard credentials", () => {
  it("matches the configured env credentials only", () => {
    expect(checkCredentials(ADMIN_USER, ADMIN_PASS)).toBe(true);
    expect(checkCredentials(ADMIN_USER, "wrong")).toBe(false);
    expect(checkCredentials("wrong", ADMIN_PASS)).toBe(false);
    expect(checkCredentials("", "")).toBe(false);
  });

  it("throws when the credentials are not configured (no built-in default)", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    expect(() => checkCredentials(ADMIN_USER, ADMIN_PASS)).toThrow(
      /DASHBOARD_PASSWORD/,
    );
  });
});
