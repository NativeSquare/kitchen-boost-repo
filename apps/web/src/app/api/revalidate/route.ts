/**
 * PWA-S4 (#452) — on-demand ISR invalidation route for the `/menu` HTML
 * (decisions-log Q2 « ISR + on-demand revalidate au clic Publier »).
 *
 * The Convex `publishMenu` mutation schedules
 * `internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag` which
 * POSTs `{ tenantId: "<id>" }` here, signed with HMAC-SHA256 over
 * `${timestamp}.${body}` keyed on `MENU_REVALIDATE_HMAC_SECRET`. The route
 * verifies the signature BEFORE parsing the body (same discipline as the
 * Wallet push + Web Push routes), then calls `revalidateTag(menu:<tenantId>)`.
 *
 * Auth verdict + body parsing are entirely delegated to the PURE
 * `decideRevalidateRequest` (vitest-pinned in node env), so this route is
 * a thin IO wrapper: read raw body → read headers → decide → branch.
 *
 * Node runtime: keeps `crypto.subtle` consistent + decouples from any Edge
 * surprise on `revalidateTag`. The route is tiny (< 1ms server time), the
 * extra cold-start is negligible at the throughput of a publishMenu fire.
 *
 * The matcher in `apps/web/src/proxy.ts` already EXCLUDES `/api/*` (`matcher:
 * ["/((?!_next|api|.*\\..*).*)"]`) so this route bypasses tenant resolution.
 * Same arrangement as `/api/push/send` (2.7-C #54).
 */
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { decideRevalidateRequest } from "@/lib/menu-revalidate";

export const runtime = "nodejs";

/** Replay tolerance window in seconds — mirrors Web Push / Wallet routes. */
const TOLERANCE_SECONDS = 300;

function secretOrNull(): string | null {
  const s = process.env.MENU_REVALIDATE_HMAC_SECRET;
  if (s === undefined || s === "") return null;
  return s;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = secretOrNull();
  if (secret === null) {
    // CI / dev with the env unset ⇒ 503 (consistent with 2.7-C Web Push).
    return NextResponse.json(
      { error: "MENU_REVALIDATE_HMAC_SECRET is not configured." },
      { status: 503 },
    );
  }

  // RAW body FIRST — never parse before verifying the channel HMAC.
  const body = await request.text();
  const verdict = await decideRevalidateRequest({
    secret,
    body,
    timestamp: request.headers.get("x-kb-timestamp"),
    signature: request.headers.get("x-kb-signature"),
    toleranceSeconds: TOLERANCE_SECONDS,
  });

  if (verdict.kind === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (verdict.kind === "bad-request") {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  // verdict.kind === "ok" — call Next's on-demand revalidation hook with
  // `menu:<tenantId>`. The `/menu` page registers itself under this tag via
  // `unstable_cache` (apps/web/src/app/menu/page.tsx). Next 16's signature is
  // `revalidateTag(tag, profile)` — we pass the "default" profile (the same
  // cache life shape `unstable_cache` registers with by default).
  revalidateTag(verdict.tag, "default");
  return NextResponse.json({ revalidated: true, tag: verdict.tag });
}
