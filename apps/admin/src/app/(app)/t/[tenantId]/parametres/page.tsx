"use client";

/**
 * F-PARAMETRES-01 (#193) + F-PARAMETRES-02 (#229) — Route
 * `/t/[tenantId]/parametres/`.
 *
 * Slice 1 (#193) wired the page skeleton: 4 placeholder section cards
 * (Identité visuelle / Coordonnées / Modes acceptés / Horaires de service)
 * + the read-only « Zone livraison Uber Direct » informational block, with
 * ONE tenant-scoped read (`api.lib.menu.serviceHours.get` via
 * `useTenantQuery`) for the future Horaires editor (F-PARAMETRES-05).
 *
 * Slice 2 (#229) lights up Section 1 (Identité visuelle): mounts the live
 * `BrandingEditor` (reusable deep module, signature `{ value, onSave,
 * onUploadLogo }`) and wires three mutations through `useTenantMutation` —
 * front-side `withTenant` discipline (ADR 0014 §4 / F-SHELL-05 #183),
 * never a raw `useMutation` on a tenant-scoped function:
 *
 *   - `api.lib.admin.tenantSettings.updateSettings` — the canonical D5
 *     élargi mutation (B-TENANT-LIFECYCLE [3/4]) that patches branding /
 *     address / phone / acceptedModes. Slice 2 only patches branding.
 *   - `api.lib.menu.photos.generateUploadUrl` — the TENANT-GATED mint of a
 *     short-lived upload URL (a `tenantMutation` whose wrapper makes this
 *     a kb_manager-only privilege, unlike the ungated template
 *     `api.storage.generateUploadUrl`). Same reuse pattern as `menu/page.tsx`
 *     for item photos (#226).
 *   - `api.storage.getImageUrl` (READ — `useQuery`, not `useMutation`) —
 *     resolves a fresh `_storage` id to its public URL after the upload,
 *     so the patch carries a real URL (the backend's `branding.logoUrl` is
 *     a `v.string`, not a storage id).
 *
 * Source of the initial branding value
 * ------------------------------------
 * No KB-Manager-accessible read query exists for `branding` today (EPIC
 * #148 Implementation Decisions anticipated this — sections reading
 * tenant-row fields land alongside their editors). #229's scope is
 * `apps/admin/...` ONLY (no backend changes allowed). So we follow the
 * SAME degradation as `qr/page.tsx`:
 *   - KB Manager → seed `branding = undefined` (the editor treats it as
 *     `{}`); the saved value re-surfaces via Convex's reactivity once a
 *     future slice exposes a manager-accessible read.
 *   - KB Admin   → re-use the existing root `loadTenantForStripe`
 *     (`kbAdminQuery`) which already returns the full `Doc<"tenants">`
 *     with `branding`. Zero new endpoint.
 *
 * Access guard: inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04, #175). The backend
 * wrappers (`tenantMutation` on `updateSettings` / `photos.*`,
 * `tenantQuery` on `serviceHours.get`) are the hard isolation barrier
 * (ADR 0010 — wrapper refuses Forbidden even if the layout regresses).
 *
 * Scope discipline (#229 hard constraint, mirrors menu/page.tsx and
 * mes-clients/page.tsx): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/parametres/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`,
 * `packages/backend/convex/`, or the shared admin sidebar.
 */

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantMutation, useTenantQuery } from "@/hooks";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import type { BrandingPatch, BrandingValue } from "./branding-editor";
import type { CoordonneesPatch, CoordonneesValue } from "./coordonnees-editor";
import type { AcceptedModesPatch, ModesValue } from "./modes-editor";
import { ParametresView } from "./parametres-view";
import type { ServiceWindow } from "./service-hours-editor";

