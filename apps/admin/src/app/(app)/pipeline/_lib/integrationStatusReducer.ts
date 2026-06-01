/**
 * F-PIPELINE-CRM 04 (#220) — `reduceIntegrationStatus`, the pure reducer that
 * computes the patch to apply to a composite oscillating integration status
 * (Stripe Connect / Uber Direct / Hubrise) when the KB Admin flips the
 * `current` value from the fiche UI dropdown.
 *
 * Pinned at the source-file level (same split discipline as
 * `decidePhaseMove` / `decideMilestoneChecklist`): the React shell (later —
 * `IntegrationStatusPanel`) and the Convex wiring shell
 * (`recordIntegrationStatus` mutation, B-ONBOARDING-MILESTONES) are thin
 * adapters that call this function and persist its output. No DOM, no Convex,
 * no router — pure function tested in vitest `node` env.
 *
 * Contract (issue #220 acceptance criteria + EPIC F-PIPELINE-CRM "Modules
 * deep" — `integrationStatusReducer`):
 *
 *   - `current` is replaced by `next`.
 *   - `history` is appended a `{ status: next, at: now, by? }` line at the
 *     tail (chronological order, NEVER truncated).
 *   - If `next === prev.current`, the call is a noop — `prev` is returned
 *     UNCHANGED (same reference, no duplicated history line). This pins the
 *     idempotency the UI relies on when the dropdown emits a redundant
 *     `onChange` (re-render, double-click).
 *   - `by` is OPTIONAL on input; when omitted, the appended history line has
 *     NO `by` property (not `by: undefined`) — matches the backend
 *     `recordIntegrationStatus` schema where `by` is `v.optional(v.string())`.
 *
 * Why generic over `S extends string`
 * ------------------------------------
 * The 3 providers (Stripe Connect / Uber Direct / Hubrise) each have their
 * own status enum (e.g. Stripe: `pending_kyc | verified | rejected` ;
 * Uber Direct: `pending | active | suspended` ; Hubrise: similar). Generics
 * keep one reducer for all three — the concrete enums live next to their
 * schema in `packages/backend/convex/table/prospects.ts` (out of scope for
 * this story).
 */

/**
 * One history entry — mirrors the validator shape for composite oscillating
 * integration statuses in `packages/backend/convex/table/prospects.ts`.
 *
 * `by` is optional (same as backend) — anonymous transitions (system-driven,
 * webhooks) are valid.
 */
export type IntegrationStatusEntry<S extends string> = {
  status: S;
  at: number;
  by?: string;
};

/**
 * Composite status — `current` is what the UI shows, `history` is the full
 * audit trail.
 *
 * NEVER truncated server-side or client-side — the fiche needs the full
 * oscillation log (PRD 70 §3.3 milestones composites).
 */
export type IntegrationStatus<S extends string> = {
  current: S;
  history: IntegrationStatusEntry<S>[];
};

export type ReduceIntegrationStatusInput<S extends string> = {
  prev: IntegrationStatus<S>;
  next: S;
  now: number;
  by?: string;
};

export function reduceIntegrationStatus<S extends string>(
  input: ReduceIntegrationStatusInput<S>,
): IntegrationStatus<S> {
  const { prev, next, now, by } = input;

  // Idempotent noop — same reference, no duplicated history line.
  if (prev.current === next) {
    return prev;
  }

  // Build the appended entry WITHOUT setting `by: undefined` when omitted —
  // the JSON shape must match the backend `v.optional(v.string())` validator
  // exactly (no `by` key at all vs. `by: undefined`).
  const entry: IntegrationStatusEntry<S> =
    by === undefined
      ? { status: next, at: now }
      : { status: next, at: now, by };

  return {
    current: next,
    history: [...prev.history, entry],
  };
}
