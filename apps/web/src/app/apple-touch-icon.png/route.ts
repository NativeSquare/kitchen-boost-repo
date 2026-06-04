/**
 * PWA-S2 (#450) — 180×180 Apple touch icon route (cf. `lib/pwa-manifest/
 * icon-route.ts` for the shared logic). Referenced by the manifest's
 * `icons[2]` AND by the root layout's `<link rel="apple-touch-icon">` —
 * Safari iOS reads the latter for the home-screen icon (it ignores the
 * manifest icons array entirely, hence the dedicated route).
 */
import { serveTenantIcon } from "@/lib/pwa-manifest/icon-route";

export async function GET() {
  return serveTenantIcon();
}
