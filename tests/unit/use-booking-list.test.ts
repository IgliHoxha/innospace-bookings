// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBookings } from "@/app/dashboard/api";
import { useBookingList } from "@/app/dashboard/useBookingList";
import type { BookingPage } from "@/lib/db";
import { INITIAL_VIEW } from "@/lib/list-view";
import { renderHook } from "../helpers/hook";

vi.mock("@/app/dashboard/api", () => ({ fetchBookings: vi.fn() }));
const fetchMock = vi.mocked(fetchBookings);

/** A page as the server would answer it; `label` tells two answers apart. */
function pageOf(total: number, label = ""): BookingPage {
  return {
    bookings: label
      ? [{ id: label, createdAt: "2026-10-12T08:30:00Z", status: "new" }]
      : [],
    total,
    page: 1,
    pageSize: 25,
    counts: { total, new: total, confirmed: 0, cancelled: 0, deleted: 0 },
  };
}

const FIRST = pageOf(60, "server-render");
let unmount: () => void;

function mount() {
  const hook = renderHook(() => useBookingList(FIRST));
  unmount = hook.unmount;
  return hook.result;
}

/** Let the search delay pass, a request answer and its state land. */
const wait = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The views the list was fetched for, in order. */
const fetched = () => fetchMock.mock.calls.map(([view]) => view);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(pageOf(60, "fetched"));
});

afterEach(() => {
  unmount?.();
  vi.useRealTimers();
});

describe("useBookingList (opening)", () => {
  it("shows the server-rendered page without fetching it again", async () => {
    const list = mount();
    await wait(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(list.current.data).toBe(FIRST);
    expect(list.current.loading).toBe(false);
    expect({
      filter: list.current.filter,
      search: list.current.search,
      sort: list.current.sort,
      page: list.current.page,
    }).toEqual(INITIAL_VIEW);
  });
});

describe("useBookingList (one fetch per change)", () => {
  it("fetches a new page once and shows the answer", async () => {
    const list = mount();
    act(() => list.current.setPage(2));
    await wait();
    expect(fetched()).toEqual([{ ...INITIAL_VIEW, page: 2 }]);
    expect(list.current.page).toBe(2);
    expect(list.current.data.bookings[0].id).toBe("fetched");
  });

  it("fetches a filter chosen from page 2 once, on its first page", async () => {
    const list = mount();
    act(() => list.current.setPage(2));
    await wait();
    fetchMock.mockClear();

    act(() => list.current.setFilter("confirmed"));
    await wait();
    expect(fetched()).toEqual([{ ...INITIAL_VIEW, filter: "confirmed" }]);
    expect(list.current.filter).toBe("confirmed");
    expect(list.current.page).toBe(1);
  });

  it("fetches a sort chosen from page 2 once, on its first page", async () => {
    const list = mount();
    act(() => list.current.setPage(2));
    await wait();
    fetchMock.mockClear();

    act(() => list.current.sortBy("guest"));
    await wait();
    expect(fetched()).toEqual([
      { ...INITIAL_VIEW, sort: { key: "guest", dir: "asc" } },
    ]);
    expect(list.current.page).toBe(1);
  });

  it("fetches a search typed on page 2 once, on its first page", async () => {
    const list = mount();
    act(() => list.current.setPage(2));
    await wait();
    fetchMock.mockClear();

    act(() => list.current.setQuery("ada"));
    await wait(300);
    expect(fetched()).toEqual([{ ...INITIAL_VIEW, search: "ada" }]);
    expect(list.current.page).toBe(1);
  });

  it("fetches nothing for the filter and the page already on screen", async () => {
    const list = mount();
    act(() => list.current.setFilter("all"));
    act(() => list.current.setPage(1));
    await wait(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useBookingList (search box)", () => {
  it("shows what was typed at once but searches 300 ms after the last key", async () => {
    const list = mount();
    act(() => list.current.setQuery("a"));
    expect(list.current.query).toBe("a");
    await wait(299);
    act(() => list.current.setQuery("ad"));
    await wait(299);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(list.current.search).toBe("");

    await wait(1);
    expect(fetched()).toEqual([{ ...INITIAL_VIEW, search: "ad" }]);
    expect(list.current.search).toBe("ad");
  });

  it("fetches nothing, and keeps the page, for text typed and undone in time", async () => {
    const list = mount();
    act(() => list.current.setPage(2));
    await wait();
    fetchMock.mockClear();

    act(() => list.current.setQuery("x"));
    await wait(100);
    act(() => list.current.setQuery(""));
    await wait(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(list.current.page).toBe(2);
  });

  it("drops a search still waiting when the dashboard goes away", async () => {
    const list = mount();
    act(() => list.current.setQuery("ada"));
    unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useBookingList (answers)", () => {
  it("is loading from the request until its answer", async () => {
    let answer!: (page: BookingPage) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const list = mount();

    act(() => list.current.setPage(2));
    expect(list.current.loading).toBe(true);
    await act(async () => answer(pageOf(60, "late")));
    expect(list.current.loading).toBe(false);
    expect(list.current.data.bookings[0].id).toBe("late");
  });

  it("keeps the newer page when an older request answers after it", async () => {
    let answerOld!: (page: BookingPage) => void;
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce(pageOf(60, "newer"));
    const list = mount();

    act(() => list.current.setPage(2));
    act(() => list.current.setPage(3));
    await wait();
    expect(list.current.data.bookings[0].id).toBe("newer");

    await act(async () => answerOld(pageOf(60, "older")));
    expect(list.current.data.bookings[0].id).toBe("newer");
    expect(list.current.loading).toBe(false);
  });

  it("keeps the page on screen when the server turns the request down", async () => {
    fetchMock.mockResolvedValue(null);
    const list = mount();
    act(() => list.current.setPage(2));
    await wait();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(list.current.data).toBe(FIRST);
    expect(list.current.loading).toBe(false);
  });

  it("steps back to the last page when the one on screen has emptied", async () => {
    const list = mount();
    act(() => list.current.setPage(3));
    await wait();
    fetchMock.mockClear();

    // 30 bookings are left: two pages, so page 3 no longer exists.
    fetchMock
      .mockResolvedValueOnce(pageOf(30, "out-of-range"))
      .mockResolvedValueOnce(pageOf(30, "last-page"));
    await act(() => list.current.reload());
    await wait();
    expect(fetched().map((view) => view.page)).toEqual([3, 2]);
    expect(list.current.page).toBe(2);
    expect(list.current.data.bookings[0].id).toBe("last-page");
  });
});

describe("useBookingList (reload)", () => {
  it("fetches the view on screen again, as after a row action", async () => {
    const list = mount();
    act(() => list.current.setFilter("new"));
    await wait();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(pageOf(59, "reloaded"));

    await act(() => list.current.reload());
    expect(fetched()).toEqual([{ ...INITIAL_VIEW, filter: "new" }]);
    expect(list.current.data.total).toBe(59);
  });
});
