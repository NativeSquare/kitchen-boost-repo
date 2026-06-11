/**
 * PWA-S3 (#451) + PWA-S12 (#464) — Address-first home (PRD §10 PWA Client,
 * decisions-log Q3 + Q7).
 *
 * Hybrid render:
 *  - RSC reads the `__Host-kb_tenant` cookie (set by the PWA edge middleware,
 *    PWA-S1 #449) → resolves the tenant's name for the heading.
 *  - RSC reads the Convex Auth token via `convexAuthNextjsToken()` and
 *    `preloadQuery(getCurrentCustomer)` to SILENTLY pre-fill the address input
 *    for a returning Sophie (decisions-log Q3 « pré-remplissage 2ᵉ visite »).
 *  - PWA-S12 (#464) — the same preloaded fiche drives the « Bonjour
 *    {firstName} 👋 » recognition banner (`<GreetingBanner>`) above the form
 *    AND the « Ce n'est pas moi → » disown link (`<NotMeLink>`) below it.
 *    The pure `decideReturnGreeting` (vitest-pinned) is the ONLY surface that
 *    turns the fiche into a visible « we recognise you » signal — it
 *    DELIBERATELY surfaces ONLY `firstName` (Q3 surveillance guardrail :
 *    JAMAIS « On a ton adresse » / mention d'historique explicite).
 *  - The `<AddressFirstForm>` is the client component that owns the Places
 *    Autocomplete + the address-first chain (signIn → getOrCreate →
 *    updateAddress → requestDeliveryQuote → decide-action).
 *
 * Three recognition branches (decisions-log Q3 table) :
 *   - `none`   — pas de fiche : ni banner, ni disown link, ni prefill.
 *   - `silent` — fiche présente mais pas de firstName : pas de banner,
 *                prefill silencieux du form, disown link visible (la session
 *                est désavouable même sans nom).
 *   - `banner` — fiche + firstName : banner « Bonjour {firstName} 👋 »,
 *                prefill, disown link.
 *
 * Edge cases (already handled by the middleware, so they never reach here):
 *  - Unknown host / orphan cookie / inactive tenant → `/erreur?reason=...`.
 *  - Apex `kitchen-boost.com` → `/erreur?reason=apex-host`.
 *
 * Defensive degraded state: cookie missing (= matcher mis-config in the
 * middleware) → render the generic KB shell without the form (the form
 * NEEDS a tenantId to run the chain). This keeps the page accessible even
 * if the routing is wrong, rather than throwing on `undefined!`.
 */
import { cookies } from "next/headers";
import { fetchQuery, preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { AddressFirstHome } from "@/components/address-first/address-first-home";
import { GreetingBanner, NotMeLink } from "@/components/return-greeting";
import { decideReturnGreeting } from "@/lib/return-greeting";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function Home() {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  if (tenantId === undefined) {
    // Degraded state — see file header. No form, no chain, just the shell.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-bold text-black">KitchenBoost</h1>
          <p className="text-base text-zinc-600">Bienvenue sur KitchenBoost.</p>
        </div>
      </main>
    );
  }

  // Tenant name for the heading (the same minimal projection PWA-S1 uses).
  const tenant = await fetchQuery(api.lib.tenants.resolution.byId, {
    tenantId,
  });

  // Silent pre-fill for returning Sophie. The token is read from the Convex
  // Auth session cookie (host-only, intra-resto — ADR 0008); if the cookie is
  // absent (first visit / 1-year expiry / private mode) the query returns
  // `null` and the input renders empty.
  let initialAddress: string | undefined = undefined;
  // PWA-S12 (#464) — the same preloaded fiche feeds the recognition verdict
  // (banner / silent / none). Default to `null` so the un-authenticated
  // branch maps cleanly onto the `none` decision.
  let greetingFiche: { firstName?: string; address?: string } | null = null;
  const token = await convexAuthNextjsToken();
  if (token !== undefined) {
    // We use `preloadQuery` (not raw `fetchQuery`) so the Convex framework can
    // attach the preloaded payload to the RSC stream — same pattern referenced
    // in decisions-log Q3.
    const preloaded = await preloadQuery(
      api.lib.customer.identity.getCurrentCustomer,
      { tenantId },
      { token },
    );
    // `preloadedQueryResult` is the official server-safe extractor of the
    // pre-fetched value out of the `Preloaded<>` envelope (Convex docs).
    const fiche = preloadedQueryResult(preloaded);
    initialAddress = fiche?.address;
    if (fiche !== null) {
      // Narrow to the subset `decideReturnGreeting` needs — the verdict
      // intentionally surfaces ONLY `firstName` (Q3 surveillance guardrail
      // pinned by `lib/return-greeting/decide-return-greeting.test.ts`).
      greetingFiche = {
        firstName: fiche.firstName,
        address: fiche.address,
      };
    }
  }

  const greeting = decideReturnGreeting(greetingFiche);
  const isRecognised = greeting.kind !== "none";
  // Q3 hospitality copy : the prefilled visit reframes the action as
  // « confirme ou modifie » (vs the first-visit imperative « indique-nous »).
  // This honours the spec bullet « bouton form passe de "Valider" à
  // "Confirmer" si address pré-remplie » — the post-S3 form has no submit
  // button (auto-fire on Places selection), so the cue lives in the subtitle
  // copy rather than on a non-existent button.
  const subtitle =
    initialAddress !== undefined
      ? "Confirme ton adresse de livraison, ou modifie-la."
      : "Indique-nous ton adresse, on vérifie si on peut te livrer.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-bold text-black">
          {tenant === null ? "KitchenBoost" : tenant.name}
        </h1>
        {greeting.kind === "banner" && (
          <GreetingBanner firstName={greeting.firstName} />
        )}
        <p className="text-base text-zinc-600">{subtitle}</p>
        <AddressFirstHome tenantId={tenantId} initialAddress={initialAddress} />
        {isRecognised && <NotMeLink />}
      </div>
    </main>
  );
}
