# Foundation 1.x — Plan de tests end-to-end (validations manuelles)

> **Statut** : 🟡 à jouer · **Créé** : 2026-05-25 · **Owner** : Alex
> **Portée** : valider en conditions **runtime réelles** ce que les tests CI (Vitest + `convex-test`, en Node) ne peuvent pas prouver, après le merge complet de la Foundation 1.x (epic #1, PRs #9–#15).
> **Réf mémoire** : `~/.claude/projects/.../memory/foundation-1x-pending-manual-validations.md`

---

## 0. Pourquoi ce document

La CI exécute les tests dans **Vitest/Node** via `convex-test`, avec une identité **mockée** et une clé crypto jetable. Trois choses ne sont donc **pas** prouvées par le vert CI :

1. que `crypto.subtle` AES-256-GCM tourne réellement dans le **runtime Convex V8 déployé** (vs nécessiter un fallback action `"use node"`) — dépendance POC flaggée dans [PRD 50](../docs/prd/50_multi_tenant_saas.md) § Further Notes ;
2. que la **vraie** chaîne Convex Auth → `getCurrentActor` renvoie l'acteur attendu pour chaque rôle, contre une vraie session ;
3. que la variable d'env **`KMS_MASTER_KEY`** est provisionnée sur le déploiement (sans elle, tout chiffrement/déchiffrement échoue en prod/dev).

À jouer **avant** que tout chantier 2.x s'appuie sur les secrets per-tenant ou l'auth live.

## 1. Couverture CI vs validations manuelles

| Comportement                         | Couvert par CI (unit/`convex-test`)                     | À valider ici (runtime réel)     |
| ------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| Round-trip + tamper crypto (logique) | ✅ `lib/crypto/envelope.test.ts`                        | ⬜ **runtime Convex V8** (T2/T3) |
| `KMS_MASTER_KEY` présent             | ❌ (clé de test injectée)                               | ⬜ **T1**                        |
| `getCurrentActor` — résolution rôle  | ✅ `lib/auth/getCurrentActor.test.ts` (identité mockée) | ⬜ **session réelle** (T4/T5)    |
| Isolation cross-tenant (fuzz)        | ✅ `lib/tenancy/fuzz.ts` rejoué en CI                   | ⬜ sonde manuelle (T6)           |
| MOAT / secret jamais en query        | ✅ (structure)                                          | ⬜ confirmation manuelle (T7)    |
| Audit hybride                        | ✅ `lib/tenancy/audit.test.ts`                          | ⬜ runtime réel (T8)             |
| Webhook idempotence                  | ✅ `lib/webhooks/idempotent.test.ts`                    | ⬜ optionnel (T9)                |

## 2. Comment exécuter une fonction Convex à la main

Deux voies. Le déploiement dev est déjà provisionné (`CONVEX_DEPLOYMENT` dans `packages/backend/.env.local`), `npx convex dev` doit tourner (cwd `packages/backend`).

- **Dashboard Convex** → onglet _Functions_ : choisir la fonction par son chemin (ex. `lib/crypto/credentials:getDecryptedTenantCredential`), saisir les args JSON, _Run_. Onglet _Data_ pour éditer/lire les tables (seed manuel).
- **CLI** : `npx convex run lib/auth/getCurrentActor:whoAmI '{}'` (query/mutation/action). Sortie JSON.

> ⚠️ **Caveat identité.** `npx convex run` et le dashboard exécutent **sans session Convex Auth** → `getAuthUserId` renvoie `null`, donc `getCurrentActor` voit un acteur **non authentifié** (cas « customer anonyme / pas de user »). C'est parfait pour T4-cas-anonyme, mais pour tester `kb_admin` / `kb_manager` / `staff` il faut une **vraie session authentifiée** : soit via un front une fois qu'il existe (Phase 3), soit via une sonde temporaire `internalAction`/`internalMutation` qui appelle le helper avec un `userId` seedé. Les cases concernées sont marquées **[session requise]**.

## 3. Pré-requis & seed

Avant T2-T8, créer des données via l'onglet _Data_ du dashboard (ou un `internalMutation` jetable) :

- [ ] **Tenant A** (`tenants`) : `slug="test-a"`, `name`, `status="active"`, `createdAt`.
- [ ] **Tenant B** (`tenants`) : `slug="test-b"`, `status="active"` — pour les tests cross-tenant.
- [ ] **User kb_admin** (`users`) : `role="kb_admin"`.
- [ ] **User kb_manager** (`users`) : `role` non-`kb_admin` + ligne `userTenants` `{userId, tenantId: A, role:"kb_manager", attachedAt, detachedAt: null}`.
- [ ] **User staff** : ligne `userTenants` `{…, role:"staff"}` sur A.
- [ ] **User customer** (`users`) : `role="customer"`.
- [ ] Noter les `_id` de chaque ligne (servent d'args).

---

## 4. Tests

### T1 — 🔴 P0 · `KMS_MASTER_KEY` provisionné sur le déploiement

- **Objectif** : la clé maître 32 octets est bien dans l'env Convex (sans elle, T2/T3 et toute la prod crypto échouent).
- **Étapes** : Dashboard Convex → _Settings_ → _Environment Variables_ → vérifier la présence de `KMS_MASTER_KEY`. Sinon, générer une clé 32 octets (`openssl rand -base64 32`) et l'ajouter. **Ne jamais committer la clé.**
- **Attendu** : `KMS_MASTER_KEY` présent, longueur cohérente avec ce qu'attend `lib/crypto/envelope.ts`.
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T2 — 🔴 P0 · Round-trip crypto sur le runtime Convex réel **[session requise]**

- **Objectif** : prouver que `crypto.subtle` AES-256-GCM (`encryptForTenant`/`decryptForTenant`) tourne dans le runtime V8 déployé — **décide si le fallback `"use node"` est nécessaire**.
- **Pré-conditions** : T1 OK ; session authentifiée `kb_manager` du Tenant A (ou `kb_admin`).
- **Étapes** :
  1. Appeler la mutation gardée `lib/crypto/credentials:storeTenantCredential` avec args `{ "tenantId": "<A>", "provider": "uber_direct", "plaintext": "secret-test-123" }`.
  2. Appeler l'action `lib/crypto/credentials:getDecryptedTenantCredential` avec `{ "tenantId": "<A>", "provider": "uber_direct" }`.
- **Attendu** : l'action renvoie exactement `"secret-test-123"`. La table `tenantCredentials` contient un blob (`iv`, `authTag`, `ciphertext`, `keyVersion`) — **jamais** le clair. Aucune erreur du type « crypto.subtle is not defined ».
- **Si échec runtime** (crypto.subtle indisponible en V8) : ouvrir une issue de refactor `lib/crypto` vers une action `"use node"`, l'acter en ADR. C'est LE résultat décisif de ce plan.
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T3 — 🔴 P0 · Tamper rejeté sur le runtime réel **[session requise]**

- **Objectif** : un ciphertext altéré échoue au déchiffrement (authTag GCM) sur le vrai runtime.
- **Étapes** : après T2, dans _Data_, modifier d'un caractère le champ `ciphertext` (ou `authTag`) de la ligne `tenantCredentials`. Rejouer `getDecryptedTenantCredential` (mêmes args).
- **Attendu** : l'action **throw** (échec d'authentification GCM), ne renvoie jamais un clair corrompu.
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T4 — 🟡 P1 · `getCurrentActor` / `whoAmI` — identité normalisée par acteur

- **Objectif** : la vraie chaîne Convex Auth → `getCurrentActor` renvoie l'acteur + le **rôle effectif** attendu.
- **Fonction** : `lib/auth/getCurrentActor:whoAmI`, args `{ "tenantId": "<A>" }` (ou `{}`).
- **Cas** :
  - ⬜ **Anonyme / pas de user** (via `npx convex run`, sans session) → acteur non authentifié, `isAnonymous`/pas de rôle resto. _(jouable sans session)_
  - ⬜ **customer** **[session requise]** → `role: "customer"`, pas de rôle effectif resto.
  - ⬜ **kb_admin** **[session requise]** → `role: "kb_admin"`, accès à tout tenant **sans** ligne `userTenants`.
  - ⬜ **kb_manager A** **[session requise]** + `tenantId=A` → rôle effectif `kb_manager` ; avec `tenantId=B` → **aucun** rôle effectif.
  - ⬜ **staff A** **[session requise]** + `tenantId=A` → rôle effectif `staff`.
- **Attendu** : chaque cas renvoie l'identité décrite (cf. critères de l'issue #3).
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T5 — 🟡 P1 · Révocation d'accès (`detachedAt`) → Forbidden **[session requise]**

- **Objectif** : un attachement détaché ne donne plus de rôle effectif (révocation immédiate, pas de cache de droits).
- **Étapes** : sur la ligne `userTenants` du kb_manager A, renseigner `detachedAt = Date.now()`. Rejouer `whoAmI` avec `tenantId=A`, puis tenter `getDecryptedTenantCredential` `{tenantId:A,…}`.
- **Attendu** : `whoAmI` ne renvoie plus le rôle effectif sur A ; l'appel gardé **throw Forbidden**.
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T6 — 🟡 P1 · Isolation cross-tenant (sonde manuelle) **[session requise]**

- **Objectif** : confirmer en runtime ce que le harness fuzz teste en CI — un `kb_manager` du Tenant A ne lit pas les données du Tenant B.
- **Étapes** : authentifié `kb_manager A`, appeler `lib/crypto/credentials:getTenantCredentialBlob` avec `{ "tenantId": "<B>", "provider": "uber_direct" }`.
- **Attendu** : **throw Forbidden** (pas de blob renvoyé). 0 fuite.
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T7 — 🟡 P1 · MOAT — le secret en clair ne transite par aucune query exposée

- **Objectif** : vérifier qu'**aucune** query exposée ne renvoie de clair (seule l'action déchiffre).
- **Étapes** : revue rapide — confirmer que `getTenantCredentialBlob` (query) renvoie uniquement l'enveloppe (`iv`/`authTag`/`ciphertext`/`keyVersion`) et que seul `getDecryptedTenantCredential` (action) produit le clair. Vérifier qu'aucune autre query exposée ne retourne d'objet `customer` brut au rôle `kb_manager`.
- **Attendu** : aucune query ne renvoie de plaintext ni de PII customer individuelle (KPI agrégés only côté kb_manager).
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T8 — 🟢 P2 · Audit hybride **[session requise]**

