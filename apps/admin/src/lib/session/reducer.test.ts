/**
 * F-SHELL-01 — reducer tests. Covers the two acceptance criteria that can be
 * expressed without a DOM:
 *   - first render = `loading` (query in flight, source `undefined`)
 *   - query throws `not_authenticated` → `unauthenticated`
 * Plus the happy path (data present → `ready` + branded session).
 *
 * The reducer is the seam where "Convex query observation" meets "UI state
 * machine"; pinning it directly avoids needing jsdom/react-testing-library
 * just to assert tri-state logic.
 */
import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { toSessionState } from "./reducer";
import type { SessionData } from "./types";

describe("toSessionState", () => {
  it("maps `undefined` source to `loading` on first render", () => {
    expect(toSessionState(undefined)).toEqual({ status: "loading" });
  });

  it("maps a thrown `not_authenticated` ConvexError to `unauthenticated`", () => {
    const err = new ConvexError({ message: "not_authenticated" });
    expect(toSessionState(err)).toEqual({ status: "unauthenticated" });
  });

  it("maps any plain thrown error to `unauthenticated` (no usable session)", () => {
    expect(toSessionState(new Error("network"))).toEqual({
      status: "unauthenticated",
    });
  });

  it("maps a resolved SessionData payload to `ready` and carries it through", () => {
    const session: SessionData = {
      isAdmin: false,
      tenants: [
        {
          tenantId: "tenants_id_xxx" as unknown as Id<"tenants">,
          slug: "lartisan",
          name: "L'Artisan",
          role: "kb_manager",
        },
      ],
      user: {
        userId: "users_xxx" as unknown as Id<"users">,
        email: "manager@kb.test",
      },
    };
    expect(toSessionState(session)).toEqual({
      status: "ready",
      session,
    });
  });

  it("preserves `isAdmin: true` + empty tenants (KB Admin root case)", () => {
    const session: SessionData = {
      isAdmin: true,
      tenants: [],
      user: {
        userId: "users_xxx" as unknown as Id<"users">,
        email: "admin@kb.test",
      },
    };
    const state = toSessionState(session);
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.session.isAdmin).toBe(true);
      expect(state.session.tenants).toHaveLength(0);
    }
  });
});
