import { describe, expect, it } from "vitest";
import {
  BOOKING_SORTS,
  INITIAL_SORT,
  nextSort,
  parseSort,
  type SortState,
} from "@/lib/sort";

describe("sort constants", () => {
  // The API validator and the db's ORDER BY map are keyed on this list.
  it("lists the sortable columns", () => {
    expect(BOOKING_SORTS).toEqual([
      "createdAt",
      "guest",
      "plan",
      "dates",
      "note",
      "status",
    ]);
  });

  it("opens the table on the newest request", () => {
    expect(INITIAL_SORT).toEqual({ key: "createdAt", dir: "desc" });
  });

  it("flips to oldest first on a click on the column it opens with", () => {
    expect(nextSort(INITIAL_SORT, INITIAL_SORT.key)).toEqual({
      key: "createdAt",
      dir: "asc",
    });
  });
});

describe("nextSort", () => {
  it("reverses the direction of the column already sorted", () => {
    const desc: SortState = { key: "dates", dir: "desc" };
    const asc = nextSort(desc, "dates");
    expect(asc).toEqual({ key: "dates", dir: "asc" });
    expect(nextSort(asc, "dates")).toEqual(desc);
  });

  it("opens a date column newest first", () => {
    const from: SortState = { key: "guest", dir: "asc" };
    expect(nextSort(from, "createdAt")).toEqual({
      key: "createdAt",
      dir: "desc",
    });
    expect(nextSort(from, "dates")).toEqual({ key: "dates", dir: "desc" });
  });

  it("opens a text column A to Z, whatever the previous direction was", () => {
    for (const dir of ["asc", "desc"] as const) {
      for (const key of ["guest", "plan", "note", "status"] as const) {
        expect(nextSort({ key: "dates", dir }, key)).toEqual({
          key,
          dir: "asc",
        });
      }
    }
  });

  it("returns a new state instead of changing the one passed in", () => {
    const current: SortState = { key: "guest", dir: "asc" };
    expect(nextSort(current, "guest")).not.toBe(current);
    expect(current).toEqual({ key: "guest", dir: "asc" });
  });
});

describe("parseSort", () => {
  it("accepts every known column in either direction", () => {
    for (const sort of BOOKING_SORTS) {
      expect(parseSort(sort, "asc")).toEqual({ sort, dir: "asc" });
      expect(parseSort(sort, "desc")).toEqual({ sort, dir: "desc" });
    }
  });

  it("leaves both unset when the params are absent", () => {
    expect(parseSort(null, null)).toEqual({ sort: undefined, dir: undefined });
  });

  it("drops an unknown column but keeps a valid direction", () => {
    expect(parseSort("email", "asc")).toEqual({ sort: undefined, dir: "asc" });
  });

  it("drops an unknown direction but keeps a valid column", () => {
    expect(parseSort("guest", "sideways")).toEqual({
      sort: "guest",
      dir: undefined,
    });
  });

  it("matches exactly: no case folding, trimming or empty string", () => {
    for (const bad of ["Guest", " guest", "guest ", ""]) {
      expect(parseSort(bad, "ASC")).toEqual({
        sort: undefined,
        dir: undefined,
      });
    }
  });

  it("drops object keys and SQL in place of a column", () => {
    for (const bad of [
      "constructor",
      "__proto__",
      "toString",
      "createdAt; DROP TABLE bookings",
      `"from" DESC`,
    ]) {
      expect(parseSort(bad, "desc; DROP TABLE bookings").sort).toBeUndefined();
      expect(parseSort(bad, "desc; DROP TABLE bookings").dir).toBeUndefined();
    }
  });
});
