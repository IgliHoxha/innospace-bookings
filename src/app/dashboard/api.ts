// The dashboard's calls to this app's own API, kept together so no component
// builds a URL or a request body by hand.
import type { BookingPage } from "@/lib/db";
import type { ListView } from "@/lib/list-view";
import { PAGE_SIZE } from "@/lib/pagination";
import type { BookingStatus } from "@/lib/types";

function sendJson(
  url: string,
  method: "PATCH" | "DELETE",
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** One page of the list, or null when the server turns the request down. */
export async function fetchBookings(
  view: ListView,
): Promise<BookingPage | null> {
  const params = new URLSearchParams({
    status: view.filter,
    q: view.search,
    sort: view.sort.key,
    dir: view.sort.dir,
    page: String(view.page),
    pageSize: String(PAGE_SIZE),
  });
  const res = await fetch(`/api/bookings?${params.toString()}`);
  const json = (await res.json()) as BookingPage & { ok: boolean };
  return json.ok ? json : null;
}

/** Confirm, cancel or soft-delete a booking. `emailBody` replaces the template. */
export function updateStatus(
  id: string,
  status: BookingStatus,
  emailBody?: string,
): Promise<Response> {
  return sendJson(`/api/bookings/${id}`, "PATCH", { status, emailBody });
}

export function markReviewAsked(
  id: string,
  reviewAsked: boolean,
): Promise<Response> {
  return sendJson(`/api/bookings/${id}`, "PATCH", { reviewAsked });
}

/** Permanently remove soft-deleted bookings. */
export function purgeBookings(ids: string[]): Promise<Response> {
  return sendJson("/api/bookings", "DELETE", { ids });
}

export function logout(): Promise<Response> {
  return fetch("/api/login", { method: "DELETE" });
}
