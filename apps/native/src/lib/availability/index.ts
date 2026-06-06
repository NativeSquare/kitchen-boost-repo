/**
 * Public API du module `availability` (PRD 20 §7 + ADR 0018, frontière
 * disponibilité commerciale).
 *
 * Deux concerns ici, autour de la bannière persistante de disponibilité
 * commerciale (rappel visuel sur TOUTES les routes authentifiées que le resto
 * est en pause / fermé / hors horaires) :
 *
 *  - `AvailabilityBanner` — surface React montée dans `(app)/_layout.tsx`
 *    à côté de `<TenantStatusBanner />` et `<PushPermissionBanner />`.
 *    Affiche une bannière rouge / amber / gris selon le verdict, avec un
 *    CTA « Paramètres » qui deeplink `/settings/availability`. Souscrit aux
 *    trois queries Convex tenant-scoped (`getOperationalPause`,
 *    `getExceptionalClosure`, `isOpenNow`) et tique une horloge locale 30s
 *    pour l'auto-reprise dérivée.
 *
 *  - `decideAvailabilityBanner` / `formatAvailabilityPauseEta` /
 *    `formatAvailabilityClosureUntilDate` — pure decision functions (no
 *    React, no Convex, no Expo). Truth table pinnée dans
 *    `decide-availability-banner.test.ts`. Même split convention que
 *    `decidePauseControl` (#406), `decideClosureControl` (#407),
 *    `decideForceUpdate` (#394).
 *
 * Les composants source `<PauseControl />` et `<ClosureControl />` continuent
 * à vivre sur l'écran `/settings/availability` pour la GESTION (set / clear) ;
 * cette bannière n'est qu'un rappel visuel ambient — elle ne porte aucune
 * mutation, juste un deeplink.
 */
export { AvailabilityBanner } from "./availability-banner";
export {
  decideAvailabilityBanner,
  formatAvailabilityClosureUntilDate,
  formatAvailabilityPauseEta,
  type AvailabilityBannerDecision,
  type AvailabilityBannerInputs,
} from "./decide-availability-banner";
