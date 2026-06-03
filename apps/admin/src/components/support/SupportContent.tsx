/**
 * F-SUPPORT/1 (#210) — `SupportContent` : the shared support surface
 * mounted by both V1 support routes (admin supervision + tenant
 * operational). Tracer-bullet of the F-SUPPORT épique (#150).
 *
 * Pure-presentational, 100 % static — no Convex query, no analytics, no
 * router dependency. The caller picks where to mount it (PRD §4.11 +
 * ADR 0014 §1).
 *
 * Post-E2E SUP revisit (2026-06-03, demande Alex en review terrain)
 * -----------------------------------------------------------------
 * « Sur l'onglet support tu me retires ce Alex Michelet c'est personne.
 *   L'adresse c'est office@kitchen-boost.com. tu met pas de numéro de tel,
 *   enlève les mention du lundi au vendredi etc. Enlève les liens pour le
 *   moment on en a pas. »
 *
 * Conséquences sur la surface :
 *   - SUPPRIMÉ : bandeau identité « Alex Michelet · Votre interlocuteur
 *     KitchenBoost » (avatar + nom + créneaux + tel). Il n'y a aujourd'hui
 *     PAS de CSM nommé en face — afficher une personne fictive trompait le
 *     restaurateur. La per-tenant assignation (vraie CSM avec photo) revient
 *     en V2 (cf. PRD `70_kb_admin.md` §4.11).
 *   - SUPPRIMÉ : la grid de cards ressources (FAQ / Guide / Vidéo tuto / Kit
 *     commercial). Les URLs étaient des placeholders V1 — les vraies pages
 *     n'existent pas encore. Plutôt qu'envoyer un 404 ou une « coming soon »,
 *     on cache la grid jusqu'à ce qu'on ait au moins un lien réel à offrir.
 *   - CONSERVÉ : un message court + un mailto vers l'adresse contact générique
 *     `office@kitchen-boost.com`. C'est le seul canal V1 — Alex le récupère
 *     directement.
 *
 * Padding (post-revisit) : la surface adopte la convention shell
 * `flex flex-col gap-4 py-4 md:gap-6 md:py-6` + inner `px-4 lg:px-6`
 * appliquée partout ailleurs (`dashboard-view`, `menu-view`, `pricing-view`,
 * etc.). C'était l'OUTLIER qui collait au bord supérieur — root cause du
 * « problème de padding » remonté par Alex sur la grille E2E SUP.
 *
 * Accessibilité :
 *   - Le mailto est un `<a href="mailto:…">` standard, annoncé tel quel par
 *     les lecteurs d'écran (pas de `target=_blank`, pas de `sr-only` à
 *     ajouter — c'est un lien interne mailto, pas une externalisation).
 */
import type { ReactNode } from "react";

import type { SupportConfig } from "./support.config";

export type SupportContentProps = SupportConfig;

/**
 * Surface support partagée. Reçoit le contenu intégralement par props pour
 * rester découplée de la config (testable, réutilisable sur les deux routes).
 */
export function SupportContent({
  contactEmail,
}: SupportContentProps): ReactNode {
  return (
    <div
      data-slot="support-view"
      className="flex flex-col gap-4 py-4 md:gap-6 md:py-6"
    >
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Besoin d&apos;aide&nbsp;?</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Pour toute question, contacte-nous :{" "}
          <a
            data-slot="support-email"
            href={`mailto:${contactEmail}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {contactEmail}
          </a>
        </p>
      </div>
    </div>
  );
}
