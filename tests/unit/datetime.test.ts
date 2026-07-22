import { describe, expect, it } from "vitest";
import {
  formatDMYShort,
  formatDateRangeLong,
  formatDateRangeShort,
  formatDateTime,
  pad2,
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

describe("formatDateTime", () => {
  it("renders a local DD/MM/YY HH:MM, or empty for junk", () => {
    expect(formatDateTime("2026-07-02T14:30:00")).toBe("02/07/26 14:30");
    expect(formatDateTime("not-a-date")).toBe("");
  });
});
