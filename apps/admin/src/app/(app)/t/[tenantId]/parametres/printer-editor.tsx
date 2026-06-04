"use client";

/**
 * #416 (KB Admin — Config imprimante Star WebPRNT par tenant) —
 * `PrinterEditor`, the section éditeur for « Imprimante cuisine » on the
 * tenant Paramètres page. Mirror of the native `PrinterSettingsScreen`
 * (`apps/native/src/lib/printing/printer-settings-screen.tsx`) posed by
 * #412, sharing the SAME backend persistence (`tenants.printerConfig
 * .starWebPrntUrl`) and the SAME Convex mutations (`setPrinterConfig` /
 * `clearPrinterConfig`).
 *
 * Stand-alone reusable deep module, mirrors the design of the sibling
 * editors (branding / coordonnées / modes / horaires): a narrow `{ value,
 * onSave, onClear }` contract, an isolated `useForm` per user story 9
 * (« save isolé : un échec sur cette section ne perd pas les inputs en
 * cours sur d'autres sections »), and no coupling to the URL / tenant
 * context / backend api (so a future surface can mount it without rework).
 *
 * What it owns:
 *  - the single form field (`starWebPrntUrl`) — text input;
 *  - the pure URL validator (`isValidStarWebPrntUrl`) — also exported so
 *    `printer-editor.test.tsx` can pin the regex in isolation. **SAME
 *    rule** as the backend `assertValidStarWebPrntUrl` (`packages/backend/
 *    convex/lib/printing/printing.ts`) AND the native `isValidStarWebPrntUrl`
 *    (`apps/native/src/lib/printing/decide-star-printer.ts`) — keeping it on
 *    every surface means a bad paste is rejected upfront with the same
 *    UX everywhere;
 *  - the « Enregistrer » button → calls `onSave({ starWebPrntUrl })`. DISABLED
 *    on invalid URL (AC clé, mirror coordonnées-editor's phone gate);
 *  - the « Retirer l'imprimante » button → calls `onClear()`. ONLY surfaces
 *    when a printer is currently configured (`value !== null && value !==
 *    undefined`);
 *  - the inline server-side error surface (Convex `FORBIDDEN` /
 *    `INVALID_PRINTER_URL` / etc.);
 *  - a static read-only disclaimer about WHY there is no « Tester
 *    l'impression » button here (LAN-only printer unreachable from the
 *    admin's browser — the gérant tests from the native app on the resto
 *    LAN). Explicit ⚠️ from issue #416 — the absence is FEATURE, not
 *    regression.
 *
 * What it does NOT own:
 *  - the toast (page-level concern, ADR 0014 / consistent with the sibling
 *    editors);
 *  - the tenantId / mutation wiring (the page does both, the editor stays
 *    UI-only — reusable across surfaces);
 *  - the actual « Tester l'impression » network round-trip. The native
 *    side already exposes that, and the issue ⚠️ explicitly defers the
 *    « test » concern to native — the printer is on a private LAN that the
 *    KB Admin's browser typically cannot reach.
 *
 * ── State Convex partagé (PRD 20 §14) ────────────────────────────────────
 * The editor writes through the SAME mutation (`setPrinterConfig`) the
 * native Settings screen calls — kb_admin is admitted via the `tenantMutation`
 * root override (ADR 0014 §3, `withTenant.ts requireTenantAccess`). No
 * `adminSetPrinterIp` invented, no allow-list extension needed. A change
 * here flips the kitchen tablet live through the Convex sub, AND a change
 * from native is reflected here on next render (page reads via
 * `useTenantQuery(getPrinterConfig)`).
 *
 * Scope discipline: this file lives under `apps/admin/src/app/(app)/t/
 * [tenantId]/parametres/`. Zero coupling to the backend api / Convex hooks
 * / tenant context — pinned by `printer-editor.test.tsx`'s source-level
 * guards.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Persisted printer config sub-object — mirrors the backend
 *  `getPrinterConfig` return shape (`packages/backend/convex/lib/printing/
 *  printing.ts`) and the `tenants.printerConfig` schema (`packages/backend/
 *  convex/table/tenants.ts`). `null` = no printer configured;
 *  `undefined` = Convex query loading sentinel (treated like `null` by
 *  the editor — same UX). */
