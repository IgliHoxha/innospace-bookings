import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import { handleTelegramUpdate, isTelegramWebhook } from "@/lib/telegram-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram posts every message sent to the bot here. There is no session: the
 * caller is known by the secret the webhook was registered with.
 */
export async function POST(req: NextRequest) {
  if (!isTelegramWebhook(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return jsonError("Unauthorized", 401);
  }

  // 200 whatever the update held: any other answer makes Telegram resend it.
  await handleTelegramUpdate(await req.json().catch(() => ({})));
  return NextResponse.json({ ok: true });
}
