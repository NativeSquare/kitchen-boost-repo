# Workflow de développement — KitchenBoost

> **Statut** : 🧪 v1.0 — à tester sur le premier chantier
> **Owner** : Alex
> **Lié à** : [STACK.md](STACK.md) (décisions techniques) + [CONTEXT-MAP.md](../../../CONTEXT-MAP.md) (bounded contexts) + [docs/prd/](../../prd/) (PRDs produit)

Ce document décrit la **boucle de production** quotidienne du projet : comment on passe d'un chantier identifié dans STACK.md à du code mergé sur `main`, en optimisant le temps Alex.

Principe : **Alex active 2h le matin (PRD + issues) → agents Claude Code local autonomes la nuit, qui mergent eux-mêmes sur CI verte → Alex fait des tests e2e + un contrôle qualité à froid, sans gate de merge**.

> **Modèle de merge (acté 2026-05-25, override de la v1.0)** : **auto-merge sur CI verte**, pas de review humaine bloquante. Une story est mergée par l'agent ssi `typecheck + lint + test` passent en local **et** la CI (`check.yml`) est verte. La chaîne de dépendances s'enchaîne donc seule pendant la nuit. Le contrôle qualité d'Alex est **asynchrone et non bloquant** (e2e + spot-check du code mergé). Garde-fous = agent + lint + tests, pas la review. _Réserve à rouvrir un jour : une fois Buns & Bao live avec de la vraie data, on pourra réintroduire un gate humain **uniquement** sur les PR `needs-schema-review` (migrations sur prod), via branch protection si on passe le repo en Pro._

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
│   /work-all-agent-issues = ORCHESTRATEUR (n'écrit aucun code)        │
│         ↓                                                            │
│   Loop :                                                             │
│   1. gh issue list → prochaine story éligible (deps closed)          │
│   2. SPAWN sous-agent frais (Agent) → run work-next-agent-issue      │
│        · le sous-agent (contexte isolé) : TDD → check → PR →         │
│          attend CI → squash-merge sur vert  (ou blocked)             │
│   3. récupère 1 LIGNE de résultat (contexte orchestrateur léger)     │
│   4. reboucle séquentiel jusqu'à backlog vide → bilan                │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────┐
│         PHASE 3 — QUALITÉ + E2E (ASYNCHRONE, PAS UN GATE)            │
│               (Alex, quand il veut — déjà mergé)                     │
│                                                                      │
│   Stories vertes : DÉJÀ mergées sur main par l'agent (CI verte)      │
│         ↓                                                            │
│   - Tests end-to-end des parcours critiques sur le dev deployment    │
│   - Spot-check qualité du code mergé (échantillon)                   │
│   - Souci → issue de correction (/triage) ou git revert du merge     │
│   - gh issue list --label blocked → /diagnose                        │
│         ↓                                                            │
│   /triage sur needs-triage / needs-info                              │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
                          Retour Phase 1 le lendemain
```

---

## 2. Skills utilisés et leurs paths

Tous installés sur `C:\Users\alexp\.claude\skills\` (workflow Matt Pocock + customs).

### Skills Matt Pocock (déjà installés)

| Skill                            | Path                                                           | Quand l'utiliser                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/setup-matt-pocock-skills`      | `C:\Users\alexp\.claude\skills\setup-matt-pocock-skills\`      | **Une seule fois** au début du projet pour mapper les labels GitHub aux états canoniques (`ready-for-agent`, `needs-triage`, etc.) |
| `/grill-with-docs`               | `C:\Users\alexp\.claude\skills\grill-with-docs\`               | Avant `/to-prd` : interview rapide pour résoudre les open questions du PRD source                                                  |
| `/grill-me`                      | `C:\Users\alexp\.claude\skills\grill-me\`                      | Variante : grilling sans focus docs (sessions exploratoires)                                                                       |
| `/to-prd`                        | `C:\Users\alexp\.claude\skills\to-prd\`                        | Produit le PRD agent-ready et le publie comme issue parent GitHub                                                                  |
| `/to-issues`                     | `C:\Users\alexp\.claude\skills\to-issues\`                     | Éclate le PRD en tracer bullets verticaux AFK/HITL                                                                                 |
| `/triage`                        | `C:\Users\alexp\.claude\skills\triage\`                        | Gérer issues : `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`                                                    |
| `/tdd`                           | `C:\Users\alexp\.claude\skills\tdd\`                           | Guide pour respecter TDD (à invoquer si Claude code dérive)                                                                        |
| `/improve-codebase-architecture` | `C:\Users\alexp\.claude\skills\improve-codebase-architecture\` | Refactor en deep modules avec API publique isolée                                                                                  |
| `/prototype`                     | `C:\Users\alexp\.claude\skills\prototype\`                     | Pour les POCs sprint 0 (les 5 du STACK.md §7)                                                                                      |
| `/diagnose`                      | `C:\Users\alexp\.claude\skills\diagnose\`                      | Quand un agent est `blocked`, debug pourquoi                                                                                       |
| `/zoom-out`                      | `C:\Users\alexp\.claude\skills\zoom-out\`                      | Si on perd la vue d'ensemble en plein chantier                                                                                     |
| `/handoff`                       | `C:\Users\alexp\.claude\skills\handoff\`                       | Si on change de session Claude Code en cours de chantier                                                                           |

### Skills custom à créer (1 seule fois, avant de pouvoir tourner AFK)

| Skill                    | Path à créer                                                   | Effort | Rôle                                       |
| ------------------------ | -------------------------------------------------------------- | ------ | ------------------------------------------ |
| `/work-next-agent-issue` | `C:\Users\alexp\.claude\skills\work-next-agent-issue\SKILL.md` | M      | Pick next AFK issue + TDD + PR             |
| `/work-all-agent-issues` | `C:\Users\alexp\.claude\skills\work-all-agent-issues\SKILL.md` | S      | Loop sur le précédent via `ScheduleWakeup` |

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

Convertir N issues `ready-for-agent` AFK en N stories **mergées sur `main`** (auto-merge sur CI verte), sans intervention humaine — en gardant le contexte de l'orchestrateur léger via des **sous-agents**.

### Lancement

Le soir avant de te coucher, dans une session Claude Code locale :

```
/work-all-agent-issues
```

**Architecture orchestrateur + sous-agents** (pour le context management — sinon le contexte sature dès la 2ᵉ story) :

`/work-all-agent-issues` est un **orchestrateur** qui n'écrit **aucun code**. Sa boucle :

1. Check léger d'éligibilité : `gh issue list --label ready-for-agent` → calcule la prochaine story éligible (deps closed). Aucune → stop + bilan.
2. **Spawn un sous-agent frais** (outil Agent, `general-purpose`) qui exécute le skill `work-next-agent-issue` pour **cette seule** story, dans **son propre contexte**.
3. Récupère **uniquement la ligne de résultat** du sous-agent (`merged #m` / `blocked`) — jamais son transcript. Contexte orchestrateur reste léger.
4. Reboucle (séquentiel — un sous-agent à la fois, ils partagent le checkout git). Parallélisation future = `isolation: "worktree"`.

Chaque **sous-agent** (`work-next-agent-issue`) fait, dans son contexte isolé :

1. Pick/valide la story éligible → label `in-progress`, branche `agent/<n>`
2. Lit l'issue + PRD + CONTEXT + ADRs référencés
3. **TDD strict** : `test(<id>):` (rouge) → `feat(<id>):` → `refactor(<id>):`
4. `pnpm typecheck && pnpm lint && pnpm test`
5. Si vert : push → `gh pr create` → **attend la CI** (`gh pr checks <pr> --watch`) → **CI verte → `gh pr merge <pr> --squash --delete-branch`** → `git switch main && git pull --ff-only`
6. Si CI/local rouge après 2 fix, ou spec manquante : push WIP, **pas de merge**, label `blocked` + commentaire (lu par `/diagnose`)
7. Répond **une seule ligne** de résultat à l'orchestrateur

### Garde-fous appliqués automatiquement

- **TDD ordre commit** : forcé par le skill (test commit avant feat commit)
- **`withTenant` obligatoire** : ESLint custom rule fait planter le lint
- **Coverage ≥ 80%** : Vitest config bloque sinon
- **Multi-tenant fuzz test** : Vitest suite obligatoire pour chaque module touchant `tenant_id`
- **Schema Convex** : si l'agent modifie `schema.ts`, il le **mentionne dans le corps de la PR** (pour le spot-check qualité d'Alex à froid). Pas de gate bloquant en V1 pré-launch (pas de data prod). _Réintroduire `needs-schema-review` comme gate humain seulement une fois Buns & Bao live._
- **Pas de secrets** : pre-commit hook git-secrets (`AKIA*`, `sk_live_*`, etc.)

