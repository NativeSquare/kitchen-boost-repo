/**
 * F-SHELL-05 (#183) — `useTenantQuery`, the front-side equivalent of the
 * backend `no-untenanted-query` rule: every surface under `/t/[tenantId]/...`
 * goes through this hook to call a `tenantQuery`, so the `tenantId` from the
 * URL (via `TenantContext`, F-SHELL-04 #175) is injected automatically and
 * "I forgot to pass tenantId" stops being a possible bug class.
 *
 * Why this test mocks `convex/react` and `tenant-context`:
 *   - `apps/admin/vitest.config.ts` runs in `environment: "node"` (no jsdom).
 *   - The hook's whole job = (1) read `tenantId` from context, (2) merge it
 *     into `args`, (3) delegate to `useQuery`. We pin (1)+(2) by capturing the
 *     args passed to a stubbed `useQuery`; we pin the throw-on-misuse contract
 *     by stubbing `useCurrentTenantId` to throw (the same way it would in
 *     production if rendered outside `<TenantProvider/>`).
 *   - The actual React + Convex wiring is exercised end-to-end by the
 *     consumer surfaces (mes-clients, etc.) — testing it again here would
 *     just retest `useQuery`, not `useTenantQuery`.
 *
 * Acceptance criteria pinned (#183):
 *   - useTenantQuery(api.x.y) sans args        → useQuery reçoit { tenantId }
 *   - useTenantQuery(api.x.y, { foo: 1 })       → useQuery reçoit { tenantId, foo: 1 }
 *   - useTenantQuery(api.x.y, "skip")           → useQuery reçoit "skip" (Convex skip propagé)
 *   - Hors TenantContext                        → throw explicite mentionnant /t/[tenantId]
 *   - Type: la signature publique masque `tenantId` (test compile-time `expectTypeOf`)
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
// Module mocks — install BEFORE importing the hook (vi.mock is hoisted, but
// being explicit here keeps the wiring obvious).
// --------------------------------------------------------------------------

const TENANT_FROM_CTX = "tenants_ctx" as unknown as Id<"tenants">;

// Captured args passed to the (stubbed) Convex useQuery — one slot per call.
const useQueryCalls: Array<{ query: unknown; args: unknown }> = [];
// Stubbed return value of useQuery (the hook is a passthrough → its return
// value comes straight from useQuery).
let useQueryReturn: unknown = undefined;
// Drives the stubbed `useCurrentTenantId`: when set, it throws (the way the
// real hook does outside <TenantProvider/>); otherwise it returns TENANT_FROM_CTX.
let throwOnUseCurrentTenantId: Error | null = null;

vi.mock("convex/react", () => ({
  useQuery: (query: unknown, args: unknown) => {
    useQueryCalls.push({ query, args });
    return useQueryReturn;
  },
}));

vi.mock("@/components/app/tenant-context", () => ({
  useCurrentTenantId: () => {
    if (throwOnUseCurrentTenantId) throw throwOnUseCurrentTenantId;
    return TENANT_FROM_CTX;
  },
}));

// Import AFTER the mocks so the hook resolves to the stubs.
const { useTenantQuery } = await import("./use-tenant-query");

beforeEach(() => {
  useQueryCalls.length = 0;
  useQueryReturn = undefined;
  throwOnUseCurrentTenantId = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// Fixture: a fake Convex query reference. The shape is what matters for the
// hook (a plain function reference is opaque to the merge logic).
// --------------------------------------------------------------------------

type FakeArgs = { foo: number };
type FakeReturn = { items: number[] };
const fakeQuery = {
  _name: "fake.query",
  _args: {} as FakeArgs & { tenantId: Id<"tenants"> },
  _returnType: {} as FakeReturn,
} as unknown as FunctionReference<
  "query",
  "public",
  FakeArgs & { tenantId: Id<"tenants"> },
  FakeReturn
>;

// A zero-arg query (only takes `tenantId`, which the hook injects).
const fakeZeroArgQuery = {
  _name: "fake.zeroArgQuery",
  _args: {} as { tenantId: Id<"tenants"> },
  _returnType: {} as FakeReturn,
} as unknown as FunctionReference<
  "query",
  "public",
  { tenantId: Id<"tenants"> },
  FakeReturn
>;

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("useTenantQuery — auto-inject tenantId", () => {
  it('zero-arg query: useQuery receives { tenantId: <fromContext> } (AC: "sans args")', () => {
    useTenantQuery(fakeZeroArgQuery);
    expect(useQueryCalls).toHaveLength(1);
    expect(useQueryCalls[0].args).toEqual({ tenantId: TENANT_FROM_CTX });
  });

  it("merges args with tenantId from context (AC: { foo: 1 } → { tenantId, foo: 1 })", () => {
    useTenantQuery(fakeQuery, { foo: 1 });
    expect(useQueryCalls).toHaveLength(1);
    expect(useQueryCalls[0].args).toEqual({
      tenantId: TENANT_FROM_CTX,
      foo: 1,
    });
  });

  it('"skip" passes through unchanged to Convex useQuery (AC: la query est bien skip côté Convex)', () => {
    useTenantQuery(fakeQuery, "skip");
    expect(useQueryCalls).toHaveLength(1);
    expect(useQueryCalls[0].args).toBe("skip");
  });

  it("forwards the query reference to useQuery untouched", () => {
    useTenantQuery(fakeQuery, { foo: 1 });
    expect(useQueryCalls[0].query).toBe(fakeQuery);
  });

  it("returns whatever useQuery returns (loading sentinel undefined OR resolved value)", () => {
    useQueryReturn = undefined;
    expect(useTenantQuery(fakeQuery, { foo: 1 })).toBeUndefined();
    useQueryReturn = { items: [1, 2, 3] } satisfies FakeReturn;
    expect(useTenantQuery(fakeQuery, { foo: 1 })).toEqual({ items: [1, 2, 3] });
  });

  it("re-throws the underlying useCurrentTenantId error when called outside <TenantProvider/>", () => {
    // The real `useCurrentTenantId` throws an explicit message mentioning
    // `/t/[tenantId]/...`; we stub the same shape to assert useTenantQuery
    // doesn't swallow it.
    throwOnUseCurrentTenantId = new Error(
      "useCurrentTenantId() called outside a /t/[tenantId]/... layout.",
    );
    expect(() => useTenantQuery(fakeQuery, { foo: 1 })).toThrowError(
      /\/t\/\[tenantId\]/,
    );
  });
});

// --------------------------------------------------------------------------
// Compile-time AC: the public signature MUST hide `tenantId` from the caller.
// `expectTypeOf` is evaluated by `tsc`/vitest at type-check time.
// --------------------------------------------------------------------------

describe("useTenantQuery — type contract", () => {
  it("hides `tenantId` from the public args signature", () => {
    // The hook accepts the query's args MINUS `tenantId` (or `"skip"`).
    expectTypeOf(useTenantQuery<typeof fakeQuery>).parameters.toEqualTypeOf<
      [typeof fakeQuery, ({ foo: number } | "skip")?]
    >();
  });

  it("typechecks: passing { foo: 1 } is accepted", () => {
    useTenantQuery(fakeQuery, { foo: 1 });
    // No expect — the assertion is that the line above compiles.
    expect(true).toBe(true);
  });

  it('typechecks: passing "skip" is accepted', () => {
    useTenantQuery(fakeQuery, "skip");
    expect(true).toBe(true);
  });

  it("typechecks: zero-arg call is accepted (args omitted)", () => {
    useTenantQuery(fakeZeroArgQuery);
    expect(true).toBe(true);
  });

  it("the return type is `FakeReturn | undefined` (undefined = loading)", () => {
    expectTypeOf(useTenantQuery(fakeQuery, { foo: 1 })).toEqualTypeOf<
      FakeReturn | undefined
    >();
  });
});
