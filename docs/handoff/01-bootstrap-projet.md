# Handoff — Bootstrap projet KitchenBoost

> **Date** : 2026-05-25
> **Pour** : Session Claude Code fraîche, spawnée dans le repo `kitchen-boost-repo` après copie du dossier `docs/` (et idéalement `CONTEXT-MAP.md` + `CLAUDE.md`) à la racine
> **Objectif de cette session** : démarrer concrètement le coding du projet KitchenBoost, en suivant le workflow documenté

---

## 1. Contexte produit (TL;DR)

**KitchenBoost** est un SaaS multi-tenant pour la restauration qui aide les restos parisiens à reprendre le pouvoir sur Uber Eats. Modèle : 2 €/cmd flat + pass-through frais Stripe. PWA client final + KB Orders mobile cuisine + KB Admin web. Cible V1 : **soft-launch sur Buns & Bao (1 resto pilote) avant 2026-09-30**.

Lire d'abord [CLAUDE.md](../../CLAUDE.md) à la racine pour le contexte business complet (si non copié → demander à Alex).

## 2. État actuel à date

✅ **Fait** (output des sessions précédentes) :
- 10 bounded contexts DDD définis avec glossaires (`docs/contexts/`)
- 10 PRDs produit + 1 master + roadmap (`docs/prd/`)
- 9 ADRs publiés (`docs/adr/`) — 0001 superseded par 0007
- Gap analysis stack technique vs requirements (consolidé dans STACK.md)
- Décision stack actée : template NativeSquare (Convex + Next.js + Expo + Resend)
- Schéma d'architecture global ([docs/diagrams/architecture-v1.excalidraw](../diagrams/architecture-v1.excalidraw))
- Workflow de production formalisé ([docs/contexts/_architecture/WORKFLOW.md](../contexts/_architecture/WORKFLOW.md))

❌ **Pas encore fait** (par ordre de priorité) :
1. **Setup workflow** (§8 de WORKFLOW.md) — push GitHub + labels + CI + ESLint custom + Husky + skills custom AFK
2. **POCs sprint 0** — 5 spikes Convex à valider (cf. STACK.md §7)
3. **Premier PRD `/to-prd`** — chantier 1.x "Foundation multi-tenant backend"
4. **Premier coding nuit AFK** — via skill custom `/work-all-agent-issues`

## 3. Documents clés à lire (dans l'ordre)

| Ordre | Document | Pourquoi |
|---|---|---|
| 1 | [CLAUDE.md](../../CLAUDE.md) | Contexte business KitchenBoost |
| 2 | [CONTEXT-MAP.md](../../CONTEXT-MAP.md) | 10 bounded contexts + vocabulaire transverse |
| 3 | [docs/contexts/_architecture/STACK.md](../contexts/_architecture/STACK.md) | Stack technique V1, décisions actées, mapping contexts↔code, shopping list libs, patterns clés (`withTenant`, idempotence webhooks, envelope encryption), POCs sprint 0, plan d'attaque chantiers |
| 4 | [docs/contexts/_architecture/WORKFLOW.md](../contexts/_architecture/WORKFLOW.md) | Workflow complet : session active / coding nuit / review matin, skills utilisés, setup prérequis |
| 5 | [docs/prd/00_master.md](../prd/00_master.md) | Vision V1/V2/V3 + personas + business model |
| 6 | [docs/prd/roadmap.md](../prd/roadmap.md) | Roadmap exécution |
| 7 | [docs/adr/README.md](../adr/README.md) | Liste des 9 ADRs (lire les ADRs cités quand on touche un contexte) |

Les PRDs produit individuels (`docs/prd/10_*.md` à `90_*.md`) et les CONTEXT.md par contexte (`docs/contexts/<context>/CONTEXT.md`) sont lus à la demande quand on attaque le chantier correspondant.

## 4. Prochaines étapes concrètes

### Étape 0 — Vérifier que tout est copié

Avant tout, demander à Alex de confirmer que la racine du repo `kitchen-boost-repo` contient :
- `docs/` (dossier copié depuis projet KitchenBoost)
- `CONTEXT-MAP.md` (à la racine)
- `CLAUDE.md` (à la racine — contient le contexte business)
- Idéalement aussi le contenu des memories projet (sinon les références `[[...]]` dans les docs ne résoudront pas)

### Étape 1 — Setup workflow (1 journée, en session active avec Alex)

