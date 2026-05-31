"use client";

/**
 * F-CONTRATS slice 2/4 (#165) — `ContractIframe`.
 *
 * Isolated, reusable component that takes a contract HTML string (already
 * generated upstream by `api.lib.admin.contracts.generateContract` — slice
 * 3/4 plumbs the call) and renders it inside a **sandboxed iframe** with a
 * « Télécharger HTML » action. Slice 1/4 (#158, merged) shipped the read-
 * only contracts list ; this slice ships the preview surface in isolation,
 * NOT yet wired to the list nor to the generation modal.
 *
 * Sandbox invariant — load-bearing
 * --------------------------------
 * Per parent epic #136 + PRD 70 §3.5 (« iframe-only V1 ») and explicitly
 * pinned in the issue body : the `<iframe sandbox srcDoc={html}>` MUST
 * NOT include `allow-scripts`. The contract HTML is generated from a
 * markdown template (`docs/legal/contrat_template.md`, transcoded in
 * `packages/backend/convex/lib/admin/generateContract.ts`) — it is
 * static, no JS needed. Allowing scripts would turn this preview surface
 * into a XSS sink the day the template ever interpolates user input.
 *
 * The sandbox attribute is therefore set to the EMPTY string — the most
 * restrictive setting, no allowances at all. The test pins explicitly
 * that the rendered string does NOT contain `allow-scripts`.
 *
 * Why « Télécharger HTML » only (no PDF in this slice)
 * ----------------------------------------------------
 * Issue body : « MVP = bouton "Télécharger HTML" (blob download).
 * Nice-to-have : un second bouton "Télécharger PDF" qui appelle
 * window.print() sur la contentWindow de l'iframe (...). Si le print-to-
 * PDF s'avère bancal (CORS sandbox, layout cassé), garder seulement le
 * "Télécharger HTML" et noter la limitation en commentaire de PR. »
 *
 * Decision : ship the HTML-only baseline now. The `window.print()` route
 * from the parent through `iframe.contentWindow` is blocked by the
 * `sandbox=""` setting (without `allow-same-origin` neither the parent
 * nor the iframe can access each other's window for security reasons),
 * and relaxing the sandbox to enable it would defeat the whole invariant
 * above. The user can still print-to-PDF using the browser's standard
 * « right-click → Imprimer » on the iframe ; this is acceptable for a
 * V1 Alex-only surface (PRD 70 §3.5 nice-to-have, not blocking AC).
 *
 * Error branch — no silent blank iframe
 * -------------------------------------
 * When `html` is empty / null / undefined, render a clear French error
 * message instead of a blank iframe (issue AC + PRD §3.5 fallback
 * erreur). The test pins :
 *   - the error copy mentions « erreur / aucun / impossible / indisponible »
 *   - NO `<iframe>` element is rendered in this branch
 *   - NO « Télécharger HTML » button is rendered (nothing to download)
 *
 * Slice tracer — non-encore-branché
 * ---------------------------------
 * This component is local to the feature folder (NOT under
 * `components/ui/*` — issue body : « composant local au feature, pas
 * globalisé »). It is montable depuis un test ou une story, mais n'est
 * PAS encore consommé par `contracts-block.tsx` (slice 1) ni par la
 * future modal de génération (slice 3). Les slices suivants
 * l'importent et le wire au flux Convex.
 *
 * Scope discipline (#165 hard constraint) : this file (and its sibling
 * test) is the SOLE surface touched by this story. Zero touch to
 * `apps/web`, `apps/native`, `packages/backend/convex/`, or to other
 * files under `apps/admin/`.
 */
import { IconDownload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export type ContractIframeProps = {
  /**
   * The contract HTML string returned by `api.lib.admin.contracts
   * .generateContract` (V1) or fetched from a stored field on a
   * previously-generated `contracts` row. Accepts the wider
   * `string | null | undefined` because Convex queries are tri-state
   * (in-flight → undefined, no row → null, hydrated → string) and the
   * upstream caller (slice 3/4 modal) is expected to forward the query
   * value verbatim — this component owns the « no content » fallback.
   */
  html: string | null | undefined;
};

/**
 * French error copy for the « no html » branch — centralised so a future
 * copy tweak (« indisponible » → « non généré ») happens in one place.
 * The test pins the SEMANTIC (one of erreur / aucun / impossible /
 * indisponible) so the exact wording can evolve without breaking the
 * matrix as long as the user-visible meaning is preserved.
 */
const ERROR_COPY =
  "Aucun contenu de contrat à afficher. La génération a peut-être échoué — réessayez ou contactez le support.";

/**
 * Build the download filename. The timestamp is `Date.now()` so the file
 * name is unique per click — useful when Alex downloads multiple
 * versions of the same contract in a row (one per prestation tried). The
 * test pins only the SHAPE (`contrat-<non-empty>.html`), not the exact
 * value, so a switch to ISO timestamps or to UUIDs would not break it.
 */
function buildFilename(): string {
  return `contrat-${Date.now()}.html`;
}

/**
 * Trigger an HTML blob download via the classic « create anchor → set
 * download attr → click → remove + revoke » pattern. Kept as a tiny
 * pure function so the test can spy on `URL.createObjectURL` /
 * `revokeObjectURL` / `document.createElement` / `appendChild` /
 * `click` and assert the full lifecycle.
 */
function triggerHtmlDownload(html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = buildFilename();
  // Hide the anchor — it should never flash on-screen even for a frame.
  // `style.display = "none"` is the canonical way (anchor is appended to
  // the body for the `click()` to fire in all browsers).
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ContractIframe({ html }: ContractIframeProps) {
  // « No content » branch — explicit French error message, NO iframe, NO
  // download button. The check covers null / undefined / empty string in
  // a single guard so the upstream caller can forward the raw Convex
  // tri-state value without pre-filtering.
  if (html === null || html === undefined || html === "") {
    return (
      <section
        data-slot="contract-iframe"
        className="flex flex-col gap-3 rounded-lg border border-dashed p-6 text-center"
      >
        <p className="text-muted-foreground text-sm">{ERROR_COPY}</p>
      </section>
    );
  }

  // « Hydrated » branch — iframe + download button. The iframe is sized
  // to fill the parent so the supervision fiche can decide its height
  // (slice 3 will likely wrap this in a sheet/dialog with a fixed
  // viewport). The sandbox attribute is the empty string : MAXIMALLY
  // restrictive, no `allow-scripts`, no `allow-same-origin`, no
  // anything. The test pins explicitly that `allow-scripts` is absent.
  return (
    <section
      data-slot="contract-iframe"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <header className="flex items-center justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => triggerHtmlDownload(html)}
        >
          <IconDownload />
          Télécharger HTML
        </Button>
      </header>
      <iframe
        data-slot="contract-iframe-frame"
        // Sandbox MUST stay the empty string (most restrictive). NEVER
        // add `allow-scripts` here — the contract HTML is static and
        // adding script execution would defeat the security boundary.
        // The test pins the absence of `allow-scripts`.
        sandbox=""
        srcDoc={html}
        title="Aperçu du contrat"
        className="h-[600px] w-full rounded-md border bg-white"
      />
    </section>
  );
}