- **Objectif** : politique d'audit hybride réelle (issue #8).
- **Étapes** :
  1. Exécuter une `kbAdminMutation` quelconque (ex. via une sonde) authentifié `kb_admin` → vérifier dans _Data_ qu'une ligne `auditLog` apparaît (actor, action, `tenantId?`, timestamp).
  2. Exécuter `storeTenantCredential` (un `tenantMutation()` **non** taggé `audit:true`) → vérifier qu'**aucune** ligne `auditLog` n'est créée.
- **Attendu** : auto-log pour le root ; pas de log pour le `tenantMutation` non taggé. `logAudit` reste appelable explicitement.
- ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

### T9 — 🟢 P2 · Webhook idempotence (optionnel — CI couvre la logique)

- **Objectif** : sanity-check runtime de `withIdempotence` (anti-doublon `(provider, eventId)`).
- **Note** : pas de webhook réel branché en 1.x (helper appelé depuis les `httpAction` des chantiers 2.5/2.6). À rejouer en e2e quand le premier webhook (Stripe/Uber Direct) existe : envoyer 2× le même `eventId` → 1 seul effet ; 2 `eventId` distincts → 2 effets.
- ⬜ N/A en 1.x / ⬜ Pass / ⬜ Fail — Notes : ********\_\_\_\_********

