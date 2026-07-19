import { describe, expect, it } from "vitest";
import { INITIAL_FILTER, PAGE_SIZE } from "@/lib/pagination";

describe("pagination constants", () => {
  it("exposes a positive page size and a default filter", () => {
    expect(PAGE_SIZE).toBe(25);
    expect(INITIAL_FILTER).toBe("new");
  });
});
