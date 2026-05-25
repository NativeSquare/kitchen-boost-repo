import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in-memory (no deployment, no network), so the
// suite is CI-safe and offline. The edge-runtime environment mirrors Convex's V8
// runtime. Real cross-tenant fuzz suites land with story 1.x-C.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
  },
});
