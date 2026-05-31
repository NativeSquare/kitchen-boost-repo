import { ConvexError, type Infer, v } from "convex/values";
import {
  hubriseStatus,
  stripeConnectStatus,
  uberDirectStatus,
} from "../../table/prospects";
import {
  type BinaryMilestoneKey,
  appendIntegrationStatus,
  getProspect as getProspectRow,
  kbAdminMutation,
  setMilestoneTimestamp,
} from "../tenancy";
import { type ClosingEvaluation, maybeAutoBascule } from "./pipeline";

/**
 * B-ONBOARDING-MILESTONES slice 3 (#189) — the granular `setMilestone`
 * `kbAdminMutation` that flips ONE binary milestone (set / clear / toggle) and
 * chains the composite Closing auto-bascule IN THE SAME TRANSACTION (PRD 70
 * §3.3, kb-admin CONTEXT "Closing" / "Phase pipeline").
 *
 * Why it lives in its own module (BMAD): the parent CRM (slice B) replaces
 * `milestones` wholesale — race-prone for a UI checklist where the operator
 * clicks one box at a time. This slice is the granular write the UI calls; the
 * front-end never needs to round-trip the whole `milestones` object.
 *
 * Access goes EXCLUSIVELY through the root wrapper `kbAdminMutation` (prospects
 * are KB-ADMIN-GLOBAL — a non-root actor is refused Forbidden, ADR 0010) and the
 * sanctioned `lib/tenancy/prospectsStore` seam (`setMilestoneTimestamp` from
 * slice 1, `getProspect` for the existence/toggle read). Never raw `ctx.db` here
 * (`no-untenanted-query`, ADR 0010). Identity flows only through the wrapper's
 * `getCurrentActor` (ADR 0011).
 *
 * Audit (Q70-Q2): the wrapper auto-logs ONE `prospect.milestone.set` row per
 * call — covers set, clear AND toggle (no separate "uncheck" verb). When the
 * auto-bascule actually fires, `maybeAutoBascule` adds its own richer
 * `prospect.closing.autoBascule` row inside the same transaction.
 *
 * Composite integration milestones (`stripeConnect` / `uberDirect` / `hubrise`)
 * are EXCLUDED from `milestoneKey` BY TYPE — they oscillate (current + history)
 * and live in slice 4 (`recordIntegrationStatus`). The exhaustive `v.union(...)`
 * below is asserted == `BinaryMilestoneKey` at compile time, so adding a binary
 * milestone to `table/prospects.ts → milestones` without extending this union
 * BREAKS THE BUILD (intentional refactor safety net).
 */

/**
 * The exhaustive runtime validator for the binary `milestoneKey` arg. EVERY
 * binary milestone key listed in `table/prospects.ts → milestones` must appear
 * here (the composite integration keys are deliberately excluded).
 *
 * The `MilestoneKey === BinaryMilestoneKey` compile-time assertion at the
 * bottom of this file fails the build the day a binary milestone is added to
 * the schema without being added here too.
 */
const milestoneKey = v.union(
  v.literal("premierContact"),
  v.literal("rdvBooke"),
  v.literal("devisPresente"),
  v.literal("contratGenere"),
  v.literal("contratEnvoyeOdoo"),
  v.literal("contratSigne"),
  v.literal("kbisRecu"),
  v.literal("pieceIdentiteRecue"),
  v.literal("ribRecu"),
  v.literal("factureTabletteEmise"),
  v.literal("factureTablettePayee"),
  v.literal("photosEmballagesRecues"),
  v.literal("menuImporte"),
);

/** The runtime-validated milestone key — derived from the validator above. */
type MilestoneKey = Infer<typeof milestoneKey>;

/**
 * Compile-time guard — fails the build if the validator drifts from the
 * schema's set of binary milestones. The two `extends` checks are MUTUAL: each
 * side must assign to the other, so adding a binary milestone to
 * `table/prospects.ts → milestones` (which widens `BinaryMilestoneKey`) without
 * extending `milestoneKey` above ERRORS the build — and vice versa. Single
 * source of truth: `BinaryMilestoneKey` is itself derived from
 * `Doc<"prospects">["milestones"]`.
 *
 * Implemented as a `satisfies` round-trip on a runtime object whose keys are
 * the two sides of the equality: lints clean (no unused-type rule needed) and
 * the `satisfies` does the type-level work.
 */
const _MILESTONE_KEY_MATCHES_SCHEMA = {
  schemaKeyIsRuntimeKey:
    null as unknown as BinaryMilestoneKey satisfies MilestoneKey,
  runtimeKeyIsSchemaKey:
    null as unknown as MilestoneKey satisfies BinaryMilestoneKey,
} as const;
// Referenced once so it cannot be tree-shaken (no-op at runtime).
void _MILESTONE_KEY_MATCHES_SCHEMA;

