import { describe, expect, it } from "vitest";
import { BOOKING_PLANS, BOOKING_STATUSES } from "@/lib/types";

// These arrays are the single source of truth for the DB CHECK constraints and
// the API validators, so pin their membership.
describe("booking enums", () => {
  it("lists the four statuses, with 'new' the initial one", () => {
    expect(BOOKING_STATUSES).toEqual([
      "new",
      "confirmed",
      "cancelled",
      "deleted",
    ]);
  });

  it("lists the known plan slugs", () => {
    expect(BOOKING_PLANS).toEqual([
      "daily-pass",
      "weekly-pass",
      "monthly-pass",
      "event-room",
    ]);
  });
});
