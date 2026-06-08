/**
 * PWA-S1 (#449) — `decideTenantResolution` — the PURE decision function that
 * powers the PWA edge middleware (`apps/web/src/proxy.ts`). Written BEFORE
 * the implementation (TDD red).
 *
 * The middleware is the host → tenantId resolution shell described in PRD
 * §10 PWA Client + ADR 0008 (cookie host-only). It's deliberately thin: it
 * reads `host` + cookie, decides what to do, and the IO (Convex lookup,
 * cookie set/clear, rewrite/error response) is performed by the caller. The
 * decision logic is THIS function so vitest can pin every branch
 * deterministically without spinning up Next.js or an edge runtime.
 *
 * Branches we pin:
 *   1. Cookie present + still resolves to an active tenant → SKIP the Convex
 *      round-trip, rewrite to the tenant-scoped path. (Fast path on every
 *      hit after the first.)
 *   2. Cookie present but the tenant has been DELETED → clear cookie + send
 *      the « Resto non disponible » page. (Tenant orphan, US 67.)
 *   3. Cookie present but the tenant is now `suspended` / `disabled` → clear
 *      cookie + error page. (Lifecycle off-state.)
 *   4. No cookie + host matches `<slug>.kitchen-boost.com` → resolve via slug,
 *      set cookie, rewrite. (First-hit sub-domain.)
 *   5. No cookie + host is a CUSTOM domain → resolve via customDomain, set
 *      cookie, rewrite. (First-hit custom domain.)
 *   6. No cookie + host is unknown → error page, NO cookie set. (Unknown
 *      host, no auto-provision.)
 *   7. No cookie + host is the bare apex (`kitchen-boost.com`) → error page.
 *      (Apex is for marketing, not the PWA; an apex hit is operator-error.)
 *   8. Cookie present but malformed (not a valid Convex id) → clear cookie +
 *      treat as no-cookie, follow path 4/5/6/7.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decideTenantResolution,
  type ResolvedTenant,
  type TenantResolutionInput,
} from "./decide-tenant-resolution";

const ROOT_DOMAIN = "kitchen-boost.com";

const A_ACTIVE: ResolvedTenant = {
  tenantId: "tenant_a" as ResolvedTenant["tenantId"],
  slug: "bunsbao",
  name: "Buns & Bao",
  status: "active",
};

const A_DISABLED: ResolvedTenant = {
  tenantId: "tenant_a" as ResolvedTenant["tenantId"],
  slug: "bunsbao",
  name: "Buns & Bao",
  status: "disabled",
};

function baseInput(
  overrides: Partial<TenantResolutionInput>,
): TenantResolutionInput {
  return {
    host: overrides.host ?? "bunsbao.kitchen-boost.com",
    cookieTenantId: overrides.cookieTenantId ?? null,
    rootDomain: overrides.rootDomain ?? ROOT_DOMAIN,
    fetchById: overrides.fetchById ?? vi.fn(async () => null),
    fetchBySlug: overrides.fetchBySlug ?? vi.fn(async () => null),
    fetchByCustomDomain:
      overrides.fetchByCustomDomain ?? vi.fn(async () => null),
    revalidateCookie: overrides.revalidateCookie,
  };
}

describe("decideTenantResolution — cookie fast path", () => {
  it("returns `rewrite` with the cookie tenantId WITHOUT calling any fetch (cache hit)", async () => {
    const fetchById = vi.fn(async () => A_ACTIVE);
    const fetchBySlug = vi.fn(async () => null);
    const fetchByCustomDomain = vi.fn(async () => null);
    const verdict = await decideTenantResolution(
      baseInput({
        cookieTenantId: "tenant_a",
        fetchById,
        fetchBySlug,
        fetchByCustomDomain,
      }),
    );
    expect(verdict.kind).toBe("rewrite");
    if (verdict.kind === "rewrite") {
      expect(verdict.tenantId).toBe("tenant_a");
      expect(verdict.setCookie).toBe(false); // cache hit — cookie already set
    }
    // The cookie fast-path is the WHOLE point — zero Convex round-trip.
    expect(fetchById).not.toHaveBeenCalled();
    expect(fetchBySlug).not.toHaveBeenCalled();
    expect(fetchByCustomDomain).not.toHaveBeenCalled();
  });

  it("clears the cookie + returns `error` when the cookie tenantId fails revalidation (orphan, US 67)", async () => {
    // The middleware should NOT trust the cookie blindly when configured to
    // revalidate. We pass `revalidate: true` to drive that path explicitly.
    const fetchById = vi.fn(async () => null); // tenant deleted
    const verdict = await decideTenantResolution(
      baseInput({
        cookieTenantId: "tenant_a",
        fetchById,
        revalidateCookie: true,
      }),
    );
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("tenant-not-found");
      expect(verdict.clearCookie).toBe(true);
    }
    expect(fetchById).toHaveBeenCalledWith("tenant_a");
  });

  it("clears the cookie + returns `error` when the cookie tenantId resolves to a non-active tenant", async () => {
    const fetchById = vi.fn(async () => A_DISABLED);
    const verdict = await decideTenantResolution(
      baseInput({
        cookieTenantId: "tenant_a",
        fetchById,
        revalidateCookie: true,
      }),
    );
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("tenant-inactive");
      expect(verdict.clearCookie).toBe(true);
    }
  });
});

describe("decideTenantResolution — host → tenant lookup (no cookie)", () => {
  it("resolves a `<slug>.kitchen-boost.com` host via slug + sets the cookie", async () => {
    const fetchBySlug = vi.fn(async (slug: string) =>
      slug === "bunsbao" ? A_ACTIVE : null,
    );
    const fetchByCustomDomain = vi.fn(async () => null);
    const verdict = await decideTenantResolution(
      baseInput({
        host: "bunsbao.kitchen-boost.com",
        fetchBySlug,
        fetchByCustomDomain,
      }),
    );
    expect(verdict.kind).toBe("rewrite");
    if (verdict.kind === "rewrite") {
      expect(verdict.tenantId).toBe("tenant_a");
      expect(verdict.setCookie).toBe(true);
    }
    expect(fetchBySlug).toHaveBeenCalledWith("bunsbao");
    // Custom-domain fetch must NOT fire for a clear sub-domain hit.
    expect(fetchByCustomDomain).not.toHaveBeenCalled();
  });

  it("resolves a custom domain host via customDomain + sets the cookie", async () => {
    const fetchBySlug = vi.fn(async () => null);
    const fetchByCustomDomain = vi.fn(async (d: string) =>
      d === "bunsbao.fr" ? A_ACTIVE : null,
    );
    const verdict = await decideTenantResolution(
      baseInput({
        host: "bunsbao.fr",
        fetchBySlug,
        fetchByCustomDomain,
      }),
    );
    expect(verdict.kind).toBe("rewrite");
    if (verdict.kind === "rewrite") {
      expect(verdict.tenantId).toBe("tenant_a");
      expect(verdict.setCookie).toBe(true);
    }
    expect(fetchByCustomDomain).toHaveBeenCalledWith("bunsbao.fr");
    // Slug fetch must NOT fire for a non-`<...>.kitchen-boost.com` host.
    expect(fetchBySlug).not.toHaveBeenCalled();
  });

  it("returns `error` when the sub-domain slug does not match any tenant", async () => {
    const fetchBySlug = vi.fn(async () => null);
    const verdict = await decideTenantResolution(
      baseInput({
        host: "unknown.kitchen-boost.com",
        fetchBySlug,
      }),
    );
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("tenant-not-found");
      expect(verdict.clearCookie).toBe(false); // no cookie to clear
    }
    expect(fetchBySlug).toHaveBeenCalledWith("unknown");
  });

  it("returns `error` when the custom domain does not match any tenant", async () => {
    const fetchByCustomDomain = vi.fn(async () => null);
    const verdict = await decideTenantResolution(
      baseInput({
        host: "unknown.fr",
        fetchByCustomDomain,
      }),
    );
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("tenant-not-found");
    }
  });

  it("returns `error` when the host is the bare apex (no slug, no custom domain)", async () => {
    const fetchBySlug = vi.fn(async () => null);
    const fetchByCustomDomain = vi.fn(async () => null);
    const verdict = await decideTenantResolution(
      baseInput({
        host: ROOT_DOMAIN,
        fetchBySlug,
        fetchByCustomDomain,
      }),
    );
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("apex-host");
    }
    // Apex is operator error — NO lookup attempted at all.
    expect(fetchBySlug).not.toHaveBeenCalled();
    expect(fetchByCustomDomain).not.toHaveBeenCalled();
  });

  it("returns `error` when the resolved tenant is non-active (no cookie)", async () => {
    const fetchBySlug = vi.fn(async () => A_DISABLED);
    const verdict = await decideTenantResolution(
      baseInput({
        host: "bunsbao.kitchen-boost.com",
        fetchBySlug,
      }),
    );
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("tenant-inactive");
    }
  });
});

describe("decideTenantResolution — host edge cases", () => {
  it("strips the port from the host before deriving the slug", async () => {
    const fetchBySlug = vi.fn(async () => A_ACTIVE);
    await decideTenantResolution(
      baseInput({
        host: "bunsbao.kitchen-boost.com:3000",
        fetchBySlug,
      }),
    );
    // Slug derivation must NOT include the port.
    expect(fetchBySlug).toHaveBeenCalledWith("bunsbao");
  });

  it("is case-insensitive on the host (browsers may upper-case)", async () => {
    const fetchBySlug = vi.fn(async () => A_ACTIVE);
    await decideTenantResolution(
      baseInput({
        host: "BunsBao.kitchen-boost.com",
        fetchBySlug,
      }),
    );
    expect(fetchBySlug).toHaveBeenCalledWith("bunsbao");
  });

  it("treats a multi-label sub-domain (`a.b.kitchen-boost.com`) as a CUSTOM domain (no auto-slug split)", async () => {
    // Sub-domains under `<slug>.kitchen-boost.com` must be ONE label deep —
    // anything else is interpreted as a different host (custom domain). This
    // prevents an accidental tenant-takeover via wildcard mis-config.
    const fetchBySlug = vi.fn(async () => A_ACTIVE);
    const fetchByCustomDomain = vi.fn(async () => null);
    const verdict = await decideTenantResolution(
      baseInput({
        host: "weird.bunsbao.kitchen-boost.com",
        fetchBySlug,
        fetchByCustomDomain,
      }),
    );
    // The host is treated as a custom domain candidate — and there's no match
    // here, so the verdict is `error`.
    expect(fetchBySlug).not.toHaveBeenCalled();
    expect(fetchByCustomDomain).toHaveBeenCalledWith(
      "weird.bunsbao.kitchen-boost.com",
    );
    expect(verdict.kind).toBe("error");
  });

  it("treats a malformed cookie value (not a valid id format) as no cookie", async () => {
    const fetchBySlug = vi.fn(async () => A_ACTIVE);
    const verdict = await decideTenantResolution(
      baseInput({
        host: "bunsbao.kitchen-boost.com",
        cookieTenantId: "", // empty string = malformed
        fetchBySlug,
      }),
    );
    expect(verdict.kind).toBe("rewrite");
    if (verdict.kind === "rewrite") {
      expect(verdict.setCookie).toBe(true);
    }
    expect(fetchBySlug).toHaveBeenCalled();
  });

  it("returns `error` for an empty host string", async () => {
    const verdict = await decideTenantResolution(baseInput({ host: "" }));
    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("apex-host");
    }
  });
});
