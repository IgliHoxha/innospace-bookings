import { describe, expect, it } from "vitest";
import * as t from "@/lib/templates";
import type { Booking, BookingPlan, ContactInfo, Pricing } from "@/lib/types";

const base: Booking = {
  id: "b1",
  createdAt: "2026-07-01T08:00:00.000Z",
  status: "new",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  plan: "daily-pass",
  from: "2026-07-01",
};

// The minimum a caller must supply: org + website, no optional detail lines.
const MINIMAL: ContactInfo = {
  org: "InnoSpace Tirana",
  url: "https://innospacetirana.com",
};

const FULL: ContactInfo = {
  ...MINIMAL,
  name: "Emi",
  address: "1 Test St",
  accessApt1: "Apt1: ring the bell",
  phone: "+355 1",
  email: "info@x.com",
};

const NO_PRICES: Pricing = { currency: "€", plans: {} };

describe("datesText", () => {
  it("falls back when the start date is missing or malformed", () => {
    expect(t.datesText({ ...base, from: undefined })).toBe(
      "your requested dates",
    );
    expect(t.datesText({ ...base, from: "not-a-date" })).toBe(
      "your requested dates",
    );
  });

  it("renders the booked range", () => {
    expect(t.datesText({ ...base, from: "2026-07-01", to: "2026-07-03" })).toBe(
      "1-3 July 2026",
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
  it("returns null without a plan, or when the plan has no amount", () => {
    expect(t.priceLineFor({ ...base, plan: undefined }, NO_PRICES)).toBeNull();
    expect(t.priceLineFor(base, NO_PRICES)).toBeNull();
  });

  it("prices a regular plan", () => {
    expect(
      t.priceLineFor(base, { currency: "€", plans: { "daily-pass": "15" } }),
    ).toBe("The Day Pass rate is 15€ per day.");
  });

  it("prices the event room by hour and/or day, else null", () => {
    const evt: Booking = { ...base, plan: "event-room" };
    expect(
      t.priceLineFor(evt, {
        ...NO_PRICES,
        eventRoom: { hour: "25", day: "170" },
      }),
    ).toBe(
      "The Event Room rate is 25€ per hour (minimum 3 hours) or 170€ per day.",
    );
    expect(t.priceLineFor(evt, { ...NO_PRICES, eventRoom: {} })).toBeNull();
    expect(t.priceLineFor(evt, NO_PRICES)).toBeNull(); // no eventRoom key
  });
});

describe("emailBodyText", () => {
  it("confirmed greets by first name and includes the dates", () => {
    const body = t.emailBodyText(base, "confirmed", NO_PRICES, MINIMAL);
    expect(body).toContain("Hi Ada,");
    expect(body).toContain("1 July 2026");
  });

  it("confirmed greets 'there' when no name, and includes the price line", () => {
    const body = t.emailBodyText(
      { ...base, fullName: undefined },
      "confirmed",
      { currency: "€", plans: { "daily-pass": "15" } },
      MINIMAL,
    );
    expect(body).toContain("Hi there,");
    expect(body).toContain("15€ per day");
  });

  it("cancelled greets by first name, or plainly when unset, and signs off as the org", () => {
    const body = t.emailBodyText(base, "cancelled", NO_PRICES, MINIMAL);
    expect(body).toContain("Hello Ada,");
    expect(body).toContain("InnoSpace Tirana");
    expect(
      t.emailBodyText(
        { ...base, fullName: undefined },
        "cancelled",
        NO_PRICES,
        MINIMAL,
      ),
    ).toContain("Hello,");
  });
});

describe("contact footer", () => {
  it("confirmed email includes only the contact fields provided", () => {
    const body = t.emailBodyText(base, "confirmed", NO_PRICES, FULL);
    expect(body).toContain("Emi");
    expect(body).toContain("1 Test St");
    expect(body).toContain("Important access instructions");
    expect(body).toContain("Apt1: ring the bell");
    expect(body).toContain("Phone: +355 1");
    expect(body).toContain("Email: info@x.com");
    expect(body).not.toContain("NID:"); // not provided
  });

  it("omits every optional line when only the org is configured", () => {
    const body = t.emailBodyText(base, "confirmed", NO_PRICES, MINIMAL);
    expect(body).toContain("InnoSpace Tirana"); // org always closes the email
    expect(body).not.toContain("Phone:");
    expect(body).not.toContain("access instructions");
  });
});
