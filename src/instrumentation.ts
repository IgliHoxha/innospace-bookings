// Next calls this once per server start. The Fly machine cold-boots on each wake, so that is this app's only clock.
export async function register(): Promise<void> {
  // A positive check, so the bundler drops the import (and SQLite) from the edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReviewEmails } = await import("@/lib/review-auto");
    startReviewEmails();
  }
}
