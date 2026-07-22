import { NextRequest, NextResponse } from "next/server";
import { createBooking, queryBookings, deleteBookings } from "@/lib/db";
import {
  BOOKING_PLANS,
  BOOKING_STATUSES,
  type BookingInput,
  type BookingPlan,
  type BookingStatus,
} from "@/lib/types";
import {
  corsHeaders,
  isOriginAllowed,
  requestOrigin,
  requireAllowedOrigin,
} from "@/lib/cors";
import { verifyTurnstile } from "@/lib/turnstile";
import { requireSession } from "@/lib/api-auth";

// This route touches the filesystem and node:crypto - force the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CORS preflight. */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

/** Public: the website posts a booking here. */
export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));

  // Server-side origin gate: reject browser requests from origins not on the
  // ALLOWED_ORIGINS list. No-op while that list is "*" (the default).
  if (!isOriginAllowed(requestOrigin(req.headers))) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403, headers: cors },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Honeypot: `company` is a hidden field real users never fill. If a bot
    // auto-fills it, silently accept (so it doesn't retry) but store nothing.
    if (typeof body.company === "string" && body.company.trim() !== "") {
      console.warn("[bookings] honeypot tripped - dropping submission");
      return NextResponse.json({ ok: true }, { status: 201, headers: cors });
    }

    // Turnstile: no-op until TURNSTILE_SECRET_KEY is set; then a missing or
    // invalid token is rejected.
    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined,
      req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for"),
    );
    if (!turnstile.ok) {
      return NextResponse.json(
        { ok: false, error: "Verification failed. Please try again." },
        { status: 403, headers: cors },
      );
    }

    const input = normalize(body);

    if (!input.fullName && !input.email) {
      return NextResponse.json(
        { ok: false, error: "Missing booking details (name or email)." },
        { status: 400, headers: cors },
      );
    }

    // A present-but-unknown plan is an error; a missing one defaults (see normalize).
    const planRaw = typeof body.plan === "string" ? body.plan.trim() : "";
    if (planRaw && !BOOKING_PLANS.includes(planRaw as BookingPlan)) {
      return NextResponse.json(
        { ok: false, error: `Unknown plan: ${planRaw}.` },
        { status: 400, headers: cors },
      );
    }

    const booking = await createBooking(input);

    return NextResponse.json(
      { ok: true, id: booking.id },
      { status: 201, headers: cors },
    );
  } catch (err) {
    console.error("[bookings] POST failed:", err);
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400, headers: cors },
    );
  }
}

const VALID_FILTERS: readonly string[] = ["all", ...BOOKING_STATUSES];

/** Protected: the dashboard fetches a page of the list. Requires a session. */
export async function GET(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const filterParam = sp.get("status") ?? "all";
  const filter = (VALID_FILTERS.includes(filterParam) ? filterParam : "all") as
    "all" | BookingStatus;

  const page = await queryBookings({
    filter,
    search: sp.get("q") ?? "",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || 25,
  });

  return NextResponse.json({ ok: true, ...page });
}

/** Protected: permanently remove soft-deleted bookings from the DB. */
export async function DELETE(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const denied = requireSession(req);
  if (denied) return denied;

  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json(
      { ok: false, error: "Expected { ids: string[] }." },
      { status: 400 },
    );
  }

  const removed = await deleteBookings(ids as string[]);
  return NextResponse.json({ ok: true, removed });
}

function normalize(body: Record<string, unknown>): BookingInput {
  const str = (v: unknown) =>
    v === undefined || v === null ? undefined : String(v).trim() || undefined;

  const planRaw = str(body.plan);
  const plan: BookingPlan = BOOKING_PLANS.includes(planRaw as BookingPlan)
    ? (planRaw as BookingPlan)
    : "daily-pass";

  return {
    fullName: str(body.fullName),
    email: str(body.email),
    phoneNumber: str(body.phoneNumber),
    plan,
    from: str(body.from),
    to: str(body.to),
    note: str(body.note),
  };
}
