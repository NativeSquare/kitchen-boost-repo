/**
 * F-QR.1 — `tenantPwaUrl` front-side mirror of the backend helper in
 * `packages/backend/convex/lib/onboarding/provisioning.ts`. Same shape, same
 * cases, kept in sync intentionally (5-line helper, no shared package V1).
 *
 * Pinning both cases here so a future refactor that flips the precedence (or
 * drops `https://`) breaks loudly. The bootstrap sub-domain
 * `<slug>.kitchen-boost.com` is FALLBACK ONLY — never used when a
 * `customDomain` is set (parity with backend PRD 50 §3).
 */
import { describe, expect, it } from "vitest";
import { tenantPwaUrl } from "./tenant-url";

describe("tenantPwaUrl", () => {
  it("uses the custom domain when present (public face wins over bootstrap)", () => {
    expect(
      tenantPwaUrl({ slug: "buns-bao", customDomain: "commander.bunsbao.fr" }),
    ).toBe("https://commander.bunsbao.fr");
  });

  it("falls back to the `<slug>.kitchen-boost.com` sub-domain when no customDomain", () => {
    expect(tenantPwaUrl({ slug: "buns-bao", customDomain: undefined })).toBe(
      "https://buns-bao.kitchen-boost.com",
    );
  });

  it("falls back to the bootstrap sub-domain when customDomain is omitted", () => {
    expect(tenantPwaUrl({ slug: "lartisan" })).toBe(
      "https://lartisan.kitchen-boost.com",
    );
  });
});
