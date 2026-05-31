/**
 * F-COMMANDES-REFUND (#243) — `useTenantAction`, twin of `useTenantMutation`
 * for Convex actions (e.g. `tenantAction({allow:["kb_manager"]})` exposed by
 * the backend). Same invariant (ADR 0014 §4): every `tenantAction` invoked
 * from a `/t/[tenantId]/...` surface gets its `tenantId` injected from the
 * `TenantContext`, so screens cannot "forget" it.
 *
 * The refund flow (F-COMMANDES-REFUND) needs this hook because the backend
 * `refundOrder` is an ACTION (it issues a Stripe network call), not a
 * mutation — and `useTenantMutation` only wraps mutations. Without
 * `useTenantAction` the page would either call raw `useAction(...)` and
 * hand-thread the tenantId (defeats ADR 0014 §4) or split the refund into
 * two queries.
 *
 * Difference with `useTenantMutation`: identical ergonomics — returns a
 * callable `(args) => Promise<R>` whose args are the action's args MINUS
 * `tenantId`. The only delta is the underlying primitive (`useAction` vs
 * `useMutation`).
 *
 * Acceptance criteria pinned:
 *   - useTenantAction injects tenantId on each invocation of the returned fn.
 *   - Hors TenantContext → throw explicite (same /t/[tenantId] message).
 *   - Type-level: la signature publique masque `tenantId`.
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

const actionCalls: Array<{ action: unknown; args: unknown }> = [];
const fakeReturn = { refunded: true } as const;
let throwOnUseCurrentTenantId: Error | null = null;
let nextTenantIdOverride: Id<"tenants"> | null = null;

vi.mock("convex/react", () => ({
  useAction: (action: unknown) => {
    return async (args: unknown) => {
      actionCalls.push({ action, args });
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

const { useTenantAction } = await import("./use-tenant-action");

beforeEach(() => {
  actionCalls.length = 0;
  throwOnUseCurrentTenantId = null;
  nextTenantIdOverride = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// Fixture
// --------------------------------------------------------------------------

type FakeArgs = { orderId: string };
type FakeReturn = { refunded: true };

const fakeAction = {
  _name: "fake.action",
  _args: {} as FakeArgs & { tenantId: Id<"tenants"> },
  _returnType: {} as FakeReturn,
} as unknown as FunctionReference<
  "action",
  "public",
  FakeArgs & { tenantId: Id<"tenants"> },
  FakeReturn
>;

const fakeZeroArgAction = {
  _name: "fake.zeroArgAction",
  _args: {} as { tenantId: Id<"tenants"> },
  _returnType: {} as FakeReturn,
} as unknown as FunctionReference<
  "action",
  "public",
  { tenantId: Id<"tenants"> },
  FakeReturn
>;

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("useTenantAction — auto-inject tenantId at call time", () => {
  it("injects tenantId into action args on each call (AC core)", async () => {
    const trigger = useTenantAction(fakeAction);
    await trigger({ orderId: "orders_x" });
    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0].args).toEqual({
      tenantId: TENANT_FROM_CTX,
      orderId: "orders_x",
    });
  });

  it("zero-arg action: trigger() sends only { tenantId }", async () => {
    const trigger = useTenantAction(fakeZeroArgAction);
    await trigger();
    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0].args).toEqual({ tenantId: TENANT_FROM_CTX });
  });

  it("re-instantiating the hook on a new render picks up the new tenantId (no stale closure on tenant switch)", async () => {
    const trigger1 = useTenantAction(fakeAction);
    await trigger1({ orderId: "orders_x" });

    const OTHER_TENANT = "tenants_other" as unknown as Id<"tenants">;
    nextTenantIdOverride = OTHER_TENANT;
    const trigger2 = useTenantAction(fakeAction);
    await trigger2({ orderId: "orders_y" });

    expect(actionCalls).toHaveLength(2);
    expect(actionCalls[0].args).toMatchObject({ tenantId: TENANT_FROM_CTX });
    expect(actionCalls[1].args).toMatchObject({ tenantId: OTHER_TENANT });
  });

  it("forwards the action reference to useAction untouched", async () => {
    const trigger = useTenantAction(fakeAction);
    await trigger({ orderId: "orders_x" });
    expect(actionCalls[0].action).toBe(fakeAction);
  });

  it("returns the underlying action's Promise<result>", async () => {
    const trigger = useTenantAction(fakeAction);
    await expect(trigger({ orderId: "orders_x" })).resolves.toEqual(fakeReturn);
  });

  it("throws the explicit /t/[tenantId] message when instantiated outside <TenantProvider/>", () => {
    throwOnUseCurrentTenantId = new Error(
      "useCurrentTenantId() called outside a /t/[tenantId]/... layout.",
    );
    expect(() => useTenantAction(fakeAction)).toThrowError(/\/t\/\[tenantId\]/);
  });

  it("the URL-derived tenantId wins over a hand-written tenantId in args (ADR 0014 §4 invariant)", async () => {
    const trigger = useTenantAction(fakeAction);
    // Caller hand-writes a foreign tenantId — the hook MUST silently
    // overwrite it with the URL-derived value (otherwise a copy-paste bug
    // would punch through ADR 0010 isolation at the network boundary).
    await trigger({
      orderId: "orders_x",
      tenantId: "tenants_evil" as unknown as Id<"tenants">,
    } as unknown as { orderId: string });
    expect(actionCalls[0].args).toMatchObject({ tenantId: TENANT_FROM_CTX });
  });
});

// --------------------------------------------------------------------------
// Compile-time AC: signature hides `tenantId`
// --------------------------------------------------------------------------

describe("useTenantAction — type contract", () => {
  it("the trigger fn accepts the action's args MINUS `tenantId`", () => {
    const trigger = useTenantAction(fakeAction);
    expectTypeOf(trigger).parameters.toEqualTypeOf<[{ orderId: string }]>();
  });

  it("the trigger fn returns Promise<R>", () => {
    const trigger = useTenantAction(fakeAction);
    expectTypeOf(trigger({ orderId: "x" })).toEqualTypeOf<
      Promise<FakeReturn>
    >();
  });

  it("zero-arg action: trigger is callable with no args", () => {
    const trigger = useTenantAction(fakeZeroArgAction);
    expectTypeOf(trigger).parameters.toEqualTypeOf<[]>();
  });
});
