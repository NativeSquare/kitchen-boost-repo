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
import type * as lib_tenancy__probes from "../lib/tenancy/_probes.js";
import type * as lib_tenancy_customer from "../lib/tenancy/customer.js";
import type * as lib_tenancy_fuzz from "../lib/tenancy/fuzz.js";
import type * as lib_tenancy_index from "../lib/tenancy/index.js";
import type * as lib_tenancy_withTenant from "../lib/tenancy/withTenant.js";
import type * as migrations from "../migrations.js";
import type * as storage from "../storage.js";
import type * as table_admin from "../table/admin.js";
import type * as table_adminInvites from "../table/adminInvites.js";
import type * as table_auditLog from "../table/auditLog.js";
import type * as table_feedback from "../table/feedback.js";
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
  "lib/tenancy/_probes": typeof lib_tenancy__probes;
  "lib/tenancy/customer": typeof lib_tenancy_customer;
  "lib/tenancy/fuzz": typeof lib_tenancy_fuzz;
  "lib/tenancy/index": typeof lib_tenancy_index;
  "lib/tenancy/withTenant": typeof lib_tenancy_withTenant;
  migrations: typeof migrations;
  storage: typeof storage;
  "table/admin": typeof table_admin;
  "table/adminInvites": typeof table_adminInvites;
  "table/auditLog": typeof table_auditLog;
  "table/feedback": typeof table_feedback;
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
