import type { BookingCounts } from "@/lib/db";
import type { BookingFilter } from "@/lib/types";

// One entry drives a stat box and a chip. Only "all" is worded differently on
// the box, where it reads as a count.
const FILTERS: { key: BookingFilter; label: string; stat?: string }[] = [
  { key: "all", label: "All", stat: "Total" },
  { key: "new", label: "New" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "deleted", label: "Deleted" },
];

/** The stat boxes, the search box and the status chips above the list. */
export default function ListControls({
  counts,
  filter,
  onFilter,
  query,
  onQuery,
}: {
  counts: BookingCounts;
  filter: BookingFilter;
  onFilter: (filter: BookingFilter) => void;
  query: string;
  onQuery: (query: string) => void;
}) {
  return (
    <>
      <div className="stats">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`stat ${filter === f.key ? "active" : ""}`}
            onClick={() => onFilter(f.key)}
          >
            <div className="num">
              {f.key === "all" ? counts.total : counts[f.key]}
            </div>
            <div className="label">{f.stat ?? f.label}</div>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          id="search"
          name="search"
          type="search"
          placeholder="Search name, email, plan, note…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? "active" : ""}`}
            onClick={() => onFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </>
  );
}
