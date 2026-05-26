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
import type * as lib_cart_cart from "../lib/cart/cart.js";
import type * as lib_cart_index from "../lib/cart/index.js";
import type * as lib_crypto_credentials from "../lib/crypto/credentials.js";
import type * as lib_crypto_envelope from "../lib/crypto/envelope.js";
import type * as lib_crypto_index from "../lib/crypto/index.js";
import type * as lib_customer_cgv from "../lib/customer/cgv.js";
import type * as lib_customer_consent from "../lib/customer/consent.js";
import type * as lib_customer_identity from "../lib/customer/identity.js";
import type * as lib_customer_index from "../lib/customer/index.js";
import type * as lib_customer_kpi from "../lib/customer/kpi.js";
import type * as lib_customer_reachability from "../lib/customer/reachability.js";
import type * as lib_customer_rgpd from "../lib/customer/rgpd.js";
import type * as lib_customer_segments from "../lib/customer/segments.js";
import type * as lib_menu_availability from "../lib/menu/availability.js";
import type * as lib_menu_catalog from "../lib/menu/catalog.js";
import type * as lib_menu_categories from "../lib/menu/categories.js";
import type * as lib_menu_index from "../lib/menu/index.js";
import type * as lib_menu_items from "../lib/menu/items.js";
import type * as lib_menu_modifiers from "../lib/menu/modifiers.js";
import type * as lib_menu_serviceHours from "../lib/menu/serviceHours.js";
import type * as lib_notifications_categories from "../lib/notifications/categories.js";
import type * as lib_notifications_engine from "../lib/notifications/engine.js";
import type * as lib_notifications_index from "../lib/notifications/index.js";
import type * as lib_notifications_notify from "../lib/notifications/notify.js";
import type * as lib_notifications_templateBounds from "../lib/notifications/templateBounds.js";
import type * as lib_onboarding_crm from "../lib/onboarding/crm.js";
import type * as lib_onboarding_csv from "../lib/onboarding/csv.js";
import type * as lib_onboarding_gates from "../lib/onboarding/gates.js";
import type * as lib_onboarding_index from "../lib/onboarding/index.js";
import type * as lib_onboarding_seedData from "../lib/onboarding/seedData.js";
import type * as lib_orders_index from "../lib/orders/index.js";
import type * as lib_orders_orders from "../lib/orders/orders.js";
import type * as lib_orders_status from "../lib/orders/status.js";
import type * as lib_orders_workflow from "../lib/orders/workflow.js";
import type * as lib_pricing_contradictions from "../lib/pricing/contradictions.js";
import type * as lib_pricing_defaultRule from "../lib/pricing/defaultRule.js";
import type * as lib_pricing_evaluate from "../lib/pricing/evaluate.js";
import type * as lib_pricing_index from "../lib/pricing/index.js";
import type * as lib_pricing_rules from "../lib/pricing/rules.js";
import type * as lib_tenancy__probes from "../lib/tenancy/_probes.js";
import type * as lib_tenancy_audit from "../lib/tenancy/audit.js";
import type * as lib_tenancy_cgvArchive from "../lib/tenancy/cgvArchive.js";
import type * as lib_tenancy_customer from "../lib/tenancy/customer.js";
import type * as lib_tenancy_customerFiche from "../lib/tenancy/customerFiche.js";
import type * as lib_tenancy_customerOrdersStore from "../lib/tenancy/customerOrdersStore.js";
import type * as lib_tenancy_deliveriesStore from "../lib/tenancy/deliveriesStore.js";
import type * as lib_tenancy_fuzz from "../lib/tenancy/fuzz.js";
import type * as lib_tenancy_index from "../lib/tenancy/index.js";
import type * as lib_tenancy_menuStore from "../lib/tenancy/menuStore.js";
import type * as lib_tenancy_notificationsStore from "../lib/tenancy/notificationsStore.js";
import type * as lib_tenancy_ordersStore from "../lib/tenancy/ordersStore.js";
import type * as lib_tenancy_pricingRulesStore from "../lib/tenancy/pricingRulesStore.js";
import type * as lib_tenancy_prospectsStore from "../lib/tenancy/prospectsStore.js";
import type * as lib_tenancy_serviceHoursStore from "../lib/tenancy/serviceHoursStore.js";
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
import type * as table_contracts from "../table/contracts.js";
import type * as table_customerOrdersPerTenant from "../table/customerOrdersPerTenant.js";
import type * as table_customers from "../table/customers.js";
import type * as table_deliveries from "../table/deliveries.js";
import type * as table_feedback from "../table/feedback.js";
import type * as table_menuCategories from "../table/menuCategories.js";
import type * as table_menuItemModifierGroups from "../table/menuItemModifierGroups.js";
import type * as table_menuItems from "../table/menuItems.js";
import type * as table_modifierGroups from "../table/modifierGroups.js";
import type * as table_notifications from "../table/notifications.js";
import type * as table_orders from "../table/orders.js";
import type * as table_pricingRules from "../table/pricingRules.js";
import type * as table_processedWebhookEvents from "../table/processedWebhookEvents.js";
import type * as table_prospects from "../table/prospects.js";
import type * as table_serviceHours from "../table/serviceHours.js";
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
  "lib/cart/cart": typeof lib_cart_cart;
  "lib/cart/index": typeof lib_cart_index;
  "lib/crypto/credentials": typeof lib_crypto_credentials;
  "lib/crypto/envelope": typeof lib_crypto_envelope;
  "lib/crypto/index": typeof lib_crypto_index;
  "lib/customer/cgv": typeof lib_customer_cgv;
  "lib/customer/consent": typeof lib_customer_consent;
  "lib/customer/identity": typeof lib_customer_identity;
  "lib/customer/index": typeof lib_customer_index;
  "lib/customer/kpi": typeof lib_customer_kpi;
  "lib/customer/reachability": typeof lib_customer_reachability;
  "lib/customer/rgpd": typeof lib_customer_rgpd;
  "lib/customer/segments": typeof lib_customer_segments;
  "lib/menu/availability": typeof lib_menu_availability;
  "lib/menu/catalog": typeof lib_menu_catalog;
  "lib/menu/categories": typeof lib_menu_categories;
  "lib/menu/index": typeof lib_menu_index;
  "lib/menu/items": typeof lib_menu_items;
  "lib/menu/modifiers": typeof lib_menu_modifiers;
  "lib/menu/serviceHours": typeof lib_menu_serviceHours;
  "lib/notifications/categories": typeof lib_notifications_categories;
  "lib/notifications/engine": typeof lib_notifications_engine;
  "lib/notifications/index": typeof lib_notifications_index;
  "lib/notifications/notify": typeof lib_notifications_notify;
  "lib/notifications/templateBounds": typeof lib_notifications_templateBounds;
  "lib/onboarding/crm": typeof lib_onboarding_crm;
  "lib/onboarding/csv": typeof lib_onboarding_csv;
  "lib/onboarding/gates": typeof lib_onboarding_gates;
  "lib/onboarding/index": typeof lib_onboarding_index;
  "lib/onboarding/seedData": typeof lib_onboarding_seedData;
  "lib/orders/index": typeof lib_orders_index;
  "lib/orders/orders": typeof lib_orders_orders;
  "lib/orders/status": typeof lib_orders_status;
  "lib/orders/workflow": typeof lib_orders_workflow;
  "lib/pricing/contradictions": typeof lib_pricing_contradictions;
  "lib/pricing/defaultRule": typeof lib_pricing_defaultRule;
  "lib/pricing/evaluate": typeof lib_pricing_evaluate;
  "lib/pricing/index": typeof lib_pricing_index;
  "lib/pricing/rules": typeof lib_pricing_rules;
  "lib/tenancy/_probes": typeof lib_tenancy__probes;
  "lib/tenancy/audit": typeof lib_tenancy_audit;
  "lib/tenancy/cgvArchive": typeof lib_tenancy_cgvArchive;
  "lib/tenancy/customer": typeof lib_tenancy_customer;
  "lib/tenancy/customerFiche": typeof lib_tenancy_customerFiche;
  "lib/tenancy/customerOrdersStore": typeof lib_tenancy_customerOrdersStore;
  "lib/tenancy/deliveriesStore": typeof lib_tenancy_deliveriesStore;
  "lib/tenancy/fuzz": typeof lib_tenancy_fuzz;
  "lib/tenancy/index": typeof lib_tenancy_index;
  "lib/tenancy/menuStore": typeof lib_tenancy_menuStore;
  "lib/tenancy/notificationsStore": typeof lib_tenancy_notificationsStore;
  "lib/tenancy/ordersStore": typeof lib_tenancy_ordersStore;
  "lib/tenancy/pricingRulesStore": typeof lib_tenancy_pricingRulesStore;
  "lib/tenancy/prospectsStore": typeof lib_tenancy_prospectsStore;
  "lib/tenancy/serviceHoursStore": typeof lib_tenancy_serviceHoursStore;
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
  "table/contracts": typeof table_contracts;
  "table/customerOrdersPerTenant": typeof table_customerOrdersPerTenant;
  "table/customers": typeof table_customers;
  "table/deliveries": typeof table_deliveries;
  "table/feedback": typeof table_feedback;
  "table/menuCategories": typeof table_menuCategories;
  "table/menuItemModifierGroups": typeof table_menuItemModifierGroups;
  "table/menuItems": typeof table_menuItems;
  "table/modifierGroups": typeof table_modifierGroups;
  "table/notifications": typeof table_notifications;
  "table/orders": typeof table_orders;
  "table/pricingRules": typeof table_pricingRules;
  "table/processedWebhookEvents": typeof table_processedWebhookEvents;
  "table/prospects": typeof table_prospects;
  "table/serviceHours": typeof table_serviceHours;
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