### Cible de productivité

**5-10 issues par nuit** (selon complexité) sur ton PC allumé.

---

## 5. Phase 3 — Contrôle qualité + e2e (toi, asynchrone, pas un gate)

### Workflow

Les stories vertes ont **déjà été mergées par l'agent pendant la nuit** (CI verte). Cette phase n'est donc **pas un gate de merge** — c'est un contrôle qualité + e2e à froid, asynchrone, quand Alex veut.

```
1. Voir ce qui a été mergé cette nuit :
   gh pr list --state merged --search "merged:>=YESTERDAY" --json number,title
2. Tests end-to-end : lancer l'app sur le preview/dev deployment et valider les
   parcours critiques (commande, paiement sandbox, KB Orders, etc.).
3. Spot-check qualité du code mergé (optionnel, échantillon) :
   - L'ordre TDD est respecté dans les commits ?
   - withTenant + fuzz cross-tenant présents sur les modules tenant ?
   - Modules deep avec API publique (index.ts) propre ?
   - Aucun secret, aucun `ctx.db.query` raw hors helpers ?
   Si un problème : ouvrir une issue de correction (`/triage`) ou `git revert` le squash-merge fautif.
4. Traiter les blocages de la nuit :
   gh issue list --label blocked
   /diagnose sur chacune → fix + repasse `ready-for-agent`, ou `needs-triage`.
5. /triage sur tout ce qui est `needs-triage` ou `needs-info`.
```

