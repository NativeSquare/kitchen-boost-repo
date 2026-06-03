import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";
import { adminInvites } from "./table/adminInvites";
import { auditLog } from "./table/auditLog";
import { cgvVersions } from "./table/cgvVersions";
import { contracts } from "./table/contracts";
import { customerOrdersPerTenant } from "./table/customerOrdersPerTenant";
import { customers } from "./table/customers";
import { deliveries } from "./table/deliveries";
import { devices } from "./table/devices";
import { feedback } from "./table/feedback";
import { menuCategories } from "./table/menuCategories";
import { menuItemModifierGroups } from "./table/menuItemModifierGroups";
import { menuItems } from "./table/menuItems";
import { modifierGroups } from "./table/modifierGroups";
import { serviceHours } from "./table/serviceHours";
import {
  campaignLaunches,
  notificationEvents,
  notificationTemplates,
} from "./table/notifications";
import { orderEvents, orderItems, orders } from "./table/orders";
import { payments } from "./table/payments";
import { pricingRules } from "./table/pricingRules";
import { processedWebhookEvents } from "./table/processedWebhookEvents";
import { prospects } from "./table/prospects";
import { publishedMenus } from "./table/publishedMenus";
import { tenantCredentials } from "./table/tenantCredentials";
import { tenants } from "./table/tenants";
import { userTenants } from "./table/userTenants";
import { users } from "./table/users";
import { walletDeviceRegistrations } from "./table/walletDeviceRegistrations";
import { walletIncentiveDeliveries } from "./table/walletIncentiveDeliveries";
import { walletPasses } from "./table/walletPasses";
import { webPushSubscriptions } from "./table/webPushSubscriptions";

