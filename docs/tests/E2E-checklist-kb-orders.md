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

> **Statut** : ✅ **4/4 validés le 2026-06-05** sur émulateur Lenovo Tab M8 (Android, mode dev build). Compte `manager@kb.test` mono-tenant `test-t1`. Pré-requis run : sync clock émulateur (cf. `docs/native/emulator-tls-fix.md`) sinon WebSocket Convex échoue en TLS. Issues couvertes #393 (kiosque toggle), #394 (force update gate), #395 (push banner fallback), #398 (onboarding séquence).
>
> **Fix shipped pendant le run** : `157f481` — bypass `<Button>` + `<Text>` custom par `Pressable` + `RNText` natif sur l'écran kiosque toggle. Cause non identifiée (Button custom rend pas les enfants quand padding override `py-6`). Dette technique à régler hors session.

### KBO-A1 — Login email + password

- **Acteur** : KB Manager
- **Pré-requis** : compte `manager@kb.test` provisionné via `bootstrapE2EInvites` + accept-invite + password set ; clock émulateur syncée ; app fraîchement lancée sur écran login
- **Étapes** :
  1. Saisir email + password
  2. Tap "Continue"
- **Attendu** :
  - Cookie session posé via Convex Auth, navigation vers écran kiosque toggle (premier login)
  - Aucun flash "Mode déconnecté" rouge (WebSocket Convex OK)
  - Écran login ne montre PAS de bouton Google/social ni lien Sign up (commenté pour V1 invite-only par `762bd23`)
- **Couvre** : Convex Auth password flow, prérequis cleanup auth UI V1

### KBO-A2 — Kiosque toggle mono-tenant → pin auto

- **Acteur** : KB Manager mono-tenant
- **Pré-requis** : KBO-A1 PASS, écran "Cette tablette sera dédiée à la cuisine ?" affiché, manager rattaché à 1 seul tenant (`test-t1`)
- **Étapes** :
  1. Tap "Oui — mode cuisine"
- **Attendu** :
  - Pin auto sur `test-t1` (pas de pick-tenant car mono-rattachement) → mutation `setMyDeviceMode({mode:"kiosque", pinnedTenantId:test-t1})` côté backend
  - Stack rebascule vers `(onboarding)` puis `(app)` via le gate `_layout.tsx`
  - Pas de switcher tenant visible dans la nav suivante (mode kiosque masque switcher)
- **Couvre** : #393 (mode kiosque + tenant pinning + audit monolithique V1)

### KBO-A3 — Onboarding séquence + fallback banner si push refusé

- **Acteur** : KB Manager post-kiosque
- **Pré-requis** : KBO-A2 PASS
- **Étapes** :
  1. Suivre l'onboarding checklist (volume max + désactiver veille — instructions visuelles, manip OS optionnelle)
  2. Si prompt OS pour push permission apparaît → "Autoriser" ; sinon (cas où la permission a déjà été refusée précédemment dans l'historique de l'app sur cet appareil), passer
  3. Tap CTA fin onboarding
- **Attendu** :
  - Arrivée sur home native (liste vide normale — pas de cmd seedée)
  - L'onboarding ne se rejoue pas après kill+relaunch (persistance "completed")
  - **Si permission push refusée** : banner rouge "Notifs désactivées — tu vas rater des commandes" visible avec CTA "Ouvrir réglages" qui deeplink Settings OS (story #395 prend le relais)
- **Couvre** : #398 (onboarding séquence) + #395 (push permission detection + banner persistant)

### KBO-A4 — Force update gate au boot — passe-plat nominal

- **Acteur** : KB Manager loggé, mode kiosque activé
- **Pré-requis** : KBO-A3 PASS, app installée avec un build dont `criticalIndex` ≥ valeur serveur Convex et `nativeBuildVersion` ≥ `minSupportedBuildVersion`
- **Étapes** :
  1. Kill app (swipe-up + close)
  2. Relance depuis le launcher
- **Attendu** :
  - L'app boot directement sur la home (pas d'écran "Mise à jour requise")
  - Aucun blocage au splash → le gate `ForceUpdateGate` au root `_layout.tsx` passe en silence
