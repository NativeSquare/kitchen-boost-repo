/**
 * PWA-S2 (#450) — 512×512 dynamic PWA icon route (cf. `lib/pwa-manifest/
 * icon-route.ts` for the shared logic). Referenced by the manifest's
 * `icons[1]` — the largest size, used for the Android launcher tile + the
 * iOS share-sheet preview.
 */
import { serveTenantIcon } from "@/lib/pwa-manifest/icon-route";

export async function GET() {
  return serveTenantIcon();
}
