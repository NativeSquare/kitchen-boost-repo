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
 *  1. **`decideTooltipGate`** — given the loaded `devices` row, decide whether
 *     the FIRST-USAGE tooltip must be surfaced BEFORE firing
 *     `setItemAvailability`, or fire it directly. PRD 20 §7c is unambiguous:
 *     the tooltip is OBLIGATOIRE the first time the gérant touches the
 *     toggle on a device, and dismissed for subsequent usages
 *     (`device.itemToggleTooltipSeen`). The exact PRD-frozen sentence lives
 *     in `ITEM_TOGGLE_TOOLTIP_TEXT` below.
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
 * PRD 20 §7c — PRD-frozen first-usage tooltip text. Pinned by the test suite
 * so a rename / reword breaks loudly. The hyphen between « permanente » and
 * « il restera » is a TYPOGRAPHIC EM DASH (`—`, U+2014), as in the PRD.
 */
export const ITEM_TOGGLE_TOOLTIP_TEXT =
  "Ce toggle masque l'item du menu côté client. Pas de modification permanente — il restera disponible dans ton catalogue KB Admin.";

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
 */
export function decideTooltipGate(
  inputs: TooltipGateInputs,
): TooltipGateDecision {
  if (inputs.device === undefined) {
    return { kind: "loading" };
  }
  if (inputs.device === null) {
    return { kind: "show-tooltip" };
  }
  if (inputs.device.itemToggleTooltipSeen === true) {
    return { kind: "proceed" };
  }
  // Absent OR explicit `false` — show the tooltip. PRD 20 §7c safe default.
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
