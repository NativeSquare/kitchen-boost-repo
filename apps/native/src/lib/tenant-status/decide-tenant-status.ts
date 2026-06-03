/**
 * #411 — pure decision function for the « Alertes statut tenant » gate
 * (PRD 20 §13 + `docs/contexts/kb-orders/CONTEXT.md` Alerte statut critique).
 *
 * Two output verdicts orthogonal in semantics + UI layer:
 *
 *  - **CRITICAL** — Stripe Connect KO, OR Uber Direct KO AND livraison is the
 *    seul mode actif. Surfaces a FULL-SCREEN red blocking overlay with the
 *    same art-direction as #405 « Mode déconnecté ». Bloquant ; couvre tout.
 *
 *  - **WARNING** — Stripe KYC pending, OR Uber Direct KO mais click & collect
 *    aussi actif (mode dégradé livraison), OR statut tenant lifecycle pas
 *    encore `active`. Persistent banner en haut des routes `(app)`, app reste
 *    fonctionnelle.
 *
 * Same split convention as `decideForceUpdate` (#394), `decideSessionRevoked`
 * (#400), `decideConnectionLost` (#405) — keep React, `convex/react`, and Expo
 * out of the function so the matrix is pinned by a fast deterministic vitest
 * suite (Node env, no jsdom, no native mocks).
 *
 * Priority hierarchy declared in the issue (orchestrator prompt): the
 * critical-vs-warning split is the LAST mile of an outer priority chain:
 *    auth (#400) > Convex sub (#405) > tenant status critical (#411)
 *    > tenant status warning (#411 banner).
 * The gate components in `_layout.tsx` / `(app)/_layout.tsx` materialise the
 * outer chain; this function only decides the #411 mile.
 *
 * Truth table (all fields combined):
 *
 *  | stripeStatus | uberConfigured | acceptedModes                      | tenantStatus | verdict                |
 *  | ------------ | -------------- | ---------------------------------- | ------------ | ---------------------- |
 *  | null         | *              | *                                  | *            | none (loading)          |
 *  | "disabled"   | *              | *                                  | *            | CRITICAL stripe        |
 *  | !"disabled"  | false          | { delivery: true, c&c: false }     | *            | CRITICAL uber-only     |
 *  | "pending"    | true           | *                                  | active       | WARNING stripe-kyc     |
 *  | "ready"      | false          | { delivery: true, c&c: true }      | active       | WARNING uber-degraded  |
 *  | "ready"      | true           | *                                  | !active      | WARNING tenant-pending |
 *  | "ready"      | true           | *                                  | active       | none                   |
 */

/**
 * The slice of `tenants` table data the gate consumes. Mirrors the
 * `getTenantHealth` query payload (`lib/orders/orders.ts`).
 *
 * All fields nullable so the gate can render `none` while the Convex sub is
 * loading — a partial verdict on partial data would lie to the user.
 */
export type TenantStatusInputs = {
  /** From `tenants.stripeStatus` (PRD 30 §1/§2). `null` while loading OR for
   *  a fresh tenant whose Stripe account has not been created yet. The PRD
   *  wording « Stripe Connect restricted » maps to our enum's `"disabled"`
   *  (the rejected/blocked KYC state, cf. `lib/stripe/status.ts`). */
  stripeStatus: "pending" | "ready" | "disabled" | null;
  /** `true` iff `tenants.uberCustomerId` is set (a Uber Direct sub-account has
   *  been linked to this tenant via `setUberCredentials`, 2.6-A). `false`
   *  means "Uber Direct disconnected" in the PRD's wording — no credentials
   *  configured, no quote, no course. The PRD's "token expired" sub-case is
   *  not tracked at the schema level today; we surface only the configured /
   *  not-configured split. */
  uberDirectConfigured: boolean;
  /** From `tenants.acceptedModes`. `null` = wizard step 4 not completed yet
   *  (fresh tenant). When `null`, we conservatively treat both modes as off
   *  (a tenant with no declared mode is incomplete — surfaces as WARNING
   *  tenant-pending). */
  acceptedModes: { delivery: boolean; clickAndCollect: boolean } | null;
  /** From `tenants.status` lifecycle (PRD 50). `"active"` = fully operational.
   *  Anything else (`"pending"`, `"suspended"`, `"disabled"`) ⇒ WARNING
   *  tenant-pending (statut tenant incomplet). */
  tenantStatus: "active" | "pending" | "suspended" | "disabled" | null;
};