export type PrinterConfigValue = { starWebPrntUrl: string } | null | undefined;

export type PrinterEditorProps = {
  /**
   * The current persisted value — seeds the form's default AND determines
   * whether the « Retirer l'imprimante » button surfaces. `null` or
   * `undefined` collapse to « no printer set yet » (the input seeds empty,
   * the clear button is hidden).
   */
  value: PrinterConfigValue;
  /**
   * Commit handler — receives `{ starWebPrntUrl }` with the trimmed URL.
   * NEVER invoked with an invalid URL (the editor re-asserts the regex at
   * submit time, defence in depth on top of the disabled button). Page-side
   * wiring: `useTenantMutation(api.lib.printing.printing.setPrinterConfig)`.
   */
  onSave: (args: { starWebPrntUrl: string }) => Promise<void>;
  /**
   * Clear handler — invoked when the gérant taps « Retirer l'imprimante ».
   * Page-side wiring: `useTenantMutation(api.lib.printing.printing
   * .clearPrinterConfig)`. The page handles the toast + reactivity on
   * success.
   */
  onClear: () => Promise<void>;
};

type PrinterFormShape = {
  starWebPrntUrl: string;
};

/**
 * Pure URL validator (exported for the unit-test AC + for any future reuse
 * by another surface needing the same gate).
 *
 * Accepts:
 *  - `http://…` or `https://…` (case-insensitive scheme — common mobile
 *    keyboard auto-capitalise artefact);
 *  - leading / trailing whitespace (user paste artefact — trimmed before
 *    matching).
 *
 * Rejects:
 *  - empty / whitespace-only (would silently mean « no printer » on save —
 *    the gérant uses the « Retirer » button to clear instead);
 *  - a bare IP without scheme (e.g. `192.168.1.42` — common copy-paste
 *    mistake; the printer's web UI advertises the full URL);
 *  - unsafe schemes (`javascript:`, `file:`, `data:`).
 *
 * The URL itself is NOT fetched here (the printer is on a private LAN the
 * KB Admin's browser cannot reach — that's the whole point of the test-from-
 * native disclaimer). Validation is shape-only; the network test happens on
 * the native app's Settings screen.
 *
 * ── Single source of validation shape ────────────────────────────────────
 * Same rule lives:
 *  - here (front-side, KB Admin surface);
 *  - in `apps/native/src/lib/printing/decide-star-printer.ts` (native
 *    Settings surface);
 *  - in `packages/backend/convex/lib/printing/printing.ts` `assertValidStar
 *    WebPrntUrl` (server-side, last line of defence — a request crafted
 *    outside the form still hits this gate).
 * Keeping all three identical means a bad paste is rejected the same way on
 * every surface, with the same UX message.
 */
export function isValidStarWebPrntUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "") return false;
  return /^https?:\/\//i.test(trimmed);
}

