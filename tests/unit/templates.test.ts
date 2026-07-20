import { afterEach, describe, expect, it, vi } from "vitest";
import * as t from "@/lib/templates";
import type { Booking, BookingPlan } from "@/lib/types";

// Product copy uses an en dash / arrow. Build them from code points so no literal
// en dash lands in this source (a project-wide formatting rule). Empty values now
// render as a plain ASCII hyphen.
const EN = String.fromCharCode(0x2013);
const ARROW = String.fromCharCode(0x2192);

const base: Booking = {
  id: "b1",
  createdAt: "2026-07-01T08:00:00.000Z",
  status: "new",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  plan: "daily-pass",
  from: "2026-07-01",
};

describe("date formatting", () => {
  it("formatDMYShort", () => {
    expect(t.formatDMYShort("2026-07-02")).toBe("02/07/26");
    expect(t.formatDMYShort(undefined)).toBe("");
  });

  it("formatDateRangeShort", () => {
    expect(t.formatDateRangeShort(undefined, undefined)).toBe("-");
    expect(t.formatDateRangeShort(undefined, "2026-07-02")).toBe("02/07/26");
    expect(t.formatDateRangeShort("2026-06-30", undefined)).toBe("30/06/26");
    expect(t.formatDateRangeShort("2026-07-02", "2026-07-02")).toBe("02/07/26");
    expect(t.formatDateRangeShort("2026-06-30", "2026-07-02")).toBe(
      `30/06/26 ${ARROW} 02/07/26`,
    );
  });

  it("formatDateTime renders a local DD/MM/YY HH:MM, or empty for junk", () => {
    expect(t.formatDateTime("2026-07-02T14:30:00")).toBe("02/07/26 14:30");
    expect(t.formatDateTime("not-a-date")).toBe("");
  });
});

describe("datesText", () => {
  it("falls back when the start date is missing or malformed", () => {
    expect(t.datesText({ ...base, from: undefined })).toBe(
      "your requested dates",
    );
    expect(t.datesText({ ...base, from: "not-a-date" })).toBe(
      "your requested dates",
    );
  });

  it("renders a single date", () => {
    expect(t.datesText({ ...base, from: "2026-07-01", to: undefined })).toBe(
      "1 July 2026",
    );
  });

  it("compresses a same-month range", () => {
    expect(t.datesText({ ...base, from: "2026-07-01", to: "2026-07-03" })).toBe(
      `1${EN}3 July 2026`,
    );
  });

  it("spells out a same-year cross-month range", () => {
    expect(t.datesText({ ...base, from: "2026-07-30", to: "2026-08-02" })).toBe(
      `30 July ${EN} 2 August 2026`,
    );
  });

  it("spells out a cross-year range", () => {
    expect(t.datesText({ ...base, from: "2025-12-30", to: "2026-01-02" })).toBe(
      `30 December 2025 ${EN} 2 January 2026`,
    );
  });
});

describe("labels + subjects", () => {
  it("bookingTypeLabel maps known plans, title-cases unknown, defaults when absent", () => {
    expect(t.bookingTypeLabel(base)).toBe("Day Pass");
    expect(t.bookingTypeLabel({ ...base, plan: undefined })).toBe("Booking");
    expect(
      t.bookingTypeLabel({ ...base, plan: "co-working" as BookingPlan }),
    ).toBe("Co Working");
  });

  it("emailSubject varies by status", () => {
    expect(t.emailSubject("cancelled")).toBe(
      "Update on your Innospace booking",
    );
    const confirmed = t.emailSubject("confirmed", base);
    expect(confirmed).toContain("Day Pass Booking Confirmation");
    expect(confirmed).toContain("1 July 2026");
  });

  it("emailSubject confirmed without a booking is generic", () => {
    expect(t.emailSubject("confirmed")).toBe(
      "Re: Booking Booking Confirmation",
    );
  });

  it("emailHeading varies by status", () => {
    expect(t.emailHeading("confirmed")).toBe("Booking confirmed");
    expect(t.emailHeading("cancelled")).toBe("Booking cancelled");
  });
});

