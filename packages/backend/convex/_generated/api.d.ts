/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as lib_auth_ResendOTP from "../lib/auth/ResendOTP.js";
import type * as lib_auth_ResendOTPPasswordReset from "../lib/auth/ResendOTPPasswordReset.js";
import type * as lib_auth_getCurrentActor from "../lib/auth/getCurrentActor.js";
import type * as lib_auth_index from "../lib/auth/index.js";
import type * as lib_crypto_credentials from "../lib/crypto/credentials.js";
import type * as lib_crypto_envelope from "../lib/crypto/envelope.js";
import type * as lib_crypto_index from "../lib/crypto/index.js";
import type * as lib_customer_cgv from "../lib/customer/cgv.js";
import type * as lib_customer_consent from "../lib/customer/consent.js";
import type * as lib_customer_identity from "../lib/customer/identity.js";
import type * as lib_customer_index from "../lib/customer/index.js";
import type * as lib_pricing_contradictions from "../lib/pricing/contradictions.js";
import type * as lib_pricing_defaultRule from "../lib/pricing/defaultRule.js";
import type * as lib_pricing_index from "../lib/pricing/index.js";
import type * as lib_pricing_rules from "../lib/pricing/rules.js";
import type * as lib_tenancy__probes from "../lib/tenancy/_probes.js";
import type * as lib_tenancy_audit from "../lib/tenancy/audit.js";
import type * as lib_tenancy_cgvArchive from "../lib/tenancy/cgvArchive.js";
import type * as lib_tenancy_customer from "../lib/tenancy/customer.js";
import type * as lib_tenancy_customerFiche from "../lib/tenancy/customerFiche.js";
import type * as lib_tenancy_deliveriesStore from "../lib/tenancy/deliveriesStore.js";
import type * as lib_tenancy_fuzz from "../lib/tenancy/fuzz.js";
import type * as lib_tenancy_index from "../lib/tenancy/index.js";
import type * as lib_tenancy_pricingRulesStore from "../lib/tenancy/pricingRulesStore.js";
import type * as lib_tenancy_withTenant from "../lib/tenancy/withTenant.js";
import type * as lib_uberDirect_credentials from "../lib/uberDirect/credentials.js";
import type * as lib_uberDirect_deliveries from "../lib/uberDirect/deliveries.js";
import type * as lib_uberDirect_index from "../lib/uberDirect/index.js";
import type * as lib_webhooks_idempotent from "../lib/webhooks/idempotent.js";
import type * as lib_webhooks_index from "../lib/webhooks/index.js";
import type * as migrations from "../migrations.js";
import type * as storage from "../storage.js";
import type * as table_admin from "../table/admin.js";
import type * as table_adminInvites from "../table/adminInvites.js";
import type * as table_auditLog from "../table/auditLog.js";
import type * as table_cgvVersions from "../table/cgvVersions.js";
import type * as table_customerOrdersPerTenant from "../table/customerOrdersPerTenant.js";
import type * as table_customers from "../table/customers.js";
import type * as table_deliveries from "../table/deliveries.js";
import type * as table_feedback from "../table/feedback.js";
import type * as table_pricingRules from "../table/pricingRules.js";
import type * as table_processedWebhookEvents from "../table/processedWebhookEvents.js";
import type * as table_tenantCredentials from "../table/tenantCredentials.js";
import type * as table_tenants from "../table/tenants.js";
import type * as table_userTenants from "../table/userTenants.js";
import type * as table_users from "../table/users.js";
import type * as utils_generateFunctions from "../utils/generateFunctions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  emails: typeof emails;
  http: typeof http;
  "lib/auth/ResendOTP": typeof lib_auth_ResendOTP;
  "lib/auth/ResendOTPPasswordReset": typeof lib_auth_ResendOTPPasswordReset;
  "lib/auth/getCurrentActor": typeof lib_auth_getCurrentActor;
  "lib/auth/index": typeof lib_auth_index;
  "lib/crypto/credentials": typeof lib_crypto_credentials;
  "lib/crypto/envelope": typeof lib_crypto_envelope;
  "lib/crypto/index": typeof lib_crypto_index;
  "lib/customer/cgv": typeof lib_customer_cgv;
  "lib/customer/consent": typeof lib_customer_consent;
  "lib/customer/identity": typeof lib_customer_identity;
  "lib/customer/index": typeof lib_customer_index;
  "lib/pricing/contradictions": typeof lib_pricing_contradictions;
  "lib/pricing/defaultRule": typeof lib_pricing_defaultRule;
  "lib/pricing/index": typeof lib_pricing_index;
  "lib/pricing/rules": typeof lib_pricing_rules;
  "lib/tenancy/_probes": typeof lib_tenancy__probes;
  "lib/tenancy/audit": typeof lib_tenancy_audit;
  "lib/tenancy/cgvArchive": typeof lib_tenancy_cgvArchive;
  "lib/tenancy/customer": typeof lib_tenancy_customer;
  "lib/tenancy/customerFiche": typeof lib_tenancy_customerFiche;
  "lib/tenancy/deliveriesStore": typeof lib_tenancy_deliveriesStore;
  "lib/tenancy/fuzz": typeof lib_tenancy_fuzz;
  "lib/tenancy/index": typeof lib_tenancy_index;
  "lib/tenancy/pricingRulesStore": typeof lib_tenancy_pricingRulesStore;
  "lib/tenancy/withTenant": typeof lib_tenancy_withTenant;
  "lib/uberDirect/credentials": typeof lib_uberDirect_credentials;
  "lib/uberDirect/deliveries": typeof lib_uberDirect_deliveries;
  "lib/uberDirect/index": typeof lib_uberDirect_index;
  "lib/webhooks/idempotent": typeof lib_webhooks_idempotent;
  "lib/webhooks/index": typeof lib_webhooks_index;
  migrations: typeof migrations;
  storage: typeof storage;
  "table/admin": typeof table_admin;
  "table/adminInvites": typeof table_adminInvites;
  "table/auditLog": typeof table_auditLog;
  "table/cgvVersions": typeof table_cgvVersions;
  "table/customerOrdersPerTenant": typeof table_customerOrdersPerTenant;
  "table/customers": typeof table_customers;
  "table/deliveries": typeof table_deliveries;
  "table/feedback": typeof table_feedback;
  "table/pricingRules": typeof table_pricingRules;
  "table/processedWebhookEvents": typeof table_processedWebhookEvents;
  "table/tenantCredentials": typeof table_tenantCredentials;
  "table/tenants": typeof table_tenants;
  "table/userTenants": typeof table_userTenants;
  "table/users": typeof table_users;
  "utils/generateFunctions": typeof utils_generateFunctions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
