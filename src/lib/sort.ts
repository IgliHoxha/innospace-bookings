// The dashboard table's sortable columns. A plain module (like pagination.ts) so
// the API route, the db layer and the client component share one definition.

export const BOOKING_SORTS = [
  "createdAt",
  "guest",
  "plan",
  "dates",
  "note",
  "status",
] as const;

export type BookingSort = (typeof BOOKING_SORTS)[number];
export type SortDir = "asc" | "desc";

export interface SortState {
  key: BookingSort;
  dir: SortDir;
}

/** How the table opens: the latest booked day on top. */
export const INITIAL_SORT: SortState = { key: "dates", dir: "desc" };

// A date column opens newest first; a text column opens A to Z.
const FIRST_DIR: Record<BookingSort, SortDir> = {
  createdAt: "desc",
  guest: "asc",
  plan: "asc",
  dates: "desc",
  note: "asc",
  status: "asc",
};

/** The sort after a click on a column header: the active column flips, another opens. */
export function nextSort(current: SortState, key: BookingSort): SortState {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/** Read the `sort` / `dir` query params, dropping anything that is not a known value. */
export function parseSort(
  sort: string | null,
  dir: string | null,
): { sort?: BookingSort; dir?: SortDir } {
  return {
    sort: BOOKING_SORTS.find((s) => s === sort),
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
  };
}
