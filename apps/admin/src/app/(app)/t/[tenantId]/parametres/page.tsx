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
import { useConvex, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantMutation, useTenantQuery } from "@/hooks";
import { useSession } from "@/lib/session";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import type { BrandingPatch, BrandingValue } from "./branding-editor";
import { ParametresView } from "./parametres-view";

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
  // `useConvex()` exposes the live Convex client so we can call the storage
  // URL resolver imperatively from an event handler — `useQuery` is a hook
  // and can't run inside `handleUploadLogo` (rules of hooks). Same pattern
  // as `login-form.tsx` (`convex.query(api.table.users.getUserByEmail)`).
  const convex = useConvex();

  // Initial branding value source — dual, role-dependent (see file header).
  // KB Manager: no read available → undefined (editor treats as {}). KB
  // Admin: re-use `loadTenantForStripe` (root-only query already in use by
  // `qr/page.tsx` for branding). Both cases are read-only here; the editor
  // refreshes through Convex's natural reactivity once the user saves.
  const tenantId = useCurrentTenantId();
  const session = useSession();
  const isAdmin =
    session.status === "ready" && session.session.isAdmin === true;
  const adminTenantDoc = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    isAdmin ? { tenantId } : "skip",
  );
  const branding: BrandingValue | undefined = isAdmin
    ? adminTenantDoc?.branding
    : undefined;

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

  return (
    <ParametresView
      serviceHours={serviceHours}
      branding={branding}
      onSaveBranding={handleSaveBranding}
      onUploadLogo={handleUploadLogo}
    />
  );
}