export default function ParametresPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]` layout) and injects it into args (ADR
  // 0014 §4 / #183). `undefined` is the loading sentinel; a successful read
  // returns `{ windows: ServiceWindow[] }` (possibly empty).
  const serviceHours = useTenantQuery(api.lib.menu.serviceHours.get);

  // ── F-PARAMETRES-02 (#229) — Identité visuelle wiring ───────────────────
  //
  // Two tenant-gated mutations + one storage read. Every mutation flows
  // through `useTenantMutation` so tenantId is injected from the context
  // (front-side `withTenant`, ADR 0014 §4) — never a raw `useMutation`.
  const updateSettings = useTenantMutation(
    api.lib.admin.tenantSettings.updateSettings,
  );
  const generateUploadUrl = useTenantMutation(
    api.lib.menu.photos.generateUploadUrl,
  );
  // F-PARAMETRES-05 (#236) — Horaires de service mutation. SEPARATE from
  // `tenant.updateSettings` (D5 élargi covers branding / address / phone /
  // acceptedModes — but NOT service hours, which live in their own
  // `serviceHours` table cf. `convex/table/serviceHours.ts` and have their
  // own tenant-scoped mutation `serviceHours.set` cf.
  // `convex/lib/menu/serviceHours.ts`). One row per tenant carries the
  // FULL windows list; the mutation is an UPSERT atomic replace, so we
  // forward the whole array (no patch shape).
  const setServiceHours = useTenantMutation(api.lib.menu.serviceHours.set);
  // `useConvex()` exposes the live Convex client so we can call the storage
  // URL resolver imperatively from an event handler — `useQuery` is a hook
  // and can't run inside `handleUploadLogo` (rules of hooks). Same pattern
  // as `login-form.tsx` (`convex.query(api.table.users.getUserByEmail)`).
  const convex = useConvex();

  // 2026-06-01 (P1 E2E spot-check fix) — settings now read from the
  // canonical manager-accessible query `api.lib.admin.tenantSettings.getSettings`
  // (tenantQuery({allow:["kb_manager"]}) with kb_admin root override — ONE
  // query, BOTH callers, zero role-branching). Before this query existed, the
  // page seeded branding/coordonnees/acceptedModes from `undefined` for the
  // manager and from the root-only `loadTenantForStripe` for the admin —
  // which meant a manager's successful save was INVISIBLE to them (no read
  // = no Convex reactivity = no refresh; the value was persisted in the DB
  // but the form snapped back to defaults on reload). See the query's
  // docstring for the full lineage.
  //
  // `useTenantQuery` injects `tenantId` from the TenantProvider (ADR 0014 §4)
  // and returns `undefined` while the query is in flight (Convex's loading
  // sentinel). A successful read returns the 5 settings fields (each `null`
  // when not yet set — converted back to `undefined` for the editors that
  // expect an optional sub-object).
  const settings = useTenantQuery(api.lib.admin.tenantSettings.getSettings);
  const branding: BrandingValue | undefined =
    settings?.branding === undefined
      ? undefined
      : settings.branding === null
        ? undefined
        : settings.branding;
  const coordonnees: CoordonneesValue | undefined =
    settings === undefined
      ? undefined
      : {
          // The editor treats `undefined` field as « pas encore renseigné »
          // and seeds an empty input. `null` (the wire-level absence) maps
          // to that.
          address: settings.address ?? undefined,
          phone: settings.phone ?? undefined,
        };
  const acceptedModes: ModesValue | undefined =
    settings?.acceptedModes === undefined
      ? undefined
      : settings.acceptedModes === null
        ? undefined
        : settings.acceptedModes;

  // Save handler — wraps the mutation in try/catch + toast.error, same
  // discipline as menu/page.tsx. Re-throws so the editor can surface the
  // inline form error (user story 8).
  const handleSaveBranding = async (patch: BrandingPatch): Promise<void> => {
    try {
      await updateSettings({ patch });
      toast.success("Identité visuelle enregistrée.");
    } catch (error) {
      toast.error("Impossible d'enregistrer l'identité visuelle", {
        description: getConvexErrorMessage(error),
      });
      // Re-throw so the editor surfaces the inline error too (the user
      // sees BOTH the toast and the in-form message — explicit failure).
      throw error;
    }
  };

  // Upload handler — the two-step Convex flow:
  //   1. mint a short-lived upload URL (tenant-gated mutation);
  //   2. POST the file bytes directly to that URL (the blob never transits
  //      our Convex functions);
  //   3. parse the returned `{ storageId }`;
  //   4. resolve the public URL via `api.storage.getImageUrl` (read).
  // The editor receives just the resolved URL and writes it into the patch.
  const handleUploadLogo = async (file: File): Promise<string> => {
    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload failed (HTTP ${response.status})`);
    }
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    // Resolve the storage id to a public URL via the ungated read query
    // `api.storage.getImageUrl`. We use the imperative `convex.query(...)`
    // (same pattern as `login-form.tsx`) because we're inside an event
    // handler, not the render path. The backend uses `ctx.storage.getUrl`
    // which mints a publicly-resolvable URL we can write into the patch.
    const publicUrl = await convex.query(api.storage.getImageUrl, {
      storageId,
    });
    if (publicUrl === null) {
      throw new Error("Le fichier téléversé est introuvable.");
    }
    return publicUrl;
  };

  // F-PARAMETRES-03 (#231) — Coordonnées save handler. Same pattern as
  // `handleSaveBranding`: wraps the SHARED `updateSettings` mutation
  // (ONE backend brick across all sections), forwards the `{ address?,
  // phone? }` patch as-is (the backend's `normalisePhone` /
  // `assertNonEmptyString` is the single source of truth for canonical
  // form). Re-throws so the editor surfaces the inline error too.
  const handleSaveCoordonnees = async (
    patch: CoordonneesPatch,
  ): Promise<void> => {
    try {
      await updateSettings({ patch });
      toast.success("Coordonnées enregistrées.");
    } catch (error) {
      toast.error("Impossible d'enregistrer les coordonnées", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  // F-PARAMETRES-04 (#234) — Modes acceptés save handler. Same pattern as
  // siblings: wraps the SHARED `updateSettings` mutation (ONE backend
  // brick across all sections — D5 élargi), forwards the `{ acceptedModes:
  // { delivery, clickAndCollect } }` patch as-is. The « au moins un mode
  // actif » guard runs at the EDITOR level (front-side, AC clé) — the
  // backend has no equivalent invariant in V1 (the validator just accepts
  // both booleans), but the editor's guard makes a both = false patch
  // impossible to construct via the UI. Re-throws so the editor surfaces
  // the inline error too.
  const handleSaveAcceptedModes = async (
    patch: AcceptedModesPatch,
  ): Promise<void> => {
    try {
      await updateSettings({ patch });
      toast.success("Modes acceptés enregistrés.");
    } catch (error) {
      toast.error("Impossible d'enregistrer les modes acceptés", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  // F-PARAMETRES-05 (#236) — Horaires de service save handler. The
  // editor hands us the ENTIRE windows array (the backend mutation is an
  // UPSERT atomic replace, not a patch). Same try/catch + toast +
  // re-throw discipline as siblings — the editor's inline error surface
  // catches the re-throw via its own try/catch and renders it under the
  // form, while the toast at this layer notifies the gérant immediately.
  const handleSaveServiceHours = async (
    windows: ServiceWindow[],
  ): Promise<void> => {
    try {
      await setServiceHours({ windows });
      toast.success("Horaires de service enregistrés.");
    } catch (error) {
      toast.error("Impossible d'enregistrer les horaires", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  return (
    <ParametresView
      serviceHours={serviceHours}
      branding={branding}
      onSaveBranding={handleSaveBranding}
      onUploadLogo={handleUploadLogo}
      coordonnees={coordonnees}
      onSaveCoordonnees={handleSaveCoordonnees}
      acceptedModes={acceptedModes}
      onSaveAcceptedModes={handleSaveAcceptedModes}
      onSaveServiceHours={handleSaveServiceHours}
    />
  );
}
