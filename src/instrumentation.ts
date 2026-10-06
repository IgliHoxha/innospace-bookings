// Next calls this once per server start. The Fly machine stops when idle and
// cold-boots on the next request, so a server start is the only clock this app has.
export async function register(): Promise<void> {
  // A positive check, so the bundler drops the import (and SQLite) from the edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReviewEmails } = await import("@/lib/review-auto");
    startReviewEmails();
  }
}
