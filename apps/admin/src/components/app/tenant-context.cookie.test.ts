/**
 * F-SHELL-04 — pure helpers around the `kb_current_tenant` cookie.
 *
 * The cookie discipline (ADR 0014 §4) is small but easy to get wrong, so it
 * is split out as named pure helpers — testable in node, no DOM, no document
 * monkey-patching:
 *
 *   - `parseTenantCookie(cookieString)` — reads `document.cookie` shape
 *     (`"a=1; kb_current_tenant=<id>; b=2"`) and returns the tenantId payload
 *     (a branded `Id<"tenants">`) or `undefined` if absent / malformed.
 *   - `formatTenantCookie(tenantId)` — produces the exact `document.cookie`
 *     assignment payload the layout writes on `allow` (with `Path=/` + a
 *     reasonable Max-Age so the hint survives a session but doesn't pretend
 *     to be a security token).
 *
 * These two are the ONLY surface that knows the cookie name and serialisation
 * — the layout, the decision function, and the future TenantSwitcher all go
 * through them. If the name ever changes, this is the one file to touch.
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  KB_CURRENT_TENANT_COOKIE,
  formatTenantCookie,
  parseTenantCookie,
} from "./tenant-context";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;

describe("KB_CURRENT_TENANT_COOKIE", () => {
  it("is the canonical name written by ADR 0014 §4 and CONTEXT.kb-admin", () => {
    expect(KB_CURRENT_TENANT_COOKIE).toBe("kb_current_tenant");
  });
});

describe("parseTenantCookie", () => {
  it("returns undefined when document.cookie is empty", () => {
    expect(parseTenantCookie("")).toBeUndefined();
  });

  it("returns undefined when the cookie is not set among others", () => {
    expect(parseTenantCookie("foo=1; bar=2")).toBeUndefined();
  });

  it("extracts the tenantId when the cookie is present alone", () => {
    expect(parseTenantCookie("kb_current_tenant=tenants_aaa")).toBe(TENANT_A);
  });

  it("extracts the tenantId when surrounded by other cookies, with whitespace", () => {
    expect(
      parseTenantCookie("foo=1; kb_current_tenant=tenants_aaa; bar=2"),
    ).toBe(TENANT_A);
  });

  it("returns undefined when the cookie key matches a prefix only (no false positives on `kb_current_tenant_foo=...`)", () => {
    // Defensive: a stray `kb_current_tenant_v2` shouldn't be read as the V1
    // cookie. The parser keys exactly on the name.
    expect(parseTenantCookie("kb_current_tenant_v2=zzz")).toBeUndefined();
  });

  it("URL-decodes the value (cookies are percent-encoded on write)", () => {
    // Convex Ids never contain reserved chars in practice, but the encoding
    // round-trip stays defensive — if a payload ever needs it (debug rerun,
    // copy-paste), we don't surface a corrupted Id.
    expect(parseTenantCookie("kb_current_tenant=tenants_aaa%20")).toBe(
      "tenants_aaa ",
    );
  });
});

describe("formatTenantCookie", () => {
  it("serialises name=value with Path=/ and a Max-Age (session-survival hint, not a token)", () => {
    const serialised = formatTenantCookie(TENANT_A);
    expect(serialised).toContain("kb_current_tenant=tenants_aaa");
    expect(serialised).toContain("Path=/");
    expect(serialised).toMatch(/Max-Age=\d+/);
    // SameSite=Lax so the hint follows top-level navigations (deep links from
    // emails / external links) but is not sent on cross-site sub-requests.
    expect(serialised).toContain("SameSite=Lax");
  });

  it("URL-encodes the tenantId (defensive — round-trips with parseTenantCookie)", () => {
    const odd = "tenants_aaa bbb" as unknown as Id<"tenants">;
    const serialised = formatTenantCookie(odd);
    expect(serialised).toContain("kb_current_tenant=tenants_aaa%20bbb");
    // parse(format(x)) === x — defends the round-trip contract.
    const cookieString = serialised.split(";")[0]; // "name=value"
    expect(parseTenantCookie(cookieString)).toBe("tenants_aaa bbb");
  });
});
