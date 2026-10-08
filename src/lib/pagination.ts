import type { BookingFilter } from "./types";

// Shared by the server page and the client dashboard. Kept in a plain module
// (NOT the "use client" component) so the server imports the real values
// rather than client-reference proxies.
export const PAGE_SIZE = 25;
export const INITIAL_FILTER: BookingFilter = "new";

/** How many pages `total` rows fill. An empty list still has its first page. */
export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export type PageItem = number | "…";

// Pages shown on each side of the current one.
const NEIGHBOURS = 1;

/** The pager's buttons, one "…" per run of pages left out: 1 … 4 5 6 … 20. */
export function pageList(page: number, totalPages: number): PageItem[] {
  const out: PageItem[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const near = Math.abs(p - page) <= NEIGHBOURS;
    if (p === 1 || p === totalPages || near) out.push(p);
    else if (out.at(-1) !== "…") out.push("…");
  }
  return out;
}
