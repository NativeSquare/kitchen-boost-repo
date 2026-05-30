/**
 * F-SHELL-02 — `SessionGuard` decision logic, pinned as a pure function.
 *
 * The garde itself is a `"use client"` React component (jsdom-free test env
 * makes rendering it from vitest impractical here), so the *what-to-do*
 * branching is extracted into `decideSessionGate(state)` — a pure mapping
 * from `SessionState` to one of three actions the React shell executes:
 *   - `wait`   → render a loading skeleton (don't render children, don't
 *                 redirect — Convex query still in flight)
 *   - `redirect-to-login` → push `/login?next=<currentPath>`
 *   - `no-tenant`         → render the "Pas de resto rattaché" page
 *   - `allow`             → render children
 *
 * Splitting it this way matches the project's existing pattern for the
 * session reducer (`reducer.ts` / `reducer.test.ts`) and lets us assert
 * every acceptance criterion of issue #164 without a DOM.
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideSessionGate } from "./session-guard";
import type { SessionState } from "@/lib/session";

const TENANT_ID = "tenants_id_xxx" as unknown as Id<"tenants">;

describe("decideSessionGate", () => {
  it("status=loading → `wait` (no redirect, no children)", () => {
    const state: SessionState = { status: "loading" };
    expect(decideSessionGate(state)).toEqual({ kind: "wait" });
  });

  it("status=unauthenticated → `redirect-to-login` (acceptance #164: push /login?next=...)", () => {
    const state: SessionState = { status: "unauthenticated" };
    expect(decideSessionGate(state)).toEqual({ kind: "redirect-to-login" });
  });

  it("status=ready, isAdmin=false + tenants=[] → `no-tenant` (acceptance #164: « Pas de resto rattaché »)", () => {
    const state: SessionState = {
      status: "ready",
      session: { isAdmin: false, tenants: [] },
    };
    expect(decideSessionGate(state)).toEqual({ kind: "no-tenant" });
  });

  it("status=ready, isAdmin=true + tenants=[] → `allow` (acceptance #164: KB Admin root case)", () => {
    const state: SessionState = {
      status: "ready",
      session: { isAdmin: true, tenants: [] },
    };
    expect(decideSessionGate(state)).toEqual({ kind: "allow" });
  });

  it("status=ready, isAdmin=false + tenants=[X] → `allow` (acceptance #164: gérant cas)", () => {
    const state: SessionState = {
      status: "ready",
      session: {
        isAdmin: false,
        tenants: [
          {
            tenantId: TENANT_ID,
            slug: "lartisan",
            name: "L'Artisan",
            role: "kb_manager",
          },
        ],
      },
    };
    expect(decideSessionGate(state)).toEqual({ kind: "allow" });
  });

  it("status=ready, isAdmin=true + tenants=[X] → `allow` (KB Admin avec rattachements)", () => {
    const state: SessionState = {
      status: "ready",
      session: {
        isAdmin: true,
        tenants: [
          {
            tenantId: TENANT_ID,
            slug: "lartisan",
            name: "L'Artisan",
            role: "kb_manager",
          },
        ],
      },
    };
    expect(decideSessionGate(state)).toEqual({ kind: "allow" });
  });
});
