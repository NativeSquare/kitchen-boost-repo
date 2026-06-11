import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Tenant lifecycle status. Cf. Multi-Tenant CONTEXT + PRD 50. */
export const tenantStatus = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("suspended"),
  v.literal("disabled"),
);

/**
 * 2.5-A — the tenant's Stripe Connect Express account status (PRD 30 §2,
 * payment CONTEXT). NOT the tenant lifecycle `status` above — this reflects ONLY
 * the connected-account onboarding/KYC state as derived from Stripe
 * `account.updated`:
 *  - `pending` — account created / onboarding started but not chargeable yet
 *    (KYC `pending`: details not fully submitted, or verification outstanding).
 *  - `ready`   — KYC verified, the account can take charges AND payouts
 *    (Stripe `charges_enabled && payouts_enabled`). The ONLY status that lets a
 *    direct charge be created (PRD 30 §1/§2).
 *  - `disabled`— Stripe disabled the account (KYC `rejected` / a blocking
 *    requirement). A rejected KYC NEVER maps to `ready` (PRD 30 §1, issue #35).
 */
export const stripeAccountStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("disabled"),
);

// A Tenant = 1 physical établissement. Identity + lifecycle only here.
export const tenants = defineTable({
  slug: v.string(),
  name: v.string(),
  siret: v.string(),
  status: tenantStatus,
  // 2.5-A — Stripe Connect Express link (PRD 30 §2, payment CONTEXT, STACK §3
  // reserves this addition to 2.5). BOTH optional: a fresh tenant has no Stripe
  // account; once the KB Admin generates the `account_link` and Stripe creates
  // the connected account, `stripeAccountId` (`acct_xxx`) is stamped here and
  // `stripeStatus` tracks the KYC/account state from the `account.updated`
  // webhook. KB is NOT merchant of record — this is just the link to the resto's
  // OWN Stripe account (direct charges, payment CONTEXT).
  stripeAccountId: v.optional(v.string()),
  stripeStatus: v.optional(stripeAccountStatus),
  branding: v.optional(
    v.object({
      logoUrl: v.optional(v.string()),
      primaryColor: v.optional(v.string()),
    }),
  ),
  // B-TENANT-LIFECYCLE [1/4] — optional contact + accepted-modes fields the
  // Wizard step 4 (branding élargi, PRD 70 §3.6) and the Paramètres tenant
  // form (PRD 70 §4.8) populate via the upcoming `tenant.updateSettings` (D5
  // élargi). All optional — a fresh tenant created at step 1 has none of
  // these set; they are filled progressively across the wizard / paramètres
  // page. No new index: these fields are never lookup keys.
  address: v.optional(v.string()),
  // Address-first slice 1 (2026-06-11) — `tenants.address` legacy carried only a
  // raw display string (the gérant typed line). The 1st PWA E2E run revealed
  // Uber Direct refuses a quote without `pickup_address`, AND recommends a
  // structured JSON shape with explicit lat/lng for accurate geocoding (cf.
  // `lib/uberDirect/quote.ts`). These three sibling fields carry the structured
  // payload the wizard / Paramètres editor (slice 2 frontend, Google Places)
  // persists ALONGSIDE the display string:
  //  - `addressLat` / `addressLng` — geocoded coordinates (Google Places result)
  //  - `addressComponents` — `{ streetAddress, city, zipCode, country }` shape
  //    the backend forwards to Uber as the JSON `pickup_address` recommended
  //    body.
  //
  // V1: all three stay OPTIONAL — a legacy tenant (created pre-slice 1) carries
  // ONLY `address` and the quote fallback sends it raw (cf. quote.ts). Slice 3
  // will gate `tenant.activate` on the full 4-tuple so a tenant cannot be
  // activated without a Places-validated address. The mutation
  // `tenant.updateSettings` already enforces the 4-tuple all-or-nothing
  // (`INVALID_ADDRESS_PAYLOAD`).
  addressLat: v.optional(v.number()),
  addressLng: v.optional(v.number()),
  addressComponents: v.optional(
    v.object({
      streetAddress: v.string(),
      city: v.string(),
      zipCode: v.string(),
      country: v.string(),
    }),
  ),
  phone: v.optional(v.string()),
  acceptedModes: v.optional(
    v.object({
      delivery: v.boolean(),
      clickAndCollect: v.boolean(),
    }),
  ),
  customDomain: v.optional(v.string()),
  // 2.6-A — the tenant's Uber Direct sub-account id (`customer_id`, research
  // §1.1 / §3.1). One Uber Direct account per tenant — always (one pickup address
  // per account, NEVER shared even with a common SIRET; multi-tenant CONTEXT
  // "Uber Direct par tenant"). Set when the Uber credentials are stored (2.6-A).
  uberCustomerId: v.optional(v.string()),
  // 2.3-A — transient operational pause ("Pause exceptionnelle", PRD 20 §7 /
  // kb-orders CONTEXT). When set, the PWA checkout is disabled until `until`
  // (epoch ms). Absent = no pause (distinct from the `status`-driven `fermé` /
  // `ouvert` lifecycle above). The full open/closed schedule is the slice-F
  // concern; this slice lays only the transient pause domain field, leaving the
  // 1.x identity / lifecycle fields untouched.
  operationalPause: v.optional(v.object({ until: v.number() })),
  // #397 — Fermeture exceptionnelle 1+ jour (PRD 20 §7b, ADR 0018). Distinct
  // from `operationalPause` (transient 15-60 min) AND from the lifecycle
  // `status` (durable suspension): a durable absence (vacances, panne frigo,
  // intempéries) avec date de réouverture explicite. When set AND `from <= now
  // < until`, PWA checkout is disabled with message « Resto fermé jusqu'au
  // JJ/MM ». Auto-reprise dérivée de `until` (no cron), même pattern que
  // operationalPause. Réversible à tout moment via `clearExceptionalClosure`
  // depuis KB Admin OU l'app native (state Convex partagé, ADR 0018).
  exceptionalClosure: v.optional(
    v.object({ from: v.number(), until: v.number() }),
  ),
  // #412 — Star Micronics WebPRNT kitchen printer config (PRD 20 §14 + kb-
  // orders CONTEXT « Impression thermique cuisine »). Optional URL the native
  // app POSTs an ESC/POS payload to when a cmd is acknowledged + when the
  // gérant taps « Réimprimer » on the detail screen. **State partagé Convex**
  // — KB Admin (#416) AND KB Orders Settings (#418 / #412) write through the
  // SAME field, so a change on the web admin is reflected live on the kitchen
  // tablet through the Convex sub (PRD 20 §14 « même state Convex partagé »).
  //
  // Stored as a SUB-OBJECT (not a top-level `printerIp` string) so future
  // printer-related fields (paper width, drawer kick, redundant printer) stay
  // co-located without polluting the root tenant row. V1 carries only
  // `starWebPrntUrl` — the full HTTP URL including scheme + host + path
  // (`http://192.168.1.42/StarWebPRNT/SendMessage` is the canonical Star
  // endpoint, but the gérant configures whatever the printer's web UI
  // advertises). The native helper `buildStarWebPrntEndpoint(ip)` derives a
  // sane default when the gérant only supplies an IP.
  //
  // Absent (= `undefined`) ⇒ auto-print is a clean no-op (PRD 20 §14 « si le
  // tenant a une printerConfig.starWebPrntUrl non-vide, fire-and-forget HTTP
  // POST »). NOT a blocker for the kitchen workflow: a cmd is acknowledged
  // (or refused, or auto-expired) regardless of the printer's reachability.
  printerConfig: v.optional(
    v.object({ starWebPrntUrl: v.optional(v.string()) }),
  ),
  createdAt: v.number(),
})
  .index("by_slug", ["slug"]) // slug is unique (enforced applicatively)
  // 2.5-A — resolve the tenant from a Stripe `account.updated` webhook payload
  // (which only carries the connected `acct_xxx`). `stripeAccountId` is unique per
  // tenant (one Stripe account per resto), enforced applicatively on stamp.
  .index("by_stripe_account", ["stripeAccountId"])
  // PWA-S1 (#449) — resolve the tenant from the public host header on the PWA
  // edge middleware. Two possible hosts per tenant: the bootstrap sub-domain
  // (`<slug>.kitchen-boost.com`, resolved via `by_slug`) AND an optional
  // CUSTOM domain (`artisan.fr`, resolved via this index). `customDomain` is
  // unique per tenant — applicatively enforced on stamp (same discipline as
  // `slug` / `stripeAccountId`). PWA middleware reads `host` → strips port →
  // looks up by sub-domain prefix first (slug) OR by full host (customDomain),
  // then sets the `__Host-kb_tenant=<id>` cookie so subsequent hits skip the
  // round-trip (PRD §10 PWA Client, ADR 0008 « cookie host-only »).
  .index("by_custom_domain", ["customDomain"]);