> Pas de label `needs-review` ni `needs-rework` dans le flux nominal : il n'y a plus de PR en attente d'approbation. Ils restent disponibles si Alex veut ponctuellement remettre une story sous revue manuelle.

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
in-progress → [closed via auto-merge sur CI verte] | blocked (CI rouge / échec / décision manquante)
blocked → ready-for-agent (après fix /diagnose) | needs-triage
# needs-review / needs-rework : hors flux nominal (auto-merge). Conservés pour mise sous revue manuelle ponctuelle.
```

---

## 7. Source de vérité — où vit quoi

| Artifact                      | Où                                        | Format     | Mutable                     |
| ----------------------------- | ----------------------------------------- | ---------- | --------------------------- |
| Vision produit                | `docs/prd/00_master.md`                   | Markdown   | Oui, versionné              |
| PRDs produit par contexte     | `docs/prd/N_*.md` (10 fichiers)           | Markdown   | Oui, versionné              |
| Bounded contexts (glossaires) | `docs/contexts/<context>/CONTEXT.md`      | Markdown   | Oui, versionné              |
| Décisions architecture        | `docs/adr/NNNN-*.md`                      | Markdown   | Immutable (sauf superseded) |
| Stack technique               | `docs/contexts/_architecture/STACK.md`    | Markdown   | Oui, versionné              |
| Workflow (ce doc)             | `docs/contexts/_architecture/WORKFLOW.md` | Markdown   | Oui, versionné              |
| **PRDs agent-ready (epics)**  | **Issues GitHub**                         | Issue body | Closed quand done           |
| **Tracer bullets (stories)**  | **Issues GitHub**                         | Issue body | Closed quand done           |
| Code dev                      | Branches `agent/<issue-number>`           | Git        | Mergées sur main            |
| Code prod                     | Branche `main`                            | Git        | Protégée                    |

**Règle d'or** : tout ce qui est **vision / décision / contexte** vit dans le repo (markdown versionné). Tout ce qui est **work in progress** vit dans GitHub Issues.

---

## 8. Setup prérequis (1 journée, à faire une fois)

| #   | Étape                                        | Effort | Comment                                                                                                         |
| --- | -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | Push `kitchen-boost-repo` sur GitHub (privé) | S      | `git remote add origin git@github.com:nativesquare/kitchen-boost.git && git push -u origin main`                |
| 2   | Configurer labels GitHub                     | S      | Via `gh label create` ou UI : tous les labels du §6                                                             |
| 3   | `/setup-matt-pocock-skills`                  | S      | Configure le mapping labels canoniques ↔ labels réels                                                           |
| 4   | Branch protection sur `main`                 | S      | UI GitHub : PR review obligatoire, status checks `typecheck/lint/test`                                          |
| 5   | GitHub Actions CI gratuit                    | M      | `.github/workflows/check.yml` : `pnpm typecheck && pnpm lint && pnpm test` sur PR (ne tape PAS l'API Anthropic) |
| 6   | ESLint custom rule `no-untenanted-query`     | M      | Dans `packages/eslint-config-kitchenboost/`                                                                     |
| 7   | Husky + lint-staged                          | S      | Pre-commit hooks locaux (typecheck + lint files staged)                                                         |
| 8   | Convex test harness                          | S      | `pnpm add -D convex-test` dans `packages/backend`                                                               |
| 9   | Skill `/work-next-agent-issue`               | M      | Via `/write-a-skill`                                                                                            |
| 10  | Skill `/work-all-agent-issues`               | S      | Wrapper loop du précédent                                                                                       |
| 11  | Template issue GitHub                        | S      | `.github/ISSUE_TEMPLATE/`                                                                                       |
| 12  | Template PR GitHub                           | S      | `.github/pull_request_template.md` avec checklist agent                                                         |

**Note importante** : GitHub Actions CI **ne coûte rien** (tier gratuit 2000 min/mois) **et n'utilise pas l'API Anthropic** — c'est juste du Node/pnpm/Convex CLI. La règle "pas de coût Anthropic" est respectée.

---

## 9. Coûts du workflow

| Composant                                 | Coût                                           |
| ----------------------------------------- | ---------------------------------------------- |
| Claude Code (sessions actives + nuit AFK) | **Abonnement Pro/Max existant** — 0 € marginal |
| GitHub privé                              | Gratuit (compte perso)                         |
| GitHub Actions CI                         | Gratuit (2000 min/mois)                        |
| Convex preview deployments                | Gratuit (dev tier)                             |
| Anthropic API direct                      | **0 €** (jamais utilisée)                      |
| Cloud cost agent runner                   | **0 €** (PC perso, allumé la nuit)             |
| **Total marginal V1**                     | **0 €** au-delà de l'existant                  |

---

## 10. Estimation V1 récapitulative

| Phase                                       | Durée Alex                               | Durée agent nuit      | Output                              |
| ------------------------------------------- | ---------------------------------------- | --------------------- | ----------------------------------- |
| Setup workflow (ce doc + skills custom)     | 1 jour                                   | —                     | infrastructure ready                |
| Phase 0 — POCs (5 spikes)                   | 2-3 jours                                | —                     | 5 commits verdict                   |
| Phase 1 — Foundation backend (1 PRD groupé) | 2h session + 2h review                   | 2-3 nuits             | foundation backend mergée           |
| Phase 2 — Backend contexts (9 PRDs)         | 4-6 sessions (8-12h) + reviews           | 2 semaines de nuits   | 9 contexts backend mergés           |
| Phase 3 — Apps front (~26 PRDs)             | 10-15 sessions (20-30h) + reviews        | 3-4 semaines de nuits | 3 apps frontend mergées             |
| Phase 4 — Polish + soft-launch              | 1 semaine active                         | —                     | Buns & Bao live                     |
| **Total Alex**                              | **~50-60h actives sur 9 semaines**       | —                     | V1 production                       |
| **Total wall-clock**                        | **9 semaines** (mi-juin → fin août 2026) |                       | cible PRD master `2026-09-30` tenue |

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

| Date       | Version | Notes                             |
| ---------- | ------- | --------------------------------- |
| 2026-05-25 | 1.0     | Création, à tester sur chantier 1 |
