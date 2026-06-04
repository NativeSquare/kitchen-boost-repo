/**
 * PWA-S2 (#450) — 192×192 dynamic PWA icon route (cf. `lib/pwa-manifest/
 * icon-route.ts` for the shared logic). Referenced by the manifest's
 * `icons[0]`.
 */
import { serveTenantIcon } from "@/lib/pwa-manifest/icon-route";

export async function GET() {
  return serveTenantIcon();
}
