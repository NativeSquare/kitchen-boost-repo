/**
 * PWA-S2 (#450) — `decideManifest` — PURE decision that returns the per-tenant
 * Web App Manifest JSON shape consumed by `app/manifest.webmanifest/route.ts`.
 *
 * Split from the route handler so vitest pins every branch (branded /
 * partially-branded / no-branding fallback) in node env, without a Next.js
 * runtime. The route is a thin IO wrapper: read cookie → query Convex →
 * `decideManifest(branding)` → JSON response with `Cache-Control` headers
 * (PRD §10 PWA Client Q4 manifest dynamique).
 *
 * Shape pinned by PRD §10 Q4 + the Web App Manifest spec. `display:
 * standalone` + `orientation: portrait` + `start_url: /` + `scope: /` are
 * mandatory for the A2HS prompt to surface on Android Chrome. `lang: fr` +
 * `categories: ["food"]` follow the PRD literal.
 *
 * `theme_color` falls back to the KitchenBoost green when a tenant has no
 * primaryColor — a missing field would make Chrome log a console warning
 * AND would lose the standalone status-bar tint, both undesirable.
 *
 * Icons ALWAYS reference the 3 dynamic routes (`/icon-192.png`,
 * `/icon-512.png`, `/apple-touch-icon.png`) rather than the raw
 * `branding.logoUrl`. The routes themselves do the work of fetching the
 * logo + resizing + serving the bytes with a long cache header. The
 * manifest stays as a tiny JSON payload (≤1 KB) that the install prompt
 * can fetch + parse instantly.
 */

/** Inputs the route extracts from the resolved tenant row. */
export type ManifestInputs = {
  /** Tenant display name. Falls back to "KitchenBoost" when empty. */
  name: string;
  /** Tenant primary color as `#RRGGBB`. Validated; falls back to KB green. */
  primaryColor?: string;
  /** Optional resolved public URL of the tenant logo (used by the icon routes). */
  logoUrl?: string;
};

/** A single icon entry in the manifest. */
export type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: "any maskable";
};

/** The full manifest JSON shape. Mirrors the W3C Web App Manifest spec. */
export type Manifest = {
  id: "/";
  start_url: "/";
  scope: "/";
  display: "standalone";
  orientation: "portrait";
  name: string;
  short_name: string;
  theme_color: string;
  background_color: "#FFFFFF";
  icons: ManifestIcon[];
  categories: ["food"];
  lang: "fr";
};

/** KitchenBoost brand green — fallback theme color when a tenant has none. */
const KB_GREEN = "#1B7A3D";
/** Default name when the tenant has no `name`. */
const DEFAULT_NAME = "KitchenBoost";
/** Strict 6-digit hex check (mirrors `isValidHexColor` in admin). */
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

function pickName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? DEFAULT_NAME : trimmed;
}

function pickThemeColor(primaryColor: string | undefined): string {
  if (primaryColor === undefined) return KB_GREEN;
  return HEX_REGEX.test(primaryColor) ? primaryColor : KB_GREEN;
}

/**
 * Build the manifest JSON for a given tenant. Always returns a complete,
 * valid manifest — never null, never an error response (the route handles
 * the "no tenant resolved" case by serving a generic KB manifest).
 */
export function decideManifest(inputs: ManifestInputs): Manifest {
  const name = pickName(inputs.name);
  return {
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    name,
    short_name: name,
    theme_color: pickThemeColor(inputs.primaryColor),
    background_color: "#FFFFFF",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    categories: ["food"],
    lang: "fr",
  };
}
