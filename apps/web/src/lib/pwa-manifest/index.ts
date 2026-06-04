/**
 * PWA-S2 (#450) — `pwa-manifest` module API.
 *
 * The dynamic manifest endpoint (`apps/web/src/app/manifest.webmanifest/route.ts`)
 * consumes:
 *  - `decideManifest(inputs)` → pure JSON-shape decision (vitest-pinned).
 *  - `type Manifest` + `type ManifestInputs` so the route + any future RSC
 *    that pre-renders manifest links share one source of truth.
 *
 * The IO (cookie read + Convex fetch + HTTP response with cache headers)
 * stays in the route handler — splitting "decide" from "perform" keeps the
 * branching logic unit-testable in node env.
 */
export {
  decideManifest,
  type Manifest,
  type ManifestIcon,
  type ManifestInputs,
} from "./decide-manifest";
