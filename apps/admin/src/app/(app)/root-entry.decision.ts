/**
 * F-SHELL-09 — root-entry redirect decision (stub).
 *
 * Real implementation lands in the `feat(F-SHELL-09)` commit. This stub
 * exists so the `test(F-SHELL-09)` commit can pin the contract (types +
 * test matrix) before the behaviour, per the TDD discipline of
 * `docs/contexts/_architecture/WORKFLOW.md` §4.
 */
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

export type RootEntryInput = {
  session: SessionState;
  cookieTenantId: Id<"tenants"> | undefined;
};

export type RootEntryDecision =
  | { kind: "wait" }
  | { kind: "redirect"; href: string };

export function buildTenantLanding(_tenantId: Id<"tenants">): string {
  throw new Error("F-SHELL-09: buildTenantLanding not implemented");
}

export function decideRootEntry(_input: RootEntryInput): RootEntryDecision {
  throw new Error("F-SHELL-09: decideRootEntry not implemented");
}
