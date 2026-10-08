import { PAGE_SIZE, pageCount, pageList } from "@/lib/pagination";

/** "26-50 of 172" plus the page buttons, which appear once there is a second page. */
export default function Pagination({
  page,
  total,
  shown,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  shown: number; // rows on the current page
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const totalPages = pageCount(total);
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = (page - 1) * PAGE_SIZE + shown;
  return (
    <div className="pagination">
      <span className="pagination-info">
        {first}-{last} of {total}
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
