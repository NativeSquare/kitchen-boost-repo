/**
 * PWA-S1 (#449) — « Resto non disponible » error page (US 67 tenant orphan,
 * unknown host, apex hit, inactive tenant).
 *
 * Reached EXCLUSIVELY through `NextResponse.rewrite("/erreur?reason=...")`
 * from the edge middleware (`proxy.ts`). NEVER linked from anywhere — this
 * is a degraded-state surface, not a navigable route. The middleware also
 * clears the `__Host-kb_tenant` cookie when the error was caused by a stale
 * cookie (orphan / inactive) so the next visit doesn't loop on the dead
 * tenant.
 *
 * Copy is intentionally generic (« Resto non disponible ») across all four
 * `reason` codes — the client doesn't need to know whether their resto is
 * inactive vs deleted vs unknown host. A future support flow can branch on
 * the search param if needed (analytics, contact CTA).
 */
type Search = { reason?: string };

export default async function ErreurPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // `searchParams` is a Promise in Next 16 RSC — await it before reading.
  await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold text-black">Resto non disponible</h1>
        <p className="text-base text-zinc-600">
          Le restaurant que tu cherches n&apos;est plus accessible depuis cette
          adresse.
        </p>
        <p className="text-sm text-zinc-500">
          Vérifie le lien ou contacte ton resto pour qu&apos;il te transmette
          son adresse à jour.
        </p>
      </div>
    </main>
  );
}
