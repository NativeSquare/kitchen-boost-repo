/**
 * #408 — pure decision functions for the « Toggle dispo item » surface
 * (PRD 20 §7c + ADR 0018 frontière disponibilité commerciale / édition
 * catalogue). Same split convention as `decidePauseControl` (#406),
 * `decideClosureControl` (#407), `decideTenantSwitcher` (#399),
 * `decideForceUpdate` (#394): no React, no Convex, no Expo here — just
 * the truth table pinned by node-env vitest.
 *
 * The React adapters (`<ItemAvailabilityList />` + `<ItemAvailabilityEntry />`)
 * are thin hosts that resolve Convex subscriptions (the `devices` row, the
 * tenant's menu items / categories) and feed them in.
 *
 * Two concerns are decided here:
 *
 *  1. **`decideTooltipGate`** — given the loaded `devices` row AND the
 *     direction of the flip (`targetAvailable`), decide whether the
 *     FIRST-USAGE tooltip must be surfaced BEFORE firing
 *     `setItemAvailability`, or fire it directly. PRD 20 §7c (reword
 *     2026-06-07) : le tooltip est OBLIGATOIRE la première fois que le
 *     gérant rend un item INDISPONIBLE sur un device, et dismissé pour
 *     usages suivants (`device.itemToggleTooltipSeen`). Le sens INVERSE
 *     (réactivation, `targetAvailable === true`) ne déclenche jamais le
 *     tooltip — flip direct. Les exacts PRD-frozen title + body vivent
 *     dans `ITEM_TOGGLE_TOOLTIP_TITLE` + `ITEM_TOGGLE_TOOLTIP_BODY`
 *     ci-dessous.
 *
 *  2. **`decideItemListEntryPoint`** — the home pill / nav entry verdict
 *     (`loading` / `ready`). Used to avoid surfacing the entry before the
 *     active tenant is resolved (the kiosque pin or phone-mode last-selected
 *     hydration via `useActiveTenantId`).
 *
 * Both functions are deterministic and side-effect-free.
 *
 * Why per-device (not per-user): the gérant might run the app on both a
 * tablet in the kitchen AND his phone in mobility. The pédagogie of the
 * tooltip ("masque côté client, pas une suppression catalogue") is useful
 * on EACH surface the first time it's seen — and a phone usage doesn't
 * silence the tablet's tooltip. The schema field lives on `devices` for
 * exactly this reason (cf. `convex/table/devices.ts` header).
 */

/**
 * PRD 20 §7c — PRD-frozen first-usage tooltip wording (reworded 2026-06-07
 * post-test E2E KBO-DIS3). Title pose la QUESTION actionnable au gérant
 * (« Rendre cette article indisponible temporairement ? »), body explique
 * l'effet côté client. Pinned by the test suite so un rename / reword silencieux
 * break loudly.
 *
 * Historique : le wording précédent était un paragraphe descriptif (« Ce toggle
 * masque… ») moins actionnable que la question directe. Validé Alex 2026-06-07.
 */
export const ITEM_TOGGLE_TOOLTIP_TITLE =
  "Rendre cette article indisponible temporairement ?";
export const ITEM_TOGGLE_TOOLTIP_BODY =
  "En poursuivant, cet article ne sera plus disponible pour les clients jusqu'à réactivation.";

/**
 * The minimal shape `decideTooltipGate` needs to read off the loaded
 * `devices` row. The native adapter projects `getMyDevice` to this shape
 * (and maps `null` row → null, loading sentinel → undefined).
 */
type DeviceTooltipState = {
  itemToggleTooltipSeen?: boolean;
};

