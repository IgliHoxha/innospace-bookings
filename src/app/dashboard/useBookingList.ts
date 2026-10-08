import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingPage } from "@/lib/db";
import { INITIAL_FILTER, pageCount } from "@/lib/pagination";
import {
  INITIAL_SORT,
  nextSort,
  type BookingSort,
  type SortState,
} from "@/lib/sort";
import type { BookingFilter } from "@/lib/types";
import { fetchBookings } from "./api";

/**
 * The list's view (filter, search, sort, page) and the page of bookings the
 * server returns for it. The first page comes from the server render.
 */
export function useBookingList(initialData: BookingPage) {
  const [data, setData] = useState<BookingPage>(initialData);
  const [filter, setFilter] = useState<BookingFilter>(INITIAL_FILTER);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>(INITIAL_SORT);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Request id guards against a slow response overwriting a newer one.
  const reqId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const next = await fetchBookings({ filter, search, sort, page });
      if (id !== reqId.current) return; // superseded by a newer request
      if (!next) return;
      const last = pageCount(next.total);
      if (page > last) {
        setPage(last); // page fell out of range (e.g. last row on last page gone)
        return;
      }
      setData(next);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filter, search, sort, page]);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Any filter/search/sort change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [filter, search, sort]);

  // Skip the first render - the server already supplied page 1.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    reload();
  }, [reload]);

  const sortBy = useCallback(
    (key: BookingSort) => setSort((s) => nextSort(s, key)),
    [],
  );

  return {
    data,
    loading,
    filter,
    setFilter,
    /** The search box as typed; `search` is the debounced value the list uses. */
    query,
    setQuery,
    search,
    sort,
    sortBy,
    page,
    setPage,
    reload,
  };
}
