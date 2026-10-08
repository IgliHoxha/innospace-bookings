import { describe, expect, it } from "vitest";
import {
  INITIAL_FILTER,
  PAGE_SIZE,
  pageCount,
  pageList,
} from "@/lib/pagination";

describe("pagination constants", () => {
  it("exposes a positive page size and a default filter", () => {
    expect(PAGE_SIZE).toBe(25);
    expect(INITIAL_FILTER).toBe("new");
  });
});

describe("pageCount", () => {
  it("keeps a first page for an empty list", () => {
    expect(pageCount(0)).toBe(1);
  });

  it("rounds a partly filled last page up", () => {
    expect(pageCount(1)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(172)).toBe(7);
  });

  it("takes another page size", () => {
    expect(pageCount(5, 2)).toBe(3);
    expect(pageCount(4, 2)).toBe(2);
  });
});

describe("pageList", () => {
  it("is a single page when there is only one", () => {
    expect(pageList(1, 1)).toEqual([1]);
  });

  it("lists every page while none would be skipped", () => {
    expect(pageList(1, 2)).toEqual([1, 2]);
    expect(pageList(2, 3)).toEqual([1, 2, 3]);
    expect(pageList(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("puts one gap after the neighbours when on the first page", () => {
    expect(pageList(1, 7)).toEqual([1, 2, "…", 7]);
  });

  it("puts one gap before the neighbours when on the last page", () => {
    expect(pageList(7, 7)).toEqual([1, "…", 6, 7]);
  });

  it("puts a gap on both sides in the middle of a long list", () => {
    expect(pageList(4, 7)).toEqual([1, "…", 3, 4, 5, "…", 7]);
    expect(pageList(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
  });

  it("uses a gap even where it stands for a single page", () => {
    expect(pageList(3, 7)).toEqual([1, 2, 3, 4, "…", 7]);
    expect(pageList(4, 6)).toEqual([1, "…", 3, 4, 5, 6]);
    expect(pageList(1, 4)).toEqual([1, 2, "…", 4]);
  });

  it("still shows first and last for a page past the end", () => {
    expect(pageList(9, 3)).toEqual([1, "…", 3]);
  });
});
