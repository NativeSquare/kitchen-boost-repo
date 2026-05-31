"use client";

/**
 * F-WIZARD [1/10] (#265) — chrome-less / minimal layout for the wizard.
 *
 * The parent `(app)/layout.tsx` already mounts the SessionLoader +
 * SessionGuard + ApplicationShell (the global sidebar + header, F-SHELL
 * #139). This nested layout's only job is to wrap the wizard content in a
 * compact container that focuses the operator on the wizard itself —
 * « focus sur le contenu wizard » per the issue spec.
 *
 * The header is intentionally KEPT (issue spec: « Header conserve le
 * switcher tenant mais hide les onglets de navigation principale »). The
 * sidebar tabs themselves come from the existing `AppSidebar` and aren't
 * trimmed inside the wizard route — trimming the global sidebar from a
 * nested route would touch shared shell state outside this slice's scope.
 * The compact container at the layout level + the wizard's own focused
 * content is the minimal chrome-less surface this story owns.
 *
 * Scope discipline (#265 hard constraint, mirrors `pipeline/[prospectId]/`
 * siblings): this file (and its siblings under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/provision/`) is the SOLE
 * surface touched by this story. Zero touch to `apps/web`, `apps/native`,
 * or `packages/backend/convex/`.
 */

export default function WizardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl" data-slot="wizard-layout">
      {children}
    </div>
  );
}