Suivre [WORKFLOW.md §8](../contexts/_architecture/WORKFLOW.md) étape par étape :
1. `git remote add origin` + push initial sur GitHub privé
2. Créer les labels GitHub (cf. WORKFLOW.md §6)
3. Invoquer `/setup-matt-pocock-skills` pour mapper les labels canoniques
4. Branch protection sur `main`
5. `.github/workflows/check.yml` (typecheck + lint + test, sans API Anthropic)
6. ESLint custom rule `no-untenanted-query` dans `packages/eslint-config-kitchenboost/`
7. Husky + lint-staged (pre-commit + pre-push hooks)
8. `pnpm add -D convex-test` dans `packages/backend/`
9. Créer skill `/work-next-agent-issue` via `/write-a-skill`
10. Créer skill `/work-all-agent-issues` (wrapper loop)
11. `.github/ISSUE_TEMPLATE/` + `.github/pull_request_template.md`

### Étape 2 — POCs sprint 0 (2-3 jours, possiblement avec `/prototype` skill)

Cf. STACK.md §7. 5 POCs à valider :
1. Convex `httpAction` préserve raw body pour vérif HMAC Stripe/Uber ?
2. Convex `"use node"` action supporte `web-push` ?
3. Convex `"use node"` action supporte `passkit-generator` ?
4. Convex Auth Anonymous adapter supporte cookie `Domain=.kitchen-boost.fr` cross-subdomain ?
5. Convex `httpRouter` supporte path params dynamiques ?

Output attendu : 1 commit par POC avec README "verdict" Go/No-Go. Si un POC échoue, offload sur Next.js API route Node runtime (la stack tient quand même).

### Étape 3 — Premier chantier de production

