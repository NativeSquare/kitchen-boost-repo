/**
 * Unit tests for `isLikelyConvexId` — pinning the page-level guard that turns
 * a syntactically invalid `[id]` URL segment into the same "not found" branch
 * as a resolved-null query, instead of an `ArgumentValidationError` crash from
 * `v.id("…")` on the backend.
 *
 * The shape we accept is `^[a-z0-9]{32}$` — see `is-likely-convex-id.ts` for
 * why the regex is loose w.r.t. the alphabet on purpose.
 */
import { describe, expect, it } from "vitest";

import { isLikelyConvexId } from "./is-likely-convex-id";

describe("isLikelyConvexId", () => {
  it("accepts a real-shaped 32-char lowercase alphanumeric id", () => {
    // Sampled from a live tenantId in the repo — proof the regex matches the
    // actual Convex doc IDs we encounter in URLs.
    expect(isLikelyConvexId("kn7bfqjem442c1dzqdjjmcfyxx87q53j")).toBe(true);
  });

  it("accepts any 32-char lowercase alphanumeric string (shape check, not server validator)", () => {
    expect(isLikelyConvexId("a".repeat(32))).toBe(true);
    expect(isLikelyConvexId("0".repeat(32))).toBe(true);
    expect(isLikelyConvexId("abcdef0123456789abcdef0123456789")).toBe(true);
  });

  it("rejects strings of the wrong length", () => {
    // 31 chars — one too short.
    expect(isLikelyConvexId("a".repeat(31))).toBe(false);
    // 33 chars — one too long. This is the EXACT bug repro from MC18 step 3:
    // `p1aaaa...aaa` (33 chars) used to crash the page.
    expect(isLikelyConvexId("p1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isLikelyConvexId("a".repeat(33))).toBe(false);
    expect(isLikelyConvexId("a".repeat(64))).toBe(false);
  });

  it("rejects strings with disallowed characters", () => {
    // Uppercase.
    expect(isLikelyConvexId("ABCDEF0123456789ABCDEF0123456789")).toBe(false);
    // Dash.
    expect(isLikelyConvexId("abcdef-123456789abcdef0123456789")).toBe(false);
    // Underscore.
    expect(isLikelyConvexId("abcdef_123456789abcdef0123456789")).toBe(false);
    // Trailing whitespace.
    expect(isLikelyConvexId("abcdef0123456789abcdef012345678 ")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isLikelyConvexId("")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isLikelyConvexId(undefined)).toBe(false);
    expect(isLikelyConvexId(null)).toBe(false);
    expect(isLikelyConvexId(123)).toBe(false);
    expect(isLikelyConvexId({})).toBe(false);
    expect(isLikelyConvexId([])).toBe(false);
  });
});
