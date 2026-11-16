// The dashboard list's view (filter, search, sort, page) as a plain module, so its changes are unit tested.
import { INITIAL_FILTER } from "./pagination";
import {
  INITIAL_SORT,
  nextSort,
  type BookingSort,
  type SortState,
} from "./sort";
import type { BookingFilter } from "./types";

export interface ListView {
  filter: BookingFilter;
  search: string;
  sort: SortState;
  page: number;
}

/** How the list opens. */
export const INITIAL_VIEW: ListView = {
  filter: INITIAL_FILTER,
  search: "",
  sort: INITIAL_SORT,
  page: 1,
};

// Each change returns the same object when nothing changed, and resets the page in the same step: one fetch, not two.

export function withFilter(view: ListView, filter: BookingFilter): ListView {
  return view.filter === filter ? view : { ...view, filter, page: 1 };
}

export function withSearch(view: ListView, search: string): ListView {
  return view.search === search ? view : { ...view, search, page: 1 };
}

/** A click on a column header (see nextSort). */
export function withSort(view: ListView, key: BookingSort): ListView {
  return { ...view, sort: nextSort(view.sort, key), page: 1 };
}

export function withPage(view: ListView, page: number): ListView {
  return view.page === page ? view : { ...view, page };
}
