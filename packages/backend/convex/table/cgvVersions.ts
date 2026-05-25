import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.1-A — `cgvVersions` (PRD 90 §1, ADR 0007). Timestamped archive of every CGV
 * wording version: lets KB prove to the CNIL WHICH exact version a given customer
 * accepted, via the `cgvVersionHash` stored on the `customers` row. One active
 * version at a time (V1 = a single standard KB wording); `endedAt` is set when a
 * version is superseded. GLOBAL (KB-owned, not tenant-scoped — one standard
 * wording in V1; per-resto bespoke CGV is V2).
 */
export const cgvVersions = defineTable({
  wording: v.string(),
  hash: v.string(), // SHA-256 of the wording — referenced by customers.cgvVersionHash
  activatedAt: v.number(),
  endedAt: v.optional(v.number()), // unset = currently active
})
  .index("by_hash", ["hash"]) // resolve the version a customer accepted
  .index("by_activatedAt", ["activatedAt"]); // chronological / find-active
