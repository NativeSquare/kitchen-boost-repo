/**
 * Public API of the `service-hours` native module (#409 KB Orders, PRD 20
 * §7d + ADR 0018 frontière disponibilité commerciale vs édition
 * catalogue).
 *
 * Three surfaces:
 *
 *  - `ServiceHoursEntry` — React surface mounted on the home strip,
 *    sibling of `<PauseControl />` (#406), `<ClosureControl />` (#407)
 *    and `<ItemAvailabilityEntry />` (#408). Entry pill → navigates to
 *    `/service-hours`. No live badge here (les horaires sont l'état
 *    normal, pas un signal éphémère).
 *
 *  - `ServiceHoursScreen` — l'écran dédié monté sur la route
 *    `/service-hours` (Stack screen dans le shell `(app)/_layout.tsx`).
 *    Toggle « Aujourd'hui » / « Cette semaine » + éditeur de créneaux
 *    par jour + bouton Enregistrer. Wire la mutation backend
 *    `api.lib.menu.serviceHours.set` (déjà posée par 2.2-E, réutilisée
 *    par #236 sur l'admin et #397 mirror).
 *
 *  - `decideServiceHoursScreen` / `filterTodayWindows` /
 *    `mergeTodayWindowsIntoWeek` / `validateServiceWindows` /
 *    `minutesToTimeString` / `timeStringToMinutes` / `parisDayOfWeek` /
 *    `WEEK_DAYS` / `SERVICE_HOURS_SEGMENTS` / `dayLabel` /
 *    `DEFAULT_NEW_SLOT` — les PURE decision functions (no React, no
 *    Convex, no Expo). Truth table pinned in
 *    `decide-service-hours.test.ts`. Même split convention que
 *    `decidePauseControl` (#406), `decideClosureControl` (#407),
 *    `decideItemAvailability` (#408) — keeps the truth table in a fast
 *    vitest suite (node env, no jsdom) et la React layer minimale.
 *
 * Source unique
 * -------------
 * La mutation `api.lib.menu.serviceHours.set` (et son `assertServiceWindows`
 * cross-tenant fuzzé via `seedTwoTenantsAllRoles`, ADR 0010) existe déjà
 * sur le backend (chantier 2.2-E). Cette story n'ajoute PAS de nouvelle
 * table, PAS de nouvelle mutation, PAS de `setTenantHoursOverride`
 * séparé : la mutation `set` est UPSERT atomic replace par tenant, donc
 * un « override aujourd'hui » se traduit comme un set de la grille
 * complète où seuls les créneaux du jour ont changé
 * (`mergeTodayWindowsIntoWeek` garantit ce contrat).
 *
 * Impact PWA client
 * -----------------
 * Le backend gate `api.lib.menu.serviceHours.isOpenNow` (PUBLIC,
 * unauthenticated, déjà chantier 2.2-E + cross-tenant fuzz) lit les
 * `windows[]` que cette story édite. Aucune intervention nécessaire sur
 * la PWA client : la sub Convex propage le nouveau windows[] en temps
 * réel et `isOpenNow` flip à false dès que `nowMs` sort des nouveaux
 * créneaux → checkout PWA bloqué (AC PRD 20 §7d « checkout désactivé
 * hors créneaux modifiés »).
 */
export { ServiceHoursEntry } from "./service-hours-entry";
export { ServiceHoursScreen } from "./service-hours-screen";
export {
  DEFAULT_NEW_SLOT,
  SERVICE_HOURS_SEGMENTS,
  WEEK_DAYS,
  dayLabel,
  decideServiceHoursScreen,
  filterTodayWindows,
  mergeTodayWindowsIntoWeek,
  minutesToTimeString,
  parisDayOfWeek,
  timeStringToMinutes,
  validateServiceWindows,
  type ServiceHoursDecision,
  type ServiceHoursQueryResult,
  type ServiceHoursSegment,
  type ServiceHoursValidationError,
  type ServiceHoursValidationResult,
  type ServiceHoursValue,
  type ServiceWindow,
} from "./decide-service-hours";
