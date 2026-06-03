/**
 * F-SUPPORT/1 (#210) — Static support config (V1, no per-tenant mapping).
 *
 * Source de vérité du contenu support pour les DEUX routes V1 (supervision
 * KB Admin + opérationnelle KB Manager). Tout est statique et figé en V1,
 * conformément à PRD `70_kb_admin.md` §4.11 et ADR 0014. Aucun fetch backend,
 * aucune Convex query — la suite (per-tenant CSM nommé, Slack/Intercom,
 * FAQ dynamique) arrivera en V2.
 *
 * Post-E2E SUP revisit (2026-06-03, demande Alex en review terrain)
 * -----------------------------------------------------------------
 * La config V1 ne porte PLUS qu'un seul champ : `contactEmail`. Le bandeau
 * identité (« Alex Michelet ») et les cards ressources (FAQ / Guide / Vidéo
 * tuto / Kit commercial) ont été retirés — il n'y a pas encore de CSM nommé
 * en face ni de pages ressources réelles. Cf. docblock de `SupportContent.tsx`
 * pour le détail (verbatim Alex inclus).
 *
 * L'adresse `office@kitchen-boost.com` est l'inbox commerciale générique
 * KitchenBoost (Alex la récupère directement).
 */

/** Contrat complet exposé par le composant `SupportContent`. */
export type SupportConfig = {
  readonly contactEmail: string;
};

/**
 * Config par défaut consommée par les deux routes support V1. Email contact
 * générique — pas de personne nommée ni de téléphone exposés.
 */
export const supportConfig: SupportConfig = {
  contactEmail: "office@kitchen-boost.com",
};