Suivre WORKFLOW.md §3 :
1. `/grill-with-docs` sur le chantier 1 "Foundation multi-tenant backend" (cf. STACK.md §3 plan d'attaque Phase 1)
2. `/to-prd` → publie issue GitHub "epic" `ready-for-agent`
3. `/to-issues` → éclate en 3-8 tracer bullets verticaux AFK/HITL
4. Lancer `/work-all-agent-issues` le soir, review au matin

## 5. Skills suggérés (dans l'ordre d'utilisation)

| Skill | Quand | Où | Notes |
|---|---|---|---|
| `/setup-matt-pocock-skills` | Setup étape 3 | Une fois | Configure mapping labels GitHub ↔ canoniques |
| `/write-a-skill` | Setup étapes 9-10 | Pour créer `/work-next-agent-issue` + `/work-all-agent-issues` | Skills custom AFK |
| `/prototype` | POCs sprint 0 | Pour chaque spike | Garde le code POC isolé, ne pas polluer le repo |
| `/grill-with-docs` | Avant chaque `/to-prd` | Chantier par chantier | Résout les open questions du PRD source |
| `/to-prd` | Après `/grill-with-docs` | Chantier par chantier | Publie issue epic `ready-for-agent` |
| `/to-issues` | Après `/to-prd` | Sur l'issue epic | Éclate en tracer bullets AFK/HITL |
| `/triage` | Quotidien | Sur issues `needs-info` ou `needs-triage` | Maintient l'état du backlog |
| `/tdd` | Si l'agent dérive du TDD | Pendant phase 2 nuit | Rappelle la discipline test-first |
| `/improve-codebase-architecture` | Si modules deviennent shallow | Périodique | Refactor en deep modules avec API publique |
| `/diagnose` | Issues `blocked` | Au matin | Comprendre pourquoi l'agent a bloqué |
| `/zoom-out` | Si perte vue d'ensemble | À la demande | Re-cadrer où on en est |

## 6. Conventions et règles d'or (non-négociables)

### Stack et architecture
- **Ne JAMAIS toucher à la structure du template** `kitchen-boost-repo` (apps/web, apps/admin, apps/native, packages/backend, packages/shared, packages/transactional). On étend, on ne reconstruit pas.
- **Toute donnée métier vit dans Convex**. Pas de base externe.
- **Multi-tenant via `tenant_id` partout + helpers applicatifs** (`withTenant` / `tenantQuery` / `tenantMutation`). RLS Postgres n'existe pas dans Convex → discipline applicative.
- **Offload Next.js Node runtime** pour code crypto-lourd (Wallet pass `.pkpass`, `web-push` ECDH). Convex actions V8 ne suffisent pas.
- **API publique des modules figée** via `index.ts` par feature dans `convex/lib/<feature>/`. Pas d'import croisé hors de cette API.

### Quality
- **TDD obligatoire** : tests écrits AVANT le code, commit order respecté (`test:` → `feat:` → `refactor:`)
- **Coverage Vitest ≥ 80%** sur les modules backend
- **`withTenant` partout** : ESLint custom rule bloque le merge sinon
- **Suite multi-tenant fuzz** : test cross-tenant systématique sur chaque mutation
- **Pas de secrets en commit** : pre-commit hook git-secrets

### Produit
- **Ne JAMAIS inventer** des specs resto (ingrédients, recettes, prix carte). Tout ce qui n'est pas sourcé reste open question.
- **V1 = 1 resto pilote Buns & Bao**. Pas de Hubrise (V2), pas de SMS (V2), pas de Critical Alerts Apple (V2), pas de KMS externe (V2).
- **MOAT** = base clients globale cross-tenant. Article 2 ter du contrat verrouille. Anti-extraction technique en V2, V1 = pas de liste individuelle côté KB Manager.

### Workflow
- **Pas de GitHub Actions Anthropic API** — Claude Code tourne en local uniquement (abonnement Alex). GitHub Actions OK pour CI Node/pnpm classique (gratuit, n'utilise pas l'API Anthropic).
- **PRs review obligatoire** avant merge sur `main`. Pas d'auto-merge.
- **Branche `agent/<issue-number>`** pour chaque story codée par l'agent.
- **Commit messages** : `test(<id>): ...` → `feat(<id>): ...` → `refactor(<id>): ...`

## 7. Ce qu'il ne faut PAS faire

- ❌ Refondre la structure du template `kitchen-boost-repo`
- ❌ Inventer des features non documentées dans les PRDs
- ❌ Coder sans tests d'abord (TDD strict)
- ❌ Utiliser `ctx.db.query(...)` raw — toujours via `withTenant` helpers
- ❌ Stocker des secrets per-tenant en clair (envelope encryption obligatoire dès Phase 1)
- ❌ Skip la phase POC sprint 0 — sans validation des 5 POCs, on risque un mauvais pattern partout
- ❌ Faire `/to-prd` sur un contexte entier — granularité = 1 chantier = 1 PRD
- ❌ Auto-merger une PR de schema Convex sans review humaine
- ❌ Commit des credentials Apple Pass / Google Wallet / Stripe / Uber Direct
- ❌ Brancher Anthropic API direct depuis GitHub Actions (coût ×10)

## 8. Ressources externes utiles

- Template repo origin : voir `kitchen-boost-repo/README.md` pour setup Convex + Resend + Apple/Google OAuth
- Convex docs : https://docs.convex.dev (composants `migrations`, `resend`, `rate-limiter`)
- Stripe Connect Express : https://stripe.com/docs/connect/express-accounts
- Uber Direct API : https://developer.uber.com/docs/deliveries (cf. `docs/research/uber_direct_deep_dive.md`)
- Apple Wallet PassKit : https://developer.apple.com/documentation/walletpasses
- Skills Matt Pocock : installés dans `C:\Users\alexp\.claude\skills\`

## 9. Memories Claude Code projet — voir export consolidé

Les memories Claude Code ne se copient pas via le repo (elles sont attachées au project-id local de la session). Les **memories essentielles techniques et produit** ont été exportées dans :

➡️ **[docs/handoff/02-memories-essentielles.md](02-memories-essentielles.md)**

Contenu : modèle commission, MOAT base clients, architecture cuisine V1, DA, onboarding 5 phases, Uber Direct patterns, Web Push, list des memories non exportées.

À lire en complément des autres docs §3.

## 10. Question d'entrée à poser à Alex

Avant de coder quoi que ce soit, vérifier avec Alex :
1. Tous les docs copiés (cf. §4 étape 0) ?
2. Repo GitHub déjà créé / à créer ?
3. Comptes externes prêts : Apple Developer ✅ (Alex a la licence), Google Cloud, Stripe Connect, Uber Direct, Resend, Sentry ?
4. On démarre par **setup workflow** (1 jour) puis **POCs sprint 0**, ou directement par un POC pour valider Convex avant d'investir le setup ?

Recommandation : commencer par **1 POC critique** (le n°1 — Convex `httpAction` raw body Stripe HMAC) parce que si ça casse, ça change beaucoup de patterns. Si OK, enchaîner le setup workflow.