/**
 * The enriched outcome of one `setMilestone` call — the SAME shape as
 * `maybeAutoBascule`'s return, so a calling UI gets the full Closing verdict
 * (`closing.complete` / `closing.missing`) without a second round-trip.
 * Re-uses `ClosingEvaluation` from `./pipeline` so the type can never drift.
 */
type SetMilestoneResult = {
  /** Whether the auto-bascule actually fired (Acquisition → Préparation). */
  basculed: boolean;
  /** The prospect's phase AFTER the write (and the optional bascule). */
  phase: "acquisition" | "preparation" | "installation" | "operationnel";
  /** Full Closing verdict (composite of all applicable milestones). */
  closing: ClosingEvaluation;
};

/**
 * Flip ONE binary milestone on a prospect, then evaluate the composite Closing
 * event in the same transaction:
 *
 *  - `achieved === true`   → record the milestone (timestamp = Date.now()).
 *  - `achieved === false`  → clear the milestone (undefined).
 *  - `achieved` omitted    → toggle (clear if present, set if absent).
 *
 * After the write, `maybeAutoBascule` reloads the prospect and, IF Closing is
 * complete AND the prospect is still in `acquisition`, advances the phase to
 * `preparation` and writes the `prospect.closing.autoBascule` audit row — all
 * in the SAME Convex transaction as the milestone write, so the
 * milestone-then-bascule pair is atomic (race-free across concurrent clicks).
 *
 * Decoche (clear / toggle-to-undefined) reuses the same wrapper-auto-audit row
 * (`prospect.milestone.set`, Q70-Q2): no separate "milestone.unset" verb. The
 * row's stored metadata is the audit foundation's default (action + actor);
 * the granular before/after diff is intentionally out of scope V1.
 *
 * Throws `NOT_FOUND` `ConvexError` if the prospect vanished between the call
 * and the read (defensive — the `kbAdminMutation` gate has already passed).
 */
export const setMilestone = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    milestoneKey,
    achieved: v.optional(v.boolean()),
  },
  action: "prospect.milestone.set",
  handler: async (ctx, args): Promise<SetMilestoneResult> => {
    // 1. Read the prospect to compute the next value (and to error EARLY with a
    //    typed NOT_FOUND if it vanished — slice-1 seam throws a plain Error).
    const prospect = await getProspectRow(ctx, args.prospectId);
    if (prospect === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Prospect not found.",
      });
    }

    // 2. Resolve set / clear / toggle. A toggle reads the current value; set /
    //    clear are deterministic and ignore the current state.
    const current = prospect.milestones?.[args.milestoneKey];
    const nextValue: number | undefined =
      args.achieved === true
        ? Date.now()
        : args.achieved === false
          ? undefined
          : // toggle: clear if present, set if absent.
            current === undefined
            ? Date.now()
            : undefined;

    // 3. Single-key, single-prospect write via the sanctioned slice-1 seam (one
    //    read + one patch on the same prospect inside this mutation = atomic).
    await setMilestoneTimestamp(
      ctx,
      args.prospectId,
      args.milestoneKey,
      nextValue,
    );

    // 4. Chain the composite Closing decision in the same transaction. Returns
    //    the enriched {basculed, phase, closing} we surface verbatim.
    return maybeAutoBascule(ctx, args.prospectId);
  },
});

