import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * apps/web tests are PURE TS unit tests (no DOM, no Convex) — they exercise
 * the middleware decision functions / module APIs in isolation. Node env
 * keeps CI lean (no jsdom install, no convex-test, no edge-runtime). Same
 * shape as `apps/admin/vitest.config.ts` (the campaign-validated convention).
 *
 * Backend integration (the `tenants.resolution.*` queries the middleware
 * fetches) is tested in `packages/backend/convex/lib/tenants/resolution.test.ts`
 * via `convex-test` — splitting backend / frontend test surfaces avoids
 * coupling the apps/web suite to the backend module graph.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
