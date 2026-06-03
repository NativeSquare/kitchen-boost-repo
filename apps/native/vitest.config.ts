import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * #394 — apps/native tests are PURE TS unit tests (no React, no Expo, no
 * Convex). They exercise decision functions like `decideForceUpdate` (the
 * native boot gate, ADR 0017) in isolation — same pattern as `apps/admin`'s
 * `decideRootEntry` / `decideTenantGate`. Node env keeps CI lean (no jsdom, no
 * Metro). React-rendering tests, if they're ever needed here, would add
 * `environment: "jsdom"` + RTL.
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
