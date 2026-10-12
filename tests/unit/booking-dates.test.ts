import { describe, expect, it } from "vitest";
import {
  DATE_GRACE_MS,
  MIN_ROOM_HOURS,
  SAME_DAY_CUTOFF_HOUR,
  bookingDatesError,
  earliestBookableDay,
} from "@/lib/booking-dates";

// A Tirana wall-clock time in October 2026 (summer time, UTC+2) as a real instant.
const tirana = (stamp: string) => new Date(`${stamp}:00+02:00`);

// Monday 12 October 2026, mid-morning in Tirana: today is still bookable.
const MON_MORNING = tirana("2026-10-12T10:30");

const EARLIEST = /earliest start date is/;
const WEEKDAYS = /only be booked for weekdays/;

describe("earliestBookableDay", () => {
  it.each([
    ["Monday morning", "2026-10-12T10:30", "2026-10-12"],
    ["the last minute before the cutoff", "2026-10-12T12:59", "2026-10-12"],
    ["the cutoff itself", "2026-10-12T13:00", "2026-10-13"],
    ["late afternoon", "2026-10-12T17:59", "2026-10-13"],
    ["the evening", "2026-10-12T18:00", "2026-10-14"],
    ["Thursday evening", "2026-10-15T18:00", "2026-10-19"],
    ["Friday morning", "2026-10-16T09:00", "2026-10-16"],
    ["Friday afternoon", "2026-10-16T13:00", "2026-10-19"],
    ["Friday evening", "2026-10-16T18:00", "2026-10-20"],
    ["Saturday", "2026-10-17T10:00", "2026-10-20"],
    ["Sunday", "2026-10-18T10:00", "2026-10-20"],
    ["a Friday afternoon at month end", "2026-10-30T14:00", "2026-11-02"],
  ])("on %s", (_label, stamp, day) => {
    expect(earliestBookableDay(stamp)).toBe(day);
  });

  it("closes today at the documented hour", () => {
    expect(SAME_DAY_CUTOFF_HOUR).toBe(13);
  });
});

