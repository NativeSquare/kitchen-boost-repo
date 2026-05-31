/**
 * F-SUPPORT/1 (#210) — Static support config (V1, no per-tenant mapping).
 *
 * Source de vérité du contenu support pour les DEUX routes V1 (supervision
 * KB Admin + opérationnelle KB Manager). Tout est statique et figé sur Alex
 * en V1, conformément à PRD `70_kb_admin.md` §4.11 et ADR 0014. Aucun
 * fetch backend, aucune Convex query — la suite (per-tenant, Slack/Intercom)
 * arrivera en V2.
 *
 * Les URLs des ressources sont des **placeholders V1** à valider avec Alex
 * au moment de la review PR. Le téléphone CSM est exposé en clair : si Alex
 * refuse en review, il suffit de retirer le champ `phone` — le composant
 * dégrade automatiquement (email + créneaux uniquement).
 */

/** Une ressource externe affichée sous forme de carte. */
export type SupportResource = {
  readonly title: string;
  readonly description?: string;
  readonly url: string;
  /**
   * Optionnel : nom d'icône lucide à utiliser à la place de l'icône par
   * défaut. Non utilisé en V1 (toutes les cartes utilisent `ExternalLink`).
   */
  readonly icon?: string;
};

/** Bloc CSM unique pour tous les tenants V1. */
export type SupportCsm = {
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly photoUrl?: string;
  readonly availability: string;
};

/** Contrat complet exposé par le composant `SupportContent`. */
export type SupportConfig = {
  readonly csm: SupportCsm;
  readonly resources: ReadonlyArray<SupportResource>;
};

/**
 * Config par défaut consommée par les deux routes support V1.
 *
 * Téléphone : Alex sur le numéro pro KitchenBoost. Si l'exposition publique
 * est jugée trop large en review, retirer le champ et laisser le composant
 * dégrader en email + créneaux.
 */
export const supportConfig: SupportConfig = {
  csm: {
    name: "Alex Michelet",
    email: "alex@kitchen-boost.fr",
    phone: "+33 6 12 34 56 78",
    availability: "Lun–Ven, 9h–19h (réponse < 24 h)",
  },
  resources: [
    {
      title: "FAQ KitchenBoost",
      description:
        "Réponses aux questions les plus fréquentes des restaurateurs.",
      url: "https://kitchen-boost.fr/faq",
    },
    {
      title: "Guide de démarrage",
      description: "Premiers pas dans l'admin : menu, QR, commandes.",
      url: "https://kitchen-boost.fr/guide-demarrage",
    },
    {
      title: "Vidéo tuto (5 min)",
      description: "Découvrir l'interface en moins de 5 minutes.",
      url: "https://kitchen-boost.fr/tuto-video",
    },
    {
      title: "Kit commercial (one-pager)",
      description: "Pour expliquer KitchenBoost à un confrère restaurateur.",
      url: "https://kitchen-boost.fr/kit-commercial",
    },
  ],
};
