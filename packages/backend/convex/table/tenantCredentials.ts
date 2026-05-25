import { defineTable } from "convex/server";
import { v } from "convex/values";

// Per-tenant secrets, envelope-encrypted (AES-256-GCM). The crypto lives in
// lib/crypto (1.x-E); this table only stores the ciphertext + GCM params.
// Plaintext NEVER stored here.
export const tenantCredentials = defineTable({
  tenantId: v.id("tenants"),
  provider: v.string(),
  ciphertext: v.string(),
  iv: v.string(),
  authTag: v.string(),
  keyVersion: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_tenant_provider", ["tenantId", "provider"]); // unique (enforced applicatively)
