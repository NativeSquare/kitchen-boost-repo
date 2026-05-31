"use client";

/**
 * F-PARAMETRES-02 (#229) — `BrandingEditor`, the section éditeur for
 * Identité visuelle (logo + couleur primaire) on the tenant Paramètres page.
 *
 * Extracted as a reusable deep module so the F-WIZARD step 4 « Branding »
 * (PRD 70 §3.6) can mount the SAME editor without any duplication (EPIC
 * #148 « Further Notes » — explicit factorisation candidate). The public
 * contract is intentionally narrow:
 *
 *   {
 *     value:        { logoUrl?: string, primaryColor?: string },
 *     onSave:       (patch: { branding: { logoUrl?, primaryColor? } }) => Promise<void>,
 *     onUploadLogo: (file: File) => Promise<string>  // returns the public URL
 *   }
 *
 * The editor owns local form state via `react-hook-form`'s `useForm` so a
 * failure in another section (Coordonnées / Modes / Horaires) cannot blow
 * away the user's in-flight input here (user story 9 from EPIC #148). It
 * does NOT read the tenantId, the URL params, or any Convex hook — the
 * page is responsible for wiring those, and passing in pre-bound handlers.
 * That keeps the editor reusable across surfaces (Paramètres + Wizard).
 *
 * Save flow (the integration loop the issue's AC asks us to test):
 *   1. user picks a file (PNG / JPG / SVG) → local preview shows the
 *      file via `URL.createObjectURL` BEFORE upload, AND no upload happens
 *      yet (no orphan blob if the user backs out);
 *   2. user picks a color → swatch updates LIVE (user story 3) — the
 *      swatch's inline `backgroundColor` style reads from the form field,
 *      not from the prop, so the picker change is visible immediately;
 *   3. user clicks « Enregistrer » → `handleSubmit` fires:
 *      a. if a file was picked, call `onUploadLogo(file)` first; the
 *         returned URL is what we write into the patch (the page wires
 *         the underlying two-step Convex upload — generateUploadUrl →
 *         POST → record storage id → resolve public URL);
 *      b. compose the patch from the fields that actually changed
 *         (compared to `value`) — an empty patch is a no-op (no network);
 *      c. call `onSave(patch)`. On rejection, set an inline form error
 *         (page-level toast is the page's responsibility).
 *
 * Inline form errors (user story 8) surface as small destructive-colored
 * paragraphs under the offending input. Success toast lives at the page
 * level (`page.tsx`) — consistent with the rest of admin (menu/page.tsx,
 * categories handlers).
 *
 * Scope discipline (#229): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/parametres/`. Zero coupling to
 * the backend api / Convex hooks / tenant context — pinned by
 * `branding-editor.test.tsx`'s source-level guards.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { IconPhoto, IconUpload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The branding shape — mirrors the optional `branding` sub-object on the
 * `tenants` row (`packages/backend/convex/table/tenants.ts`) and the
 * `branding` field on the `tenant.updateSettings` mutation's patch validator
 * (`packages/backend/convex/lib/admin/tenantSettings.ts`).
 *
 * Both fields are optional independently — a tenant may have a logo but no
 * brand color, or vice-versa, or neither.
 */
export type BrandingValue = {
  logoUrl?: string;
  primaryColor?: string;
};

/** Patch shape forwarded to the page's `onSave` handler (mirrors the
 * backend mutation's `patch.branding`). */
export type BrandingPatch = {
  branding: BrandingValue;
};

export type BrandingEditorProps = {
  /**
   * The current persisted value — used to seed the form's default values
   * AND to compute the diff (only changed fields land in the save patch).
   * An empty object is valid (no logo, no color); the editor handles it
   * gracefully (placeholder thumbnail, default ink color on the swatch).
   */
  value: BrandingValue;
  /**
   * Commit handler. Receives the diff between the form state and `value`
   * — fields that didn't change are absent from the patch. An empty patch
   * never reaches this callback (the editor short-circuits to a no-op).
   * Page-side wiring: `useTenantMutation(api.lib.admin.tenantSettings.updateSettings)`.
   */
  onSave: (patch: BrandingPatch) => Promise<void>;
  /**
   * Logo upload handler. Receives the picked File and returns the public
   * URL to write into the patch. Page-side wiring: a two-step Convex
   * upload (`photos.generateUploadUrl` → POST → resolve URL via
   * `api.storage.getImageUrl`).
   */
  onUploadLogo: (file: File) => Promise<string>;
};

