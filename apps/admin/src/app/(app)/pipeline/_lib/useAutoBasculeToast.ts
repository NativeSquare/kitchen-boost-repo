"use client";

/**
 * F-PIPELINE-CRM 06 (#262) — `useAutoBasculeToast`.
 *
 * React-side wrapper around the pure `detectAutoBascule` diff. On every
 * change of the `listProspects` snapshot, compares to the previous one
 * (via `useRef`) and fires a toast for each prospect whose `phase` JUST
 * became `preparation` (the only auto-bascule we currently care about —
 * Closing complete on the fiche triggers Acquisition → Préparation
 * server-side via `maybeAutoBascule`).
 *
 * Why only `→ preparation`
 * ------------------------
 * Backend has only ONE automatic phase transition today
 * (`acquisition → preparation`, triggered by `evaluateClosing` complete in
 * `maybeAutoBascule`). The other transitions are operator-initiated (manual
 * DnD or `crm.changePhase`) and would double-toast if surfaced here (the
 * operator already sees the card move on the Kanban). Filtering to the auto
 * edge keeps the toast meaningful — « the system did something », not
 * « you did something ».
 *
 * Why `useRef` for the prev snapshot
 * ----------------------------------
 * `useState` would re-render the consumer on every snapshot delta; `useRef`
 * holds the previous list across renders without triggering one. The diff
 * runs in a `useEffect` keyed on the current snapshot — fires once per
 * Convex push.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  type ProspectPhaseSnapshot,
  detectAutoBascule,
} from "./autoBasculeNotifier";

export function useAutoBasculeToast(
  prospects: ReadonlyArray<ProspectPhaseSnapshot> | undefined,
): void {
  const prevRef = useRef<ReadonlyArray<ProspectPhaseSnapshot> | undefined>(
    undefined,
  );

  useEffect(() => {
    const transitions = detectAutoBascule(prevRef.current, prospects);
    for (const t of transitions) {
      if (t.fromPhase === "acquisition" && t.toPhase === "preparation") {
        toast.success(
          `${t.name} — Prospect basculé en Préparation (Closing complet)`,
        );
      }
    }
    prevRef.current = prospects;
  }, [prospects]);
}
