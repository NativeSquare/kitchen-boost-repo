/**
 * F-SUPPORT/3 (#235) — Route opérationnelle `/t/[tenantId]/support`.
 *
 * Troisième tracer-bullet de l'épique F-SUPPORT (#150) : rend le composant
 * partagé `SupportContent` (figé en #210) sous le shell opérationnel
 * `(app)/t/[tenantId]`, miroir strict de la route supervision `/support`
 * (#232). Aucune divergence de config, aucune duplication.
 *
 * Why is this page so thin?
 * -------------------------
 * Tout le contenu (CSM bandeau + cards ressources) est porté par
 * `SupportContent` + `supportConfig` (le module `@/components/support` expose
 * son contrat via `index.ts` — guardrail "Module API" du workflow). La page
 * n'a qu'une responsabilité : monter ce composant sous le bon segment de
 * route. Pas de Convex query, pas de state, pas de router dep, pas même de
 * lecture du `tenantId` — la version V1 est 100 % statique (PRD
 * `70_kb_admin.md` §4.11 et ADR 0014 §1). La per-tenant config (Slack,
 * Intercom, FAQ dynamique, contrat PDF Odoo) arrivera en V2.
 *
 * Why under `(app)/t/[tenantId]/support/`, not at the supervision root?
 * --------------------------------------------------------------------
 * Le segment `(app)/` (parenthésé) est un route group Next.js : il n'ajoute
 * RIEN à l'URL — il sert juste à grouper les pages qui partagent le shell
 * `(app)/layout.tsx` (SessionLoader + SessionGuard + ApplicationShell, cf.
 * F-SHELL-01..02). Les segments `t/[tenantId]` DO segmenter — la page sous
 * `(app)/t/[tenantId]/support/` est donc accessible à `/t/[tenantId]/support`,
 * dans l'espace opérationnel (cf. ADR 0014 §3 : « la sidebar et les surfaces
 * s'adaptent au rôle »).
 *
 * Accessibilité tenant suspendu (AC4, PRD §Edge cases)
 * ----------------------------------------------------
 * « KB Manager attaché à un tenant suspendu uniquement : message
 *  d'explication + lien vers support, pas d'accès aux fonctions. » →
 * cette route DOIT rester accessible même quand le tenant est suspendu.
 *
 * Comportement constaté côté shell (F-SHELL-04 #175 — pinned par
 * `tenant-context.hook.test.ts`) : le parent `(app)/t/[tenantId]/layout.tsx`
 * gate UNIQUEMENT sur existence (`not-found`) et propriété (`not-authorized`
 * / `allow` / `wait`) via la fonction pure `decideTenantGate`. Il n'y a
 * AUCUNE branche `suspended` — un KB Manager attaché à un tenant suspendu
 * atteint cette route exactement comme un tenant actif. Aucune exception
 * n'est donc nécessaire ici, ET aucun code « allow suspended » à écrire :
 * l'absence de gate suspendue EST l'autorisation. Si une future slice
 * F-SHELL introduit un tel gate, elle devra explicitement excepter cette
 * route (référer PRD §Edge cases ci-dessus).
 *
 * Sidebar wiring : HORS scope (cf. issue #235) — l'entrée « Support » dans
 * la sidebar conditionnelle KB Manager appartient à F-SHELL (#142) ou à un
 * PR de suivi. Cette story se contente de POSER la route.
 *
 * Scope discipline (#235 hard constraint, mirrors `(app)/support/page.tsx`
 * et `t/[tenantId]/parametres/page.tsx`) : ce fichier (et son voisin
 * `page.test.tsx` sous `apps/admin/src/app/(app)/t/[tenantId]/support/`) est
 * la SEULE surface touchée par cette story. Zéro touche à `apps/web`,
 * `apps/native`, `packages/backend/convex/`, au composant partagé
 * `@/components/support` (figé en #210), à la route supervision
 * `(app)/support/`, ou à la sidebar.
 */
"use client";

import type { ReactNode } from "react";

import { SupportContent, supportConfig } from "@/components/support";

export default function TenantSupportPage(): ReactNode {
  return <SupportContent {...supportConfig} />;
}
