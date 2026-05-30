import { defineConfig } from "vitest/config";
import path from "node:path";

// apps/admin tests are PURE TS unit tests (no DOM, no Convex) — they exercise
// the session reducer / module API in isolation. Node env keeps CI lean (no
// jsdom install, no convex-test, no edge-runtime). React-rendering tests, if
// they're ever needed here, would add `environment: "jsdom"` + RTL.
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