/**
 * B-ONBOARDING-MILESTONES slice 4 (#213) — the granular
 * `recordIntegrationStatus` `kbAdminMutation` that appends ONE transition to a
 * composite integration milestone (`stripeConnect` / `uberDirect` / `hubrise`)
 * and chains `maybeAutoBascule` in the SAME transaction (PRD 70 §3.3 Préparation,
 * kb-admin CONTEXT [[Milestone]] composite).
 *
 * Why this is its own mutation (BMAD): the composite integrations OSCILLATE
 * (`pending_kyc → verified → rejected → pending_kyc → verified`) and carry a
 * `history[]` — they are write-shape-different from binary milestones (no
 * timestamp toggle, only `current` + append). Forcing the UI to round-trip the
 * full `milestones` object would race two concurrent operator clicks. This slice
 * is the granular write the UI calls.
 *
 * Per-integration status discrimination (the acceptance criterion: "validator
 * union discriminé OU pattern équivalent garantissant que `status` valide pour
 * `stripeConnect` ne peut pas être passé avec `integration: 'uberDirect'`") is
 * a TWO-STAGE check, both grounded in the per-integration `*Status` unions of
 * `table/prospects.ts` (the schema source of truth — NEVER duplicated here):
 *
 *  1. Convex boundary: the `status` arg is `v.union(stripeConnectStatus,
 *     uberDirectStatus, hubriseStatus)` — accepts ANY of the 3 sets. This stage
 *     refuses an unknown status literal (e.g. `"totally_made_up"`) before the
 *     handler runs.
 *  2. Handler boundary: `assertIntegrationStatusMatches(integration, status)`
 *     pins `status` to the SPECIFIC integration's set (the sets are themselves
 *     DERIVED from each `*Status` validator via `literalSet`, so adding a
 *     status in `table/prospects.ts` propagates here for free). A cross-
 *     integration payload (e.g. `integration: "stripeConnect", status: "active"`,
 *     a legal `uberDirect` status that has no meaning for Stripe) throws
 *     `INVALID_ARGUMENT`, the same contract as a missing required field at the
 *     Convex boundary.
 *
 * Compile-time TypeScript narrowing through `IntegrationStatusMap` (slice 1
 * seam) catches it one extra layer earlier — a `uberDirect` status literal
 * passed to the `stripeConnect` branch of the discriminated dispatch below is
 * a TS error.
 *
 * Closing semantics: the 3 integrations are NOT Closing milestones (PRD 70
 * §3.3 / `evaluateClosing`), so `basculed` is always `false` for THIS slice. We
 * STILL chain `maybeAutoBascule` after the write (defence in depth + uniform
 * return shape with `setMilestone`) — its `evaluateClosing` is unaffected by a
 * write that touches a non-Closing field, so the helper is structurally a
 * no-op here and just returns the current phase + the up-to-date Closing
 * verdict.
 *
 * Audit (Q70-Q2): the wrapper auto-logs ONE `prospect.integration.recordStatus`
 * row per call — covers any (integration × status) pair. Append-only history is
 * already enforced at the store seam (slice 1, `appendIntegrationStatus`).
 */

/**
 * Extract the closed set of accepted string literals from a Convex
 * `v.union(v.literal(...), ...)` validator at module load. Used to derive the
 * per-integration status sets DIRECTLY from `table/prospects.ts` (the single
 * source of truth) — the lists are NEVER duplicated here. Each `member` of a
 * `v.union(...)` of literals exposes its `.value`.
 */
function literalSet(union: unknown): ReadonlySet<string> {
  const members = (union as { members?: Array<{ value?: unknown }> }).members;
  if (!Array.isArray(members)) {
    // Defensive — every per-integration `*Status` is built as `v.union(v.literal(...))`,
    // so this never trips in production. The check keeps the cast honest.
    throw new Error("literalSet: expected a v.union(v.literal(...)) validator");
  }
  return new Set(
    members.map((m) => {
      if (typeof m.value !== "string") {
        throw new Error("literalSet: non-string literal member");
      }
      return m.value;
    }),
  );
}

/**
 * The 3 composite integration milestone keys mapped to their accepted status
 * literals — derived (NOT duplicated) from `stripeConnectStatus` /
 * `uberDirectStatus` / `hubriseStatus`. Adding a status to those unions in
 * `table/prospects.ts` propagates here for free; adding a 4th INTEGRATION
 * mechanically requires extending this map, the `v.union(...)` arg validator
 * AND the discriminated dispatch in the handler — the build fails otherwise.
 */
const INTEGRATION_STATUS_BY_KEY: Readonly<
  Record<"stripeConnect" | "uberDirect" | "hubrise", ReadonlySet<string>>
> = {
  stripeConnect: literalSet(stripeConnectStatus),
  uberDirect: literalSet(uberDirectStatus),
  hubrise: literalSet(hubriseStatus),
};

/**
 * Refuse a cross-integration `{integration, status}` payload at the boundary
 * (e.g. `integration: "stripeConnect"` paired with `status: "active"` — a
 * legal `uberDirect` status that has no meaning for Stripe). The Convex arg
 * validator above lets `status` syntactically be a member of the UNION of the
 * 3 status sets; this check pins it to the SPECIFIC integration's set, keeping
 * the per-integration `*Status` validators of `table/prospects.ts` as the
 * single source of truth (no duplicated literal list).
 *
 * Throws an `INVALID_ARGUMENT` `ConvexError` — same contract as a missing
 * required field at the boundary.
 */
function assertIntegrationStatusMatches(
  integration: "stripeConnect" | "uberDirect" | "hubrise",
  status: string,
): void {
  if (!INTEGRATION_STATUS_BY_KEY[integration].has(status)) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT",
      message: `Status "${status}" is not valid for integration "${integration}".`,
    });
  }
}

/**
 * The enriched outcome of one `recordIntegrationStatus` call — the SAME shape
 * as `setMilestone`'s return (and `maybeAutoBascule`'s return). `basculed` is
 * always `false` for this slice by construction (integrations are NOT Closing
 * milestones); shipped uniformly so a calling UI consumes one return shape
 * across the two granular mutations.
 */