type BrandingFormShape = {
  primaryColor: string;
  /** The picked FileList from the `<input type="file">`. */
  logoFile: FileList | null;
};

/**
 * Default brand color when none is set — the KitchenBoost canonical green
 * from CLAUDE.md. Used as the color picker's initial value so the swatch
 * has something to display before the user touches anything.
 */
const DEFAULT_BRAND_COLOR = "#1B7A3D";

export function BrandingEditor({
  value,
  onSave,
  onUploadLogo,
}: BrandingEditorProps): React.ReactElement {
  const form = useForm<BrandingFormShape>({
    defaultValues: {
      primaryColor: value.primaryColor ?? DEFAULT_BRAND_COLOR,
      logoFile: null,
    },
  });
  const { register, handleSubmit, watch, setValue, formState } = form;

  // Live-watched color drives the swatch's inline style (user story 3 —
  // « preview live »: the swatch reflects the picker value BEFORE save).
  const watchedColor = watch("primaryColor") ?? DEFAULT_BRAND_COLOR;
  const watchedLogoFile = watch("logoFile");

  // Local object-URL for the picked file (preview before upload). Released
  // on unmount + when the user picks a different file (no leaked blob URL).
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (watchedLogoFile === null || watchedLogoFile === undefined) {
      return;
    }
    if (!(watchedLogoFile.length > 0)) {
      return;
    }
    const file = watchedLogoFile.item(0);
    if (file === null) return;
    // In SSR / node env there is no URL.createObjectURL; bail silently
    // (the test serializer doesn't need a preview to assert behaviour).
    if (
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objectUrl);
    return () => {
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [watchedLogoFile]);

  // Inline server-side error message (the AC's « inline form errors » when
  // `onSave` rejects). Reset on each submit attempt.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Diff helper: only fields whose current form value differs from the
  // persisted `value` land in the patch. Avoids round-trips when nothing
  // changed (empty patch = no `onSave` call, no network).
  const buildPatch = (fields: {
    uploadedLogoUrl: string | undefined;
    primaryColor: string;
  }): BrandingPatch | null => {
    const branding: BrandingValue = {};
    if (
      fields.uploadedLogoUrl !== undefined &&
      fields.uploadedLogoUrl !== value.logoUrl
    ) {
      branding.logoUrl = fields.uploadedLogoUrl;
    }
    const colorChanged =
      fields.primaryColor !== (value.primaryColor ?? DEFAULT_BRAND_COLOR) ||
      value.primaryColor === undefined; // first save of color from default
    // We don't emit the color if it never moved from the prop value; the
    // default-from-prop covers the « first save » case (color was unset →
    // user clicks save without touching → emit nothing).
    if (
      fields.primaryColor !== (value.primaryColor ?? "") &&
      colorChanged &&
      // Only count it as a change when the user actually picked something
      // different from what was persisted (treating "no persisted color"
      // as the implicit no-op — the user has to actively pick a color).
      fields.primaryColor !== value.primaryColor
    ) {
      branding.primaryColor = fields.primaryColor;
    }
    if (Object.keys(branding).length === 0) return null;
    return { branding };
  };

  const onSubmit = async (data: BrandingFormShape): Promise<void> => {
    setSubmitError(null);
    try {
      // Step 1: upload first when a file was picked. The page wires the
      // two-step Convex flow; the URL it returns is what we write into the
      // patch.
      let uploadedLogoUrl: string | undefined = undefined;
      if (
        data.logoFile !== null &&
        data.logoFile !== undefined &&
        data.logoFile.length > 0
      ) {
        const file = data.logoFile.item(0);
        if (file !== null) {
          uploadedLogoUrl = await onUploadLogo(file);
        }
      }

      // Step 2: compose the patch from the diff vs `value`.
      const patch = buildPatch({
        uploadedLogoUrl,
        primaryColor: data.primaryColor,
      });
      if (patch === null) return; // empty patch — no-op
      await onSave(patch);
      // Step 3: reset the file input so a second save doesn't re-upload
      // the same file. The color stays as-is (no surprise reset).
      setValue("logoFile", null);
      setLocalPreviewUrl(null);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Échec de l'enregistrement, réessayez.";
      setSubmitError(message);
    }
  };

  // Visible logo: local preview wins (the user just picked a file but
  // hasn't saved yet), then the persisted `value.logoUrl`, else nothing.
  const visibleLogoUrl = useMemo(() => {
    if (localPreviewUrl !== null) return localPreviewUrl;
    if (value.logoUrl !== undefined && value.logoUrl.length > 0) {
      return value.logoUrl;
    }
    return null;
  }, [localPreviewUrl, value.logoUrl]);

  // Hidden file input — clicked via a Label so the affordance stays
  // accessible without a raw `<button>`. The ref lets the « cliquer sur
  // l'image actuelle » UX (user story 2) trigger the picker too.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputId = "parametres-branding-logo-input-id";

  // Register the file input (RHF) AND keep a ref to it for the click-on-
  // preview affordance. We compose RHF's ref with our own ref via a
  // callback ref pattern.
  const logoFileRegister = register("logoFile");
  const composedRef = (node: HTMLInputElement | null) => {
    fileInputRef.current = node;
    logoFileRegister.ref(node);
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const primaryColorError = formState.errors.primaryColor;

  return (
    <form
      data-slot="parametres-branding-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
    >
      <h2 className="sr-only">Identité visuelle</h2>

      {/* Logo block — preview + file picker. The preview itself is
          click-to-replace (user story 2 « cliquer sur l'image actuelle »). */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={fileInputId}>Logo</Label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            data-slot="parametres-branding-logo-preview"
            onClick={triggerFilePicker}
            className="bg-muted text-muted-foreground hover:border-ring flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border transition"
            aria-label={
              visibleLogoUrl === null
                ? "Téléverser un logo"
                : "Remplacer le logo"
            }
          >
            {visibleLogoUrl !== null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={visibleLogoUrl}
                alt="Logo du restaurant"
                className="size-full object-cover"
              />
            ) : (
              <IconPhoto className="size-10" aria-hidden="true" />
            )}
          </button>
          <div className="flex flex-1 flex-col gap-2">
            <Label
              htmlFor={fileInputId}
              className="border-input bg-background hover:bg-accent inline-flex cursor-pointer items-center gap-2 self-start rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              <IconUpload className="size-4" aria-hidden="true" />
              {visibleLogoUrl === null ? "Téléverser" : "Remplacer"}
            </Label>
            <p className="text-muted-foreground text-xs">
              PNG, JPG ou SVG. Le logo s&apos;affichera sur votre PWA et sur les
              supports imprimés.
            </p>
            {/* The native file input is visually hidden but stays focusable
                via the Label above (radix-free, keyboard-accessible). */}
            <input
              id={fileInputId}
              data-slot="parametres-branding-logo-input"
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/*"
              className="sr-only"
              name={logoFileRegister.name}
              onChange={logoFileRegister.onChange}
              onBlur={logoFileRegister.onBlur}
              ref={composedRef}
            />
          </div>
        </div>
      </div>

      {/* Color picker block — native input[type=color] for V1 (browser
          picker is good enough; a fancy picker is a V2 polish). The swatch
          reflects the LIVE picker value (user story 3). */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="parametres-branding-color-input">
          Couleur primaire
        </Label>
        <div className="flex items-center gap-3">
          <Input
            id="parametres-branding-color-input"
            data-slot="parametres-branding-color-input"
            type="color"
            className="h-10 w-16 cursor-pointer p-1"
            aria-invalid={primaryColorError !== undefined || undefined}
            {...register("primaryColor")}
          />
          <div
            data-slot="parametres-branding-color-swatch"
            className="size-10 rounded-md border"
            style={{ backgroundColor: watchedColor }}
            aria-hidden="true"
          />
          <code className="text-muted-foreground text-xs">{watchedColor}</code>
        </div>
        {primaryColorError !== undefined &&
        primaryColorError.message !== undefined ? (
          <p
            data-slot="parametres-branding-color-error"
            className="text-destructive text-xs"
          >
            {primaryColorError.message}
          </p>
        ) : null}
      </div>

      {/* Inline server-side error (the AC's « inline form errors » when
          `onSave` rejects). Kept distinct from per-field errors so a
          backend `INVALID_HEX_COLOR` doesn't masquerade as a client error. */}
      {submitError !== null ? (
        <p
          data-slot="parametres-branding-submit-error"
          className="text-destructive text-sm"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          data-slot="parametres-branding-save"
          disabled={formState.isSubmitting}
        >
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
