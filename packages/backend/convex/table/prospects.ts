import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.9-A — `prospects` (PRD 70 §3.3/§3.4, kb-admin CONTEXT).
 *
 * A restaurant being prospected / onboarded by KB — a [[Prospect]], distinct
 * from a signed [[Tenant]] (no `tenantId` until it is provisioned). This is KB's
 * OWN sales / onboarding pipeline: the "Pipeline onboarding" is the source of
 * truth of `KitchenBoost Admin` and is "accessible côté rôle KB Admin uniquement"
 * (kb-admin CONTEXT). It is therefore KB-ADMIN-GLOBAL, NOT tenant-scoped.
 *
 * ── KB-ADMIN-GLOBAL, NO `tenantId` SCOPING KEY — ISOLATION EXEMPTION (ADR 0010) ─
 * Exactly like `customers` / `cgvVersions`, this table is deliberately NOT
 * tenant-scoped: a prospect is KB-owned pipeline data, owned by the `kb_admin`
 * (root) role — no `kb_manager` / `staff` / `customer` ever reads it. There is no
 * `tenantId` to scope on (the optional `tenantId` below is a BACK-LINK set once
 * the prospect is provisioned into a tenant, used by the `by_tenant` index to go
 * prospect → tenant, NOT a tenancy boundary). The `no-untenanted-query` ESLint
 * rule (1.x-H / #26) therefore does NOT apply by tenant here: access still goes
 * EXCLUSIVELY through the sanctioned root wrappers (`kbAdminQuery/Mutation`) —
 * never a raw `ctx.db.query("prospects")` in business code. The sanctioned
 * `ctx.db` site is the exempt `convex/lib/tenancy/**` path (alongside this
 * `convex/table/**` foundation file), so both ends are covered; new 2.x business
 * modules get NO exemption and must route through `kbAdminQuery/Mutation`.
 *
 * Vocabulary is NOT invented — every enum is fixed by the PRD/CONTEXT/contract:
 *  - `phase` — the 4 pipeline phases (kb-admin CONTEXT "Phase pipeline").
 *  - `source` — the 4 acquisition channels (PRD 70 §3.3 Acquisition milestone).
 *  - `tabletteMode` — the 2 Prestation-B tablette options of the contract
 *    (contrat_template.md Article 3 ter): `appareil_existant` (BYOD, default) and
 *    `achat_kb` (KB-supplied tablet, 99 € HT). `achat_kb` is what enables the
 *    conditional Closing milestone "facture tablette émise / payée".
 *  - milestone integration statuses — the exact lists of PRD 70 §3.3
 *    (Préparation): Stripe Connect / Uber Direct / Hubrise.
 *
 * Written field-by-field by later 2.9 slices (CRM CRUD, pipeline transitions,
 * milestone toggles, wizard provisioning); this slice only lays the table + the
 * `by_phase` and `by_tenant` indexes.
 */

/** The 4 pipeline phases (kb-admin CONTEXT "Phase pipeline", acté 2026-05-23). */
export const prospectPhase = v.union(
  v.literal("acquisition"),
  v.literal("preparation"),
  v.literal("installation"),
  v.literal("operationnel"),
);

/** The 4 acquisition channels (PRD 70 §3.3 — also reused for an interaction's canal). */
export const acquisitionSource = v.union(
  v.literal("cold_call"),
  v.literal("whatsapp"),
  v.literal("referral"),
  v.literal("visite_physique"),
);

/**
 * The 2 Prestation-B tablette options (contrat_template.md Article 3 ter):
 *  - `appareil_existant` — the partner's own device (BYOD, default Option 1).
 *  - `achat_kb` — KB-supplied pre-configured tablet (Option 2, 99 € HT). Drives
 *    the conditional Closing milestone "facture tablette émise / payée".
 */
export const tabletteMode = v.union(
  v.literal("appareil_existant"),
  v.literal("achat_kb"),
);

/** Stripe Connect integration status (PRD 70 §3.3 Préparation — exact list). */
export const stripeConnectStatus = v.union(
  v.literal("not_started"),
  v.literal("pending_kyc"),
  v.literal("verified"),
  v.literal("rejected"),
  v.literal("disabled"),
);

/** Uber Direct integration status (PRD 70 §3.3 Préparation — exact list). */
export const uberDirectStatus = v.union(
  v.literal("not_started"),
  v.literal("pending_kyc"),
  v.literal("active"),
  v.literal("failed"),
);

/** Hubrise integration status (optional V1, PRD 70 §3.3 Préparation — exact list). */
export const hubriseStatus = v.union(
  v.literal("not_configured"),
  v.literal("configured"),
  v.literal("active"),
);

/**
 * A composite (oscillating) integration milestone: the current status plus a
 * dated history of every transition. Models the Stripe / Uber oscillation
 * `pending → verified → rejected → pending` (kb-admin CONTEXT [[Milestone]]).
 * One per integration so each carries its OWN status union.
 */
const stripeConnectMilestone = v.object({
  current: stripeConnectStatus,
  history: v.array(v.object({ status: stripeConnectStatus, at: v.number() })),
});
const uberDirectMilestone = v.object({
  current: uberDirectStatus,
  history: v.array(v.object({ status: uberDirectStatus, at: v.number() })),
});
const hubriseMilestone = v.object({
  current: hubriseStatus,
  history: v.array(v.object({ status: hubriseStatus, at: v.number() })),
});

/**
 * Per-phase advancement state. Binary milestones are modelled as an OPTIONAL
 * TIMESTAMP (present = achieved, at that instant) — so a simple "KBIS reçu :
 * oui/non" check and an oscillating integration status can both live here, as
 * the issue requires. Every field optional: a fresh prospect has none. The exact
 * binary milestones are those of PRD 70 §3.3 (Acquisition); the conditional
 * tablette-invoice milestones apply only when `tabletteMode = achat_kb`.
 */
export const milestones = v.object({
  // Binary Acquisition milestones (PRD 70 §3.3) — timestamp = achieved.
  premierContact: v.optional(v.number()),
  rdvBooke: v.optional(v.number()),
  devisPresente: v.optional(v.number()),
  contratGenere: v.optional(v.number()),
  contratEnvoyeOdoo: v.optional(v.number()),
  contratSigne: v.optional(v.number()),
  kbisRecu: v.optional(v.number()),
  pieceIdentiteRecue: v.optional(v.number()),
  ribRecu: v.optional(v.number()),
  // Conditional (only when tabletteMode = achat_kb), PRD 70 §3.3.
  factureTabletteEmise: v.optional(v.number()),
  factureTablettePayee: v.optional(v.number()),
  // Binary Préparation / Installation milestones (PRD 70 §3.3) — timestamp = done.
  photosEmballagesRecues: v.optional(v.number()),
  menuImporte: v.optional(v.number()),
  // Composite (oscillating) integration milestones (PRD 70 §3.3 Préparation).
  stripeConnect: v.optional(stripeConnectMilestone),
  uberDirect: v.optional(uberDirectMilestone),
  hubrise: v.optional(hubriseMilestone),
});

/** One logged interaction with the prospect (PRD 70 §3.4 "log interaction"). */
const interaction = v.object({
  note: v.string(),
  date: v.number(),
  canal: acquisitionSource,
});

export const prospects = defineTable({
  // Identity (PRD 70 §3.2 / §3.4). `name` + `phone` are the only required fields;
  // the rest is filled progressively during acquisition.
  name: v.string(),
  siret: v.optional(v.string()),
  address: v.optional(v.string()),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.string(),

  // Pipeline state.
  phase: prospectPhase,
  source: acquisitionSource,
  score: v.optional(v.number()),

  // Per-phase advancement + which tablette path was chosen.
  tabletteMode: v.optional(tabletteMode),
  milestones: v.optional(milestones),

  // Lightweight CRM interaction log (note + date + canal), PRD 70 §3.4.
  interactions: v.optional(v.array(interaction)),

  // BACK-LINK to the tenant once provisioned (not a tenancy scoping key — see the
  // module header). Absent for a still-prospect restaurant.
  tenantId: v.optional(v.id("tenants")),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  // Kanban "by phase" column reads + filters (PRD 70 §3.3 / §3.4).
  .index("by_phase", ["phase"])
  // prospect → tenant once provisioned (PRD 70 §3.2 detail).
  .index("by_tenant", ["tenantId"]);
