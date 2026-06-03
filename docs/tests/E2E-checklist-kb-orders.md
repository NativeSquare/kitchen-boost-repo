# E2E manual checklist — KitchenBoost KB Orders native (V1)

Checklist E2E manuelle pour l'app tablette `apps/native` (KB Orders), équivalent Uber Eats Orders côté restaurateur. Format identique à `E2E-checklist.md` (KB Admin web). Chaque parcours est exécuté à la main contre `apps/native` en dev build (Convex live + push APNs/FCM + simulator Star WebPRNT optionnel).

- **Date d'ouverture** : 2026-06-03
- **PRD source** : `docs/prd/20_kb_orders.md` v1.4 (référence canonique produit)
- **Périmètre** : 26 issues `ready-for-agent` (#393–#418), publiées le 2026-06-03 via `/to-issues`
- **Statut global** : **0/26 stories mergées** — doc ouvert en attente du premier merge AFK
- **Validation** : humaine (manuelle), pas de Maestro/Detox V1
- **Convention** : format strict **Acteur / Pré-requis / Étapes / Attendu / Couvre**, nomenclature `KBO-<GROUPE><N>`

---

## Contrat de curation (pourquoi ce doc existe)

Chaque agent qui ferme une story KB Orders propose 1-3 tests E2E dans sa PR (rappel issue body). Ce doc **n'enregistre pas tous les E2E proposés** : il ne consigne que ceux qui passent les critères ci-dessous.

### À garder (mérite la checklist manuelle)

1. **Cross-layer réel** — touche au moins 2 frontières (UI + Convex sub + side effect type push, print, timeout serveur, force update gate). Une mutation Convex isolée + un assert UI ne suffit pas.
2. **Comportement non lisible dans le code** — race conditions, coupure réseau, timeout `scheduler.runAfter` 5 min, kiosque pinned vs switcher, escalation push T+60s, état Convex sub broken, force update au boot. Le parcours révèle quelque chose qu'on ne verrait pas en relisant le diff.
3. **Régression à impact business direct** — cmd perdue silencieusement, paiement raté, ancienne build qui ne se met pas à jour malgré faille sécurité, fuite cross-tenant, imprimante kitchen muette.
4. **Parcours utilisateur visible** — Khan en cuisine fait X, voit Y. Pas un test de fonction interne déguisé.

### À rejeter ou fusionner

1. **Déjà couvert par TDD/unit** — validation Zod, pure reducer, hook isolé, formatage. Si la régression est détectable par un test unitaire, pas la peine d'un E2E manuel.
2. **"Click sur bouton, mutation s'appelle"** — les types Convex garantissent ça. Inutile en E2E manuel.
3. **Happy path déjà englobé** — un test de refus n'a pas besoin de re-tester "accepter une cmd" si TB-5 le couvre. Démarrer le parcours à l'état désiré.
4. **Screenshot/render check** — code review ou snapshot tests, pas E2E manuel.
5. **Duplication cross-slice** — si plusieurs slices testent le même flux, fusionner en un seul parcours `KBO-<X>` qui liste tous les # GitHub couverts.

### Process

Au moment du merge de chaque PR :

1. Lire le bloc E2E proposé par l'agent dans la PR.
2. Passer chaque test au filtre.
3. Pour les tests gardés → ajouter une entrée au format strict dans le groupe correspondant, incrémenter le compteur du groupe en header.
4. Pour les tests rejetés ou fusionnés → noter brièvement la raison en commentaire dans la PR (audit trail).
5. Les tests rejetés **ne sont pas supprimés du code de la PR** — l'agent les garde comme tests automatisés, seul ce doc tranche ce qui mérite revérification humaine.

---

## Pré-requis transverses

- **App** : `apps/native` en **dev build EAS** installé sur tablette physique ou simulator (iOS Simulator + Android Emulator OK pour la plupart des parcours ; push réel nécessite device physique pour iOS APNs).
- **Backend** : Convex live dev (`pnpm dev --filter=@packages/backend`), seeds e2e chargées.
- **Comptes seed** : au minimum `manager@kb.test` (mono-tenant T1), `manager-multi@kb.test` (T1+T2), `admin@kb.test` (root). Réutiliser les comptes seed admin existants (`packages/backend/convex/e2e.ts`).
- **Tenants seed** : T1 actif avec ≥1 commande payée, T2 isolé pour cross-tenant fuzz.
- **Stripe Connect** : mode test, `stripeAccountId` rattaché à T1 avec `stripeStatus="ready"`. Pour valider les états downstream sans monter le sandbox réel → patch manuel de la donnée (mémoire [[e2e-scope-what-we-control]]).
- **Push** : projet Expo configuré `eas push:setup`, device enrôlé via `expo-notifications` (token persisté côté Convex `pushTokens`).
- **Star WebPRNT** : optionnel pour V1 — utiliser le [simulator officiel Star Micronics](https://www.starmicronics.com/support/SDKDocumentation.aspx?type=Tools) sur la même LAN que le device. Le simulator s'enregistre comme une imprimante WebPRNT accessible en HTTP.
- **Force update** : pour tester le gate, deux leviers serveur — bumper `expo.extra.criticalIndex` dans `app.config.ts` (couche OTA), ou bumper `minSupportedBuildVersion` via mutation Convex sur table tenant config (couche native).
- **Mode déconnecté** : pour simuler la coupure Convex sub → DevTools Network throttling « Offline » côté simulator, ou couper la connexion réseau du device.
- **Convention identifiants parcours** : `KBO-<GROUPE><N>` (ex. `KBO-A1`, `KBO-CMD2`). N redémarre à 1 par groupe.

---

## KBO-A — Auth tablette + kiosque

> **Statut** : 🟡 0/? validés — issues couvertes #393 (TB-1 kiosque toggle), #398 (TB-2 onboarding séquence), #399 (TB-16 switcher tenant), #400 (TB-22 révocation session côté app).

_(parcours ajoutés au fil des merges)_

---

## KBO-FU — Force update + mode déconnecté

> **Statut** : 🟡 0/? validés — issues couvertes #394 (TB-3 force update gate Expo 2 couches), #405 (TB-11 mode déconnecté écran rouge), #411 (TB-19 alertes statut tenant).

_(parcours ajoutés au fil des merges)_

---

## KBO-N — Notifications + permissions

> **Statut** : 🟡 0/? validés — issues couvertes #395 (TB-4 push permission detection + banner), #414 (TB-10 escalation push T+60s).

_(parcours ajoutés au fil des merges)_

---

## KBO-CMD — Commandes happy path

> **Statut** : 🟡 0/? validés — issues couvertes #401 (TB-5 happy path direct livraison E2E), #402 (TB-6 happy path click & collect).

_(parcours ajoutés au fil des merges)_

---

## KBO-RJ — Refus + auto-expired

> **Statut** : 🟡 0/? validés — issues couvertes #403 (TB-7 refus depuis nouvelle 2-step), #413 (TB-8 refus en prep/prête 3-step), #404 (TB-9 auto-expired timeout 5 min).

_(parcours ajoutés au fil des merges)_

---

## KBO-DIS — Disponibilité commerciale

> **Statut** : 🟡 0/? validés — issues couvertes #406 (TB-12 pause exceptionnelle), #407 (TB-13 fermeture exceptionnelle), #408 (TB-14 toggle dispo item), #409 (TB-15 modif horaires d'ouverture).

_(parcours ajoutés au fil des merges)_

---

## KBO-OPS — Ops & maintenance

> **Statut** : 🟡 0/? validés — issues couvertes #410 (TB-18 stats rapides V1), #412 (TB-20 impression Star WebPRNT), #417 (TB-17 historique cmds + onglet manquées), #418 (TB-21 page settings complète).

_(parcours ajoutés au fil des merges)_

---

## KBO-AD — KB Admin cross-cutting (KB Orders side effects)

> **Statut** : 🟡 0/? validés — issues couvertes #396 (TB-A1 sessions actives + revoke), #397 (TB-A3 toggles disponibilité commerciale), #415 (TB-A2 histo + alerte ops), #416 (TB-A4 config printer).

_(parcours ajoutés au fil des merges. Note : ces 4 issues touchent `apps/admin` mais leurs side effects affectent KB Orders — les parcours qui croisent les deux apps sont consignés ici.)_

---

## Journal de curation

À chaque merge, ajouter une ligne `## YYYY-MM-DD — PR #N` avec un résumé court (`gardé X tests, rejeté Y, fusionné Z`). Sert d'audit trail pour comprendre pourquoi un test E2E proposé par un agent ne se retrouve pas dans cette checklist.

_(vide au 2026-06-03 — premier merge KB Orders à venir)_
