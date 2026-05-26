import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in-memory (no deployment, no network), so the
// suite is CI-safe and offline. The edge-runtime environment mirrors Convex's V8
// runtime. Real cross-tenant fuzz suites land with story 1.x-C.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
    // Injects a test-only KMS_MASTER_KEY (crypto module 1.x-E) — see test.setup.ts.
    setupFiles: ["./test.setup.ts"],
    // The default 5s is too tight for the heaviest convex-test paths under the
    // full parallel suite (an httpAction cold-starts the router + crypto.subtle
    // decrypt + HMAC on first hit — e.g. the per-tenant Uber webhook, 2.6-C). The
    // tests are fast in isolation; this only absorbs cold-start jitter.
    testTimeout: 20000,
  },
});