- **Couvre** : #394 (couche OTA criticalIndex + couche native minSupportedBuildVersion, branche passe-plat)
- **Note** : la branche BLOQUANTE du gate (force update affichée) n'est pas testée ici — nécessite de bumper `criticalIndex` côté `app.config.ts` OU `minSupportedBuildVersion` via mutation Convex. À tester séparément quand on validera explicitement #394 sous contrainte.

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

> **Statut** : ✅ **2/2 validés le 2026-06-05** — KBO-CMD1 PASS (#401 direct livraison) + KBO-CMD2 PASS (#402 click & collect). Fix livré pendant le run : `587de17` exclude `remise` de la home queue côté V1 (sans webhook Uber Direct, sinon la cmd reste éternellement visible). Fix transverse livré pendant la session : `83b0a7c` pin `@react-navigation/drawer ~7.9.4` (le `^7.10.3` installé par la refonte drawer crashait l'app au boot — `Element type is invalid Screen` car expo-router SDK 55 attend strictement `~7.9.4`).

### KBO-CMD1 — Réception live + workflow direct livraison (#401)

- **Acteur** : KB Manager (`manager@kb.test`) en mode kiosque sur `test-t1`
- **Pré-requis** : KBO-A4 PASS, home native vide. Lancer le seed côté Convex : `npx convex run e2e:seedE2EKBOrdersNouvelleCmd '{"mode":"delivery"}'` depuis `packages/backend` — insère 1 cmd `nouvelle` (burger + 2 frites, 27,50 €, mode delivery, adresse Paris).
- **Étapes** :
  1. Observer la home native — la card cmd arrive EN LIVE via Convex sub (< 5s sans refresh)
  2. Tap card → detail screen (items frozen visibles, adresse livraison visible)
  3. Tap **"Accepter / Préparer"** → status `en préparation` (badge change live)
  4. Tap **"Prête"** → status `prête`
  5. Tap **"Remise au coursier"** → status `remise`
- **Attendu** :
  - Réception live sans refresh, transitions instantanées (mutation Convex + sub home auto-update)
  - Après "Remise au coursier" → la card fade out de la home (V1 archive après remise, en attendant le webhook Uber Direct V2 qui transitionnera vers `livrée`)
  - Aucun crash, aucun "Mode déconnecté" rouge pendant le run
- **Couvre** : #401 (réception Convex sub + workflow delivery + transitions backend + fade out V1)

### KBO-CMD2 — Click & collect (#402)

- **Acteur** : KB Manager (`manager@kb.test`) en mode kiosque sur `test-t1`
- **Pré-requis** : KBO-A4 PASS, home native vide. Seed : `npx convex run e2e:seedE2EKBOrdersNouvelleCmd '{"mode":"pickup"}'` depuis `packages/backend` — insère 1 cmd `nouvelle` (burger + 2 frites, 27,50 €, mode pickup, customer **David**, **pas d'adresse**).
- **Étapes** :
  1. Observer la home native — la card cmd arrive EN LIVE via Convex sub (< 5s sans refresh)
  2. Tap card → detail screen (items frozen visibles, marqueur "À emporter" / pickup, pas d'adresse de livraison)
  3. Tap **"Accepter / Préparer"** → status `en préparation`
  4. Tap **"Prête"** → status `prête`
  5. Tap le bouton terminal pickup → status `collectée` (label différent de delivery, transition direct en terminal, pas via `remise`)
- **Attendu** :
  - Réception live sans refresh, transitions instantanées
  - Detail screen conforme mode pickup (pas d'adresse, marqueur visuel)
  - Status terminal `collectée` (pas `remise` — `remise` est réservé au mode delivery en attente du webhook Uber Direct V2)
  - Card fade out de la home après `collectée`
- **Couvre** : #402 (workflow pickup + transitions backend + fade out V1 + distinction visuelle delivery vs pickup)

---

## KBO-RJ — Refus + auto-expired

> **Statut** : ✅ **4/4 PASS le 2026-06-06** — KBO-RJ1 (#403 + ADR 0019 refus `autre` + customReason) + KBO-RJ2 (régression motifs enum) + KBO-RJ3 (#413 3-step depuis `en préparation` + typed-word "REFUSER") + KBO-RJ4 (#404 auto-expired via `triggerE2EAutoExpireKbOrder` helper). Fixs livrés pendant le run : `f5be1e9` (dispatch open dialog manquant — bug latent depuis #403) + Convex backend redeploy (validator `refuse` n'accepte `customReason` qu'après push) + `957de1e` (helper E2E `triggerE2EAutoExpireKbOrder` pour simuler le tick 5min sans attendre). En passant a aussi validé : **reveal téléphone client + tap-to-call** (`5a82340` + `ab56dc9`), **système de toast confirmation top-center** (`36c44e8` — 11 sites wirés). Issues couvertes #403, #413, #404, ADR 0019.

### KBO-RJ1 — Refus `autre` + custom reason → event row + push body (ADR 0019)

- **Acteur** : KB Manager (`manager@kb.test`) en mode kiosque sur `test-t1`
- **Pré-requis** : KBO-A4 PASS, home native vide. Seed : `npx convex run e2e:seedE2EKBOrdersNouvelleCmd '{"mode":"delivery"}'` depuis `packages/backend` — insère 1 cmd `nouvelle`.
- **Étapes** :
  1. Tap card → detail screen
  2. Tap **"Refuser"** (secondary outline) → dialog s'ouvre sur étape `pickReason`
  3. Tap le motif **"Autre"** → la dialog transit vers une étape **"Précisez le motif"** avec un text area + compteur `0/280` (PAS vers `confirm` direct)
  4. Saisir `"ratatouille brûlée"` dans le text area
  5. Vérifier que le bouton **"Continuer"** est devenu enabled (vert primary)
  6. Tap **"Continuer"** → étape `confirm` portant `"Motif : Autre — ratatouille brûlée"` dans la description
  7. Tap **"Confirmer le refus + refund"**
- **Attendu** :
  - L'order passe `nouvelle → refusée` (fade out de la home)
  - L'order detail historique affiche `"Motif du refus : Autre"` (le label enum côté UI, le texte libre est dans l'audit + push, pas dans l'écran resto)
  - Côté Convex dashboard (ou via `npx convex data orderEvents`) : la ligne `refusée` carrie `reason: "autre"` ET `customReason: "ratatouille brûlée"`
  - Côté client (PWA test ou notif visible si push wallet/web-push effectif) : le push reçu contient `"Désolé, votre commande a été refusée. Motif : ratatouille brûlée"` (le label "Autre" disparaît, seul le texte libre apparaît — ADR 0019 décision A)
- **Couvre** : ADR 0019 cross-layer (UI saisie → mutation → event row stocké → push template body), gating bouton Continuer, format wording push

### KBO-RJ2 — Refus motif enum (rupture/fermeture/surcharge) → flow inchangé (régression)

- **Acteur** : KB Manager (`manager@kb.test`) en mode kiosque sur `test-t1`
- **Pré-requis** : KBO-A4 PASS, home native vide. Seed : `npx convex run e2e:seedE2EKBOrdersNouvelleCmd '{"mode":"delivery"}'`.
- **Étapes** :
  1. Tap card → detail screen → **"Refuser"**
  2. Tap motif **"Rupture de stock"** (ou n'importe quel motif non-`autre`)
- **Attendu** :
  - La dialog passe **directement** à l'étape `confirm` (pas de step `customReasonInput` qui s'insère — régression ADR 0019)
  - Description : `"Motif : Rupture de stock. Le client sera remboursé immédiatement…"` (label seul, sans tiret + texte libre)
  - Tap "Confirmer" → mutation `refuse` réussit sans `customReason` ; event row `reason: "rupture"`, `customReason: undefined`
- **Couvre** : ADR 0019 — pin que les 3 motifs enum n'ont PAS de régression UX (asymétrie volontaire `autre`-only)

---

## KBO-DIS — Disponibilité commerciale

> **Statut** : 🟡 **3/4 PASS le 2026-06-07** — KBO-DIS1 (pause exceptionnelle #406 avec presets + custom + bannière) + KBO-DIS2 (fermeture exceptionnelle #407 avec calendar JS Wix + bannière scheduled) + KBO-DIS3 (toggle dispo item #408 ADR 0018 + tooltip first-usage avec nouveau wording asymétrique + badge état + dette UX touch area + ActivityIndicator vs optimistic en cours de fix). Fixs livrés pendant KBO-DIS3 : `f016467` (badge état + wording + `withOptimisticUpdate` + per-item Set + PRD §7c update) + un commit en cours pour la touch area large + retrait ActivityIndicator anti-optimistic. Fixs livrés pendant le run : `599c2b8` (pause custom + retrait tab horaires + fix crash accessibilityRole=tab) + `6e6181e` (bannière availability-banner) + `0b1e3df` (helper closureScheduled kind quand `from > now` — bug bannière hidden sur custom future, +picker DateTimePicker natif initial) + `70252ba` (pivot calendar JS-only `react-native-calendars` Wix car `@react-native-community/datetimepicker` crash module natif non-bundlé dans dev build EAS — +titres header drawer dédupliqués "Commandes en cours" / "Stats rapides" + fix padding bannière `useSafeAreaInsets` consommé une fois sur wrapper bannières + `headerStatusBarHeight: 0` drawer pour éviter double inset). Vérif `acceptsOrderNow` : 36 tests pinned (status.test.ts) couvrent pause + closure + hours + cross-tenant + auto-reprise — RAS côté backend. Issues couvertes #406, #407, #408, #409.

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

### 2026-06-05 — première session test groupe KBO-A

- Documenté 4 parcours KBO-A1 à A4 couvrant 4 stories (#393, #394, #395, #398). Tous PASS sur Lenovo Tab M8 Android émulateur.
- **Fusion** : #395 (push banner refusé) absorbé dans KBO-A3 (onboarding) au lieu d'un parcours dédié — le fallback banner est naturellement observable pendant l'onboarding sans interaction supplémentaire. Évite duplication.
- **Rejeté** : test isolé "validation format email" du sign-in form (couvert TDD Zod côté `SignInSchema`).
- **Rejeté** : test isolé "vérification absence boutons Google/social" du sign-in form après cleanup `762bd23` — intégré comme AC visuel dans KBO-A1 sans parcours dédié.
- **Hors curation, dette ouverte** : bug rendering `<Button>` + `<Text>` custom avec override padding `py-6` sur écran kiosque toggle. Bypass shipped (`157f481`) avec `Pressable` + `RNText` natif. Cause non identifiée. À traiter hors session de test.
- **Hors curation, doc complémentaire** : `docs/native/emulator-tls-fix.md` — sync clock émulateur Android pour éviter "Chain validation failed" sur WebSocket Convex. Pré-requis transverse à tous les parcours.

### 2026-06-05 (suite) — KBO-CMD2 + refonte UI drawer/tabs

- **KBO-CMD2 PASS** — click & collect (#402) — workflow pickup validé bout en bout sur Lenovo Tab M8. Transition terminale en `collectée` (vs `remise` pour delivery) OK, card fade out de la home après terminal, detail screen pickup sans adresse OK.
- **Fix transverse pendant la session** : `83b0a7c` pin `@react-navigation/drawer ~7.9.4`. La refonte UI (commit `08cd473`) avait installé `^7.10.3` (latest npm), incompatible avec `expo-router` SDK 55 qui exige strictement `~7.9.4`. Résolvait `Screen` à `undefined` via la chaîne `@react-navigation/elements@2.9.x` transitif → crash boot `Element type is invalid`. Lockfile re-résolu, cleanup `node_modules` corrompu (`*_tmp_*` orphelins de pnpm installs interrompus par Metro qui watchait).
- **Refonte UI** : `(tabs)/_layout.tsx` flippe maintenant entre `Drawer` (tablette/kiosque) et `NativeTabs` (téléphone) via `useFormFactorShell()`. 4 sections (Accueil / Historique / Stats / Paramètres). Drawer rétractable (`drawerType: "front"`). Quick stats sortis de l'Historique vers la section Stats dédiée. Settings `Ouverture & horaires` regroupe pause/fermeture/dispo items/horaires (précédemment éparpillés sur le home).
