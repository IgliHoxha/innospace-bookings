// The one failure shape every route returns, so no handler can drift from it.
import { NextResponse } from "next/server";

/** `{ ok: false, error }` with the given status. Keep `error` safe to show a client. */
export function jsonError(
  error: string,
  status: number,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers });
}
