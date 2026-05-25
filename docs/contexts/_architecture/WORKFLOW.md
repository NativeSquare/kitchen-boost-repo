# Workflow de développement — KitchenBoost

> **Statut** : 🧪 v1.0 — à tester sur le premier chantier
> **Owner** : Alex
> **Lié à** : [STACK.md](STACK.md) (décisions techniques) + [CONTEXT-MAP.md](../../../CONTEXT-MAP.md) (bounded contexts) + [docs/prd/](../../prd/) (PRDs produit)

Ce document décrit la **boucle de production** quotidienne du projet : comment on passe d'un chantier identifié dans STACK.md à du code mergé sur `main`, en optimisant le temps Alex.

Principe : **Alex active 2h le matin → agents Claude Code local autonomes la nuit → Alex review 30-60 min le lendemain**.

---

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────┐
│                         PHASE 1 — SESSION ACTIVE                     │
│                          (Alex, 2h en batch)                         │
│                                                                      │
│   /grill-with-docs sur un chantier                                   │
│         ↓                                                            │
│   /to-prd  →  1 issue GitHub "epic" ready-for-agent (PRD complet)    │
│         ↓                                                            │
│   /to-issues  →  3-8 issues "tracer bullets" AFK/HITL                │
│                  avec Blocked by entre elles                         │
│         ↓                                                            │
│   Répéter 3-5 fois par session                                       │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────┐
│                    PHASE 2 — CODING AUTONOME (NUIT)                  │
│              (Claude Code local sur PC d'Alex, 6-10h)                │
│                                                                      │
│   /work-all-agent-issues  (skill custom à créer)                     │
│         ↓                                                            │
│   Loop :                                                             │
│   1. Pick next issue ready-for-agent AFK avec dépendances closed     │
│   2. Crée branche agent/<issue-number>                               │
│   3. TDD : tests → code → refactor                                   │
│   4. pnpm typecheck && pnpm lint && pnpm test                        │
│   5. Si vert : gh pr create + label needs-review                     │
│   6. Si rouge : commentaire + label blocked                          │
│   7. ScheduleWakeup 60-300s → loop                                   │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────┐
│                     PHASE 3 — REVIEW (MATIN)                         │
│                       (Alex, 30-60 min)                              │
│                                                                      │
│   gh pr list --label needs-review                                    │
│         ↓                                                            │
│   Pour chaque PR :                                                   │
│   - gh pr diff / review web                                          │
│   - Test E2E manuel si feature visible                               │
│   - Merge si OK (gh pr merge --squash)                               │
│   - Sinon commentaire + label needs-rework                           │
│         ↓                                                            │
│   /triage sur les HITL en attente                                    │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
                          Retour Phase 1 le lendemain
```

---

## 2. Skills utilisés et leurs paths

Tous installés sur `C:\Users\alexp\.claude\skills\` (workflow Matt Pocock + customs).

### Skills Matt Pocock (déjà installés)

| Skill | Path | Quand l'utiliser |
|---|---|---|
| `/setup-matt-pocock-skills` | `C:\Users\alexp\.claude\skills\setup-matt-pocock-skills\` | **Une seule fois** au début du projet pour mapper les labels GitHub aux états canoniques (`ready-for-agent`, `needs-triage`, etc.) |
| `/grill-with-docs` | `C:\Users\alexp\.claude\skills\grill-with-docs\` | Avant `/to-prd` : interview rapide pour résoudre les open questions du PRD source |
| `/grill-me` | `C:\Users\alexp\.claude\skills\grill-me\` | Variante : grilling sans focus docs (sessions exploratoires) |
| `/to-prd` | `C:\Users\alexp\.claude\skills\to-prd\` | Produit le PRD agent-ready et le publie comme issue parent GitHub |
| `/to-issues` | `C:\Users\alexp\.claude\skills\to-issues\` | Éclate le PRD en tracer bullets verticaux AFK/HITL |
| `/triage` | `C:\Users\alexp\.claude\skills\triage\` | Gérer issues : `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` |
| `/tdd` | `C:\Users\alexp\.claude\skills\tdd\` | Guide pour respecter TDD (à invoquer si Claude code dérive) |
| `/improve-codebase-architecture` | `C:\Users\alexp\.claude\skills\improve-codebase-architecture\` | Refactor en deep modules avec API publique isolée |
| `/prototype` | `C:\Users\alexp\.claude\skills\prototype\` | Pour les POCs sprint 0 (les 5 du STACK.md §7) |
| `/diagnose` | `C:\Users\alexp\.claude\skills\diagnose\` | Quand un agent est `blocked`, debug pourquoi |
| `/zoom-out` | `C:\Users\alexp\.claude\skills\zoom-out\` | Si on perd la vue d'ensemble en plein chantier |
| `/handoff` | `C:\Users\alexp\.claude\skills\handoff\` | Si on change de session Claude Code en cours de chantier |

### Skills custom à créer (1 seule fois, avant de pouvoir tourner AFK)

| Skill | Path à créer | Effort | Rôle |
|---|---|---|---|
| `/work-next-agent-issue` | `C:\Users\alexp\.claude\skills\work-next-agent-issue\SKILL.md` | M | Pick next AFK issue + TDD + PR |
| `/work-all-agent-issues` | `C:\Users\alexp\.claude\skills\work-all-agent-issues\SKILL.md` | S | Loop sur le précédent via `ScheduleWakeup` |

Pour les créer, utiliser le skill `/write-a-skill` déjà installé.

---

## 3. Phase 1 — Session active (toi)

### Objectif
Produire 3-5 PRDs `/to-prd` (= 3-5 issues epic) qui seront éclatés en 15-40 tracer bullets AFK pour la nuit.

### Cadence cible
**5-8 PRDs par session de 2h** → 30-35 PRDs en 5-7 sessions = ~2 semaines de prep.

### Ordre d'attaque (selon plan STACK.md)
1. **Semaine 1** : Phase 0 (POCs) + 1 PRD "Foundation multi-tenant" (Phase 1)
2. **Semaine 2** : 9 PRDs Phase 2 (backends contexts)
3. **Semaine 3-5** : ~26 PRDs Phase 3 (apps front)
4. **Semaine 6** : 1-2 PRDs Phase 4 (polish + soft-launch)

### Workflow par PRD

```
1. Choisir un chantier dans STACK.md §3 plan d'attaque
2. /grill-with-docs <chantier>
   (résout les open questions du PRD source docs/prd/N_*.md)
3. /to-prd
   - Sketche modules deep + API publique
   - Vérifie avec toi
   - Publie issue GitHub "epic" ready-for-agent
4. /to-issues sur l'issue epic
   - Propose tracer bullets verticaux
   - Marque AFK / HITL pour chacun
   - Liste Blocked by entre eux
   - Itère avec toi jusqu'à approbation
   - Publie les sous-issues GitHub
5. Passer au chantier suivant
```

### Artifacts produits
- **Issues GitHub** : 1 epic (parent) + N tracer bullets (enfants) par chantier
- **Labels** : `ready-for-agent` sur les tracer bullets AFK
- **Commits** sur main : aucun (la session active produit du backlog, pas du code)

---

## 4. Phase 2 — Coding autonome (Claude Code local, nuit)

### Objectif
Convertir N issues `ready-for-agent` AFK en N PRs `needs-review`, sans intervention humaine.

### Lancement
Le soir avant de te coucher, dans une session Claude Code locale :
```
/work-all-agent-issues
```

Ce skill custom :
1. Liste les issues GitHub avec label `ready-for-agent` non-bloquées
2. Pick la première dans l'ordre des dépendances
3. Crée la branche `agent/<issue-number>`
4. Lit le PRD complet de l'issue + les ADRs référencés
5. **TDD strict** :
   - Étape 1 : écrit les tests Vitest selon "Testing Decisions" → `commit test(<id>): scaffold tests` (rouge attendu)
   - Étape 2 : implémente le code minimum pour passer les tests → `commit feat(<id>): implement`
   - Étape 3 : refactor + extraction patterns → `commit refactor(<id>): cleanup`
6. Lance localement : `pnpm typecheck && pnpm lint && pnpm test`
7. Si vert :
   - `git push origin agent/<issue-number>`
   - `gh pr create --title "feat: <issue-title>" --body "Closes #<issue-number>" --label needs-review`
   - Sur l'issue GitHub : retire `ready-for-agent`, ajoute `in-progress`
8. Si rouge après 2 tentatives de fix :
   - Commit l'état actuel sur la branche
   - Sur l'issue : ajoute label `blocked` + commentaire avec la raison + traces
9. `ScheduleWakeup` 60-300s pour pick la suivante (cache Claude Code reste warm)

### Garde-fous appliqués automatiquement
- **TDD ordre commit** : forcé par le skill (test commit avant feat commit)
- **`withTenant` obligatoire** : ESLint custom rule fait planter le lint
- **Coverage ≥ 80%** : Vitest config bloque sinon
- **Multi-tenant fuzz test** : Vitest suite obligatoire pour chaque module touchant `tenant_id`
- **Schema Convex frozen** : si l'agent modifie `schema.ts`, il flag la PR avec label `needs-schema-review` (= HITL forcé)
- **Pas de secrets** : pre-commit hook git-secrets (`AKIA*`, `sk_live_*`, etc.)

### Cible de productivité
**5-10 issues par nuit** (selon complexité) sur ton PC allumé.

---

## 5. Phase 3 — Review (toi, matin)

### Workflow

```
1. gh pr list --label needs-review
2. Pour chaque PR :
   a. gh pr diff #<num>  (ou web UI)
   b. Vérifier :
      - L'ordre TDD est respecté dans les commits ?
      - Les tests couvrent les acceptance criteria de l'issue ?
      - Les modules deep ont une API publique (index.ts) propre ?
      - Aucun `ctx.db.query` raw (= `withTenant` utilisé) ?
      - Aucun secret commité ?
   c. Si feature UI visible : test E2E manuel rapide sur le preview deployment Convex
   d. Si OK : gh pr merge --squash --delete-branch
   e. Si KO :
      - Commentaire structuré sur la PR
      - Retire `needs-review`, ajoute `needs-rework`
      - L'issue retourne en `ready-for-agent` pour la nuit suivante
3. gh issue list --label blocked
4. /diagnose sur chaque issue bloquée pour comprendre pourquoi
5. Soit fix la story, soit la repasse en `needs-triage`
6. /triage sur tout ce qui est `needs-triage` ou `needs-info`
```

### Reset hebdomadaire
Une fois par semaine, **30 min de hygiene** :
- Purge des branches mergées : `git branch -d agent/*`
- Audit `.out-of-scope/` (rejected enhancements)
- Update STACK.md si décisions techniques ont évolué
- Update CHANGELOG global

---

## 6. États et labels GitHub

À configurer via `/setup-matt-pocock-skills` (voir setup §8).

### Catégorie (1 par issue)
- `bug`
- `enhancement`

### État (1 par issue)
- `needs-triage` — défaut pour issues entrantes
- `needs-info` — bloqué sur reporter
- `ready-for-agent` — AFK, prêt à coder
- `ready-for-human` — HITL, nécessite Alex (architecture, design)
- `in-progress` — agent en train de bosser
- `needs-review` — PR ouverte, attend review Alex
- `needs-rework` — PR review négative, retour code
- `blocked` — agent bloqué, raison en commentaire
- `wontfix` — abandonné, fermé

### Transitions normales
```
[unlabeled] → needs-triage
needs-triage → ready-for-agent | ready-for-human | needs-info | wontfix
needs-info → needs-triage (quand reporter répond)
ready-for-agent → in-progress (agent pick)
in-progress → needs-review (PR créée) | blocked (échec)
needs-review → [closed via merge] | needs-rework
needs-rework → ready-for-agent (retour boucle)
blocked → needs-triage (après /diagnose)
```

---

## 7. Source de vérité — où vit quoi

| Artifact | Où | Format | Mutable |
|---|---|---|---|
| Vision produit | `docs/prd/00_master.md` | Markdown | Oui, versionné |
| PRDs produit par contexte | `docs/prd/N_*.md` (10 fichiers) | Markdown | Oui, versionné |
| Bounded contexts (glossaires) | `docs/contexts/<context>/CONTEXT.md` | Markdown | Oui, versionné |
| Décisions architecture | `docs/adr/NNNN-*.md` | Markdown | Immutable (sauf superseded) |
| Stack technique | `docs/contexts/_architecture/STACK.md` | Markdown | Oui, versionné |
| Workflow (ce doc) | `docs/contexts/_architecture/WORKFLOW.md` | Markdown | Oui, versionné |
| **PRDs agent-ready (epics)** | **Issues GitHub** | Issue body | Closed quand done |
| **Tracer bullets (stories)** | **Issues GitHub** | Issue body | Closed quand done |
| Code dev | Branches `agent/<issue-number>` | Git | Mergées sur main |
| Code prod | Branche `main` | Git | Protégée |

**Règle d'or** : tout ce qui est **vision / décision / contexte** vit dans le repo (markdown versionné). Tout ce qui est **work in progress** vit dans GitHub Issues.

---

## 8. Setup prérequis (1 journée, à faire une fois)

| # | Étape | Effort | Comment |
|---|---|---|---|
| 1 | Push `kitchen-boost-repo` sur GitHub (privé) | S | `git remote add origin git@github.com:nativesquare/kitchen-boost.git && git push -u origin main` |
| 2 | Configurer labels GitHub | S | Via `gh label create` ou UI : tous les labels du §6 |
| 3 | `/setup-matt-pocock-skills` | S | Configure le mapping labels canoniques ↔ labels réels |
| 4 | Branch protection sur `main` | S | UI GitHub : PR review obligatoire, status checks `typecheck/lint/test` |
| 5 | GitHub Actions CI gratuit | M | `.github/workflows/check.yml` : `pnpm typecheck && pnpm lint && pnpm test` sur PR (ne tape PAS l'API Anthropic) |
| 6 | ESLint custom rule `no-untenanted-query` | M | Dans `packages/eslint-config-kitchenboost/` |
| 7 | Husky + lint-staged | S | Pre-commit hooks locaux (typecheck + lint files staged) |
| 8 | Convex test harness | S | `pnpm add -D convex-test` dans `packages/backend` |
| 9 | Skill `/work-next-agent-issue` | M | Via `/write-a-skill` |
| 10 | Skill `/work-all-agent-issues` | S | Wrapper loop du précédent |
| 11 | Template issue GitHub | S | `.github/ISSUE_TEMPLATE/` |
| 12 | Template PR GitHub | S | `.github/pull_request_template.md` avec checklist agent |

**Note importante** : GitHub Actions CI **ne coûte rien** (tier gratuit 2000 min/mois) **et n'utilise pas l'API Anthropic** — c'est juste du Node/pnpm/Convex CLI. La règle "pas de coût Anthropic" est respectée.

---

## 9. Coûts du workflow

| Composant | Coût |
|---|---|
| Claude Code (sessions actives + nuit AFK) | **Abonnement Pro/Max existant** — 0 € marginal |
| GitHub privé | Gratuit (compte perso) |
| GitHub Actions CI | Gratuit (2000 min/mois) |
| Convex preview deployments | Gratuit (dev tier) |
| Anthropic API direct | **0 €** (jamais utilisée) |
| Cloud cost agent runner | **0 €** (PC perso, allumé la nuit) |
| **Total marginal V1** | **0 €** au-delà de l'existant |

---

## 10. Estimation V1 récapitulative

| Phase | Durée Alex | Durée agent nuit | Output |
|---|---|---|---|
| Setup workflow (ce doc + skills custom) | 1 jour | — | infrastructure ready |
| Phase 0 — POCs (5 spikes) | 2-3 jours | — | 5 commits verdict |
| Phase 1 — Foundation backend (1 PRD groupé) | 2h session + 2h review | 2-3 nuits | foundation backend mergée |
| Phase 2 — Backend contexts (9 PRDs) | 4-6 sessions (8-12h) + reviews | 2 semaines de nuits | 9 contexts backend mergés |
| Phase 3 — Apps front (~26 PRDs) | 10-15 sessions (20-30h) + reviews | 3-4 semaines de nuits | 3 apps frontend mergées |
| Phase 4 — Polish + soft-launch | 1 semaine active | — | Buns & Bao live |
| **Total Alex** | **~50-60h actives sur 9 semaines** | — | V1 production |
| **Total wall-clock** | **9 semaines** (mi-juin → fin août 2026) | | cible PRD master `2026-09-30` tenue |

---

## 11. Boucle de validation du workflow

**Ce document est versionné. Si une étape s'avère sous-dimensionnée ou mal séquencée à l'usage, on amende ici et on commit.**

Premier test du workflow = **chantier 1 (Foundation multi-tenant backend)**. À l'issue de ce premier cycle complet (PRD → tracer bullets → coding nuit → review matin → merge), on rétrospect :
- Cadence PRDs/h tenue ?
- Cadence issues codées/nuit tenue ?
- Garde-fous quality suffisants ?
- Skills custom à enrichir ?

Update ce doc après la rétrospective.

---

## 12. Liens

- [STACK.md](STACK.md) — décisions techniques + plan d'attaque chantiers
- [CONTEXT-MAP.md](../../../CONTEXT-MAP.md) — 10 bounded contexts
- [docs/adr/](../../adr/) — décisions architecture
- [docs/prd/](../../prd/) — PRDs produit par contexte
- Template repo : `../kitchen-boost-repo`

## 13. Changelog

| Date | Version | Notes |
|---|---|---|
| 2026-05-25 | 1.0 | Création, à tester sur chantier 1 |
