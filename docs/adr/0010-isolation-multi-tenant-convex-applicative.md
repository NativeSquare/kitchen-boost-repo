---
status: accepted
date: 2026-05-25
deciders: Alex
---

# Isolation multi-tenant Convex applicative (sans RLS)

## Contexte

Le [PRD 50](../prd/50_multi_tenant_saas.md) (rédigé v0.3, 2026-05-23) supposait Postgres/Supabase avec **RLS comme 4ᵉ couche de défense** de l'isolation tenant. Le [STACK.md](../contexts/_architecture/STACK.md) v1.0 (2026-05-25) a acté **Convex** comme source de vérité unique, hérité du template NativeSquare. Convex **n'a pas de RLS** ni d'équivalent : pas de filtre automatique au niveau base selon un `tenant_id` de session.

## Décision

L'isolation multi-tenant est **100 % applicative**. Pas de RLS, pas de Postgres. Toute query/mutation métier passe par des helpers Convex obligatoires — `tenantQuery` / `tenantMutation` (+ `kbAdminQuery` pour le rôle root) — qui reçoivent le `tenantId` et **throw si le user n'y a pas accès** (résolu via [[user_tenants]] ; `kb_admin` = accès illimité). 3 couches de défense remplacent les 4 du PRD 50 :

1. **Helpers typés obligatoires** (`withTenant`)
2. **Règle ESLint `no-untenanted-query`** interdisant `ctx.db.query()` brut hors des helpers
3. **Suite Vitest fuzz cross-tenant** rejouant chaque mutation exportée avec un `tenantId` non autorisé et exigeant un throw

Les open questions `50-Q1` (Postgres self-hosted vs Supabase) et `50-Q2` (RLS vs applicatif) sont **closes** par cette décision.

## Considered options

1. **Convex + isolation applicative (retenu)** — source de vérité unique, zéro infra DB à opérer, temps réel natif ; perte du filet RLS au niveau base.
2. **Convex + Postgres miroir avec RLS** — garder un filet DB, mais double source de vérité + synchro + complexité disproportionnée pour 1-10 tenants. YAGNI.
3. **Rester sur Postgres/Supabase + RLS (plan PRD 50 d'origine)** — filet DB natif, mais contredit le choix stack template, perd le temps réel Convex, ré-introduit une infra à opérer.

## Pourquoi ce choix

- Le template NativeSquare est **Convex/Convex Auth** — repartir sur Postgres = refonte complète, interdite par la règle « ne pas toucher la structure du template ».
- À l'échelle V1 (1-10 tenants), le risque de fuite cross-tenant se gère par discipline applicative + tests, sans le coût d'une seconde base.
- Convex apporte le temps réel + une seule source de vérité, ce qui sert directement le produit (suivi commande live, push [[KB Orders]]).
- Les 3 couches (helpers + lint + fuzz) sont **auditables et bloquent le merge en CI** — ça compense l'absence de RLS de façon vérifiable, pas seulement déclarative.

## Conséquences

- Le **chantier 1.x Foundation doit livrer** les helpers `tenantQuery`/`tenantMutation`/`kbAdminQuery` + la suite fuzz **avant tout code métier**.
- La règle ESLint `no-untenanted-query` est un garde-fou de merge ; elle ne peut être écrite qu'**une fois les helpers définis** (d'où la dépendance setup AFK → 1.x).
- Le code template existant (`users.ts`, `admin.ts`) fait du `ctx.db.query` brut et expose des mutations CRUD non gardées via `generateFunctions` : **à mettre en conformité ou exempter explicitement** (traité dans le grill 1.x, décisions C/D).
- Toute fuite cross-tenant en prod = bug applicatif **sans filet base** → les tests fuzz sont non négociables (couverture de chaque mutation exportée).
- Pas de `password_hash` maison : Convex Auth possède les credentials.

## Hard to reverse pourquoi

Tout le code métier (9 backends + 3 fronts) est bâti sur la signature des helpers `withTenant`. Changer de modèle d'isolation après coup = réécrire chaque query/mutation. À l'inverse, ré-introduire un filet RLS supposerait migrer vers Postgres = changer de base = refonte totale. La décision conditionne le schema, les helpers, les tests et la règle ESLint — c'est le socle du chantier 1.x.
