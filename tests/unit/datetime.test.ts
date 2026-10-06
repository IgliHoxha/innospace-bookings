import { describe, expect, it } from "vitest";
import {
  daysSinceEnd,
  formatDMYShort,
  formatDateRangeLong,
  formatDateRangeShort,
  formatDateTime,
  hasEnded,
  pad2,
  todayYMD,
  zonedDay,
} from "@/lib/datetime";

// The table's range separator is an arrow. Build it from its code point so no
// literal non-ASCII glyph lands in this source.
const ARROW = String.fromCharCode(0x2192);

describe("pad2", () => {
  it("zero-pads to two digits", () => {
    expect(pad2(9)).toBe("09");
    expect(pad2(31)).toBe("31");
  });
});

describe("formatDMYShort", () => {
  it("renders DD/MM/YY, or empty for a missing/malformed value", () => {
    expect(formatDMYShort("2026-07-02")).toBe("02/07/26");
    expect(formatDMYShort("2026-07-02T10:00:00Z")).toBe("02/07/26");
    expect(formatDMYShort(undefined)).toBe("");
    expect(formatDMYShort("not-a-date")).toBe("");
  });
});

describe("formatDateRangeShort", () => {
  it("collapses empty, single and equal dates, else joins with an arrow", () => {
    expect(formatDateRangeShort(undefined, undefined)).toBe("-");
    expect(formatDateRangeShort(undefined, "2026-07-02")).toBe("02/07/26");
    expect(formatDateRangeShort("2026-06-30", undefined)).toBe("30/06/26");
    expect(formatDateRangeShort("2026-07-02", "2026-07-02")).toBe("02/07/26");
    expect(formatDateRangeShort("2026-06-30", "2026-07-02")).toBe(
      `30/06/26 ${ARROW} 02/07/26`,
    );
  });
});

describe("formatDateRangeLong", () => {
  it("returns null when the start date is missing or malformed", () => {
    expect(formatDateRangeLong(undefined, undefined)).toBeNull();
    expect(formatDateRangeLong("not-a-date", undefined)).toBeNull();
  });

  it("renders a single date", () => {
    expect(formatDateRangeLong("2026-07-01", undefined)).toBe("1 July 2026");
    expect(formatDateRangeLong("2026-07-01", "2026-07-01")).toBe("1 July 2026");
  });

  it("compresses a same-month range", () => {
    expect(formatDateRangeLong("2026-07-01", "2026-07-03")).toBe(
      "1-3 July 2026",
    );
  });

  it("spells out a same-year cross-month range", () => {
    expect(formatDateRangeLong("2026-07-30", "2026-08-02")).toBe(
      "30 July - 2 August 2026",
    );
  });

  it("spells out a cross-year range", () => {
    expect(formatDateRangeLong("2025-12-30", "2026-01-02")).toBe(
      "30 December 2025 - 2 January 2026",
    );
  });
});

describe("todayYMD", () => {
  it("renders the local date zero-padded", () => {
    expect(todayYMD(new Date(2026, 6, 2, 23, 59))).toBe("2026-07-02");
    expect(todayYMD(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("defaults to the current date", () => {
    expect(todayYMD()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("hasEnded", () => {
  it("is true only from the day after the last booked day", () => {
    expect(hasEnded("2026-07-01", undefined, "2026-07-01")).toBe(false);
    expect(hasEnded("2026-07-01", undefined, "2026-07-02")).toBe(true);
    expect(hasEnded("2026-07-01", "2026-07-03", "2026-07-03")).toBe(false);
    expect(hasEnded("2026-07-01", "2026-07-03", "2026-07-04")).toBe(true);
  });

  it("compares across month and year boundaries", () => {
    expect(hasEnded("2026-09-30", undefined, "2026-10-01")).toBe(true);
    expect(hasEnded("2025-12-31", undefined, "2026-01-01")).toBe(true);
    expect(hasEnded("2026-10-01", undefined, "2026-09-30")).toBe(false);
  });

  it("reads the date out of a timestamp", () => {
    expect(hasEnded("2026-07-01T10:00", "2026-07-01T13:00", "2026-07-02")).toBe(
      true,
    );
  });

  it("falls back to the start date when the end is missing or malformed", () => {
    expect(hasEnded("2026-07-01", "soon", "2026-07-02")).toBe(true);
  });

  it("is false without a usable date", () => {
    expect(hasEnded(undefined, undefined, "2026-07-02")).toBe(false);
    expect(hasEnded("not-a-date", undefined, "2026-07-02")).toBe(false);
  });
});

describe("formatDateTime", () => {
  it("renders a local DD/MM/YY HH:MM, or empty for junk", () => {
    expect(formatDateTime("2026-07-02T14:30:00")).toBe("02/07/26 14:30");
    expect(formatDateTime("not-a-date")).toBe("");
  });
});

describe("daysSinceEnd", () => {
  it("counts whole days from the last booked day", () => {
    expect(daysSinceEnd("2026-07-01", undefined, "2026-07-02")).toBe(1);
    expect(daysSinceEnd("2026-07-01", "2026-07-03", "2026-07-10")).toBe(7);
  });

  it("is zero on the last day and negative before it", () => {
    expect(daysSinceEnd("2026-07-01", "2026-07-03", "2026-07-03")).toBe(0);
    expect(daysSinceEnd("2026-07-01", "2026-07-03", "2026-07-01")).toBe(-2);
  });

  it("crosses month, year and clock-change boundaries without drifting", () => {
    expect(daysSinceEnd("2026-07-31", undefined, "2026-08-01")).toBe(1);
    expect(daysSinceEnd("2026-12-31", undefined, "2027-01-01")).toBe(1);
    expect(daysSinceEnd("2026-03-28", undefined, "2026-03-30")).toBe(2);
    expect(daysSinceEnd("2026-10-24", undefined, "2026-10-26")).toBe(2);
  });

  it("reads the date out of a timestamp and falls back to the start date", () => {
    expect(
      daysSinceEnd("2026-07-01T10:00", "2026-07-01T13:00", "2026-07-02"),
    ).toBe(1);
    expect(daysSinceEnd("2026-07-01", "soon", "2026-07-02")).toBe(1);
  });

  it("is null without two usable dates", () => {
    expect(daysSinceEnd(undefined, undefined, "2026-07-02")).toBeNull();
    expect(daysSinceEnd("not-a-date", undefined, "2026-07-02")).toBeNull();
    expect(daysSinceEnd("2026-07-01", undefined, "today")).toBeNull();
  });
});

describe("zonedDay", () => {
  const ZONE = "Europe/Tirane";

  it("reads the day and hour in the zone, in winter and in summer", () => {
    expect(zonedDay(new Date("2026-01-15T08:30:00Z"), ZONE)).toEqual({
      ymd: "2026-01-15",
      hour: 9,
    });
    expect(zonedDay(new Date("2026-07-02T08:30:00Z"), ZONE)).toEqual({
      ymd: "2026-07-02",
      hour: 10,
    });
  });

  it("rolls the day over when the zone is already past midnight", () => {
    expect(zonedDay(new Date("2026-07-01T22:30:00Z"), ZONE)).toEqual({
      ymd: "2026-07-02",
      hour: 0,
    });
  });

  it("follows whichever zone it is given", () => {
    expect(zonedDay(new Date("2026-07-02T02:00:00Z"), "UTC")).toEqual({
      ymd: "2026-07-02",
      hour: 2,
    });
    expect(
      zonedDay(new Date("2026-07-02T02:00:00Z"), "America/New_York"),
    ).toEqual({ ymd: "2026-07-01", hour: 22 });
  });
});
