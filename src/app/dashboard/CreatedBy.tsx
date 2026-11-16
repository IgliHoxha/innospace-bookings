const BUILT_BY = { name: "stackrover.tech", url: "https://stackrover.tech" };

// Stack Rover's own cube mark, as in its favicon.
function StackRoverMark() {
  return (
    <svg className="created-by-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0B1013" />
      <path d="M8 11 L16 7 L24 11 L16 15 Z" fill="#4CC9F0" />
      <path d="M8 11 L8 21 L16 25 L16 15 Z" fill="#1A262C" />
      <path d="M24 11 L24 21 L16 25 L16 15 Z" fill="#FF7A45" />
      <circle cx="16" cy="11" r="1.6" fill="#0B1013" />
    </svg>
  );
}

/** The footer's "Created by" credit, the same pill as on innospacetirana.com. */
export default function CreatedBy() {
  return (
    <a
      className="created-by"
      href={BUILT_BY.url}
      target="_blank"
      rel="noopener"
    >
      <StackRoverMark />
      <span>
        Created by <strong>{BUILT_BY.name}</strong>
      </span>
    </a>
  );
}
