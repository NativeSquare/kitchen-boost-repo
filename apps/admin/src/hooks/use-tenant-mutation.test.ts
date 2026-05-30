/**
 * F-SHELL-05 (#183) — `useTenantMutation`, twin of `useTenantQuery` for
 * Convex mutations. Same invariant: every `tenantMutation` invoked from a
 * `/t/[tenantId]/...` surface gets its `tenantId` injected from the
 * `TenantContext`, so screens cannot "forget" it.
 *
 * Difference with `useTenantQuery`: the hook returns a callable `(args) =>
 * Promise<R>`. The `tenantId` is read once per render (React rules of hooks
 * force `useContext` at the top); a tenant switch is reflected because
 * `<TenantProvider/>` re-renders and the hook re-instantiates with the new
 * value, so the returned trigger always closes over the latest `tenantId`.
 *
 * Why this test mocks `convex/react` and `tenant-context`:
 *   - Node-env vitest, no jsdom — same setup as `use-tenant-query.test.ts`.
 *   - We stub `useMutation` to return a capture-spy function so we can assert
 *     the args that finally reach Convex.
 *   - We exercise the throw-on-misuse contract by stubbing `useCurrentTenantId`
 *     to throw, the way it would in production outside `<TenantProvider/>`.
 *
 * Acceptance criteria pinned (#183):
 *   - useTenantMutation injecte tenantId à CHAQUE appel de la fn retournée
 *   - Hors TenantContext → throw explicite
 *   - Type-level: la signature publique masque `tenantId`
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  expectTypeOf,
} from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { FunctionReference } from "convex/server";

// --------------------------------------------------------------------------
// Module mocks (installed before the hook import).
// --------------------------------------------------------------------------

const TENANT_FROM_CTX = "tenants_ctx" as unknown as Id<"tenants">;

const mutationCalls: Array<{ mutation: unknown; args: unknown }> = [];
const fakeReturn = { ok: true } as const;
let throwOnUseCurrentTenantId: Error | null = null;
// When set, the next call to useCurrentTenantId returns this id instead of
// the default — used to assert "each invocation re-reads from context".
let nextTenantIdOverride: Id<"tenants"> | null = null;

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) => {
    // Mirror the real Convex shape: useMutation returns a callable function.
    return async (args: unknown) => {
      mutationCalls.push({ mutation, args });
      return fakeReturn;
    };
  },
}));

vi.mock("@/components/app/tenant-context", () => ({
  useCurrentTenantId: () => {
    if (throwOnUseCurrentTenantId) throw throwOnUseCurrentTenantId;
    const override = nextTenantIdOverride;
    nextTenantIdOverride = null;
    return override ?? TENANT_FROM_CTX;
  },
}));

const { useTenantMutation } = await import("./use-tenant-mutation");

beforeEach(() => {
  mutationCalls.length = 0;
  throwOnUseCurrentTenantId = null;
  nextTenantIdOverride = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// Fixture
// --------------------------------------------------------------------------

type FakeArgs = { name: string };
type FakeReturn = { ok: true };

const fakeMutation = {
  _name: "fake.mutation",
  _args: {} as FakeArgs & { tenantId: Id<"tenants"> },
  _returnType: {} as FakeReturn,
} as unknown as FunctionReference<
  "mutation",
  "public",
  FakeArgs & { tenantId: Id<"tenants"> },
  FakeReturn
>;

const fakeZeroArgMutation = {
  _name: "fake.zeroArgMutation",
  _args: {} as { tenantId: Id<"tenants"> },
  _returnType: {} as FakeReturn,
} as unknown as FunctionReference<
  "mutation",
  "public",
  { tenantId: Id<"tenants"> },
  FakeReturn
>;

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("useTenantMutation — auto-inject tenantId at call time", () => {
  it("injects tenantId into mutation args on each call (AC core)", async () => {
    const trigger = useTenantMutation(fakeMutation);
    await trigger({ name: "alpha" });
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].args).toEqual({
      tenantId: TENANT_FROM_CTX,
      name: "alpha",
    });
  });

  it("zero-arg mutation: trigger() sends only { tenantId }", async () => {
    const trigger = useTenantMutation(fakeZeroArgMutation);
    await trigger();
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].args).toEqual({ tenantId: TENANT_FROM_CTX });
  });

  it("re-instantiating the hook on a new render picks up the new tenantId (no stale closure on tenant switch)", async () => {
    // React's rules of hooks force the context read at the top of the hook,
    // so the per-call re-read happens via React re-rendering with the new
    // TenantContext value (TenantSwitcher → router.replace → TenantProvider
    // updates → useTenantMutation re-runs → new trigger). We simulate that by
    // calling the hook a second time with the new context value.
    const trigger1 = useTenantMutation(fakeMutation);
    await trigger1({ name: "first" });

    const OTHER_TENANT = "tenants_other" as unknown as Id<"tenants">;
    nextTenantIdOverride = OTHER_TENANT;
    const trigger2 = useTenantMutation(fakeMutation);
    await trigger2({ name: "second" });

    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[0].args).toMatchObject({ tenantId: TENANT_FROM_CTX });
    expect(mutationCalls[1].args).toMatchObject({ tenantId: OTHER_TENANT });
  });

  it("forwards the mutation reference to useMutation untouched", async () => {
    const trigger = useTenantMutation(fakeMutation);
    await trigger({ name: "x" });
    expect(mutationCalls[0].mutation).toBe(fakeMutation);
  });

  it("returns the underlying mutation's Promise<result>", async () => {
    const trigger = useTenantMutation(fakeMutation);
    await expect(trigger({ name: "x" })).resolves.toEqual(fakeReturn);
  });

  it("throws the explicit /t/[tenantId] message when instantiated outside <TenantProvider/>", () => {
    // The throw is raised by `useCurrentTenantId()` at the top of the hook
    // (rules of hooks: useContext must run at render time). The error matches
    // the message established by F-SHELL-04 (#175) — a developer who renders
    // a tenant surface without the layout sees the same string everywhere.
    throwOnUseCurrentTenantId = new Error(
      "useCurrentTenantId() called outside a /t/[tenantId]/... layout.",
    );
    expect(() => useTenantMutation(fakeMutation)).toThrowError(
      /\/t\/\[tenantId\]/,
    );
  });
});

// --------------------------------------------------------------------------
// Compile-time AC: signature hides `tenantId`
// --------------------------------------------------------------------------

describe("useTenantMutation — type contract", () => {
  it("the trigger fn accepts the mutation's args MINUS `tenantId`", () => {
    const trigger = useTenantMutation(fakeMutation);
    expectTypeOf(trigger).parameters.toEqualTypeOf<[{ name: string }]>();
  });

  it("the trigger fn returns Promise<R>", () => {
    const trigger = useTenantMutation(fakeMutation);
    expectTypeOf(trigger({ name: "x" })).toEqualTypeOf<Promise<FakeReturn>>();
  });

  it("zero-arg mutation: trigger is callable with no args", () => {
    const trigger = useTenantMutation(fakeZeroArgMutation);
    expectTypeOf(trigger).parameters.toEqualTypeOf<[]>();
  });
});
