"use client";

/**
 * F-QR.4 (#198) — Route `/t/[tenantId]/qr/`.
 *
 * Quatrième et dernier tracer-bullet de l'EPIC F-QR #142 — boucle la boucle :
 * tenant-scoped page qui lit le tenant courant depuis le shell, recompose la
 * PWA URL côté front (zéro round-trip backend), et monte le composant
 * réutilisable `QrGeneratorView` (#182) qui orchestre QR data URL + PDF +
 * preview + download.
 *
 * Acceptance criteria pinned (#198) :
 *   - AC1 « Page rendue à `/t/[tenantId]/qr` sous le shell `(app)` » → ce
 *     fichier vit sous `apps/admin/src/app/(app)/t/[tenantId]/qr/page.tsx` ;
 *     les guards (KB Manager ne peut pas reach un autre tenant, KB Admin via
 *     root override = ADR 0014 impersonation V1 = navigation) sont hérités du
 *     layout chrome-less `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175).
 *   - AC2 « Lit le tenant courant via le hook fourni par F-SHELL (zéro nouvel
 *     endpoint backend) » → on lit `useCurrentTenantId()` (#175) + `useSession()`
 *     (#159). Le seul `useQuery` est sur la primitive root-only EXISTANTE
 *     `api.lib.stripe.account.loadTenantForStripe` (incidemment nommée Stripe,
 *     mais c'est un `kbAdminQuery` qui renvoie le `Doc<"tenants">` entier ;
 *     ré-utilisée à l'identique par le F-SHELL-04 layout pour la probe
 *     d'existence d'un tenant côté KB Admin).
 *   - AC3 « Recompose `pwaUrl` via `tenantPwaUrl` (pas d'appel backend pour
 *     l'URL) » → on duplique côté front ce que `provisionTenant` fait côté
 *     backend (helper #167). Si un `customDomain` est défini → `https://<dom>`,
 *     sinon → `https://<slug>.kitchen-boost.fr`.
 *   - AC4 « Monte `QrGeneratorView` avec props branding du tenant » → mount
 *     direct, props mappées depuis la source ad-hoc selon le rôle (voir plus
 *     bas).
 *   - AC5 « Si tenant non trouvé / non autorisé → comportement standard du
 *     shell F-SHELL » → inhérité du layout (notFound() / redirect / spinner).
 *     Cette page n'est rendue QUE quand `decideTenantGate` renvoie `"allow"`.
 *
 * Source des props branding selon le rôle (architecturalement)
 * ------------------------------------------------------------
 * Les `tenants` n'exposent PAS de read query côté `kb_manager` aujourd'hui
 * (sa fiche complète arrivera avec F-PARAMETRES-02..04, hors-scope #198). On
 * travaille donc avec ce que F-SHELL EXPOSE DÉJÀ, sans introduire de nouvel
 * endpoint (contrainte forte du body) :
 *
 *  - KB Manager  → `session.tenants` contient `{ slug, name }` pour le tenant
 *    courant. `customDomain` / `branding.logoUrl` / `branding.primaryColor`
 *    restent `undefined` → `tenantPwaUrl` retombera sur le sous-domaine
 *    bootstrap `<slug>.kitchen-boost.fr` (parité avec backend, PRD 50 §3) et
 *    `QrPdfDocument` rend les fallbacks ink-noir / pas de logo (déjà pinés
 *    par `QrPdfDocument.test.tsx`). C'est la dégradation gracieuse explicite
 *    voulue par les helpers front #167 et #173.
 *  - KB Admin    → re-utilise la PRIMITIVE EXISTANTE `loadTenantForStripe`
 *    (`kbAdminQuery`, retourne `Doc<"tenants"> | null`) — c'est la même que
 *    le F-SHELL-04 layout consomme déjà pour valider l'existence d'un tenant
 *    inconnu côté admin. Le nom est incident, le scope est root-only. On en
 *    tire `customDomain` + `branding` PLUS un fallback nom/slug si le KB
 *    Admin atterrit sur un tenant dont il n'est pas membre (cas typique de
 *    l'impersonation ADR 0014 V1 = navigation). Aucun nouvel endpoint créé.
 *
 * Re-render automatique quand `customDomain` change
 * -------------------------------------------------
 * Couvert naturellement par les effets côté hooks : si le KB Manager change
 * son `customDomain` depuis la page Paramètres, la query Convex le ré-émet,
 * `pwaUrl` est recomputé via `tenantPwaUrl`, et `QrGeneratorView` régénère le
 * QR (son `useEffect` dépend de `pwaUrl`, pinné par `QrGeneratorView.tsx`
 * lui-même). Aucune logique custom à ajouter ici.
 *
 * Hors-scope V2 (issue body) : tracking de scans, batches QR uniques par
 * sticker, templates custom au-delà des 3 formats, envoi automatique
 * imprimeur. Ne PAS les implémenter — `blocked` + `needs-info` si demandés.
 *
 * Scope discipline (#198 hard constraint) : ce fichier sous
 * `apps/admin/src/app/(app)/t/[tenantId]/qr/` est la SEULE surface touchée
 * par cette story. Zéro touch à `apps/web`, `apps/native`,
 * `packages/backend/convex/`, ou au sidebar / shell partagé.
 */

