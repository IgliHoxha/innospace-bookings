import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingPage } from "@/lib/db";
import {
  INITIAL_VIEW,
  withFilter,
  withPage,
  withSearch,
  withSort,
  type ListView,
} from "@/lib/list-view";
import { pageCount } from "@/lib/pagination";
import type { BookingSort } from "@/lib/sort";
import type { BookingFilter } from "@/lib/types";
import { fetchBookings } from "./api";

/**
 * The list's view (filter, search, sort, page) and the page of bookings the
 * server returns for it. The first page comes from the server render.
 */
export function useBookingList(initialData: BookingPage) {
  const [data, setData] = useState<BookingPage>(initialData);
  // One state for the whole view: a change that also resets the page is then a
  // single update, so the list is fetched once for it.
  const [view, setView] = useState<ListView>(INITIAL_VIEW);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const setFilter = useCallback(
    (filter: BookingFilter) => setView((v) => withFilter(v, filter)),
    [],
  );
  const sortBy = useCallback(
    (key: BookingSort) => setView((v) => withSort(v, key)),
    [],
  );
  const setPage = useCallback(
    (page: number) => setView((v) => withPage(v, page)),
    [],
  );

  // Request id guards against a slow response overwriting a newer one.
  const reqId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const next = await fetchBookings(view);
      if (id !== reqId.current) return; // superseded by a newer request
      if (!next) return;
      const last = pageCount(next.total);
      if (view.page > last) {
        setPage(last); // page fell out of range (e.g. last row on last page gone)
        return;
      }
      setData(next);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [view, setPage]);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setView((v) => withSearch(v, query)), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Skip the first render - the server already supplied page 1.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    reload();
  }, [reload]);

  return {
    data,
    loading,
    filter: view.filter,
    setFilter,
    /** The search box as typed; `search` is the debounced value the list uses. */
    query,
    setQuery,
    search: view.search,
    sort: view.sort,
    sortBy,
    page: view.page,
    setPage,
    reload,
  };
}