/** Inputs the tooltip gate needs to reach a verdict. */
export type TooltipGateInputs = {
  /**
   * Convex `getMyDevice` result, projected to the tooltip flag only:
   *  - `undefined` = query still in flight (loading sentinel),
   *  - `null` = no row in `devices` yet (fresh device, user has NEVER seen
   *    the tooltip),
   *  - `{ itemToggleTooltipSeen }` = a row exists; the flag drives the
   *    verdict (absent / `false` / `true`).
   */
  device: DeviceTooltipState | null | undefined;
  /**
   * La valeur d'`available` APRÈS le flip (la cible que la mutation va écrire).
   * Asymétrie OFF / ON (PRD 20 §7c reword 2026-06-07) :
   *  - `false` (sens disponible → indisponible) = sens DANGEREUX, masque côté
   *    client. Le tooltip first-usage explique cette pédagogie.
   *  - `true` (sens indisponible → disponible) = réactivation, aucune pédagogie
   *    nécessaire — flip direct, jamais de tooltip.
   */
  targetAvailable: boolean;
};

/** The three mutually-exclusive verdicts the host renders against. */
export type TooltipGateDecision =
  /** Convex sub still resolving — surface no tooltip and disable the toggle. */
  | { kind: "loading" }
  /** First usage on this device — surface the tooltip BEFORE firing toggle. */
  | { kind: "show-tooltip" }
  /** Subsequent usage — toggle directly, no tooltip. */
  | { kind: "proceed" };

/**
 * Decide whether to surface the first-usage tooltip BEFORE firing the toggle.
 * Pure: same inputs ⇒ same output. Truth table pinned in
 * `decide-item-availability.test.ts`.
 *
 * Précédence des règles (haut → bas) :
 *  1. Device encore en chargement → `loading` (les deux axes ignorés).
 *  2. Sens ON (`targetAvailable === true`) → `proceed` direct, jamais de tooltip
 *     (asymétrie post-reword 2026-06-07 : pas de pédagogie pour la réactivation).
 *  3. Device déjà tagué `itemToggleTooltipSeen === true` → `proceed`.
 *  4. Sinon (sens OFF, device legacy / fresh / false explicite) → `show-tooltip`.
 */
export function decideTooltipGate(
  inputs: TooltipGateInputs,
): TooltipGateDecision {
  if (inputs.device === undefined) {
    return { kind: "loading" };
  }
  // Asymétrie OFF / ON : le sens « rendre disponible » ne déclenche jamais le
  // tooltip — pas de pédagogie nécessaire pour réactiver un item.
  if (inputs.targetAvailable === true) {
    return { kind: "proceed" };
  }
  if (inputs.device === null) {
    return { kind: "show-tooltip" };
  }
  if (inputs.device.itemToggleTooltipSeen === true) {
    return { kind: "proceed" };
  }
  // Sens OFF + device fresh / legacy / explicit reset → tooltip. PRD 20 §7c
  // safe default.
  return { kind: "show-tooltip" };
}

/** Inputs the entry-point verdict needs. */
export type ItemListEntryPointInputs = {
  /**
   * The currently active tenant id resolved by `useActiveTenantId` (#399).
   * `null` while the device row / session is still loading OR no tenant
   * resolvable (kb_admin in an unpinned device, detached user).
   *
   * The id is passed as an opaque string here so this pure module stays
   * decoupled from the Convex `Id<"tenants">` brand — the native adapter
   * forwards the branded value untouched.
   */
  activeTenantId: string | null;
};

/** The two verdicts the home entry-point renders against. */
export type ItemListEntryPointDecision =
  /** Tenant resolving — render an invisible placeholder. */
  | { kind: "loading" }
  /** Tenant resolved — surface the entry pill that navigates to the page. */
  | { kind: "ready"; activeTenantId: string };

/**
 * Decide whether the home entry-point pill should render. Pure.
 */
export function decideItemListEntryPoint(
  inputs: ItemListEntryPointInputs,
): ItemListEntryPointDecision {
  if (inputs.activeTenantId === null) {
    return { kind: "loading" };
  }
  return { kind: "ready", activeTenantId: inputs.activeTenantId };
}
