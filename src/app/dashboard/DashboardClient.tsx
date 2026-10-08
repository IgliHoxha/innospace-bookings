"use client";

import { useEffect, useState } from "react";
import type { BookingPage } from "@/lib/db";
import { emailBodyText, type EmailStatus } from "@/lib/templates";
import type { Booking, ContactInfo, Pricing } from "@/lib/types";
import { markReviewAsked, purgeBookings, updateStatus } from "./api";
import BookingsTable from "./BookingsTable";
import ConfirmDialog from "./ConfirmDialog";
import type { EmailDrafts } from "./EmailPreview";
import ListControls from "./ListControls";
import Pagination from "./Pagination";
import type { RowAction } from "./row-actions";
import Topbar from "./Topbar";
import { useBookingList } from "./useBookingList";

/** A row action waiting on its yes/no prompt. */
interface PendingAction {
  booking: Booking;
  action: RowAction;
  body: string; // the email body as it stood when the button was clicked
}

/** What saying yes will do beyond changing the status. */
function outcome({ booking, action }: PendingAction): string {
  if (!action.email) {
    return "It will be hidden from the list (no email is sent).";
  }
  return booking.email
    ? `The ${action.email} email (as shown in the Email column) will be sent to ${booking.email}.`
    : "(No email on file - nothing will be sent.)";
}

export default function DashboardClient({
  initialData,
  username,
  pricing,
  contact,
}: {
  initialData: BookingPage;
  username: string;
  pricing: Pricing;
  contact: ContactInfo;
}) {
  const list = useBookingList(initialData);
  const { filter, search, sort, page, loading, reload } = list;
  const { bookings, counts, total } = list.data;

  // Permanent-delete selection (only used on the Deleted view).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  // Per-booking, per-status edited email bodies (id -> { confirmed?, cancelled? }).
  const [drafts, setDrafts] = useState<Record<string, EmailDrafts>>({});
  const [pending, setPending] = useState<PendingAction | null>(null);

  // Reset the permanent-delete selection whenever the view changes.
  useEffect(() => {
    setSelected(new Set());
  }, [filter, search, sort, page]);

  function draftFor(b: Booking, status: EmailStatus): string {
    return drafts[b.id]?.[status] ?? emailBodyText(b, status, pricing, contact);
  }
  function setDraft(id: string, status: EmailStatus, value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [status]: value } }));
  }

  function ask(booking: Booking, action: RowAction) {
    const body =
      action.status === "deleted" ? "" : draftFor(booking, action.status);
    setPending({ booking, action, body });
  }

  async function run({ booking, action, body }: PendingAction) {
    await updateStatus(booking.id, action.status, body);
    reload(); // re-sync the visible page and the stat counts
  }

  async function setReviewAsked(id: string, asked: boolean) {
    await markReviewAsked(id, asked);
    reload();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select-all operates on the current page only.
  const allVisibleSelected =
    bookings.length > 0 && bookings.every((b) => selected.has(b.id));

  function toggleSelectAll() {
    setSelected(
      allVisibleSelected ? new Set() : new Set(bookings.map((b) => b.id)),
    );
  }

  async function deleteForever() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSelected(new Set());
    setConfirmPurge(false);
    await purgeBookings(ids);
    reload();
  }

  return (
    <>
      <Topbar username={username} />

      <div className="container">
        <div className="page-head">
          <span className="eyebrow">Innospace Tirana</span>
          <h1 className="page-title">Booking requests</h1>
          <p className="page-subtitle">
            Review incoming reservations, confirm or cancel, and send the guest
            their email - all in one place.
          </p>
        </div>

        <ListControls
          counts={counts}
          filter={filter}
          onFilter={list.setFilter}
          query={list.query}
          onQuery={list.setQuery}
        />

        {filter === "deleted" && bookings.length > 0 && (
          <div className="bulk-bar">
            <label className="bulk-select">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
              />
              Select all
            </label>
            <span className="bulk-count">{selected.size} selected</span>
            <button
              className="btn danger"
              disabled={selected.size === 0}
              onClick={() => setConfirmPurge(true)}
            >
              Delete permanently
            </button>
          </div>
        )}

        <div className="card" aria-busy={loading}>
          {bookings.length === 0 ? (
            <div className="empty">
              {loading ? "Loading…" : "No bookings to show."}
            </div>
          ) : (
            <BookingsTable
              bookings={bookings}
              sort={sort}
              onSort={list.sortBy}
              selection={
                filter === "deleted"
                  ? {
                      ids: selected,
                      all: allVisibleSelected,
                      onToggle: toggleSelected,
                      onToggleAll: toggleSelectAll,
                    }
                  : undefined
              }
              drafts={drafts}
              onDraftChange={setDraft}
              pricing={pricing}
              contact={contact}
              onAction={ask}
              onReviewAsked={setReviewAsked}
            />
          )}
        </div>

        {total > 0 && (
          <Pagination
            page={page}
            total={total}
            shown={bookings.length}
            loading={loading}
            onPage={list.setPage}
          />
        )}
      </div>

      <footer className="site-footer">
        <div className="site-footer-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="site-footer-logo"
            src="/logo.svg"
            alt="Innospace Tirana"
          />
          <span className="site-footer-copy">
            © {new Date().getFullYear()} Innospace Tirana. All rights reserved.
          </span>
        </div>
      </footer>

      {confirmPurge && (
        <ConfirmDialog
          title="Delete permanently?"
          confirmLabel="Yes, delete permanently"
          danger
          onConfirm={deleteForever}
          onCancel={() => setConfirmPurge(false)}
        >
          This will permanently remove{" "}
          <strong>
            {selected.size} booking{selected.size === 1 ? "" : "s"}
          </strong>{" "}
          from the database. This cannot be undone.
        </ConfirmDialog>
      )}

      {pending && (
        <ConfirmDialog
          title={`${pending.action.verb} booking?`}
          confirmLabel={`Yes, ${pending.action.verb.toLowerCase()}`}
          danger={pending.action.status !== "confirmed"}
          onConfirm={() => {
            run(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        >
          {pending.action.verb} the booking
          {pending.booking.fullName ? (
            <>
              {" "}
              for <strong>{pending.booking.fullName}</strong>
            </>
          ) : null}
          ? {outcome(pending)}
        </ConfirmDialog>
      )}
    </>
  );
}
