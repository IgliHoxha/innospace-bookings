import { describe, expect, it } from "vitest";
import {
  INITIAL_VIEW,
  withFilter,
  withPage,
  withSearch,
  withSort,
  type ListView,
} from "@/lib/list-view";

// A view deep in the list, so a reset to the first page is visible.
const deep: ListView = {
  filter: "confirmed",
  search: "ada",
  sort: { key: "guest", dir: "asc" },
  page: 3,
};

describe("INITIAL_VIEW", () => {
  it("opens on every booking, newest first, on the first page", () => {
    expect(INITIAL_VIEW).toEqual({
      filter: "all",
      search: "",
      sort: { key: "createdAt", dir: "desc" },
      page: 1,
    });
  });
});

describe("withFilter", () => {
  it("moves to the first page in the same step as the new filter", () => {
    expect(withFilter(deep, "new")).toEqual({
      ...deep,
      filter: "new",
      page: 1,
    });
  });

  it("returns the same view for the filter already on screen", () => {
    expect(withFilter(deep, "confirmed")).toBe(deep);
  });
});

describe("withSearch", () => {
  it("moves to the first page in the same step as the new search", () => {
    expect(withSearch(deep, "bea")).toEqual({
      ...deep,
      search: "bea",
      page: 1,
    });
  });

  it("clears the search like any other change", () => {
    expect(withSearch(deep, "")).toEqual({ ...deep, search: "", page: 1 });
  });

  it("returns the same view for the search already on screen", () => {
    expect(withSearch(deep, "ada")).toBe(deep);
  });
});

describe("withSort", () => {
  it("opens another column in its first direction, on the first page", () => {
    expect(withSort(deep, "createdAt")).toEqual({
      ...deep,
      sort: { key: "createdAt", dir: "desc" },
      page: 1,
    });
  });

  it("reverses the active column, on the first page", () => {
    expect(withSort(deep, "guest")).toEqual({
      ...deep,
      sort: { key: "guest", dir: "desc" },
      page: 1,
    });
  });
});

describe("withPage", () => {
  it("changes the page and nothing else", () => {
    expect(withPage(deep, 2)).toEqual({ ...deep, page: 2 });
  });

  it("returns the same view for the page already on screen", () => {
    expect(withPage(deep, 3)).toBe(deep);
  });
});

describe("a view change", () => {
  it("never edits the view it was given", () => {
    const before = structuredClone(deep);
    withFilter(deep, "new");
    withSearch(deep, "bea");
    withSort(deep, "guest");
    withPage(deep, 1);
    expect(deep).toEqual(before);
  });
});
