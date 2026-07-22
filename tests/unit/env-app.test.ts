import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appBaseUrl,
  getContactFromEnv,
  getPricingFromEnv,
  optionalEnv,
  requireEnv,
  requireIntEnv,
} from "@/lib/env-app";

afterEach(() => vi.unstubAllEnvs());

describe("requireEnv", () => {
  it("returns the value when set", () => {
    vi.stubEnv("SOME_VAR", "hello");
    expect(requireEnv("SOME_VAR")).toBe("hello");
  });

  it("throws when unset or blank", () => {
    vi.stubEnv("SOME_VAR", "");
    expect(() => requireEnv("SOME_VAR")).toThrow(/SOME_VAR/);
    vi.stubEnv("SOME_VAR", "   ");
    expect(() => requireEnv("SOME_VAR")).toThrow(/SOME_VAR/);
  });
});

describe("requireIntEnv", () => {
  it("parses an integer", () => {
    vi.stubEnv("N", "42");
    expect(requireIntEnv("N")).toBe(42);
  });

  it("throws on a non-integer or missing value", () => {
    vi.stubEnv("N", "4.5");
    expect(() => requireIntEnv("N")).toThrow(/integer/);
    vi.stubEnv("N", "abc");
    expect(() => requireIntEnv("N")).toThrow(/integer/);
    vi.stubEnv("N", "");
    expect(() => requireIntEnv("N")).toThrow(/N/);
  });
});

describe("optionalEnv", () => {
  it("returns the trimmed value, or undefined when unset/blank", () => {
    vi.stubEnv("FLAG", "  on  ");
    expect(optionalEnv("FLAG")).toBe("on");
    vi.stubEnv("FLAG", "");
    expect(optionalEnv("FLAG")).toBeUndefined();
  });
});

describe("appBaseUrl", () => {
  it("uses APP_BASE_URL when set, else the production default", () => {
    expect(appBaseUrl()).toBe("https://booking.innospacetirana.com");
    vi.stubEnv("APP_BASE_URL", "http://localhost:4000");
    expect(appBaseUrl()).toBe("http://localhost:4000");
  });
});

describe("getPricingFromEnv", () => {
  it("requires the currency and reads the optional PRICE_* amounts", () => {
    vi.stubEnv("PRICE_CURRENCY", "$");
    vi.stubEnv("PRICE_DAILY_PASS", "20");
    vi.stubEnv("PRICE_EVENT_ROOM_HOUR", "30");
    const p = getPricingFromEnv();
    expect(p.currency).toBe("$");
    expect(p.plans["daily-pass"]).toBe("20");
    expect(p.plans["weekly-pass"]).toBeUndefined();
    expect(p.eventRoom?.hour).toBe("30");
  });

  it("throws when PRICE_CURRENCY is missing", () => {
    vi.stubEnv("PRICE_CURRENCY", "");
    expect(() => getPricingFromEnv()).toThrow(/PRICE_CURRENCY/);
  });
});

describe("getContactFromEnv", () => {
  it("requires the org name and omits every unset detail line", () => {
    const c = getContactFromEnv();
    expect(c.org).toBe("Test Org");
    expect(c.url).toBe("https://innospacetirana.com"); // default website
    expect(c.phone).toBeUndefined();
    expect(c.nid).toBeUndefined();
  });

  it("reads the optional BUSINESS_* / EMAIL_SIGNOFF_NAME details", () => {
    vi.stubEnv("EMAIL_SIGNOFF_NAME", "Emi");
    vi.stubEnv("BUSINESS_ADDRESS", "1 Test St");
    vi.stubEnv("BUSINESS_PHONE", "+355 1");
    vi.stubEnv("BUSINESS_WEBSITE_URL", "https://test.co");
    expect(getContactFromEnv()).toMatchObject({
      name: "Emi",
      address: "1 Test St",
      phone: "+355 1",
      url: "https://test.co",
    });
  });

  it("throws when BUSINESS_NAME is missing", () => {
    vi.stubEnv("BUSINESS_NAME", "");
    expect(() => getContactFromEnv()).toThrow(/BUSINESS_NAME/);
  });
});