---

## 5. Résultats de session

| Test                         | Priorité | Résultat   | Date | Notes                            |
| ---------------------------- | -------- | ---------- | ---- | -------------------------------- |
| T1 KMS_MASTER_KEY            | 🔴 P0    | ⬜         |      |                                  |
| T2 crypto round-trip runtime | 🔴 P0    | ⬜         |      | **décide fallback `"use node"`** |
| T3 tamper rejeté             | 🔴 P0    | ⬜         |      |                                  |
| T4 whoAmI 4 acteurs          | 🟡 P1    | ⬜         |      |                                  |
| T5 detachedAt → Forbidden    | 🟡 P1    | ⬜         |      |                                  |
| T6 cross-tenant Forbidden    | 🟡 P1    | ⬜         |      |                                  |
| T7 MOAT secret/PII           | 🟡 P1    | ⬜         |      |                                  |
| T8 audit hybride             | 🟢 P2    | ⬜         |      |                                  |
| T9 webhook idempotence       | 🟢 P2    | ⬜ N/A 1.x |      |                                  |

## 6. Ce qui automatisera tout ça

Ces validations manuelles sont **transitoires**. Elles seront remplacées/complétées par la **suite e2e Playwright** prévue en Phase 4 (cf. [roadmap.md](../docs/prd/roadmap.md) DOD V1 : « Tests automatisés chemin critique end-to-end » + « Tests cross-tenant fuite (audit manuel + automatisé) »). Le harness fuzz `lib/tenancy/fuzz.ts` (`runCrossTenantFuzz`, `seedTwoTenantsAllRoles`) reste, lui, branché en CI et grandit à chaque chantier 2.x qui enregistre de nouvelles fonctions.