describe("priceLineFor", () => {
  it("returns null without pricing or a plan", () => {
    expect(t.priceLineFor(base)).toBeNull();
    expect(
      t.priceLineFor(
        { ...base, plan: undefined },
        { currency: "€", plans: {} },
      ),
    ).toBeNull();
  });

  it("prices a regular plan, or null when its amount is missing", () => {
    expect(
      t.priceLineFor(base, { currency: "€", plans: { "daily-pass": "15" } }),
    ).toBe("The Day Pass rate is 15€ per day.");
    expect(t.priceLineFor(base, { currency: "€", plans: {} })).toBeNull();
  });

  it("prices the event room by hour and/or day, else null", () => {
    const evt: Booking = { ...base, plan: "event-room" };
    expect(
      t.priceLineFor(evt, {
        currency: "€",
        plans: {},
        eventRoom: { hour: "25", day: "170" },
      }),
    ).toBe(
      "The Event Room rate is 25€ per hour (minimum 3 hours) or 170€ per day.",
    );
    expect(
      t.priceLineFor(evt, { currency: "€", plans: {}, eventRoom: {} }),
    ).toBeNull();
    expect(t.priceLineFor(evt, { currency: "€", plans: {} })).toBeNull(); // no eventRoom key
  });
});

describe("getPricingFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults the currency and reads PRICE_* overrides", () => {
    expect(t.getPricingFromEnv().currency).toBe("€");
    vi.stubEnv("PRICE_CURRENCY", "$");
    vi.stubEnv("PRICE_DAILY_PASS", "20");
    vi.stubEnv("PRICE_EVENT_ROOM_HOUR", "30");
    const p = t.getPricingFromEnv();
    expect(p.currency).toBe("$");
    expect(p.plans["daily-pass"]).toBe("20");
    expect(p.eventRoom?.hour).toBe("30");
  });
});

describe("emailBodyText", () => {
  it("confirmed greets by first name and includes the dates", () => {
    const body = t.emailBodyText(base, "confirmed");
    expect(body).toContain("Hi Ada,");
    expect(body).toContain("1 July 2026");
  });

  it("confirmed greets 'there' when no name, and can include a price line", () => {
    const body = t.emailBodyText(
      { ...base, fullName: undefined },
      "confirmed",
      {
        currency: "€",
        plans: { "daily-pass": "15" },
      },
    );
    expect(body).toContain("Hi there,");
    expect(body).toContain("15€ per day");
  });

  it("cancelled greets by first name, or plainly when unset", () => {
    expect(t.emailBodyText(base, "cancelled")).toContain("Hello Ada,");
    expect(
      t.emailBodyText({ ...base, fullName: undefined }, "cancelled"),
    ).toContain("Hello,");
  });
});

describe("contact footer (env-driven)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getContactFromEnv reads BUSINESS_* / EMAIL_SIGNOFF_NAME", () => {
    vi.stubEnv("EMAIL_SIGNOFF_NAME", "Emi");
    vi.stubEnv("BUSINESS_ADDRESS", "1 Test St");
    vi.stubEnv("BUSINESS_PHONE", "+355 1");
    const c = t.getContactFromEnv();
    expect(c).toMatchObject({
      name: "Emi",
      address: "1 Test St",
      phone: "+355 1",
    });
  });

  it("confirmed email includes only the contact fields provided", () => {
    const body = t.emailBodyText(base, "confirmed", undefined, {
      name: "Emi",
      address: "1 Test St",
      accessApt1: "Apt1: ring the bell",
      phone: "+355 1",
      email: "info@x.com",
    });
    expect(body).toContain("Emi");
    expect(body).toContain("1 Test St");
    expect(body).toContain("Important access instructions");
    expect(body).toContain("Apt1: ring the bell");
    expect(body).toContain("Phone: +355 1");
    expect(body).toContain("Email: info@x.com");
    expect(body).not.toContain("NID:"); // not provided
  });

  it("confirmed email omits the whole block when no contact is given", () => {
    const body = t.emailBodyText(base, "confirmed");
    expect(body).toContain("InnoSpace Tirana"); // org default
    expect(body).not.toContain("Phone:");
    expect(body).not.toContain("access instructions");
  });
});
