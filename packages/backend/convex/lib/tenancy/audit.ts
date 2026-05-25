import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

/**
 * 1.x-G — audit log of sensitive actions (STACK.md §6.4, RGPD "qui a fait quoi
 * sur quel tenant", roadmap V1).
 *
 * `logAudit` writes ONE append-only `auditLog` row. The table (1.x-A / #2)
 * already carries `actorUserId`, `actorRole`, `action`, `tenantId?`,
 * `targetType?`, `targetId?`, `metadata?`, `timestamp` with `by_tenant` /
 * `by_actor` / `by_timestamp` indexes — this story does NOT change the schema.
 *
 * HYBRID composition policy (driven from `withTenant.ts`):
 *  - `kbAdminMutation` AUTO-logs every one of its mutations (root actions are
 *    always sensitive) via an `onSuccess` hook INSIDE the wrapper — so the row
 *    is written only when the mutation actually committed.
 *  - `tenantMutation` logs ONLY when the function declares `audit: true`
 *    (most resto writes are routine; opt-in keeps the trail signal-rich).
 *  - `logAudit` stays callable explicitly from any mutation handler for the
 *    cases the wrappers can't infer (richer `targetType`/`metadata`, an action
 *    spanning several writes, …).
 *
 * It lives in the `lib/tenancy/` module (the sanctioned `ctx.db` exception of the
 * `no-untenanted-query` rule, ADR 0010): the audit trail is transverse plumbing,
 * not tenant-scoped business data, so the raw `ctx.db.insert` here is by design.
 * Requires a write-capable (mutation) ctx; the insert commits in the SAME
 * transaction as the action it records, so a rolled-back action leaves no row.
 */

/** Fields accepted by `logAudit`. `timestamp` is stamped by the helper. */
export type AuditEntry = {
  /** Who performed the action. */
  actorUserId: Id<"users">;
  /**
   * The actor's role at the time, as a free string (the table keeps it loose so
   * the trail survives role-model evolutions). Typically the effective role on
   * the tenant (`kb_admin` / `kb_manager` / `staff`) or the global role.
   */
  actorRole: string;
  /** What happened — a stable dotted verb, e.g. `tenant.suspend`, `menu.edit`. */
  action: string;
  /** Tenant the action targeted, if any (root-wide actions may omit it). */
  tenantId?: Id<"tenants">;
  /** Kind of the targeted entity, e.g. `tenant`, `customer`, `order`. */
  targetType?: string;
  /** Id of the targeted entity (kept as a string: any table, or an external id). */
  targetId?: string;
  /** Arbitrary structured context (diff, reason, request metadata, …). */
  metadata?: unknown;
};

/**
 * Append one row to `auditLog`, stamping `timestamp` with the current time.
 * Optional fields are only persisted when supplied (Convex stores `undefined`
 * as an absent field). Returns the new row id.
 */
export async function logAudit(
  // Write-capable ctx only: the audit row must commit with the recorded action.
  ctx: Pick<MutationCtx, "db">,
  entry: AuditEntry,
): Promise<Id<"auditLog">> {
  return ctx.db.insert("auditLog", {
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    action: entry.action,
    tenantId: entry.tenantId,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    timestamp: Date.now(),
  });
}
