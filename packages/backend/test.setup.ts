/**
 * Vitest global setup for the backend suite.
 *
 * Injects a TEST-ONLY `KMS_MASTER_KEY` so the crypto module (1.x-E) can run in
 * the convex-test / edge-runtime environment, where Convex env vars are not
 * provisioned. This is a fixed, throw-away 32-byte base64 key used ONLY by the
 * test runner — it is NOT a real secret and is NEVER deployed. The real key
 * lives in the Convex deployment env (STACK.md §2.5, §4.6) and is never
 * committed.
 *
 * Lives at the package root (outside `convex/`) on purpose: it must NOT be
 * picked up by the `import.meta.glob` module graph that convex-test loads.
 *
 * base64 of the literal "test-only-kms-master-key-32-byte" (exactly 32 bytes).
 */
process.env.KMS_MASTER_KEY ??= "dGVzdC1vbmx5LWttcy1tYXN0ZXIta2V5LTMyLWJ5dGU=";
