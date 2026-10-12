// The date rules of the website's booking form, repeated here so a request that
// skips the form cannot book what the form would refuse. Keep the two in step.

import { zonedStamp } from "./datetime";
import type { BookingPlan } from "./types";

const ZONE = "Europe/Tirane";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Today stays bookable on a working day until this hour, Tirana time. */
export const SAME_DAY_CUTOFF_HOUR = 13;

/** The shortest hourly booking of the event room. */
export const MIN_ROOM_HOURS = 3;

/** What the form allowed minutes ago still passes: clocks drift and the machine takes seconds to wake. */
export const DATE_GRACE_MS = 10 * 60 * 1000;

const STAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

// `at` counts the wall clock as if it were UTC, so two moments compare without a zone.
type Moment = { day: string; timed: boolean; at: number };

function parse(value: string | undefined): Moment | null {
  const m = STAMP.exec(value ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map((v) => Number(v ?? 0));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Date.UTC rolls 31 April into May, so a date that does not read back is not real.
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    h < 24 &&
    mi < 60;
  if (!real) return null;
  return {
    day: m[0].slice(0, 10),
    timed: m[4] !== undefined,
    at: date.getTime(),
  };
}

const weekday = (at: number) => new Date(at).getUTCDay();

const isWeekend = (moment: Moment) => [0, 6].includes(weekday(moment.at));

// The website's rule: today before the cutoff, else the next working day and its 17:00 cutoff.
function daysToFirstBookableDay(day: number, hour: number): number {
  const weekend = day === 0 || day === 6;
  if (!weekend && hour < SAME_DAY_CUTOFF_HOUR) return 0;
  let days = day === 5 || day === 6 ? 3 : day === 0 ? 2 : 1;
  if (hour > 17) {
    if (!weekend) days += 1;
    if (day === 4) days += 2;
  }
  return days;
}

/** The first day that can be booked at `stamp`, a Tirana "YYYY-MM-DDTHH:mm". */
export function earliestBookableDay(stamp: string): string {
  const today = Date.parse(`${stamp.slice(0, 10)}T00:00:00Z`);
  const days = daysToFirstBookableDay(
    weekday(today),
    Number(stamp.slice(11, 13)),
  );
  return new Date(today + days * DAY_MS).toISOString().slice(0, 10);
}

/** Why a booking's dates are refused, worded for the response, or null when they pass. */
export function bookingDatesError(
  plan: BookingPlan | undefined,
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): string | null {
  // Dates are optional on this endpoint, so only what was sent is checked.
  if (from === undefined && to === undefined) return null;

  const start = parse(from);
  const end = to === undefined ? start : parse(to);
  if (!start || !end) return "Invalid booking dates.";
  if (end.at < start.at) return "The end date cannot be before the start date.";

  // Both clocks are read, since the one a few minutes back is stricter just after midnight.
  const current = zonedStamp(now, ZONE);
  const lenient = zonedStamp(new Date(now.getTime() - DATE_GRACE_MS), ZONE);
  const earliest = [current, lenient].map(earliestBookableDay).sort()[0];
  if (start.day < earliest) return `The earliest start date is ${earliest}.`;
  if (start.timed && start.at < (parse(lenient)?.at ?? 0))
    return "That start time has already passed.";

  if (plan === "daily-pass" && (isWeekend(start) || isWeekend(end)))
    return "A Day Pass can only be booked for weekdays.";
  if (
    plan === "event-room" &&
    start.timed &&
    end.timed &&
    end.at - start.at < MIN_ROOM_HOURS * HOUR_MS
  )
    return `An hourly booking is at least ${MIN_ROOM_HOURS} hours.`;

  return null;
}
