// Sends the post-visit review email to every guest who is due. Server-only: never import it from a client component.
import { zonedDay } from "./datetime";
import {
  claimReviewEmail,
  listReviewCandidates,
  releaseReviewEmail,
} from "./db";
import { sendReviewRequestEmail } from "./email";
import { optionalEnv } from "./env-app";
import { isReviewEmailDue } from "./review";

// Guests are in Albania or were a day ago, so the clock that matters is Tirana's.
const ZONE = "Europe/Tirane";
// Local hours in which an email may go out: nobody wants this one at night.
const FIRST_HOUR = 9;
const LAST_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

type ReviewRun = {
  /** "off": not switched on. "quiet": outside sending hours. "ran": guests were checked. */
  status: "off" | "quiet" | "ran";
  sent: number;
  failed: number;
};

/** On only with REVIEW_AUTO_EMAIL=on plus the review link and mail key, so a dev machine with real keys mails nobody. */
export function reviewEmailsEnabled(): boolean {
  return (
    optionalEnv("REVIEW_AUTO_EMAIL") === "on" &&
    Boolean(optionalEnv("BUSINESS_REVIEW_URL")) &&
    Boolean(optionalEnv("RESEND_API_KEY"))
  );
}

async function run(now: Date): Promise<ReviewRun> {
  if (!reviewEmailsEnabled()) return { status: "off", sent: 0, failed: 0 };

  const { ymd: today, hour } = zonedDay(now, ZONE);
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) {
    return { status: "quiet", sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const booking of await listReviewCandidates()) {
    if (!isReviewEmailDue(booking, today)) continue;
    // Claim before sending: a second booking by the same person then fails here.
    if (!(await claimReviewEmail(booking.id, now.toISOString()))) continue;

    let ok = false;
    try {
      ok = await sendReviewRequestEmail(booking);
    } catch (err) {
      console.error("[review] sending a review request failed:", err);
    }
    if (ok) {
      sent += 1;
    } else {
      await releaseReviewEmail(booking.id);
      failed += 1;
    }
  }

  if (sent || failed) {
    console.log(`[review] review requests sent: ${sent}, failed: ${failed}`);
  }
  return { status: "ran", sent, failed };
}

let running: Promise<ReviewRun> | null = null;

/** Email every guest who is due. Calls made while a run is in flight share that run. */
export function sendDueReviewEmails(
  now: Date = new Date(),
): Promise<ReviewRun> {
  running ??= run(now).finally(() => {
    running = null;
  });
  return running;
}

/** Check now, then hourly while the process lives. The Fly machine cold-boots on every wake, so a wake is the clock. */
export function startReviewEmails(): void {
  const check = () => {
    sendDueReviewEmails().catch((err) =>
      console.error("[review] review request run failed:", err),
    );
  };
  check();
  setInterval(check, HOUR_MS).unref();
}
