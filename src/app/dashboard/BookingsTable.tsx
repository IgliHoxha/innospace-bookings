import { useEffect, useState } from "react";
import { formatDateRangeShort, formatDateTime } from "@/lib/datetime";
import type { BookingSort, SortState } from "@/lib/sort";
import { bookingTypeLabel, type EmailStatus } from "@/lib/templates";
import type { Booking, ContactInfo, Pricing } from "@/lib/types";
import EmailPreview, { type EmailDrafts } from "./EmailPreview";
import ReviewAsk from "./ReviewAsk";
import { ROW_ACTIONS, type RowAction } from "./row-actions";

// Email and Action hold controls, not a value, so they carry no sort key.
const COLUMNS: { label: string; sort?: BookingSort }[] = [
  { label: "Created at", sort: "createdAt" },
  { label: "Guest", sort: "guest" },
  { label: "Plan", sort: "plan" },
  { label: "Dates", sort: "dates" },
  { label: "Notes", sort: "note" },
  { label: "Status", sort: "status" },
  { label: "Email" },
  { label: "Action" },
];

/** The rows ticked for permanent deletion, and how to tick them. */
export interface RowSelection {
  ids: Set<string>;
  all: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

export default function BookingsTable({
  bookings,
  sort,
  onSort,
  selection,
  drafts,
  onDraftChange,
  pricing,
  contact,
  onAction,
  onReviewAsked,
}: {
  bookings: Booking[];
  sort: SortState;
  onSort: (key: BookingSort) => void;
  /** Passed on the Deleted view only, where it adds the checkbox column. */
  selection?: RowSelection;
  drafts: Record<string, EmailDrafts>;
  onDraftChange: (id: string, status: EmailStatus, value: string) => void;
  pricing: Pricing;
  contact: ContactInfo;
  onAction: (booking: Booking, action: RowAction) => void;
  onReviewAsked: (id: string, asked: boolean) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          {selection && (
            <th>
              <input
                type="checkbox"
                checked={selection.all}
                onChange={selection.onToggleAll}
                aria-label="Select all"
              />
            </th>
          )}
          {COLUMNS.map((c) =>
            c.sort ? (
              <SortHeader
                key={c.label}
                label={c.label}
                column={c.sort}
                sort={sort}
                onSort={onSort}
              />
            ) : (
              <th key={c.label}>{c.label}</th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {bookings.map((b) => (
          <tr key={b.id}>
            {selection && (
              <td>
                <input
                  type="checkbox"
                  checked={selection.ids.has(b.id)}
                  onChange={() => selection.onToggle(b.id)}
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
            <td className="dates">{formatDateRangeShort(b.from, b.to)}</td>
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
                onChange={(status, value) => onDraftChange(b.id, status, value)}
              />
            </td>
            <td>
              <div className="actions">
                {ROW_ACTIONS.map((action) => (
                  <button
                    key={action.status}
                    className={`icon-btn ${action.className}`}
                    title={`${action.verb} booking`}
                    aria-label={`${action.verb} booking`}
                    disabled={b.status === action.status}
                    onClick={() => onAction(b, action)}
                  >
                    {action.icon}
                  </button>
                ))}
                <ReviewAsk
                  booking={b}
                  contact={contact}
                  onAsked={(asked) => onReviewAsked(b.id, asked)}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A column header that sorts the list: a second click reverses the direction. */
function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: BookingSort;
  sort: SortState;
  onSort: (key: BookingSort) => void;
}) {
  const active = sort.key === column;
  const ascending = active && sort.dir === "asc";
  return (
    <th
      aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className={`th-sort ${active ? "active" : ""}`}
        onClick={() => onSort(column)}
      >
        {label}
        <span className="th-sort-arrow" aria-hidden="true">
          {active ? (ascending ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
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