import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { QrGeneratorView } from "@/components/qr/QrGeneratorView";
import { useSession } from "@/lib/session";
import { tenantPwaUrl } from "@/lib/tenant-url";

export default function QrPage() {
  const tenantId = useCurrentTenantId();
  const session = useSession();

  // Source #1 : `session.tenants` — disponible pour le KB Manager (et pour
  // un KB Admin qui serait aussi membre du tenant). Ne porte que slug + name
  // (cf. `SessionTenant` dans `lib/session/types.ts`).
  const sessionTenant =
    session.status === "ready"
      ? (session.session.tenants.find((t) => t.tenantId === tenantId) ?? null)
      : null;

  // Source #2 : `loadTenantForStripe` — kbAdminQuery, retourne le
  // `Doc<"tenants">` complet (slug + name + customDomain + branding). On ne
  // la fire QUE pour le KB Admin (la query refuserait un kb_manager de toute
  // façon). Skip-sentinel quand non-applicable, conformément au pattern
  // Convex (cf. F-SHELL-04 layout). Garantit zéro requête réseau côté manager.
  const isAdmin =
    session.status === "ready" && session.session.isAdmin === true;
  const adminTenantDoc = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    isAdmin ? { tenantId } : "skip",
  );

  // Loading sentinel : tant que la session n'est pas résolue, ou que la query
  // admin (quand pertinente) est en vol, on rend un placeholder léger plutôt
  // qu'un QR sur des données partielles. Le shell parent (F-SHELL-04 layout)
  // a déjà géré le spinner d'auth — ici on couvre uniquement le delta tenant.
  if (session.status !== "ready") {
    // Le SessionGuard / layout parent gère déjà le spinner + redirect login.
    // On rend `null` pour rester muet le temps qu'il prenne la main.
    return null;
  }
  if (isAdmin && adminTenantDoc === undefined) {
    // Le KB Admin attend le retour de `loadTenantForStripe` pour avoir le
    // branding réel — sinon il verrait une régénération immédiate au refetch.
    return null;
  }

  // Fusion des deux sources, en favorisant `adminTenantDoc` (plus complet)
  // quand disponible, sinon retombant sur `sessionTenant`. Pour un KB Admin
  // qui aurait DOUBLE attache (admin + membre), l'admin doc reste la source
  // de vérité (a le branding complet ; le `SessionTenant` ne le porte pas).
  const slug = adminTenantDoc?.slug ?? sessionTenant?.slug ?? null;
  const name = adminTenantDoc?.name ?? sessionTenant?.name ?? null;
  const customDomain = adminTenantDoc?.customDomain;
  const logoUrl = adminTenantDoc?.branding?.logoUrl;
  const primaryColor = adminTenantDoc?.branding?.primaryColor;

  // Garde défensive : si NI la session NI la query admin ne nous donnent un
  // slug/name, on ne peut pas calculer une URL stable — on retourne `null`
  // (le layout parent aurait dû redirect ou 404 avant qu'on en arrive là ;
  // cette branche est un cintre de sécurité, pas un chemin attendu).
  if (slug === null || name === null) {
    return null;
  }

  // Recomposition front de la PWA URL (helper #167, miroir du backend
  // `provisionTenant`). Quand `customDomain` est défini → l'host gagne ;
  // sinon → bootstrap `<slug>.kitchen-boost.fr` (PRD 50 §3).
  const pwaUrl = tenantPwaUrl({ slug, customDomain });

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 lg:px-6">
        <h1 className="text-2xl font-bold">QR code</h1>
        <p className="text-muted-foreground text-sm">
          Générez et téléchargez les stickers QR à coller dans les sacs de
          livraison Uber Eats. Le client scanne, atterrit sur votre PWA et
          commande direct.
        </p>
      </div>
      <div className="px-4 lg:px-6">
        <QrGeneratorView
          pwaUrl={pwaUrl}
          restoName={name}
          logoUrl={logoUrl}
          primaryColor={primaryColor}
        />
      </div>
    </div>
  );
}
