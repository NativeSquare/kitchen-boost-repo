/**
 * PWA-S9b (#461) — `/api/wallet-bridge/clear` — POST surface the client
 * `<WalletBridgeRunner>` hits AFTER it ran `signIn("wallet-bridge", { serial })`
 * to wipe the short-lived `__Host-kb_wallet_bridge_pending` cookie
 * (decisions-log Q5, US 39 / 40 / 41 / 42).
 *
 * Why a dedicated route — and not `document.cookie = "...; Max-Age=0"`:
 * the cookie is `__Host-` prefixed → `Secure` + no `Domain` + `Path=/` are
 * mandatory (browser enforces); some browsers refuse `document.cookie`
 * writes that try to roll a `__Host-` cookie back to absent. The cleanest
 * cross-browser wipe is a server-side `response.cookies.delete` with the
 * SAME attributes, which is exactly what `NextResponse.cookies.delete`
 * emits. The route is a 2-line IO — no body, no auth (the cookie itself is
 * the only handle), no Convex round-trip.
 *
 * The matcher in `apps/web/src/proxy.ts` already EXCLUDES `/api/*` so this
 * route bypasses tenant resolution (same arrangement as `/api/push/send` and
 * `/api/revalidate`).
 *
 * The cookie has a 5-minute TTL FALLBACK (`WALLET_BRIDGE_COOKIE_MAX_AGE_S`),
 * so even a failed clear cannot strand the user — this route is the NOMINAL
 * clear, the TTL is the safety net.
 */
import { NextResponse } from "next/server";
import { WALLET_BRIDGE_PENDING_COOKIE } from "@/lib/wallet-bridge";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ cleared: true });
  response.cookies.delete(WALLET_BRIDGE_PENDING_COOKIE);
  return response;
}
