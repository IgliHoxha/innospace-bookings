import { describe, expect, it } from "vitest";
import {
  reviewRequestLink,
  reviewRequestText,
  whatsappNumber,
} from "@/lib/review";
import type { Booking, ContactInfo } from "@/lib/types";

const REVIEW_URL = "https://g.page/r/fixture/review";

const CONTACT: ContactInfo = {
  org: "InnoSpace Tirana",
  url: "https://innospacetirana.com",
  reviewUrl: REVIEW_URL,
};

// A confirmed day pass that ended the day before TODAY.
const TODAY = "2026-07-02";
const done: Booking = {
  id: "b1",
  createdAt: "2026-06-28T08:00:00.000Z",
  status: "confirmed",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phoneNumber: "+355695240467",
  plan: "daily-pass",
  from: "2026-07-01",
};

describe("whatsappNumber", () => {
  it("strips an international number down to its digits", () => {
    expect(whatsappNumber("+355695240467")).toBe("355695240467");
    expect(whatsappNumber(" +355 69 524 0467 ")).toBe("355695240467");
    expect(whatsappNumber("+1 (415) 555-2671")).toBe("14155552671");
    expect(whatsappNumber("00355 69 524 0467")).toBe("355695240467");
  });

  it("drops a bracketed trunk zero", () => {
    expect(whatsappNumber("+355 (0) 69 524 0467")).toBe("355695240467");
  });

  it("rejects a number without a country code", () => {
    expect(whatsappNumber("069 524 0467")).toBeNull();
    expect(whatsappNumber("695240467")).toBeNull();
  });

  it("rejects missing, malformed and out-of-range input", () => {
    expect(whatsappNumber(undefined)).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber("+")).toBeNull();
    expect(whatsappNumber("+355 69 call me")).toBeNull();
    expect(whatsappNumber("+0355695240467")).toBeNull();
    expect(whatsappNumber("+1234567")).toBeNull(); // 7 digits
    expect(whatsappNumber("+1234567890123456")).toBeNull(); // 16 digits
  });
});

describe("reviewRequestText", () => {
  it("greets by first name and carries the review link on its own line", () => {
    const text = reviewRequestText(done, CONTACT);
    expect(text).toContain("Hi Ada, thank you for choosing InnoSpace Tirana.");
    expect(text?.split("\n")).toContain(REVIEW_URL);
  });

  it("falls back to a neutral greeting without a name", () => {
    expect(
      reviewRequestText({ ...done, fullName: undefined }, CONTACT),
    ).toMatch(/^Hi there,/);
  });

  it("is null when no review link is configured", () => {
    expect(
      reviewRequestText(done, { ...CONTACT, reviewUrl: undefined }),
    ).toBeNull();
  });

  it("never suggests a rating, wording or a reward", () => {
    const text = reviewRequestText(done, CONTACT) ?? "";
    expect(text).not.toMatch(/star|five|\b5\b|discount|free|gift/i);
    expect(text).toContain("in your own words");
  });
});

describe("reviewRequestLink", () => {
  it("opens WhatsApp with the message when the phone is international", () => {
    const link = reviewRequestLink(done, CONTACT, TODAY);
    expect(link?.channel).toBe("whatsapp");
    const url = new URL(link!.href);
    expect(url.origin + url.pathname).toBe("https://wa.me/355695240467");
    expect(url.searchParams.get("text")).toBe(reviewRequestText(done, CONTACT));
  });

  it("falls back to email when the phone cannot be used", () => {
    for (const phoneNumber of [undefined, "069 524 0467"]) {
      const link = reviewRequestLink({ ...done, phoneNumber }, CONTACT, TODAY);
      expect(link?.channel).toBe("email");
      const url = new URL(link!.href);
      expect(url.protocol).toBe("mailto:");
      expect(url.pathname).toBe("ada@example.com");
      expect(url.searchParams.get("subject")).toBe(
        "Your visit to InnoSpace Tirana",
      );
      expect(url.searchParams.get("body")).toBe(
        reviewRequestText(done, CONTACT)!.replace(/\n/g, "\r\n"),
      );
    }
  });

  it("keeps a crafted address from adding mail headers", () => {
    const link = reviewRequestLink(
      { ...done, phoneNumber: undefined, email: "a@b.co?cc=x@y.co&bcc=z@y.co" },
      CONTACT,
      TODAY,
    );
    const url = new URL(link!.href);
    expect(url.searchParams.has("cc")).toBe(false);
    expect(url.searchParams.has("bcc")).toBe(false);
    expect([...url.searchParams.keys()]).toEqual(["subject", "body"]);
  });

  it("is null when there is no way to reach the guest", () => {
    const unreachable = { ...done, phoneNumber: undefined };
    expect(
      reviewRequestLink({ ...unreachable, email: undefined }, CONTACT, TODAY),
    ).toBeNull();
    expect(
      reviewRequestLink(
        { ...unreachable, email: "not-an-email" },
        CONTACT,
        TODAY,
      ),
    ).toBeNull();
  });

  it("is offered only for confirmed bookings", () => {
    for (const status of ["new", "cancelled", "deleted"] as const) {
      expect(reviewRequestLink({ ...done, status }, CONTACT, TODAY)).toBeNull();
    }
  });

  it("waits until the day after the last booked day", () => {
    expect(reviewRequestLink(done, CONTACT, "2026-07-01")).toBeNull();
    expect(reviewRequestLink(done, CONTACT, "2026-06-30")).toBeNull();
    const week = { ...done, to: "2026-07-07" };
    expect(reviewRequestLink(week, CONTACT, "2026-07-07")).toBeNull();
    expect(reviewRequestLink(week, CONTACT, "2026-07-08")).not.toBeNull();
  });

  it("is null for a booking without dates", () => {
    expect(
      reviewRequestLink({ ...done, from: undefined }, CONTACT, TODAY),
    ).toBeNull();
  });

  it("is null when no review link is configured", () => {
    expect(
      reviewRequestLink(done, { ...CONTACT, reviewUrl: undefined }, TODAY),
    ).toBeNull();
  });
});
