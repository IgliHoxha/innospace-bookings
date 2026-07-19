import type { BookingStatus } from "./types";

// Shared by the server page and the client dashboard. Kept in a plain module
// (NOT the "use client" component) so the server imports the real values
// rather than client-reference proxies.
export const PAGE_SIZE = 25;
export const INITIAL_FILTER: "all" | BookingStatus = "new";
