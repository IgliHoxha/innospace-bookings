"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Booking, BookingStatus } from "@/lib/types";
import type { BookingPage } from "@/lib/db";
import { PAGE_SIZE, INITIAL_FILTER } from "@/lib/pagination";
import {
  bookingTypeLabel,
  emailBodyText,
  emailSubject,
  formatDateRangeShort,
  formatDateTime,
  type ContactInfo,
  type EmailStatus,
  type Pricing,
} from "@/lib/templates";

const FILTERS: { key: "all" | BookingStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "deleted", label: "Deleted" },
];

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
  const router = useRouter();
  const [data, setData] = useState<BookingPage>(initialData);
  const [filter, setFilter] = useState<"all" | BookingStatus>(INITIAL_FILTER);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Permanent-delete selection (only used on the Deleted view).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  // Per-booking, per-status edited email bodies (id -> { confirmed?, cancelled? }).
  const [drafts, setDrafts] = useState<
    Record<string, Partial<Record<EmailStatus, string>>>
  >({});
  const [pending, setPending] = useState<{
    id: string;
    name: string;
    email: string;
    status: Exclude<BookingStatus, "new">;
    body: string;
  } | null>(null);

  const bookings = data.bookings;
  const counts = data.counts;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function draftFor(b: Booking, status: EmailStatus): string {
    return drafts[b.id]?.[status] ?? emailBodyText(b, status, pricing, contact);
  }
  function setDraft(id: string, status: EmailStatus, value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [status]: value } }));
  }

  // Request id guards against a slow response overwriting a newer one.
  const reqId = useRef(0);
  const loadPage = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams({
      status: filter,
      q: debouncedQuery,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    try {
      const res = await fetch(`/api/bookings?${params.toString()}`);
      const json = (await res.json()) as BookingPage & { ok: boolean };
      if (id !== reqId.current) return; // superseded by a newer request
      if (!json.ok) return;
      const tp = Math.max(1, Math.ceil(json.total / PAGE_SIZE));
      if (page > tp) {
        setPage(tp); // page fell out of range (e.g. last row on last page gone)
        return;
      }
      setData(json);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filter, debouncedQuery, page]);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Any filter/search change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [filter, debouncedQuery]);

  // Skip the first render - the server already supplied page 1.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    loadPage();
  }, [loadPage]);

  async function setStatus(
    id: string,
    status: BookingStatus,
    emailBody?: string,
  ) {
    await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, emailBody }),
    });
    loadPage(); // re-sync the visible page and the stat counts
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
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
    await fetch("/api/bookings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    loadPage();
  }

  // Reset the permanent-delete selection whenever the view changes.
  useEffect(() => {
    setSelected(new Set());
  }, [filter, debouncedQuery, page]);

  // Close the user menu on any outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/dashboard" aria-label="Go to bookings">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="topbar-logo"
              src="/logo.svg"
              alt="Innospace Tirana"
            />
            <span className="brand-sub">Bookings</span>
          </a>
          <div className="user-menu">
            <button
              className="user-btn"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="avatar">{username.charAt(0).toUpperCase()}</span>
              <span className="user-name">{username}</span>
              <span className="caret">▾</span>
            </button>
            {menuOpen && (
              <div className="user-dropdown" role="menu">
                <div className="user-dropdown-head">
                  Signed in as
                  <strong>{username}</strong>
                </div>
                <button className="user-dropdown-item" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container">
        <div className="page-head">
          <span className="eyebrow">Innospace Tirana</span>
          <h1 className="page-title">Booking requests</h1>
          <p className="page-subtitle">
            Review incoming reservations, confirm or cancel, and send the guest
            their email - all in one place.
          </p>
        </div>

        <div className="stats">
          <Stat
            num={counts.total}
            label="Total"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <Stat
            num={counts.new}
            label="New"
            active={filter === "new"}
            onClick={() => setFilter("new")}
          />
          <Stat
            num={counts.confirmed}
            label="Confirmed"
            active={filter === "confirmed"}
            onClick={() => setFilter("confirmed")}
          />
          <Stat
            num={counts.cancelled}
            label="Cancelled"
            active={filter === "cancelled"}
            onClick={() => setFilter("cancelled")}
          />
          <Stat
            num={counts.deleted}
            label="Deleted"
            active={filter === "deleted"}
            onClick={() => setFilter("deleted")}
          />
        </div>

        <div className="toolbar">
          <input
            id="search"
            name="search"
            type="search"
            placeholder="Search name, email, plan, note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

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
            <table>
              <thead>
                <tr>
                  {filter === "deleted" && (
                    <th>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  <th>Created at</th>
                  <th>Guest</th>
                  <th>Plan</th>
                  <th>Dates</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    {filter === "deleted" && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(b.id)}
                          onChange={() => toggleSelected(b.id)}
                          aria-label={`Select booking ${b.fullName || b.id}`}
                        />
                      </td>
                    )}
                    <td>
                      <WhenCell iso={b.createdAt} />
                    </td>
                    <td className="who">
                      <strong>{b.fullName || "-"}</strong>
                      {b.email && (
                        <small>
                          <a href={`mailto:${b.email}`}>{b.email}</a>
                        </small>
                      )}
                      {b.phoneNumber && (
                        <small>
                          <br />
                          <a href={`tel:${b.phoneNumber}`}>{b.phoneNumber}</a>
                        </small>
                      )}
                    </td>
                    <td>{b.plan ? bookingTypeLabel(b) : "-"}</td>
                    <td className="dates">
                      {formatDateRangeShort(b.from, b.to)}
                    </td>
                    <td style={{ maxWidth: 220 }}>{b.note || "-"}</td>
                    <td>
                      <span className={`badge ${b.status}`}>{b.status}</span>
                    </td>
                    <td>
                      <EmailPreview
                        booking={b}
                        drafts={drafts[b.id] || {}}
                        pricing={pricing}
                        contact={contact}
                        onChange={(status, value) =>
                          setDraft(b.id, status, value)
                        }
                      />
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          className="icon-btn tick"
                          title="Confirm booking"
                          aria-label="Confirm booking"
                          disabled={b.status === "confirmed"}
                          onClick={() =>
                            setPending({
                              id: b.id,
                              name: b.fullName || "",
                              email: b.email || "",
                              status: "confirmed",
                              body: draftFor(b, "confirmed"),
                            })
                          }
                        >
                          ✓
                        </button>
                        <button
                          className="icon-btn cross"
                          title="Cancel booking"
                          aria-label="Cancel booking"
                          disabled={b.status === "cancelled"}
                          onClick={() =>
                            setPending({
                              id: b.id,
                              name: b.fullName || "",
                              email: b.email || "",
                              status: "cancelled",
                              body: draftFor(b, "cancelled"),
                            })
                          }
                        >
                          ✕
                        </button>
                        <button
                          className="icon-btn trash"
                          title="Delete booking"
                          aria-label="Delete booking"
                          disabled={b.status === "deleted"}
                          onClick={() =>
                            setPending({
                              id: b.id,
                              name: b.fullName || "",
                              email: b.email || "",
                              status: "deleted",
                              body: "",
                            })
                          }
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            shown={bookings.length}
            loading={loading}
            onPage={setPage}
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
        <div
          className="modal-overlay"
          onClick={() => setConfirmPurge(false)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Delete permanently?</h2>
            <p>
              This will permanently remove{" "}
              <strong>
                {selected.size} booking{selected.size === 1 ? "" : "s"}
              </strong>{" "}
              from the database. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => setConfirmPurge(false)}
              >
                No
              </button>
              <button className="btn danger" onClick={deleteForever}>
                Yes, delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div
          className="modal-overlay"
          onClick={() => setPending(null)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>
              {pending.status === "confirmed"
                ? "Confirm booking?"
                : pending.status === "cancelled"
                  ? "Cancel booking?"
                  : "Delete booking?"}
            </h2>
            <p>
              {pending.status === "confirmed"
                ? "Confirm"
                : pending.status === "cancelled"
                  ? "Cancel"
                  : "Delete"}{" "}
              the booking
              {pending.name ? (
                <>
                  {" "}
                  for <strong>{pending.name}</strong>
                </>
              ) : null}
              ?
              {pending.status === "deleted"
                ? " It will be hidden from the list (no email is sent)."
                : pending.email
                  ? ` The ${pending.status === "confirmed" ? "confirmation" : "cancellation"} email (as shown in the Email column) will be sent to ${pending.email}.`
                  : " (No email on file - nothing will be sent.)"}
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPending(null)}>
                No
              </button>
              <button
                className={`btn ${pending.status === "confirmed" ? "" : "danger"}`}
                onClick={() => {
                  setStatus(pending.id, pending.status, pending.body);
                  setPending(null);
                }}
              >
                Yes,{" "}
                {pending.status === "confirmed"
                  ? "confirm"
                  : pending.status === "cancelled"
                    ? "cancel"
                    : "delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Compact list of page numbers with ellipses, e.g. 1 … 4 5 [6] 7 8 … 20.
function pageList(page: number, totalPages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const push = (n: number) => out.push(n);
  const window = 1; // pages to show on each side of the current page
  const last = totalPages;
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || (p >= page - window && p <= page + window)) {
      push(p);
    } else if (out[out.length - 1] !== "…") {
      out.push("…");
    }
  }
  return out;
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  shown,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  shown: number;
  loading: boolean;
  onPage: (p: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = (page - 1) * pageSize + shown;
  return (
    <div className="pagination">
      <span className="pagination-info">
        {first}–{lastRow} of {total}
        {loading ? " · loading…" : ""}
      </span>
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            className="page-btn"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            ‹ Prev
          </button>
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="page-gap">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`page-btn ${p === page ? "active" : ""}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            ),
          )}
          <button
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  num,
  label,
  active,
  onClick,
}: {
  num: number;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`stat ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <div className="num">{num}</div>
      <div className="label">{label}</div>
    </button>
  );
}

// Client-only timestamp render to avoid a server/client hydration mismatch.
function WhenCell({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(formatDateTime(iso));
  }, [iso]);
  return (
    <span className="dates" suppressHydrationWarning>
      {text || "-"}
    </span>
  );
}

/** Per-row, editable email body with Confirm / Cancel tabs. */
function EmailPreview({
  booking,
  drafts,
  pricing,
  contact,
  onChange,
}: {
  booking: Booking;
  drafts: Partial<Record<EmailStatus, string>>;
  pricing: Pricing;
  contact: ContactInfo;
  onChange: (status: EmailStatus, value: string) => void;
}) {
  const [tab, setTab] = useState<EmailStatus>("confirmed");

  // Deleted bookings have no associated email.
  if (booking.status === "deleted") {
    return <span className="muted">-</span>;
  }

  // Once actioned, the email is locked - show only the one that was sent.
  if (booking.status !== "new") {
    const sent = booking.status as EmailStatus;
    const value =
      drafts[sent] ?? emailBodyText(booking, sent, pricing, contact);
    return (
      <div className="email-preview">
        <div className={`email-sent ${sent}`}>
          {sent === "confirmed" ? "Confirmation sent" : "Cancellation sent"}
        </div>
        <div className="email-subject">
          Subject: {emailSubject(sent, booking)}
        </div>
        <textarea
          id={`email-${booking.id}-${sent}`}
          name={`email-${booking.id}-${sent}`}
          className="email-text"
          rows={7}
          value={value}
          readOnly
          aria-label={`${sent} email body (sent)`}
        />
      </div>
    );
  }

  const value = drafts[tab] ?? emailBodyText(booking, tab, pricing, contact);
  return (
    <div className="email-preview">
      <div className="email-tabs">
        <button
          type="button"
          className={`email-tab ${tab === "confirmed" ? "active" : ""}`}
          onClick={() => setTab("confirmed")}
        >
          Confirm
        </button>
        <button
          type="button"
          className={`email-tab ${tab === "cancelled" ? "active cancel" : ""}`}
          onClick={() => setTab("cancelled")}
        >
          Cancel
        </button>
      </div>
      <div className="email-subject">Subject: {emailSubject(tab, booking)}</div>
      <textarea
        id={`email-${booking.id}-${tab}`}
        name={`email-${booking.id}-${tab}`}
        className="email-text"
        rows={7}
        value={value}
        onChange={(e) => onChange(tab, e.target.value)}
        aria-label={`${tab} email body`}
      />
    </div>
  );
}
