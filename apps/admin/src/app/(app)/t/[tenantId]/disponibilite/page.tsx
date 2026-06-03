"use client";

/**
 * #397 (KB Admin — Toggles disponibilité commerciale) — Route
 * `/t/[tenantId]/disponibilite/`.
 *
 * Wiring de la page « Disponibilité commerciale » (PRD 20 §7 / ADR 0018).
 * 4 surfaces mirror de l'app native (#406–#409) avec **même state Convex
 * partagé** : un changement KB Admin se reflète immédiatement côté KB Orders.
 *
 * Pure wiring layer (mirror `sessions/page.tsx`, `parametres/page.tsx`) :
 *  - lit `api.lib.orders.orders.getOperationalPause` +
 *    `api.lib.orders.orders.getExceptionalClosure` via `useTenantQuery`
 *    (front-side `withTenant`, ADR 0014 §4 / #183) ;
 *  - wrap les 4 mutations (set/clear pause + set/clear closure) via
 *    `useTenantMutation` — JAMAIS un raw `useMutation` sur une tenantMutation
 *    (bypasse l'injection de tenantId — ADR 0014 §4) ;
 *  - délègue le rendering à `<DisponibiliteView/>` (pure presentational).
 *
 * Access guard (cross-tenant) : hérité de la layout parente
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175). Le wrapper backend
 * (`tenantMutation`/`tenantQuery` sur tous les surfaces orders) reste la vraie
 * barrière (ADR 0010 — refuse Forbidden même si le shell régresse,
 * cross-tenant fuzz shipé par `orders.test.ts`).
 *
 * Scope discipline (mirror #396 / #229) : ce fichier (et ses siblings sous
 * `t/[tenantId]/disponibilite/`) est la seule surface front touchée par cette
 * story côté `apps/admin`. Le backend embarqué (3 nouvelles mutations + 1
 * query + 1 champ schema `exceptionalClosure`) suit la convention
 * `backend-embedded-in-frontend-story` (mémoire Alex).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantMutation, useTenantQuery } from "@/hooks";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { DisponibiliteView } from "./disponibilite-view";

const MINUTE_MS = 60 * 1000;

export default function DisponibilitePage() {
  // `useParams` exposes the URL tenant segment for the cross-link sections
  // (Menu / Paramètres). The TenantProvider already resolved + validated it
  // (F-SHELL-04 #175), so the value here is just the raw string.
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId ?? "";

  // Convex subscriptions — `undefined` is the loading sentinel.
  const pause = useTenantQuery(api.lib.orders.orders.getOperationalPause);
  const closure = useTenantQuery(api.lib.orders.orders.getExceptionalClosure);

  // `nowMs` is read off the wall-clock but staged through state so the React
  // Compiler rule « no impure call during render » is honoured (Date.now() is
  // impure). We seed it once on mount and refresh every 30s so the pause ETA
  // / closure « jusqu'au » display stays live even if no Convex re-render
  // fires (e.g. the gérant lands on the page exactly at the auto-reprise
  // boundary). 30s is generous enough that we don't burn cycles.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30 * 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  // tenant-scoped mutations — every one through `useTenantMutation` so
  // tenantId is injected from the context (front-side `withTenant`, ADR 0014
  // §4) — never a raw `useMutation`.
  const setPause = useTenantMutation(api.lib.orders.orders.setOperationalPause);
  const clearPause = useTenantMutation(
    api.lib.orders.orders.clearOperationalPause,
  );
  const setClosure = useTenantMutation(
    api.lib.orders.orders.setExceptionalClosure,
  );
  const clearClosure = useTenantMutation(
    api.lib.orders.orders.clearExceptionalClosure,
  );

  const handleSetPause = async (durationMin: 15 | 30 | 60): Promise<void> => {
    const until = Date.now() + durationMin * MINUTE_MS;
    try {
      await setPause({ until });
      toast.success(`Resto en pause pour ${durationMin} min.`);
    } catch (error) {
      toast.error("Impossible de mettre le resto en pause", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  const handleClearPause = async (): Promise<void> => {
    try {
      await clearPause();
      toast.success("Reprise des commandes.");
    } catch (error) {
      toast.error("Impossible de lever la pause", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  const handleSetClosure = async (
    from: number,
    until: number,
  ): Promise<void> => {
    try {
      await setClosure({ from, until });
      toast.success("Fermeture exceptionnelle enregistrée.");
    } catch (error) {
      toast.error("Impossible d'enregistrer la fermeture", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  const handleClearClosure = async (): Promise<void> => {
    try {
      await clearClosure();
      toast.success("Fermeture exceptionnelle levée.");
    } catch (error) {
      toast.error("Impossible de lever la fermeture", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  return (
    <DisponibiliteView
      tenantId={tenantId}
      pause={pause}
      closure={closure}
      onSetPause={handleSetPause}
      onClearPause={handleClearPause}
      onSetClosure={handleSetClosure}
      onClearClosure={handleClearClosure}
      // The view derives every active / expired display from `nowMs` so
      // unit tests are deterministic. In production it ticks every 30s via
      // the useEffect interval above — enough for the pause auto-reprise
      // boundary to be reflected without burning render cycles.
      nowMs={nowMs}
    />
  );
}
