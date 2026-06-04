/**
 * PWA-S3 (#451) — `/menu` PLACEHOLDER.
 *
 * The full menu page (ISR + Convex sub overlay LIVE + item modal Vaul + filters
 * allergènes + LCP <1.5s) is the deliverable of PWA-S4 (#452). This placeholder
 * exists ONLY so the address-first `redirect` verdict (`<AddressFirstForm>`
 * → `decideAddressFirstAction` → `{ kind: "redirect", path: "/menu" }`) has a
 * valid target. Without it, the verdict-OK branch would 404 in E2E.
 *
 * Pattern aligned on the RSC home (`app/page.tsx`): reads the
 * `__Host-kb_tenant` cookie set by the PWA edge middleware (#449) and shows
 * the tenant name so a tester can confirm the redirect worked end-to-end on a
 * device. The actual content is intentionally minimal — replaced wholesale by
 * #452.
 */
import { cookies } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function MenuPage() {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  const tenant =
    tenantId === undefined
      ? null
      : await fetchQuery(api.lib.tenants.resolution.byId, { tenantId });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold text-black">
          {tenant === null ? "Menu" : `Menu — ${tenant.name}`}
        </h1>
        <p className="text-base text-zinc-600">
          La carte arrive bientôt — l&apos;équipe prépare l&apos;app.
        </p>
      </div>
    </main>
  );
}