export default defineSchema({
  ...authTables,
  adminInvites,
  feedback,
  users,
  // 1.x-A — transverse multi-tenant foundation
  tenants,
  userTenants,
  auditLog,
  processedWebhookEvents,
  tenantCredentials,
  // 2.1-A — Customer Data (the MOAT). `customers` is GLOBAL (no tenantId, ADR
  // 0010); the per-tenant link table carries tenantId; cgvVersions archives
  // consent wording (ADR 0007).
  customers,
  cgvVersions,
  customerOrdersPerTenant,
  // 2.4-B — Pricing engine (backend-only, ADR 0013). Tenant-scoped configurable
  // delivery-fee rules (carries tenantId, by_tenant index, ADR 0010). The rule
  // shape mirrors the pure engine in @packages/shared/pricing (#29).
  pricingRules,
  // 2.6-A — Delivery (Uber Direct, PRD 40). Tenant-scoped delivery / click &
  // collect fulfilment rows (carries tenantId, ADR 0010). Uber credentials reuse
  // the existing `tenantCredentials` row (provider = "uber_direct", 1.x-E) — not
  // a new table. `tenants.uberCustomerId` (added above) links the Uber account.
  deliveries,
  // 2.3-A — Orders (PRD 10 Client Ordering + PRD 20 KB Orders). Tenant-scoped
  // (all three carry tenantId, ADR 0010). `orderItems` are FROZEN snapshots
  // (denormalised name/price/modifiers/allergens, NOT FKs into the menu — PRD 10
  // §7), so an order is self-contained. `orderEvents` is the append-only status
  // audit. The transient `operationalPause` field is on `tenants` (above).
  orders,
  orderItems,
  orderEvents,
  // 2.5-B — Payment (direct charge Stripe Connect, PRD 30 §3/§4). Tenant-scoped
  // (carries tenantId, ADR 0010): one local source-of-truth row per order's
  // PaymentIntent on the resto's connected account. Indexed by order AND by
  // `paymentIntentId` (webhook resolution). KB is NOT merchant of record — it
  // takes a fixed `application_fee_amount` (240 cts TTC immutable V1, Q30-Q1),
  // stored HT (200 cts) for CGI-compliant reporting (Q30-Q7). Payment never
  // recomputes the total — it charges the amount received from Pricing (#20).
  payments,
  // 2.7-A — Notifications (PRD 80, ADR 0006 templates pré-validés, ADR 0012 push
  // split). `notificationTemplates` = pre-validated campaign presets with their
  // declarative bounds (discount ≤ 50 %, < 200 chars, FR, no alcohol);
  // `notificationEvents` = the send journal (both carry tenantId, ADR 0010;
  // events reference customerId BY ID only — the MOAT). The push joignabilité
  // (Wallet serial / web-push id / per-channel status) is NOT duplicated here —
  // it lives in `customers.pushEnrollment` (2.1, ADR 0012); 2.7 only sends.
  notificationTemplates,
  notificationEvents,
  // 2.7-D — Marketing campaigns. `campaignLaunches` = one row per campaign LAUNCH
  // per resto (PRD 80 §7 anti-anomaly: > 1/48h, > 3/sem, recipient surge +50 %).
  // Tenant-scoped (carries tenantId, ADR 0010); stores recipient COUNTS only, no
  // nominative recipient (the MOAT). The per-send rows stay in notificationEvents.
  campaignLaunches,
  // 2.2-A — Menu (PRD 10 §5/§6, client-ordering CONTEXT). All five tables are
  // TENANT-SCOPED (carry tenantId, ADR 0010). `menuCategories` = flat editorial
  // groups (no hierarchy V1); `menuItems` = sellable products (basePrice in
  // centimes, allergens a subset of the frozen 14 UE 1169/2011 literals,
  // available toggle for "out of stock"); `modifierGroups` = REUSABLE choice
  // groups (Uber Eats model — NOT owned by an item); `menuItemModifierGroups` =
  // the N-N link materialising that reuse (by_item / by_group / by_item_group);
  // `serviceHours` = [[Plage horaire de service]] (one row/tenant, windows shared
  // delivery + C&C, Europe/Paris implicit), KB source of truth read by checkout.
  menuCategories,
  menuItems,
  modifierGroups,
  menuItemModifierGroups,
  serviceHours,
  // B-MENU-PUBLICATION slice 1 — `publishedMenus` (ADR 0015 + ADR 0010). One doc
  // per tenant carrying the structured snapshot the PWA mangeur reads from once
  // the publication pipeline is wired (slices 2–6). Rebuilt entirely at every
  // publish, atomically inside ONE Convex tx. PIVOT: the snapshot does NOT carry
  // `available` — the rupture stays a live overlay read from `menuItems` (ADR
  // 0015 « la rupture ne doit pas exiger une republication globale »). Tenant-
  // scoped (carries tenantId), reached ONLY through the sanctioned seam
  // `lib/tenancy/menuStore`. Indexed by_tenant — the only access path.
  publishedMenus,
  // 2.9-A — KB Admin backend (PRD 70, kb-admin CONTEXT). Both tables are
  // KB-ADMIN-GLOBAL (NO tenantId scoping key, like `customers`/`cgvVersions`,
  // ADR 0010): they hold KB's OWN onboarding pipeline, owned by the `kb_admin`
  // (root) role — accessed via `kbAdminQuery/Mutation`, never raw ctx.db in
  // business code. `prospects` = a restaurant being prospected (NOT yet a
  // tenant); its `phase`/`source`/`tabletteMode`/milestone enums are fixed by
  // the PRD/CONTEXT/contract (none invented). Milestones model both binary checks
  // (timestamp = achieved) AND oscillating integration statuses (current + dated
  // history). `contracts` = the A/B/A&B contract lifecycle (dated draft → sent →
  // signed → expired); the HTML generation itself is #64. The optional `tenantId`
  // on each is a BACK-LINK (by_tenant index), set once provisioned — not a tenancy
  // boundary.
  prospects,
  contracts,
  // 2.8-A — Wallet pass (PRD 80 Notifications, ADR 0003 carte commune marque
  // neutre). `walletPasses` is GLOBAL with NO authoritative `tenantId` (like
  // `customers`, ADR 0010): the card is ONE common card under a neutral consumer
  // brand for ALL restos — the visible branding (`lastBrandTenantId`) is a USAGE,
  // not an ownership. It holds the TECHNICAL pass state only (serialNumber unique
  // via by_serial, FIXED passTypeIdentifier, a Customer ref, install state,
  // lifecycle status); the AUTHORITATIVE serial→customer identity bridge lives in
  // 2.1 (`customers.pushEnrollment.walletSerialNumber`, ADR 0008/0012) — NOT
  // duplicated here. Reached only through the sanctioned `lib/tenancy` seam.
  walletPasses,
  // 2.8-B — Wallet device registry (PRD 80, ADR 0003, STACK §5.4). The device↔pass
  // couples the Apple Wallet Web Service registers (POST) / unregisters (DELETE) so
  // KB can push card updates over APNs. GLOBAL with NO authoritative `tenantId`
  // (like `walletPasses` — the common neutral card is one channel for all restos,
  // ADR 0010 documented exemption); the `(deviceLibraryIdentifier, serialNumber)`
  // couple is UNIQUE (idempotent register, soft `inactive` on unregister). Reached
  // only through the sanctioned `lib/tenancy` seam. This slice is the device-
  // registration plumbing only — serial→customer (slice C) + push (slice D) come
  // later.
  walletDeviceRegistrations,
  // 2.8-E — Incentive Wallet conditional delivery (PRD 80, ADR 0002, [[Incentive
  // Wallet]] glossaire client-ordering). `walletIncentiveDeliveries` is the ledger
  // proving the reward code was delivered to a Customer once the pass was REALLY
  // installed (US 19 — no fake reward). GLOBAL with NO authoritative `tenantId`
  // (the Incentive rides the COMMON neutral card, ADR 0003 / ADR 0010 exemption);
  // `serialNumber` is UNIQUE (by_serial) — ONE reward per pass, never per device
  // (US 20). The single write site is the `lib/tenancy` seam, reached ONLY from
  // `linkSerialToCustomer` inside the install handler's `withIdempotence` block —
  // no alternative generation path, so a row cannot exist without a constated
  // install. The reward PARAMETRISATION (hook text + promo code value) is edited in
  // KB Admin Phase C (a Phase-3 front, out of scope) — this records only the
  // delivery FACT, no invented promo string.
  walletIncentiveDeliveries,
  // 2.1-G — Web Push subscriptions (PRD 90 Customer Data, notifications CONTEXT
  // « Push subscription », ADR 0012 push split 2.1/2.7). The persisted RFC 8291
  // subscription objects (endpoint + client keys p256dh/auth) the send layer (#54)
  // needs to encrypt + POST a push — data `customers.pushEnrollment` (opaque id +
  // status only) does NOT hold. TENANT-SCOPED (carries tenantId, web-push is
  // per-origin — « 1 origine = 1 channel », ADR 0010): the inverse of the GLOBAL
  // Wallet registry, so it goes through the tenancy seam + ships the cross-tenant
  // fuzz. A tenant-scoped satellite of the GLOBAL MOAT fiche (customer referenced BY
  // ID only). `endpoint` is UNIQUE (by_endpoint): idempotent re-subscribe (refresh
  // keys + reactivate), soft `inactive` on 410 Gone (no hard delete). The SEND
  // itself is #54 (2.7) — this slice is storage only.
  webPushSubscriptions,
  // #393 (KB Orders, PRD 20 §1a / §1b / §12) — per-(user, device) preference
  // row owned by the native app. USER-SCOPED, NO `tenantId` scoping key
  // (accessed via the self-identity seam `lib/tenancy/devicesStore`, never raw
  // `ctx.db.query("devices")`). Drives the FIRST-login kiosque/téléphone
  // toggle, the kiosque `pinnedTenantId` (#399 reads it to hide the switcher
  // + audit monolithique V1), the phone-mode `lastSelectedTenantId` (#399
  // hydrates the switcher default), and the `onboardingCompleted` skip flag.
  // The cross-tenant constraint on `pinnedTenantId` (user must have an ACTIVE
  // `userTenants` attachment on the tenant) lives in the BUSINESS layer —
  // `lib/devices/setMyDeviceMode` resolves access via `getCurrentActor` and
  // throws Forbidden otherwise; the cross-tenant fuzz pins that.
  devices,
});
