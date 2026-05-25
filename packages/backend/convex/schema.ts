import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";
import { adminInvites } from "./table/adminInvites";
import { auditLog } from "./table/auditLog";
import { cgvVersions } from "./table/cgvVersions";
import { customerOrdersPerTenant } from "./table/customerOrdersPerTenant";
import { customers } from "./table/customers";
import { deliveries } from "./table/deliveries";
import { feedback } from "./table/feedback";
import {
  notificationEvents,
  notificationTemplates,
} from "./table/notifications";
import { orderEvents, orderItems, orders } from "./table/orders";
import { pricingRules } from "./table/pricingRules";
import { processedWebhookEvents } from "./table/processedWebhookEvents";
import { tenantCredentials } from "./table/tenantCredentials";
import { tenants } from "./table/tenants";
import { userTenants } from "./table/userTenants";
import { users } from "./table/users";

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
  // 2.7-A — Notifications (PRD 80, ADR 0006 templates pré-validés, ADR 0012 push
  // split). `notificationTemplates` = pre-validated campaign presets with their
  // declarative bounds (discount ≤ 50 %, < 200 chars, FR, no alcohol);
  // `notificationEvents` = the send journal (both carry tenantId, ADR 0010;
  // events reference customerId BY ID only — the MOAT). The push joignabilité
  // (Wallet serial / web-push id / per-channel status) is NOT duplicated here —
  // it lives in `customers.pushEnrollment` (2.1, ADR 0012); 2.7 only sends.
  notificationTemplates,
  notificationEvents,
});
