/**
 * F-PIPELINE-CRM 05 (#255) — pure derivations for the Kanban surface.
 *
 * Two small pure helpers consumed by the React shells (`page.tsx` +
 * `_components/*`) :
 *
 *   - `searchProspectsByName` — case-insensitive + accent-insensitive
 *     substring filter on `name`. Mirror of the search semantics any
 *     French-speaking operator expects when typing « cafe » → « Café Vert ».
 *     Empty / whitespace query is identity (no « no results » false-positive
 *     while the input is still empty).
 *   - `partitionProspectsByPhase` — split the FLAT list returned by
 *     `crm.listProspects()` into 4 buckets (one per phase). The backend
 *     query is intentionally flat (one round-trip, real-time reactive on a
 *     single subscription, ADR 0010 — through `kbAdminQuery`); partitioning
 *     here keeps every bucket reactive in lockstep without 4 distinct
 *     subscriptions.
 *
 * No React / no Convex / no DOM (vitest `node` env). The component shells
 * (`KanbanColumn`, `ProspectCard`, `ActiveClientsTab`, `ProspectSearchBar`)
 * are thin adapters over these.
 *
 * Why a local `ProspectCardSnapshot` shape (not `Doc<"prospects">`)
 * ----------------------------------------------------------------
 * The Kanban only consumes a handful of fields (the ones rendered on the
 * card + the partition key). Pinning a NARROW snapshot type keeps the
 * unit tests free of fixture noise (no need to fill `_creationTime`,
 * `createdAt`, full `milestones`…) AND makes it obvious to the reader
 * what the card actually depends on. The full `Doc<"prospects">` is
 * structurally assignable to it (every field of `ProspectCardSnapshot` is
 * also on the Doc), so production code passes the Convex doc through
 * without conversion.
 */

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

/** The 4 pipeline phases — mirror of `prospectPhase` validator. */
export type ProspectPhase =
  | "acquisition"
  | "preparation"
  | "installation"
  | "operationnel";

/**
 * The narrow shape every Kanban surface consumes. Structurally assignable
 * from `Doc<"prospects">` — production code passes the Convex doc through.
 */
export type ProspectCardSnapshot = {
  _id: Id<"prospects"> | string;
  name: string;
  phase: ProspectPhase;
  source: Doc<"prospects">["source"];
  score?: number;
  tenantId?: Id<"tenants"> | string;
  interactions?: ReadonlyArray<{
    date: number;
    canal?: unknown;
    note?: unknown;
  }>;
};

/**
 * Strip accents + lowercase — used by `searchProspectsByName` so that
 * « cafe » matches « Café Vert ». NFD-decompose + drop combining diacritics
 * (the canonical Unicode trick — works for the latin script our restaurant
 * names live in).
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Filter prospects by a case-insensitive + accent-insensitive substring
 * match on `name`. Empty / whitespace query returns the input list as-is
 * (identity — avoids a misleading empty state while the input is untouched).
 * Stable: preserves the input order.
 */
export function searchProspectsByName<
  T extends Pick<ProspectCardSnapshot, "name">,
>(prospects: ReadonlyArray<T>, query: string): T[] {
  const needle = fold(query.trim());
  if (needle.length === 0) return [...prospects];
  return prospects.filter((p) => fold(p.name).includes(needle));
}

/**
 * Split the flat prospect list into one bucket per phase. Every bucket is
 * always present (empty array if no match) so the consumer never has to
 * guard `undefined`. Stable: preserves the input order within each bucket.
 */
export function partitionProspectsByPhase<
  T extends Pick<ProspectCardSnapshot, "phase">,
>(prospects: ReadonlyArray<T>): Record<ProspectPhase, T[]> {
  const buckets: Record<ProspectPhase, T[]> = {
    acquisition: [],
    preparation: [],
    installation: [],
    operationnel: [],
  };
  for (const p of prospects) {
    buckets[p.phase].push(p);
  }
  return buckets;
}
