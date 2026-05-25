import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";
import { adminInvites } from "./table/adminInvites";
import { auditLog } from "./table/auditLog";
import { cgvVersions } from "./table/cgvVersions";
import { customerOrdersPerTenant } from "./table/customerOrdersPerTenant";
import { customers } from "./table/customers";
import { feedback } from "./table/feedback";
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
});
