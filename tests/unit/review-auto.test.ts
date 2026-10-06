import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ReviewAuto = typeof import("@/lib/review-auto");
let auto: ReviewAuto;

beforeEach(async () => {
  vi.resetModules();
  auto = await import("@/lib/review-auto");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ready = () => {
  vi.stubEnv("REVIEW_AUTO_EMAIL", "on");
  vi.stubEnv("BUSINESS_REVIEW_URL", "https://g.page/r/fixture/review");
  vi.stubEnv("RESEND_API_KEY", "re_test");
};

describe("reviewEmailsEnabled", () => {
  it("is off by default", () => {
    expect(auto.reviewEmailsEnabled()).toBe(false);
  });

  it("is on once the switch, the review link and the mail key are all set", () => {
    ready();
    expect(auto.reviewEmailsEnabled()).toBe(true);
  });

  it("needs the switch to read exactly on", () => {
    ready();
    for (const value of ["", "off", "true", "1", "ON"]) {
      vi.stubEnv("REVIEW_AUTO_EMAIL", value);
      expect(auto.reviewEmailsEnabled()).toBe(false);
    }
  });

  it("stays off without a review link or without a mail key", () => {
    ready();
    vi.stubEnv("BUSINESS_REVIEW_URL", "");
    expect(auto.reviewEmailsEnabled()).toBe(false);

    ready();
    vi.stubEnv("RESEND_API_KEY", "");
    expect(auto.reviewEmailsEnabled()).toBe(false);
  });
});
