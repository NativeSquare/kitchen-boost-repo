/**
 * F-SUPPORT/2 (#232) — Route supervision `/support`.
 *
 * Deuxième tracer-bullet de l'épique F-SUPPORT (#150) : rend le composant
 * partagé `SupportContent` (figé en #210) sous le shell supervision KB Admin.
 *
 * Why is this page so thin?
 * -------------------------
 * Tout le contenu (CSM bandeau + cards ressources) est porté par
 * `SupportContent` + `supportConfig` (le module `@/components/support` expose
 * son contrat via `index.ts` — guardrail "Module API" du workflow). La page
 * n'a donc qu'une responsabilité : monter ce composant sous le bon segment
 * de route. Pas de Convex query, pas de state, pas de router dep — la page
 * est 100 % statique en V1, comme prévu par PRD `70_kb_admin.md` §4.11 et
 * ADR 0014 §1 (la suite — Slack/Intercom, FAQ dynamique, contrat PDF Odoo —
 * arrivera en V2).
 *
 * Why under `(app)/support/`, not `(app)/t/[tenantId]/support/` ?
 * --------------------------------------------------------------
 * Le segment `(app)/` (parenthésé) est un route group Next.js : il n'ajoute
 * RIEN à l'URL — il sert juste à grouper les pages qui partagent le shell
 * `(app)/layout.tsx` (SessionLoader + SessionGuard + ApplicationShell, cf.
 * F-SHELL-01..02). Une page sous `(app)/support/` est donc accessible à
 * `/support` (et pas `/(app)/support`). Les routes opérationnelles d'un
 * tenant vivent sous `(app)/t/[tenantId]/...` — pas ici (cf. ADR 0014 §3 :
 * « la sidebar et les surfaces s'adaptent au rôle »).
 *
 * Sidebar wiring : HORS scope (cf. issue #232) — l'entrée « Support » dans
 * la sidebar conditionnelle KB Admin appartient à F-SHELL (#142) ou à un
 * PR de suivi. Cette story se contente de POSER la route.
 *
 * Scope discipline (#232 hard constraint, mirrors menu/page.tsx et
 * parametres/page.tsx) : ce fichier (et ses voisins sous
 * `apps/admin/src/app/(app)/support/`) est la SEULE surface touchée par
 * cette story. Zéro touche à `apps/web`, `apps/native`,
 * `packages/backend/convex/`, au composant partagé `@/components/support`
 * (figé en #210), ou à la sidebar.
 */
"use client";

import type { ReactNode } from "react";

import { SupportContent, supportConfig } from "@/components/support";

export default function SupportPage(): ReactNode {
  return <SupportContent {...supportConfig} />;
}
