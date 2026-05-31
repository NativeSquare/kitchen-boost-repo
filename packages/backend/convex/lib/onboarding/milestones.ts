import { ConvexError, type Infer, v } from "convex/values";
import {
  type BinaryMilestoneKey,
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
 * schema's set of binary milestones. If a new binary milestone is added to
 * `table/prospects.ts → milestones`, this assertion errors until the new
 * literal is added to `milestoneKey` above (and vice versa). Single source of
 * truth: `BinaryMilestoneKey` is itself derived from `Doc<"prospects">["milestones"]`.
 */
type Assert<A, _B extends A> = true;
type AssertEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MilestoneKeyMatchesSchema = Assert<
  true,
  AssertEqual<MilestoneKey, BinaryMilestoneKey>
>;

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

// Re-export the canonical `ClosingMilestoneKey` from `pipeline.ts` so any
// consumer of this module's barrel can spell the Closing-set keys WITHOUT
// reaching across modules (the type stays a single source of truth in
// `pipeline.ts`; this re-export is purely an API-surface convenience).
export type { ClosingMilestoneKey } from "./pipeline";
