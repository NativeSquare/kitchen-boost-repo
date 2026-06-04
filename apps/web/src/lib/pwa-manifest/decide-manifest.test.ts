/**
 * PWA-S2 (#450) — `decideManifest` — pure decision returning the manifest JSON
 * shape per-tenant. Written BEFORE the implementation (TDD red).
 *
 * The manifest endpoint (`app/manifest.webmanifest/route.ts`) is the dynamic
 * per-host PWA manifest spec'd by PRD §10 PWA Client Q4 (manifest dynamique
 * branded). The route reads the resolved `tenantId` from the
 * `__Host-kb_tenant` cookie (set by the PWA edge middleware, #449), fetches
 * the tenant's branding, and serves the JSON described here.
 *
 * Branches we pin:
 *   1. Fully-branded tenant (logoUrl + primaryColor + name) → all fields filled,
 *      icons reference the dynamic icon routes.
 *   2. Tenant with name only (no logoUrl, no primaryColor) → safe defaults
 *      (white bg, KB green theme), icons still reference the routes (the
 *      routes themselves fall back to a placeholder when logoUrl is absent).
 *   3. Tenant with primaryColor only → theme_color = primaryColor, name
 *      reflected, bg_color always #FFFFFF (PRD §10 Q4 explicit).
 *   4. The manifest is ALWAYS standalone + portrait + lang "fr" + categories
 *      ["food"] + id/start_url/scope = "/" (PRD §10 Q4 explicit).
 *   5. Icons are ALWAYS the 3 routes (192, 512, 180 apple-touch) with
 *      `purpose: "any maskable"` for the 2 PNGs (Android adaptatif compat).
 *   6. `short_name` mirrors `name` (no separate field on the tenant V1).
 */
import { describe, expect, it } from "vitest";
import { decideManifest } from "./decide-manifest";

describe("decideManifest — fully-branded tenant", () => {
  it("returns the manifest with the tenant name + primaryColor + icons", () => {
    const manifest = decideManifest({
      name: "Buns & Bao",
      primaryColor: "#1B7A3D",
      logoUrl: "https://cdn.example/buns.png",
    });
    expect(manifest.name).toBe("Buns & Bao");
    expect(manifest.short_name).toBe("Buns & Bao");
    expect(manifest.theme_color).toBe("#1B7A3D");
    expect(manifest.background_color).toBe("#FFFFFF");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.lang).toBe("fr");
    expect(manifest.categories).toEqual(["food"]);
  });

  it("references the 3 dynamic icon routes (192, 512, apple-touch 180) with `any maskable`", () => {
    const manifest = decideManifest({
      name: "Buns & Bao",
      primaryColor: "#1B7A3D",
      logoUrl: "https://cdn.example/buns.png",
    });
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(sizes).toContain("180x180");
    // Android maskable compat — required so the icon fills the adaptive shape.
    const png192 = manifest.icons.find((i) => i.sizes === "192x192");
    const png512 = manifest.icons.find((i) => i.sizes === "512x512");
    expect(png192?.purpose).toBe("any maskable");
    expect(png512?.purpose).toBe("any maskable");
    // Source URLs point at the dynamic icon routes (NOT the raw logoUrl): this
    // is what lets the routes pipe through `ctx.storage.get` server-side and
    // cache the bytes at the CDN (PRD §10 Q4).
    expect(png192?.src).toBe("/icon-192.png");
    expect(png512?.src).toBe("/icon-512.png");
    expect(manifest.icons.find((i) => i.sizes === "180x180")?.src).toBe(
      "/apple-touch-icon.png",
    );
  });
});

describe("decideManifest — partial branding", () => {
  it("falls back to a safe theme_color when primaryColor is missing (KB green)", () => {
    const manifest = decideManifest({ name: "Sans branding" });
    // Default theme color = KB green (#1B7A3D) — never a missing field on the
    // manifest, would otherwise make Chrome surface a console warning.
    expect(manifest.theme_color).toBe("#1B7A3D");
    expect(manifest.background_color).toBe("#FFFFFF");
    expect(manifest.name).toBe("Sans branding");
  });

  it("still emits the 3 icon routes when logoUrl is absent (route falls back to placeholder)", () => {
    const manifest = decideManifest({ name: "Sans logo" });
    // The icon ROUTES handle the missing-logo case themselves (they serve a
    // KB placeholder). The manifest must always reference the routes so the
    // PWA install prompt has SOMETHING to render.
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.map((i) => i.src)).toEqual([
      "/icon-192.png",
      "/icon-512.png",
      "/apple-touch-icon.png",
    ]);
  });

  it("uses the tenant name even when only the name is provided", () => {
    const manifest = decideManifest({ name: "Pizza Roma" });
    expect(manifest.name).toBe("Pizza Roma");
    expect(manifest.short_name).toBe("Pizza Roma");
  });
});

describe("decideManifest — defensive defaults", () => {
  it("falls back to 'KitchenBoost' when the name is empty", () => {
    const manifest = decideManifest({ name: "" });
    expect(manifest.name).toBe("KitchenBoost");
    expect(manifest.short_name).toBe("KitchenBoost");
  });

  it("ignores a malformed primaryColor (non-hex) and uses the default KB green", () => {
    const manifest = decideManifest({
      name: "Buns & Bao",
      primaryColor: "not-a-color",
    });
    expect(manifest.theme_color).toBe("#1B7A3D");
  });
});