export function PrinterEditor({
  value,
  onSave,
  onClear,
}: PrinterEditorProps): React.ReactElement {
  // Normalise the persisted-value seed: `null` and `undefined` both mean
  // « no printer », so we treat them identically downstream (the form seeds
  // empty, the clear button is hidden).
  const persistedUrl =
    value !== null && value !== undefined ? value.starWebPrntUrl : "";

  const form = useForm<PrinterFormShape>({
    defaultValues: {
      starWebPrntUrl: persistedUrl,
    },
  });
  const { register, handleSubmit, watch, formState } = form;

  // Live-watched URL drives the validation gate (the disabled-button +
  // inline-error surface update on every keystroke).
  const watched = watch("starWebPrntUrl") ?? "";
  const trimmed = watched.trim();
  // An empty input is the « no value yet » state — we don't surface the
  // « invalid format » error then (user hasn't typed yet). The save button
  // still gates: an empty input is NOT a valid URL to persist.
  const isEmpty = trimmed === "";
  const isInvalid = !isEmpty && !isValidStarWebPrntUrl(trimmed);

  // Inline server-side error (mirror coordonnees-editor's discipline).
  // Reset on each submit attempt. Also surfaces the defence-in-depth refusal
  // when a programmatic submit reaches us with an invalid URL.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (data: PrinterFormShape): Promise<void> => {
    setSubmitError(null);
    const next = data.starWebPrntUrl.trim();
    // Re-assert the regex at submit time — the button is disabled when the
    // URL is invalid, but a programmatic submit could bypass that.
    if (!isValidStarWebPrntUrl(next)) {
      setSubmitError(
        "L'adresse de l'imprimante doit commencer par http:// ou https:// (ex http://192.168.1.42/StarWebPRNT/SendMessage).",
      );
      return;
    }
    // No-op short-circuit: same URL as persisted → no round-trip.
    if (next === persistedUrl) return;
    try {
      await onSave({ starWebPrntUrl: next });
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Échec de l'enregistrement, réessayez.";
      setSubmitError(message);
    }
  };

  const handleClear = async (): Promise<void> => {
    setSubmitError(null);
    try {
      await onClear();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Échec de la suppression, réessayez.";
      setSubmitError(message);
    }
  };

  const urlInputId = "parametres-printer-url-input-id";
  const hasConfigured = persistedUrl !== "";
  // Save button is disabled when:
  //  - the form is mid-submit,
  //  - OR the input is empty,
  //  - OR the input is invalid.
  // A valid URL EQUAL to the persisted one keeps the button enabled (the
  // submit short-circuits to no-op, but that's the page's concern — UX-wise
  // it's fine for the gérant to « re-save » what's already there).
  const saveDisabled = formState.isSubmitting || isEmpty || isInvalid;

  return (
    <form
      data-slot="parametres-printer-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
    >
      <h2 className="sr-only">Imprimante cuisine</h2>

      <div className="flex flex-col gap-2">
        <Label htmlFor={urlInputId}>Adresse de l&apos;imprimante</Label>
        <Input
          id={urlInputId}
          data-slot="parametres-printer-url-input"
          type="text"
          autoComplete="off"
          inputMode="url"
          placeholder="http://192.168.1.42/StarWebPRNT/SendMessage"
          aria-invalid={isInvalid || undefined}
          {...register("starWebPrntUrl")}
        />
        {isInvalid ? (
          <p
            data-slot="parametres-printer-url-error"
            className="text-destructive text-xs"
          >
            L&apos;adresse doit commencer par http:// ou https:// (ex
            http://192.168.1.42/StarWebPRNT/SendMessage).
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            URL complète affichée par l&apos;interface web de l&apos;imprimante
            Star (typiquement
            http://&lt;ip-de-l-imprimante&gt;/StarWebPRNT/SendMessage). La
            configuration est partagée en direct avec l&apos;app KB Orders
            (tablette cuisine).
          </p>
        )}
      </div>

      {/* Read-only disclaimer about the absent « Tester l'impression » button.
          Issue #416 ⚠️ explicitly defers the test to native: the printer is on
          the resto's LAN, unreachable from the KB Admin's browser. The
          functional test happens on the native app, where the KB Manager is
          physically on the LAN. Same data, same shape, different vantage point. */}
      <div
        data-slot="parametres-printer-test-disclaimer"
        className="bg-muted/50 rounded-md border p-3"
      >
        <p className="text-muted-foreground text-xs">
          Le bouton « Tester l&apos;impression » n&apos;est disponible que dans
          l&apos;application native KB Orders, sur le réseau LAN du restaurant
          (l&apos;imprimante n&apos;est pas joignable depuis ce panneau
          d&apos;administration).
        </p>
      </div>

      {/* Server-side rejection — kept distinct from the inline format error
          so a backend FORBIDDEN (cross-tenant) / INVALID_PRINTER_URL / etc.
          surfaces with its actual message. */}
      {submitError !== null ? (
        <p
          data-slot="parametres-printer-submit-error"
          className="text-destructive text-sm"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {hasConfigured ? (
          <Button
            type="button"
            variant="outline"
            data-slot="parametres-printer-clear"
            disabled={formState.isSubmitting}
            onClick={handleClear}
          >
            Retirer l&apos;imprimante
          </Button>
        ) : null}
        <Button
          type="submit"
          data-slot="parametres-printer-save"
          disabled={saveDisabled}
        >
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