/** The three mutually-exclusive verdicts the gate acts on. */
export type TenantStatusDecision =
  /** Nothing to show — render the rest of the tree as-is. */
  | { kind: "none" }
  /** Full-screen red blocking overlay. `reason` drives the title / body copy. */
  | {
      kind: "critical";
      /** `stripe` = Stripe Connect KO (paiements refusés). `uber-direct-only` =
       *  Uber KO + livraison is the seul mode (donc le resto ne peut rien
       *  livrer, et ne fait pas de click & collect pour rattraper). */
      reason: "stripe" | "uber-direct-only";
    }
  /** Persistent banner — app reste fonctionnelle. `reason` drives copy + tone. */
  | {
      kind: "warning";
      /**
       *  `stripe-kyc-pending` = orange, KYC en attente mais paiements OK pour
       *                         l'instant.
       *  `uber-direct-degraded` = red banner, Uber KO mais click & collect
       *                           dispo donc le resto peut encore vendre.
       *  `tenant-incomplete` = gray, statut tenant pas encore `active`.
       */
      reason:
        | "stripe-kyc-pending"
        | "uber-direct-degraded"
        | "tenant-incomplete";
    };

/**
 * Decide whether the « Alertes statut tenant » gate should surface a critical
 * overlay, a warning banner, or nothing for the given tenant snapshot.
 *
 * Pure: same inputs ⇒ same output, no Date.now(), no side effects.
 *
 * Decision order (CRITICAL wins over WARNING wins over none; within a layer,
 * Stripe wins over Uber — Stripe KO = paiements totalement refusés = priorité
 * absolue) :
 *
 *  1. Any input still `null` (incomplete sub) → none. Loading state = no UI.
 *  2. Stripe `disabled` → CRITICAL stripe. Paiement refusé = TOUT bloquant.
 *  3. Uber Direct not configured AND delivery is the seul mode → CRITICAL
 *     uber-direct-only. Le resto ne peut rien livrer + pas de C&C fallback.
 *  4. Stripe `pending` → WARNING stripe-kyc-pending. KYC en attente.
 *  5. Uber Direct not configured AND click & collect aussi actif → WARNING
 *     uber-direct-degraded. Mode dégradé.
 *  6. Tenant lifecycle `status` !== `active` → WARNING tenant-incomplete.
 *  7. Everything else → none.
 */
export function decideTenantStatus(
  inputs: TenantStatusInputs,
): TenantStatusDecision {
  // 1. Any input still `null` ⇒ Convex sub still loading. Don't flash anything.
  if (
    inputs.stripeStatus === null ||
    inputs.acceptedModes === null ||
    inputs.tenantStatus === null
  ) {
    return { kind: "none" };
  }

  // 2. Stripe disabled (= PRD's « restricted ») ⇒ paiements refusés = CRITICAL
  //    stripe. Priorité absolue — sans Stripe le resto n'encaisse rien.
  if (inputs.stripeStatus === "disabled") {
    return { kind: "critical", reason: "stripe" };
  }

  // Helpers for the Uber Direct branches below.
  const deliveryActive = inputs.acceptedModes.delivery === true;
  const clickAndCollectActive = inputs.acceptedModes.clickAndCollect === true;
  const uberDown = inputs.uberDirectConfigured === false;

  // 3. Uber Direct down AND livraison est le SEUL mode actif ⇒ CRITICAL
  //    uber-direct-only. Le resto ne peut rien livrer et n'a pas de C&C pour
  //    rattraper — bloquant pour toute la prise de cmd.
  if (uberDown && deliveryActive && !clickAndCollectActive) {
    return { kind: "critical", reason: "uber-direct-only" };
  }

  // 4. Stripe KYC pending (mais paiements OK pour l'instant) ⇒ WARNING.
  if (inputs.stripeStatus === "pending") {
    return { kind: "warning", reason: "stripe-kyc-pending" };
  }

  // 5. Uber Direct down + click & collect aussi actif ⇒ WARNING dégradé
  //    (livraison désactivée, le resto encaisse encore via C&C).
  if (uberDown && deliveryActive && clickAndCollectActive) {
    return { kind: "warning", reason: "uber-direct-degraded" };
  }

  // 6. Statut tenant lifecycle pas encore `active` ⇒ WARNING incomplete.
  if (inputs.tenantStatus !== "active") {
    return { kind: "warning", reason: "tenant-incomplete" };
  }

  // 7. All clear.
  return { kind: "none" };
}
