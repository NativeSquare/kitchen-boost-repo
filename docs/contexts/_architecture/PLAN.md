# Plan de construction — KitchenBoost

> **Statut** : 🟢 Vivant · **Version** : 1.0 · **Créé** : 2026-05-25 · **Owner** : Alex
> **Rôle** : tableau de bord macro de l'**ordre de construction** du produit. C'est le doc qu'on ouvre pour répondre à « où on en est ».

Ce document est l'**axe construction** : dans quel ordre on écrit les PRD et on code, par couche technique et dépendance.
Pour l'**axe livraison produit** (quand Buns & Bao reçoit quelle valeur, avec checkpoints datés), voir [roadmap.md](../../prd/roadmap.md).
Les deux axes sont réconciliés en bas de ce doc (§ Mapping construction ↔ release).

---

## Où on en est (snapshot)

|                             |                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Étape workflow**          | Phase 2 — Session active ([WORKFLOW.md](WORKFLOW.md)) : boucle `/grill-with-docs` → `/to-prd` → `/to-issues`, chantier par chantier |
| **Chantier en cours**       | **2.1 Customer Data** — cadrage PRD (`/grill-with-docs`) en cours                                                                   |
| **Chantiers de PRD écrits** | 1 / ~36 (1.x ✅)                                                                                                                    |
| **Issues publiées**         | epic [#1](https://github.com/NativeSquare/kitchen-boost-repo/issues/1) + 7 stories (#2–#8) — **toutes fermées**                     |
| **Code mergé**              | **1.x Foundation ✅** — stories #2–#8 mergées (PRs #9–#15), epic #1 fermé · `main` @ `debfb05`                                      |

---

## Terminologie

- **Phase** — macro-étape de construction (1 Foundation → 2 Backends → 3 Fronts → 4 Polish).
- **Chantier** — 1 PRD = 1 issue **epic** GitHub. Produit par `/to-prd`. Granularité : 1 chantier = 1 PRD (jamais un contexte entier d'un coup).
- **Story** (= tracer bullet) — 1 issue **enfant**, tranche verticale e2e marquée **AFK** (codable sans humain) ou **HITL** (décision/design requis). Produit par `/to-issues`, avec `Blocked by` entre stories.

> ⚠️ Collision de vocabulaire assumée : `roadmap.md` utilise aussi « Phase 1-4 » mais pour l'axe **release produit**. Ici « Phase » = axe **construction**. Ne pas confondre. Mapping en bas.

### Légende statut

🔵 en cours · ⛔ pas démarré · 🟡 partiel · ✅ fait

---

## Prérequis transverses (hors chantiers)

| Brique                                                                                                                                              | Réf         | Statut | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copie docs + remote GitHub + skills                                                                                                                 | handoff 01  | ✅     | Vérifié 2026-05-25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Labels GitHub canoniques + `/setup-matt-pocock-skills`                                                                                              | WORKFLOW §6 | ✅     | 10 labels + `docs/agents/*` créés 2026-05-25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Setup workflow AFK (skills `/work-next-agent-issue` + `/work-all-agent-issues`, CI `check.yml`, ESLint `no-untenanted-query`, Husky, `convex-test`) | WORKFLOW §8 | 🟡     | Fait 2026-05-25. **Modèle autonome : auto-merge sur CI verte, pas de review humaine bloquante** (cf. WORKFLOW §1). Le gate = `typecheck+lint+test` local **+** CI verte. 2 réserves : (1) ⚠️ règle ESLint `no-untenanted-query` **toujours scaffoldée, PAS activée** — la story #2 ne l'a pas branchée ; `packages/backend` n'a **aucun script `lint`** ni config eslint, donc `turbo run lint` ignore le backend. Tant que non activée, le garde `withTenant everywhere` n'est tenu que par discipline d'agent + fuzz harness + tests, **pas par le lint**. Petite tâche de durcissement foundation à replanifier (impacte le garde des stories 2.x). (2) **branch protection indisponible** (repo privé plan gratuit) → c'est l'agent qui attend la CI puis merge (`gh pr checks --watch` → `gh pr merge --squash`) ; main reste verte sans gate humain. |
| POCs sprint 0 (5 spikes Convex)                                                                                                                     | STACK §7    | ⛔     | Session dédiée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## Phase 1 — Foundation multi-tenant backend

Le socle transverse dont dépendent **tous** les chantiers Phase 2 et Phase 3.

| Chantier           | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | PRD source                                                  | Epic                                                              | Stories   | Statut                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- | --------- | ----------------------------------- |
| **1.x Foundation** | schema core (`tenants`, `userTenants` avec `role`, `auditLog`, `processedWebhookEvents`, `tenantCredentials` + extension `users`/rôles) · auth/RBAC **4 rôles** (`kb_admin`/`customer` globaux sur `users.role` + `kb_manager`/`staff` per-tenant sur `userTenants.role`) · `getCurrentActor` (point d'intégration auth unique) · helpers `tenantQuery`/`tenantMutation`/`kbAdminQuery` · envelope encryption · `withIdempotence` · audit log · suite Vitest fuzz cross-tenant | [50](../../prd/50_multi_tenant_saas.md) + **ADR 0010/0011** | [#1](https://github.com/NativeSquare/kitchen-boost-repo/issues/1) | 7 (#2–#8) | ✅ fait — PRs #9–#15, epic #1 fermé |

> **Scope V1 ajusté (2026-05-25)** : `staff` est **opérationnel V1** (décision grill, cf. 50-Q6). Le multi-utilisateur par tenant (invites équipe + permissions différenciées) passe de V2.A → V1. La foundation 1.x pose le **modèle + les gardes** ; l'UI d'invitation et les permissions fines vivent dans les chantiers front (Train B/C).

---

## Phase 2 — Backends contexts (9 chantiers)

Ordre d'**écriture des PRD** = ordre ci-dessous (respecte les dépendances). Tous bloqués par 1.x.

> **Pré-Phase 2 (à publier en tête de backlog)** :
>
> - **`2.0` — POCs sprint 0** (5 spikes Convex, [STACK §7](STACK.md)) = **1 story HITL** (`ready-for-human`, validation runtime par dev-lead, pas l'AFK). Les tranches d'intégration en dépendent : **auth/session de 2.1** (POC #4 cookie cross-sous-domaine), **webhooks + saved-card de 2.5** (POC #1 raw body Stripe), **2.6** (POC #5 path params Uber), **push/wallet 2.7/2.8** (POC #2/#3 `"use node"`).
> - **`1.x-H` — activer la règle ESLint `no-untenanted-query`** sur `packages/backend` = **story AFK**, à merger **avant** le code 2.x (le garde _withTenant partout_ devient machine-enforced).

| Ordre | Chantier                                                                | PRD source                                                                  | Bloqué par | Epic | Statut     |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- | ---- | ---------- |
| 1     | **2.1 Customer Data** (anonymous auth, sessions, consent, cgv_versions) | [90](../../prd/90_donnees_clients_crm.md) + ADR 0008                        | 1.x ✅     | #—   | 🔵 cadrage |
| 2     | **2.2 Menu** (categories, items, modifiers, photos)                     | [10](../../prd/10_pwa_client_commande.md) + [70](../../prd/70_kb_admin.md)  | 1.x        | #—   | ⛔         |
| 3     | **2.4 Pricing engine** (`packages/shared/pricing` + rules table)        | [35](../../prd/35_pricing_engine.md)                                        | 1.x        | #—   | ⛔         |
| 4     | **2.3 Orders + Cart**                                                   | [10](../../prd/10_pwa_client_commande.md) + [20](../../prd/20_kb_orders.md) | 2.1 + 2.2  | #—   | ⛔         |
| 5     | **2.5 Payment Stripe Connect**                                          | [30](../../prd/30_paiement_stripe_connect.md)                               | 2.3 + 2.4  | #—   | ⛔         |
| 6     | **2.6 Delivery Uber Direct**                                            | [40](../../prd/40_livraison_uber_direct.md)                                 | 2.3 + 2.5  | #—   | ⛔         |
| 7     | **2.7 Notifications** (push subs, templates, opt-in/out)                | [80](../../prd/80_notifications.md)                                         | 1.x        | #—   | ⛔         |
| 8     | **2.8 Wallet pass**                                                     | [80](../../prd/80_notifications.md) + ADR 0002/0003/0004                    | 2.1 + 2.7  | #—   | ⛔         |
| 9     | **2.9 KB Admin backend** (prospects, contrats, wizard provisioning)     | [70](../../prd/70_kb_admin.md)                                              | 1.x        | #—   | ⛔         |

---

## Phase 3 — Apps front (~26 chantiers, 3 trains parallèles)

> **Esquisse** — le découpage fin et les `Blocked by` seront figés à l'entrée en Phase 3 (une fois les PRD Phase 2 écrits). À attaquer quand Phase 2 est complète. Chaque train mappe à une app du monorepo.

### Train A — `apps/web` (PWA client final) · PRD [10](../../prd/10_pwa_client_commande.md)

Sous-domaine + branding tenant · menu + panier · checkout Stripe Elements + Apple/Google Pay · captation profil + consentement · suivi commande temps réel (Lottie) · web-push subscribe (SW) + A2HS · ajout Wallet pass · API routes Node (`web-push` send).

### Train B — `apps/admin` (KB Admin + KB Manager) · PRD [70](../../prd/70_kb_admin.md)

Login SSO + switcher tenant + guards RBAC · **KB Manager** : édition menu, vue commandes, éditeur règles pricing, KPI clients agrégés (MOAT — **pas de liste individuelle**), campagnes, QR PDF · **KB Admin root** : pipeline onboarding Kanban + CRM prospects, contrats, wizard provisioning, monitoring · API routes Node (wallet `.pkpass`, APNs push).

### Train C — `apps/native` (KB Orders) · PRD [20](../../prd/20_kb_orders.md)

Login SSO + switcher tenant · liste commandes + workflow (nouvelle → prep → prête → remise) · push APNs/FCM + son boucle · mode kiosque tablette (keep-awake, lock task) · refus + refund + ETA courier.

---

## Phase 4 — Polish + soft-launch

> Esquisse — détail à la fin de Phase 3.

Hardening sécurité (dont remplacer le crypto password passthrough du template) · monitoring Sentry + UptimeRobot + tags tenant · tests e2e Playwright chemin critique · audit cross-tenant final (manuel + automatisé) · perf · onboarding 2ᵉ/3ᵉ resto (Eline, Thai Street) · Definition of Done V1.

---

## Mapping construction (ce doc) ↔ release produit ([roadmap.md](../../prd/roadmap.md))

L'ordre de construction n'est pas l'ordre de livraison. On construit par couche (socle → backends → fronts) ; on livre par valeur métier. Un checkpoint produit consomme des chantiers de plusieurs phases construction.

| Checkpoint produit (roadmap)                             | Chantiers construction nécessaires                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **C1** — 1ʳᵉ commande publique Buns & Bao                | 1.x · 2.1 · 2.2 · 2.3 · 2.4 · 2.5 · 2.6 · 2.7 · Train A (menu→checkout→suivi) · Train C (workflow cmd) |
| **C2** — Khan édite son menu seul                        | 2.2 · 2.9 · Train B (édition menu)                                                                     |
| **C3** — Khan reçoit ses cmds (KB Orders)                | 2.3 · 2.7 · Train C complet                                                                            |
| **C4** — Khan configure son pricing                      | 2.4 · Train B (éditeur règles)                                                                         |
| **C5-C7** — marketplaces, push marketing, CB cross-resto | V2 / fin V1 selon arbitrage (cf. roadmap risques)                                                      |

---

## Liens

- [WORKFLOW.md](WORKFLOW.md) — la boucle de production (sessions, AFK, review) + labels
- [STACK.md](STACK.md) — décisions techniques + patterns + POCs
- [roadmap.md](../../prd/roadmap.md) — axe release produit (checkpoints datés)
- [CONTEXT-MAP.md](../../../CONTEXT-MAP.md) — 10 bounded contexts

## Changelog

| Date       | Version | Notes                                                                                                                                                                                                                                                                        |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-25 | 1.0     | Création. Matérialise l'axe construction (Phase/Chantier/Story) absent du repo jusqu'ici.                                                                                                                                                                                    |
| 2026-05-25 | 1.1     | Snapshot rafraîchi : 1.x ✅ codée+mergée (PRs #9–#15, epic #1 fermé). Passage Phase 2, chantier en cours = 2.1 Customer Data (cadrage). Réserve ESLint `no-untenanted-query` corrigée : non activée par #2 (backend sans script lint) → tâche de durcissement à replanifier. |