describe("bookingDatesError", () => {
  const check = (
    plan: Parameters<typeof bookingDatesError>[0],
    from?: string,
    to?: string,
    now: Date = MON_MORNING,
  ) => bookingDatesError(plan, from, to, now);

  it("passes a request that carries no dates", () => {
    expect(check("daily-pass")).toBeNull();
    expect(check(undefined)).toBeNull();
  });

  it("checks the start alone when no end is sent", () => {
    expect(check("daily-pass", "2026-10-12")).toBeNull();
    expect(check("daily-pass", "2026-10-09")).toMatch(EARLIEST);
  });

  it("books today before the cutoff, on every plan", () => {
    expect(check("daily-pass", "2026-10-12", "2026-10-12")).toBeNull();
    expect(check("weekly-pass", "2026-10-12", "2026-10-19")).toBeNull();
    expect(check("monthly-pass", "2026-10-12", "2026-11-12")).toBeNull();
    expect(check("event-room", "2026-10-12", "2026-10-12")).toBeNull();
  });

  it("refuses today once the cutoff and the grace have passed", () => {
    const today = ["daily-pass", "2026-10-12", "2026-10-12"] as const;
    expect(check(...today, tirana("2026-10-12T12:59"))).toBeNull();
    // The grace keeps the form's last answer valid for a few minutes.
    expect(check(...today, tirana("2026-10-12T13:09"))).toBeNull();
    expect(check(...today, tirana("2026-10-12T13:10"))).toBe(
      "The earliest start date is 2026-10-13.",
    );
    expect(DATE_GRACE_MS).toBe(10 * 60 * 1000);
  });

  it("refuses tomorrow from the evening on", () => {
    const tomorrow = ["weekly-pass", "2026-10-13", "2026-10-20"] as const;
    expect(check(...tomorrow, tirana("2026-10-12T18:09"))).toBeNull();
    expect(check(...tomorrow, tirana("2026-10-12T18:10"))).toBe(
      "The earliest start date is 2026-10-14.",
    );
  });

  it("refuses a start in the past", () => {
    expect(check("daily-pass", "2026-10-09", "2026-10-09")).toMatch(EARLIEST);
    expect(check("event-room", "2026-10-11T10:00", "2026-10-11T14:00")).toMatch(
      EARLIEST,
    );
  });

  it("does not let the grace tighten the rule just after midnight", () => {
    // 00:05 on Tuesday: ten minutes back it was Monday evening, which is stricter.
    const now = tirana("2026-10-13T00:05");
    expect(check("daily-pass", "2026-10-13", "2026-10-13", now)).toBeNull();
  });

  it("reads the cutoff in Tirana time, in summer and in winter", () => {
    // 11:30 UTC is 13:30 in Tirana in October, past the cutoff.
    const summer = new Date("2026-10-12T11:30:00Z");
    expect(check("daily-pass", "2026-10-12", "2026-10-12", summer)).toMatch(
      EARLIEST,
    );
    // Monday 11 January 2027: 11:30 UTC is 12:30 in Tirana, 12:30 UTC is 13:30.
    const before = new Date("2027-01-11T11:30:00Z");
    const after = new Date("2027-01-11T12:30:00Z");
    expect(check("daily-pass", "2027-01-11", "2027-01-11", before)).toBeNull();
    expect(check("daily-pass", "2027-01-11", "2027-01-11", after)).toMatch(
      EARLIEST,
    );
  });

  it("takes the day from Tirana when UTC is still on the day before", () => {
    // 22:30 UTC on Monday is 00:30 on Tuesday in Tirana.
    const now = new Date("2026-10-12T22:30:00Z");
    expect(check("daily-pass", "2026-10-13", "2026-10-13", now)).toBeNull();
    expect(check("daily-pass", "2026-10-12", "2026-10-12", now)).toMatch(
      EARLIEST,
    );
  });

  it("keeps a Day Pass off the weekend", () => {
    expect(check("daily-pass", "2026-10-17", "2026-10-17")).toMatch(WEEKDAYS);
    expect(check("daily-pass", "2026-10-18", "2026-10-19")).toMatch(WEEKDAYS);
    expect(check("daily-pass", "2026-10-16", "2026-10-17")).toMatch(WEEKDAYS);
    // A stay that only passes over the weekend is fine.
    expect(check("daily-pass", "2026-10-16", "2026-10-19")).toBeNull();
  });

  it("leaves the weekend open to every other plan", () => {
    expect(check("weekly-pass", "2026-10-17", "2026-10-24")).toBeNull();
    expect(check("monthly-pass", "2026-10-18", "2026-11-18")).toBeNull();
    expect(check("event-room", "2026-10-17", "2026-10-17")).toBeNull();
    expect(
      check("event-room", "2026-10-17T09:00", "2026-10-17T13:00"),
    ).toBeNull();
  });

  it("refuses an end before the start", () => {
    const reversed = "The end date cannot be before the start date.";
    expect(check("daily-pass", "2026-10-15", "2026-10-14")).toBe(reversed);
    expect(check("event-room", "2026-10-13T14:00", "2026-10-13T11:00")).toBe(
      reversed,
    );
  });

  it("holds an hourly room booking to its minimum", () => {
    const short = `An hourly booking is at least ${MIN_ROOM_HOURS} hours.`;
    expect(
      check("event-room", "2026-10-13T09:00", "2026-10-13T12:00"),
    ).toBeNull();
    expect(check("event-room", "2026-10-13T09:00", "2026-10-13T11:59")).toBe(
      short,
    );
    // A half day is four hours, and a full day carries no times at all.
    expect(
      check("event-room", "2026-10-13T13:00", "2026-10-13T17:00"),
    ).toBeNull();
    expect(check("event-room", "2026-10-13", "2026-10-13")).toBeNull();
  });

  it("refuses a timed start that has already passed today", () => {
    const passed = "That start time has already passed.";
    expect(check("event-room", "2026-10-12T09:00", "2026-10-12T13:00")).toBe(
      passed,
    );
    expect(
      check("event-room", "2026-10-12T11:00", "2026-10-12T14:00"),
    ).toBeNull();
    expect(
      check("event-room", "2026-10-12T13:00", "2026-10-12T17:00"),
    ).toBeNull();
    // 10:30 now: the grace reaches back to 10:20 and no further.
    expect(
      check("event-room", "2026-10-12T10:20", "2026-10-12T13:20"),
    ).toBeNull();
    expect(check("event-room", "2026-10-12T10:19", "2026-10-12T13:19")).toBe(
      passed,
    );
  });

  it("accepts seconds on a timed value", () => {
    expect(
      check("event-room", "2026-10-13T09:00:00", "2026-10-13T12:00:00.000"),
    ).toBeNull();
  });

  it.each([
    ["a word", "soon", "2026-10-13"],
    ["a day that does not exist", "2026-04-31", "2026-05-02"],
    ["a month that does not exist", "2026-13-01", "2026-13-02"],
    ["an hour that does not exist", "2026-10-13T25:00", "2026-10-13T28:00"],
    ["a minute that does not exist", "2026-10-13T09:60", "2026-10-13T12:60"],
    ["another date format", "13.10.2026", "14.10.2026"],
    ["a malformed end", "2026-10-13", "later"],
  ])("refuses %s", (_label, from, to) => {
    expect(check("daily-pass", from, to)).toBe("Invalid booking dates.");
  });

  it("refuses an end sent without a start", () => {
    expect(check("daily-pass", undefined, "2026-10-13")).toBe(
      "Invalid booking dates.",
    );
  });

  it("reads the clock itself when none is passed", () => {
    expect(bookingDatesError("daily-pass", "2000-01-03", "2000-01-03")).toMatch(
      EARLIEST,
    );
  });
});
