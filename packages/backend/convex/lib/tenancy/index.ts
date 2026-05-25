/**
 * Public API of the `tenancy` foundation module — the FIRST line of defence of
 * the 100% applicative multi-tenant isolation (ADR 0010), built on the single
 * sanctioned identity point `getCurrentActor` (ADR 0011).
 *
 * Business code imports its query/mutation builders from HERE, never from
 * Convex's raw `query` / `mutation`:
 *  - `kbAdminQuery` / `kbAdminMutation` — root (kb_admin) scope, any tenant.
 *    Used directly: `kbAdminQuery({ args, handler })`.
 *  - `tenantQuery` / `tenantMutation` — resto scope, explicit `tenantId` arg,
 *    allow-listed effective roles. They are FACTORIES taking `{ allow }`
 *    (default `["kb_manager"]`) and returning the builder, so usage is
 *    `tenantQuery({ allow: ["kb_manager", "staff"] })({ args, handler })` (or
 *    `tenantQuery()({ args, handler })` for the default allow). The handler ctx
 *    gains `{ actor, tenantId }`.
 *  - `customerQuery` / `customerMutation` (1.x-D) — client (eater) scope, global
 *    role `customer`, explicit `tenantId` arg. Used directly:
 *    `customerQuery({ args, handler })`. The handler ctx gains `{ actor,
 *    tenantId }` and only ever sees the caller's OWN `actor.userId` (self-scope).
 *  - `publicTenantQuery` (1.x-D) — read-only PUBLIC tenant data, NO auth,
 *    explicit `tenantId` that must resolve to an existing tenant (else throws).
 *    The handler ctx gains `{ tenantId, tenant }`. No public mutation twin.
 *
 *  - `logAudit` (1.x-G) — append one `auditLog` row from a mutation handler.
 *    Most sensitive writes are audited AUTOMATICALLY by the wrappers (every
 *    `kbAdminMutation`, plus any `tenantMutation` declaring `audit: true`), so
 *    `logAudit` is exported mainly for the explicit cases the wrappers can't
 *    infer (richer `targetType`/`metadata`, an action spanning several writes).
 *
 * The reusable cross-tenant fuzz harness (`runCrossTenantFuzz`,
 * `seedTwoTenantsAllRoles`) lives in `./fuzz` and is imported directly by test
 * suites (it depends on the convex-test handle), not re-exported here — a barrel
 * re-export would pull a test-only helper into the deploy graph.
 *
 * (The probe Convex functions in `_probes.ts` are test fixtures, registered by
 * their own module path, not part of this contract.)
 */
export {
  kbAdminMutation,
  kbAdminQuery,
  tenantMutation,
  tenantQuery,
  type TenantRole,
} from "./withTenant";
export { customerMutation, customerQuery, publicTenantQuery } from "./customer";
export {
  type CustomerConsentPatch,
  anonymizeCustomerFiche,
  getOrCreateCustomerFiche,
  insertCustomerFiche,
  patchCustomerConsent,
  readCustomerFicheById,
  readCustomerFicheByUser,
} from "./customerFiche";
export {
  type CustomerAggregateFields,
  type PushEnrollmentPatch,
  listTenantCustomerOrders,
  patchCustomerPushEnrollment,
  readCustomerAggregateFields,
} from "./customerOrdersStore";
export {
  closeActiveCgvVersions,
  insertCgvVersion,
  readActiveCgvVersion,
} from "./cgvArchive";
export { logAudit, type AuditEntry } from "./audit";
export {
  type PricingRuleBody,
  deleteTenantPricingRule,
  getTenantPricingRule,
  insertTenantPricingRule,
  listTenantPricingRules,
  patchTenantPricingRuleBody,
  requireTenantPricingRule,
  setTenantPricingRuleActive,
} from "./pricingRulesStore";
export {
  type DeliveryPatch,
  type NewDelivery,
  getTenantDelivery,
  getTenantDeliveryByOrder,
  insertTenantDelivery,
  listTenantDeliveries,
  patchTenantDelivery,
  requireTenantDelivery,
  setTenantUberCustomerId,
} from "./deliveriesStore";
export {
  type NewTransactionalEvent,
  insertTenantNotificationEvent,
  listTenantCustomerNotificationEvents,
  listTenantNotificationEvents,
} from "./notificationsStore";
export {
  type NewOrder,
  type NewOrderItem,
  type OrderWithDetail,
  clearTenantOperationalPause,
  getTenantOperationalPause,
  getTenantOrder,
  getTenantOrderWithDetail,
  insertTenantOrder,
  listTenantOrderEvents,
  listTenantOrderItems,
  listTenantOrders,
  listTenantOrdersByStatus,
  recordTenantOrderStatus,
  requireTenantOrder,
  setTenantOperationalPause,
} from "./ordersStore";
