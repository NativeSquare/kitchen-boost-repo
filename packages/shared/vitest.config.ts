import { defineConfig } from "vitest/config";

// The Pricing engine is a PURE function package (ADR 0013): no Convex, no DB,
// no I/O — so these tests run in a plain Node environment, fully offline and
// deterministic. They exercise the engine in total isolation.
export default defineConfig({
  test: {
    environment: "node",
    include: ["pricing/**/*.test.ts"],
  },
});