type RecordIntegrationStatusResult = {
  /**
   * Always `false` for this slice — integrations are NOT Closing milestones.
   * Kept in the return shape for uniformity with `setMilestone` (which can
   * bascule) so a caller does not branch on the mutation it just invoked.
   */
  basculed: boolean;
  /** The prospect's phase AFTER the write (unchanged by this slice). */
  phase: "acquisition" | "preparation" | "installation" | "operationnel";
  /** Full Closing verdict (composite of all applicable binary milestones). */
  closing: ClosingEvaluation;
};

/**
 * Append ONE transition (`status` + `at = Date.now()`) to a composite
 * integration milestone, then re-evaluate the composite Closing in the same
 * transaction (uniform return). The integration sub-object is created on first
 * call; subsequent calls append to its `history[]` (append-only) and update
 * `current`.
 *
 * Cross-integration safety: a `uberDirect` status with
 * `integration: "stripeConnect"` is rejected — at compile time by
 * `IntegrationStatusMap` (slice-1 seam), and at runtime by
 * `assertIntegrationStatusMatches` (this module) BEFORE the store seam is
 * reached. The integration list itself is exhaustive (the 3 composite keys of
 * `table/prospects.ts → milestones`); adding a 4th would require extending the
 * `integration` `v.union` here, `INTEGRATION_STATUS_BY_KEY`, the discriminated
 * dispatch in the handler, AND `IntegrationStatusMap` in the slice-1 seam.
 *
 * Throws `NOT_FOUND` `ConvexError` if the prospect vanished between the call
 * and the read (defensive — the `kbAdminMutation` gate has already passed).
 */
export const recordIntegrationStatus = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    integration: v.union(
      v.literal("stripeConnect"),
      v.literal("uberDirect"),
      v.literal("hubrise"),
    ),
    // The union of all 3 status sets — the per-integration discrimination is
    // done in the handler against the very same per-integration unions that
    // back `IntegrationStatusMap` (slice 1) so a `uberDirect` status with
    // `integration: "stripeConnect"` is rejected at the boundary BEFORE the
    // store seam is reached. The boundary validator stays in sync with the
    // schema because each branch IS the imported `*Status` value.
    status: v.union(stripeConnectStatus, uberDirectStatus, hubriseStatus),
  },
  action: "prospect.integration.recordStatus",
  handler: async (ctx, args): Promise<RecordIntegrationStatusResult> => {
    // 1. Surface a typed NOT_FOUND if the prospect vanished — the slice-1 seam
    //    throws a plain Error; we want the same ConvexError contract as
    //    setMilestone for the UI to consume uniformly.
    const prospect = await getProspectRow(ctx, args.prospectId);
    if (prospect === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Prospect not found.",
      });
    }

    // 2. Discriminated dispatch — refuse any cross-integration payload (e.g.
    //    `integration: "stripeConnect", status: "active"`). The arg validator
    //    above keeps `status` syntactically inside the union of all 3 sets;
    //    THIS narrowing pins each `status` to its own integration's set via
    //    `Infer<typeof *Status>` (the single source of truth in
    //    `table/prospects.ts`). Mis-matched payloads throw `INVALID_ARGUMENT`,
    //    parallel to a missing required field of the boundary validator. The
    //    discriminated dispatch is also what gives the slice-1 helper its
    //    correctly typed status overload.
    assertIntegrationStatusMatches(args.integration, args.status);
    if (args.integration === "stripeConnect") {
      await appendIntegrationStatus(
        ctx,
        args.prospectId,
        "stripeConnect",
        args.status as Infer<typeof stripeConnectStatus>,
        Date.now(),
      );
    } else if (args.integration === "uberDirect") {
      await appendIntegrationStatus(
        ctx,
        args.prospectId,
        "uberDirect",
        args.status as Infer<typeof uberDirectStatus>,
        Date.now(),
      );
    } else {
      await appendIntegrationStatus(
        ctx,
        args.prospectId,
        "hubrise",
        args.status as Infer<typeof hubriseStatus>,
        Date.now(),
      );
    }

    // 3. Chain the composite Closing decision in the same transaction. Returns
    //    the enriched {basculed, phase, closing}. By construction, basculed is
    //    always false here (integrations are not Closing milestones) — the
    //    helper is a structural no-op for this slice but we still keep the call
    //    as a defence-in-depth + uniform return guarantee.
    return maybeAutoBascule(ctx, args.prospectId);
  },
});

// Re-export the canonical `ClosingMilestoneKey` from `pipeline.ts` so any
// consumer of this module's barrel can spell the Closing-set keys WITHOUT
// reaching across modules (the type stays a single source of truth in
// `pipeline.ts`; this re-export is purely an API-surface convenience).
export type { ClosingMilestoneKey } from "./pipeline";
