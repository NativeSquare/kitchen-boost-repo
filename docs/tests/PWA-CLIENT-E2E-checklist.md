# E2E manual checklist — PWA Client KitchenBoost (V1)

Checklist E2E manuelle pour la PWA client (`apps/web`), nomenclature canonique alignée sur le PRD section Testing Decisions (FND / A / M / C / CHK / PAY / TRK / WAL / A2H / REC). Chaque parcours est à exécuter à la main contre `apps/web` en dev (Convex live + seeds e2e + Stripe test + Uber sandbox + device réel iPhone Safari OU Android Chrome).

- **Date** : 2026-06-04 (drain initial 12 PRs) + 2026-06-10 (chain `#458 → #459 → #463 → #464` débloquée et drainée → 4 PRs supplémentaires #478, #479, #480, #481)
- **Statut global** : 🟢 **PRÊT À TESTER** — **16 PRs PWA Client mergées au total** (#465-#476 le 06-04 + #478-#481 le 06-10). **Les 11 groupes sont peuplés** : FND (3) + A (3) + M (3) + C (3) + CHK (5) + PAY (3) + TRK (3) + WAL (4) + A2H Android (2) + A2H iOS (3) + REC (2) = **34 scénarios E2E** prêts à tester sur devices physiques iPhone Safari + Android Chrome. Aucun blocker.
- **Pré-requis transverses** : seeds `e2e` chargées (≥ 1 tenant `test-t1` slug + custom domain, menu publié ≥ 3 catégories ≥ 15 items dont 2 avec modifiers obligatoires + 1 item out-of-stock toggleable depuis admin), Convex deployment dev (`impartial-goshawk-798` ou équivalent), Stripe en mode test avec `acct_resto` rattaché au tenant, Uber Direct sandbox creds, VAPID keys valides (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), Apple PassKit cert + Google Wallet issuer ID valides, Resend test pour emails transactionnels, `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` set dans `apps/web/.env.local`. Pour les tests Wallet/push, device physique iPhone 15+ Safari et device physique Android Chrome récent.
- **Convention** : format strict aligné sur la campagne admin (cf. [`E2E-checklist.md`](E2E-checklist.md) validée 12/12 groupes 2026-06-03) — **Acteur / Pré-requis / URL de départ / Étapes / Attendu / Couvre**. La colonne "Couvre" référence : les US du PRD master + les issues `#N` mergées + les modules deep extraits.
- **Slices de référence** : voir [00-issues-breakdown.md](../prd/sub/10-pwa-client/00-issues-breakdown.md) pour le DAG des 19 slices (3 HITL + 16 AFK) et le mapping US ↔ slice.

---

## Bilan drain 2026-06-04 — état après drain AFK nuit

- **12 PRs mergées** par sub-agents AFK : #465 (S1), #466 (S2), #467 (S3), #468 (S4), #469 (S5), #470 (S6), #471 (S6a), #472 (S6b), #473 (S6c), #474 (S9a), #475 (S9b), #476 (S10).
- **4 stories bloquées par HITL #447 (Vercel config)** : #458 (S7 Stripe payment → groupe PAY), #459 (S8 tracking realtime → groupe TRK), #463 (S11 A2HS iOS → moitié iOS du groupe A2H), #464 (S12 recognition retour → groupe REC).
- **23 scénarios E2E agrégés** sur **7 groupes peuplés** (FND, A, M, C, CHK, WAL, A2H Android).
- **0 hygiène gaps détectés** — les 12 PRs ont toutes une section "Plan de test E2E" structurée (3 scénarios chacune en moyenne). Discipline orchestrateur respectée.
- Agrégations notables :
  - Scénario CHK-4 fusionne le chemin critique « 0 canal → palier 3 Wallet refusé + Web Push denied → fallback 3 niveaux → flag `noChannelPossible` → Payer débloqué » à partir de S6a + S6b + S6c (state machine complète du module `push-enrollment-orchestrator`).
  - Groupe FND consolide les vérifs transverses manifest + SW + tenant cookie + push deep-link en 3 scénarios DevTools-driven (S1 + S2).
  - Le scénario WAL « install Wallet effectif → 3 paliers cachés » fusionne le Convex sub veto de S9a avec le flow install de S6a.

## Bilan drain 2026-06-10 — chain Stripe/tracking/A2HS iOS/recognition débloquée

- **4 PRs mergées** par sub-agents AFK séquentiels : #478 (S7 Stripe payment), #479 (S8 tracking realtime), #480 (S11 A2HS iOS), #481 (S12 recognition retour). HITL #447 (Vercel config) résolu en pratique en amont, plus de chain blocker.
- **11 scénarios E2E supplémentaires** agrégés sur **4 groupes complétés** : PAY (3) + TRK (3) + A2H iOS (3) + REC (2). Total cumulé : **34 scénarios sur 11 groupes**.
- **0 hygiène gaps détectés** — les 4 PRs ont toutes une section « Plan de test E2E » conforme (3 scénarios proposés par défaut, 1 trivial agrégé à 2 sur REC pour éliminer la redondance avec les 7 unit tests vitest sur la branche `none`).
- Agrégations notables :
  - **REC** : 3 scénarios PR → 2 publiés. La branche `none` (1ère visite, aucun cookie) éliminée comme test E2E dédié (trivial : « ouvrir l'URL, rien à voir ») et remontée en **baseline implicite** documentée en préambule du groupe — déjà couverte par 7 unit tests `decideReturnGreeting` + visuellement attestée en début des autres scénarios.
  - **A2H iOS** : `A2H.5` test « bottom-sheet jamais visible sur Android » conservé (négatif critique d'iOS-only), mais la **matrice in-app browsers iOS** (Instagram/Facebook/TikTok/Snapchat/Pinterest WebViews) explicitement **non dédupliquée** en E2E manuel — couverte par 34 unit tests `is-ios-safari` UA matrix dans la PR.
  - **TRK** : aucune fusion entre les 3 trajectoires (redirect+timeline / Convex sub realtime / share URL+incident) car contextes mutuellement exclusifs (anonymous → realtime owner → cross-device share). Garder distincts maximise la lisibilité.
  - **PAY** : 3 scénarios distincts (saved card / new card 3DS / latching surge) — pas d'agrégation possible car branches mutuellement exclusives (presence/absence `savedPaymentMethodId` + mock backend surge).
- **Scope gap documenté côté PAY** : checkbox « Sauvegarder ma carte » new-card branch deliberately deferred V1 (requiert platform-level SetupIntent flow non collecté V1). Consumption side (tile saved card pre-sélectionné) fully wired.

---

## FND — Foundation transverse (tenant resolution + PWA shell)

> **Slices** : #449 (S1 tenant resolution) + #450 (S2 PWA shell) · **Statut** : 🟡 EN COURS — 3 scénarios prêts à tester
>
> Couvre : middleware `proxy.ts` host → tenantId via cookie `__Host-kb_tenant`, manifest dynamique branded, service worker push + deep-link, fichier Apple Pay `.well-known`.

### FND — Test FND.1 : First hit pose cookie + manifest branded + SW activé

- **Acteur** : visiteur first-time, device mobile réel (iPhone Safari OU Android Chrome) en mode privé / cache vidé.
- **Pré-requis** : tenant `test-t1` actif en base (seed dev OK), DNS wildcard pointe sur Vercel dev tunnel HTTPS.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Naviguer vers l'URL en mode privé.
  2. Ouvrir DevTools mobile (Safari → Settings → Advanced → Web Inspector / Chrome → `chrome://inspect/#devices`) → onglet **Application**.
  3. Sous **Cookies** : vérifier `__Host-kb_tenant=<id_tenant_test-t1>`, `HttpOnly=true`, `Secure=true`, `Path=/`, pas d'attribut `Domain`.
  4. Sous **Manifest** : vérifier `name = "Test Restaurant 1"`, `theme_color = "#1B7A3D"` (ou couleur primaire configurée), `display = "standalone"`, `orientation = "portrait"`, icons array contient 3 entrées (192/512/180).
  5. Sous **Service Workers** : vérifier `sw.js` scope `/`, status `activated and is running`, source = `https://test-t1.kitchen-boost.com/sw.js`.
  6. Hard reload (Ctrl+Shift+R) + vérifier dans Network que `manifest.webmanifest` renvoie `Cache-Control: public, max-age=3600, s-maxage=3600`, content-type `application/manifest+json`.
- **Attendu** : page « Bienvenue chez Test Restaurant 1 » s'affiche en <2s ; cookie posé conforme `__Host-` prefix ; manifest branded ; SW actif ; aucun appel `*.convex.cloud` pour la résolution `tenants.resolution.byId` au refresh (le middleware lit le cookie sans round-trip).
- **Couvre** : US 1, US 67 + slice #449 + #450 + modules `decideTenantResolution`, `decideManifest`.

### FND — Test FND.2 : Host inconnu + tenant orphelin → page erreur sans pollution cookie

- **Acteur** : visiteur device mobile.
- **Pré-requis** : un slug inconnu (jamais provisionné) + capacité à supprimer un tenant en base pour tester l'orphelin.
- **URL de départ** : `https://inconnu.kitchen-boost.com/`
- **Étapes** :
  1. Naviguer vers `https://inconnu.kitchen-boost.com/` (slug inexistant).
  2. Vérifier URL bar : reste `inconnu.kitchen-boost.com/` (rewrite interne, pas redirect).
  3. DevTools → Cookies : aucun `__Host-kb_tenant` posé.
  4. Re-tester avec cookie stale : poser cookie valide via FND.1 sur `test-t1`, puis supprimer le tenant `test-t1` en base (mutation dev), activer `revalidateCookie: true` côté middleware temporairement, recharger.
  5. DevTools → Cookies : `__Host-kb_tenant` a disparu (clearCookie).
  6. Recharger encore — vérifier qu'on ne boucle pas.
- **Attendu** : page « Resto non disponible » s'affiche pour les 2 cas (host inconnu + cookie stale orphelin) ; pas de cookie posé pour le host inconnu ; cookie wipé pour l'orphelin ; pas de boucle.
- **Couvre** : US 67 + slice #449 + module `decideTenantResolution`.

### FND — Test FND.3 : Push notification deep-link + collapse via tag (Android Chrome)

- **Acteur** : Android Chrome avec subscription web-push déjà enrôlée.
- **Pré-requis** : SW enregistré (FND.1 OK) + 1 subscription web-push enrôlée pour le tenant + capacité d'envoyer un payload de test via `/api/push/send` (terminal admin).
- **URL de départ** : N/A (test depuis le tray notif device).
- **Étapes** :
  1. Depuis terminal admin, envoyer un push test : `{"title":"🥢 Test Restaurant 1 : -20% bao ce soir","body":"Code BAO20","data":{"url":"/c/order_test_abc","orderId":"order_test_abc"}}`.
  2. Vérifier notification lock-screen : titre **VERBATIM** `🥢 Test Restaurant 1 : -20% bao ce soir` + body `Code BAO20`.
  3. Tap la notification.
  4. Renvoyer un 2ᵉ push avec le **même** `orderId` (`order_test_abc`) mais titre différent.
  5. Vérifier le tray notif.
- **Attendu** : titre VERBATIM affiché (pas de mutation côté SW) ; tap ouvre la PWA directement sur `https://test-t1.kitchen-boost.com/c/order_test_abc` (deep-link) ; le 2ᵉ push REMPLACE le 1ᵉʳ dans le tray (collapse via tag `orderId|campaignId`) au lieu de dupliquer.
- **Couvre** : US (push deep-link) + slice #450 + modules `deriveNotificationOptions`, `decideNotificationClickAction`.

---

## A — Address-first flow

> **Slices** : #449 (S1 tenant resolution) + #451 (S3 address-first) · **Statut** : 🟡 EN COURS — 3 scénarios prêts à tester
>
> Couvre : address-first BLOQUANT avant menu, Google Places autocomplete obligatoire, auto-validate au sélection, chain `signIn → getOrCreateCurrentCustomer → updateAddress → requestDeliveryQuote`, 4 verdicts (`deliverable` / `hors_zone` / `hors_horaire` / `surge`), édit adresse re-fire quote.

### A — Test A.1 : Address-first chain end-to-end verdict `deliverable`

- **Acteur** : iPhone Safari, première visite (cache + cookies vidés).
- **Pré-requis** : `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` valide, tenant `test-t1` seedé actif avec service hours + Uber Direct sandbox configurés, dev tunnel HTTPS.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Ouvrir l'URL en mode privé.
  2. Vérifier que le nom du resto s'affiche en titre (`Test Restaurant 1`) — confirme tenant resolution PWA-S1.
  3. Taper « 12 rue de la Paix Paris » dans le champ adresse.
  4. Sélectionner la suggestion Google Places « 12 rue de la Paix, 75002 Paris, France ».
- **Attendu** : pas de bouton « Valider » — auto-validate au sélection (US 3) ; spinner « On vérifie la livraison… » immédiat ; DevTools → Cookies : cookie de session Convex Auth posé (HttpOnly + Secure + host-only ADR 0008) ; Convex Dashboard → table `customers` : la fiche du nouvel user a `address`, `lat`, `lng` persistés ; <1s après la sélection, la card « -10% sur ta prochaine commande » palier 1 Wallet apparaît (le `/menu` direct est désormais médiatisé par le palier 1 — cf. S9a #474) avec bouton « Ajouter à mon Wallet » + lien « Plus tard → ». Cliquer « Plus tard → » navigue vers `/menu`.
- **Couvre** : US 3, US 27 (palier 1 Wallet) + slices #449 + #451 + #474 + modules `decideAddressFirstAction`, `decideWalletPromptVisibility`.

### A — Test A.2 : Verdict `hors_zone` propose C&C

- **Acteur** : Android Chrome, première visite.
- **Pré-requis** : sandbox Uber Direct configuré pour refuser une adresse fixture hors zone (ex: « 1 place Bellecour, 69002 Lyon »).
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Ouvrir l'URL.
  2. Taper « 1 place Bellecour Lyon » + sélectionner la suggestion.
  3. Lire le message.
  4. Cliquer « Voir le menu (retrait sur place) ».
- **Attendu** : spinner « On vérifie la livraison… » puis message « Trop éloignée pour la livraison depuis ce resto. Tu peux passer prendre ta commande sur place. » ; bouton vert « Voir le menu (retrait sur place) » visible ; click → navigation `/menu` ; PAS de redirect automatique ; sur `/menu` puis `/panier`, le toggle delivery `[🛵 Livraison · — ]` est GRISÉ + non-cliquable (aria-disabled), `[🚶 Retrait]` sélectionné par défaut.
- **Couvre** : US 4 (hors_zone), US 24-26 (toggle mode initial) + slices #451 + #453 + modules `decideAddressFirstAction`, `decideInitialMode`.

### A — Test A.3 : Verdict `hors_horaire` bloque + édit adresse re-fire quote

- **Acteur** : iPhone Safari ou Android Chrome.
- **Pré-requis** : seed `service_hours` du tenant `test-t1` configuré « fermé maintenant » (ex: window `[10:00-12:00]` seulement, test à 14:00).
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Ouvrir l'URL.
  2. Taper et sélectionner « 12 rue de la Paix Paris ».
  3. Lire le message hors_horaire.
  4. Modifier l'adresse dans le champ → sélectionner une nouvelle suggestion Places « 8 boulevard Haussmann Paris ».
- **Attendu** : étape 3 : message « Le resto est fermé pour le moment. Reviens à l'ouverture pour commander. » (PAS de bouton C&C, PAS de Retry) ; étape 4 : spinner ré-apparaît automatiquement (re-fire de la chain à l'édit, US édit-après-validation), puis nouveau verdict — confirme que la modification d'adresse déclenche un nouveau quote.
- **Couvre** : US 5 (hors_horaire), US édit-après-validation + slice #451 + module `decideAddressFirstAction`.

---

## M — Menu browsing

> **Slices** : #452 (S4 menu ISR + item modal Vaul + overlay LIVE) · **Statut** : 🟡 EN COURS — 3 scénarios prêts à tester
>
> Couvre : LCP <1.5s 4G, catégories scrollables + ancres latérales, badges + filtres allergènes (14 UE 1169/2011), item modal bottom-sheet Vaul `?item=<id>` URL-stateful (back button ferme), modifiers required/optional (badge "À choisir"), overlay LIVE `available` Convex sub par-dessus HTML cached ISR, deep-link `?promo=<itemId>` scroll + highlight.

### M — Test M.1 : Tap item → modal Vaul URL-stateful + back button ferme modal

- **Acteur** : iPhone Safari OU Android Chrome, cookie tenant posé.
- **Pré-requis** : `test-t1` seedé avec menu publié ≥ 3 catégories, ≥ 1 item « Smash Double Bao ».
- **URL de départ** : `https://test-t1.kitchen-boost.com/menu`
- **Étapes** :
  1. Visiter l'URL avec DevTools throttling 4G.
  2. Tap sur le card item « Smash Double Bao ».
  3. Vérifier la URL bar.
  4. Tap le bouton « Retour » du browser (ou geste swipe-back iOS).
  5. Vérifier le scroll position de `/menu`.
  6. Re-tap le même item.
- **Attendu** : page rendue <2s sur 4G (cible <1.5s) ; photos lazy-loaded ; Drawer Vaul s'ouvre par le bas mobile (side-drawer desktop ≥ md) ; URL passe à `…/menu?item=<id_de_smash_double_bao>` ; Retour → drawer se ferme SANS reload, scroll préservé, URL repasse `…/menu` ; re-tap → drawer s'ouvre instantanément (state local reset par `key={item._id}`).
- **Couvre** : US 14, US 15, US 18 + slice #452 + module `decideMenuDeepLink`.

### M — Test M.2 : Modifier required disabled + overlay LIVE item out-of-stock

- **Acteur** : iPhone Safari, PWA ouvert.
- **Pré-requis** : `test-t1` menu avec ≥ 1 item ayant un modifier group `minSelect=1` (ex: « Sauce ») ; accès tablette KDS admin (KB Orders) en parallèle.
- **URL de départ** : `https://test-t1.kitchen-boost.com/menu`
- **Étapes** :
  1. Visiter `/menu` puis tap un item avec modifier group `minSelect=1` (ex: « Sauce »).
  2. Vérifier le badge « À choisir » + état du bouton.
  3. Tap « Ketchup ».
  4. **Sans fermer la modal**, depuis KB Orders (autre device) toggle l'item courant en « Indisponible ce soir ».
  5. Re-ouvrir la modal d'un autre item dispo et observer les cards en arrière-plan.
- **Attendu** : étape 2 : badge « À choisir » (fond ambre, texte « À choisir ») visible, bouton « Ajouter au panier » disabled, libellé « Sélectionne les options obligatoires » ; étape 3 : badge disparaît, bouton actif, libellé `Ajouter au panier · X,XX €` ; étape 4-5 : <500ms l'overlay LIVE Convex sub réagit, le card de l'item toggle est grisé avec label rouge « Indisponible ce soir », bouton card `disabled`.
- **Couvre** : US 17, US 19, US 66 + slice #452 + slice chantier 2.2 `publishMenu` overlay live.

### M — Test M.3 : Deep-link `?promo=<id>` scroll + highlight + `?item=<id>` ouvre modal directement + ISR revalidate

- **Acteur** : iPhone Safari OU Android Chrome.
- **Pré-requis** : `test-t1` menu publié, accès KB Admin tenant pour tester le republish.
- **URL de départ** : `https://test-t1.kitchen-boost.com/menu?promo=<id_du_smash_burger>` puis `?item=<id_du_smash_burger>`
- **Étapes** :
  1. Taper l'URL `?promo=<id>` (id récupéré côté KB Admin → Menu).
  2. Observer le scroll + animation.
  3. Attendre 2s, vérifier l'URL.
  4. Visiter ensuite `?item=<id>` directement.
  5. Tap back → vérifier que `/menu` reste rendu sous-jacent.
  6. **Bonus AC publish-revalidate** : depuis KB Admin tenant Test Restaurant 1, modifier nom d'un item (« Smash Burger » → « Smash Burger v2 ») puis cliquer « Publier ». Recharger `/menu` côté PWA dans les 30s.
- **Attendu** : `?promo=` : scroll smooth jusqu'au card centré dans viewport, border émeraude épais + animation pulse ~2s, après pulse l'URL devient `…/menu` (cleanup `?promo=`, le back button ne re-pulse pas) ; `?item=` : Drawer Vaul s'ouvre directement au mount, back button ferme la modal et laisse `/menu` sous-jacent ; bonus : nouveau nom apparaît dans les 30s (hook `publishMenu → revalidateMenuTag → revalidateTag('menu:<tenantId>', 'default')` invalide l'ISR).
- **Couvre** : US 18, US 62 + slice #452 + modules `decideMenuDeepLink`, `decideRevalidateRequest`.

---

## C — Cart + delivery mode toggle

> **Slices** : #453 (S5 cart + Note resto + Delivery mode toggle) · **Statut** : 🟡 EN COURS — 3 scénarios prêts à tester
>
> Couvre : lignes panier dédupées par config item × modifiers, edit qty + suppression, Note resto 200 chars max, sous-total + frais livraison (prix barré "Offert par X" si pricing rule) + total, toggle Livraison/C&C header permanent switch sans re-quote (verdict initial cache 2 modes), mode initial cohérent avec verdict S3.

### C — Test C.1 : Add cart dédup item × modifiers + edit qty + suppression + persistance localStorage

- **Acteur** : iPhone Safari OU Android Chrome, anonyme frais.
- **Pré-requis** : tenant `test-t1` seedé avec ≥ 2 items dont 1 ayant ≥ 1 modifier group multi-options (ex: Smash Burger × Sauce {Ketchup, Mayo}).
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Saisir une adresse livrable via Google Places → palier 1 Wallet → « Plus tard » → arrivée `/menu`.
  2. Tap « Smash Burger » → modal Vaul → sélectionner « Sauce : Ketchup », qty=1, tap « Ajouter au panier ». Modal ferme.
  3. Re-tap « Smash Burger » → re-sélectionner « Sauce : Ketchup » + qty 1 + « Ajouter ». Modal ferme.
  4. Re-tap « Smash Burger » → sélectionner « Sauce : Mayo » + qty 1 + « Ajouter ».
  5. Naviguer `/panier` via le lien « Voir le panier → » du header.
  6. Sur ligne Ketchup, tap « + » → qty 3 ; tap « − » × 2 → qty 1.
  7. Tap « Supprimer » sur la ligne Mayo.
  8. Reload de la page `/panier`.
- **Attendu** : étape 5 : 2 lignes panier — « Smash Burger · Sauce : Ketchup × 2 » et « Smash Burger · Sauce : Mayo × 1 » (dédup Ketchup, ligne distincte Mayo) ; étape 6 : sous-total recalcule correctement ; étape 7 : ligne Mayo disparaît ; étape 8 : ligne Ketchup ×1 reste (localStorage persisté).
- **Couvre** : US 20, US 22 + slice #453 + module `cartReducer`.

### C — Test C.2 : Note resto 200 chars max enforced + persistée

- **Acteur** : Device mobile, ≥ 1 ligne dans cart.
- **Pré-requis** : C.1 OK (cart non vide).
- **URL de départ** : `https://test-t1.kitchen-boost.com/panier`
- **Étapes** :
  1. Dans la textarea « Une note pour le resto ? — allergies, demandes spéciales », taper « sans oignon merci ».
  2. Coller un texte de 250 caractères.
  3. Naviguer vers `/menu` puis revenir vers `/panier`.
- **Attendu** : étape 1 : compteur affiche `18 / 200` ; étape 2 : textarea contient exactement 200 caractères (maxLength HTML coupe), compteur `200 / 200` ; étape 3 : note 200 chars toujours présente (localStorage persisté).
- **Couvre** : US 21 + slice #453 + module `cartReducer` (note trunc).

### C — Test C.3 : Toggle Livraison/C&C sans re-quote + mode initial selon verdict S3

- **Acteur** : Device mobile, verdict address-first `deliverable` cached.
- **Pré-requis** : adresse livrable validée (C.1 OK).
- **URL de départ** : `https://test-t1.kitchen-boost.com/menu`
- **Étapes** :
  1. Sur `/menu`, observer header.
  2. Ajouter 1 item au cart, naviguer `/panier`.
  3. Tap `[🚶 Retrait]`.
  4. Observer onglet Network du navigateur (DevTools mobile).
  5. Tap `[🛵 Livraison]`.
  6. Reload `/panier`.
- **Attendu** : étape 1 : header affiche `[🛵 Livraison · X,XX €]` (sélectionné, vert) et `[🚶 Retrait · Gratuit]` (idle) ; étape 2 : sous-total + « Frais de livraison X,XX € » + total ; étape 3 : switch INSTANT (pas de spinner), bouton Retrait vert, ligne fee « Retrait sur place · Gratuit », total = sous-total seul, AUCUN appel réseau Network ; étape 5 : retour instant ; étape 6 : mode revient à `delivery` par défaut (verdict cache → `initialMode: "delivery"`).
- **Couvre** : US 24-26 + slice #453 + modules `decideInitialMode`, `decideCartTotals`, `encodeVerdict`/`decodeVerdict`.

---

## CHK — Checkout + push enrollment 3 paliers

> **Slices** : #454 (S6 checkout form RSC + détection canal actif) + #455 (S6a Wallet branch) + #456 (S6b Web Push branch + iOS<16.4 mask) + #457 (S6c fallback 3 niveaux + noChannelPossible) · **Statut** : 🟡 EN COURS — 5 scénarios prêts à tester
>
> Couvre : RSC `preloadQuery(getCurrentCustomer)` pré-remplissage form (firstName/email/phone capturés à un checkout précédent), Convex sub réactive bouton "Payer" gated dynamique, wording CGV ≥ 12px sous bouton, modal push enrollment single-screen non-skippable (Esc/click outside ignorés), branche Wallet (loader 30s + "Tester sans attendre" + "J'ai changé d'avis"), branche Web Push (`Notification.requestPermission` + masquage iOS <16.4), fallback 3 niveaux frictionnels (lien 12px → modal confirm → re-display modal initial → flag `noChannelPossible`).

### CHK — Test CHK.1 : Redirect cart vide + form pré-rempli + CGV ≥ 12px

- **Acteur** : iPhone Safari, anonyme frais.
- **Pré-requis** : seeds `test-t1` + 1+ items publiés + cookie `__Host-kb_tenant` posé.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Adresse Places `12 Avenue de l'Opéra, Paris` → palier 1 Wallet → « Plus tard » → arrivée `/menu`.
  2. Ajouter 2 items au panier → cliquer panier → `/panier` affiche les 2 lignes → vider le panier (Supprimer × 2).
  3. Taper directement `test-t1.kitchen-boost.com/checkout` dans la barre d'URL.
  4. Re-ajouter 1 item depuis `/menu` → retourner `/checkout`.
  5. Inspecter la taille du wording CGV avec DevTools mobile.
- **Attendu** : étape 3 : redirect immédiat vers `/panier`, affiche « Ton panier est vide » + lien « ← Retour au menu », aucun flash de form vide ; étape 4 : form affiche heading `Paiement — Commande chez Test Restaurant 1`, 3 inputs **vides** (firstName / email / phone — pas encore stampé en DB, S7 fait ça), wording CGV ≥ 12px exact : `« En cliquant sur Payer, tu acceptes les CGV de Test Restaurant 1 et le service de fidélité KitchenBoost. »` ; étape 5 : `font-size: 12px` confirmé via DevTools.
- **Couvre** : US 44 + slice #454 + modules `decideCheckoutRedirect`, `decideCheckoutPrefill`.

### CHK — Test CHK.2 : Détection canal actif Convex sub → gate dynamique + form pré-rempli 2ᵉ visite

- **Acteur** : iPhone Safari, accès Convex dashboard (ou `npx convex run`).
- **Pré-requis** : fiche customer existante avec firstName/email/phone vide, cart 1 item.
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. Arriver sur `/checkout` avec gate disabled (0 canal enrolled). Vérifier bouton "Payer X,XX €" **disabled** (grisé, `cursor-not-allowed`).
  2. **Sans recharger la page**, depuis Convex dashboard : `db.patch(<customerId>, { pushEnrollment: { walletStatus: "enrolled" } })`.
  3. Re-patcher `{ pushEnrollment: { walletStatus: "revoked" } }`.
  4. Re-patcher `db.patch(<customerId>, { firstName: "Sophie", email: "sophie@example.com", phone: "+33612345678", pushEnrollment: { webPushStatus: "enrolled" } })`.
  5. Recharger `/checkout`.
- **Attendu** : étape 1 : bouton disabled, placeholder visible « Coming next : modal push enrollment » ; étape 2 : en <2s (latence sub Convex), bouton passe **active** (fond vert `emerald-700`) ; étape 3 : bouton repasse disabled en realtime (revoked ≠ enrolled) ; étape 5 : form affiche `Prénom: Sophie`, `Email: sophie@example.com`, `Téléphone: +33612345678` pré-remplis dès le SSR (pas de flash vide), bouton "Payer X,XX €" **active** au mount (gate hydraté par `preloadQuery`, pas de flash).
- **Couvre** : US 44, Q8 « Règle d'or V1 » + slice #454 + module `decidePaymentGate`.

### CHK — Test CHK.3 : Modal push enrollment blocking + install Wallet effectif iPhone

- **Acteur** : iPhone Safari, fiche fraîche.
- **Pré-requis** : panier non vide, fiche customer sans `pushEnrollment` actif.
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. Cliquer « Payer X € ».
  2. Tenter Esc + tap hors de la modal.
  3. Vérifier l'absence de × button.
  4. Cliquer « Ajouter à mon Wallet ».
  5. Dans le sheet Wallet, taper « Ajouter ». Revenir à Safari.
  6. Attendre 1-2s.
- **Attendu** : étape 1 : modal s'ouvre avec header « Pour finaliser ta cmd, choisis comment recevoir ta confirmation + offres » + hook « 🎁 -10% sur ta prochaine cmd chez {Resto} dès que ta carte est ajoutée » ; étape 2-3 : modal reste ouverte (non-skippable, US 30), pas de × button visible ; étape 4 : bouton « Génération… » ~300ms, puis Safari ouvre le sheet natif Apple Wallet (PWA en arrière-plan) ; étape 5 : retour Safari, modal passée à l'écran loader « ⏳ En attente confirmation Wallet… » + compteur 0/30s ; étape 6 : sub Convex sur `customers.pushEnrollment.walletStatus` flip à `enrolled`, modal se ferme automatiquement, nouveau click "Payer" n'ouvre plus la modal.
- **Couvre** : US 29, US 30, US 31, US 33 + slices #455 + modules `decideDeviceTarget`, `decideModalStep`.

### CHK — Test CHK.4 : Fallback 3 niveaux complet → flag `noChannelPossible` → Payer débloqué (chemin critique state machine)

- **Acteur** : iPhone Safari (≥16.4) OU Android Chrome, navigation privée.
- **Pré-requis** : panier non vide, fiche sans `pushEnrollment` actif, accès Convex dashboard pour vérif backend.
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. Address-first → cart → `/checkout` → remplir prénom/email/tel → cliquer **Payer**.
  2. Vérifier qu'AUCUN lien « Continuer sans notifs → » n'apparaît au bas de la modal (compteur d'échecs = 0).
  3. Cliquer « Ajouter à mon Wallet » → loader → cliquer « J'ai changé d'avis » (1er échec Wallet). Retour à l'écran de choix. Toujours AUCUN lien fallback (compteur = 1).
  4. Cliquer « Autoriser les notifs » → refuser la permission native (× sur popup OU « Bloquer »). Vérifier message « Refusé — essaie une autre option » + apparition du lien micro « Continuer sans notifs → » au bas (compteur = 2, font-size 12px, gris souligné).
  5. Cliquer le lien « Continuer sans notifs → ». Modal niveau 2 apparaît : titre EXACT « Sans notifs : tu n'auras AUCUNE confirmation de cmd reçue, AUCUN suivi livraison live, AUCUNE offre. Sûr ? » + bouton vert « Je veux les notifs après tout » + lien gris « Oui continue sans ».
  6. Cliquer « Oui continue sans ». Modal niveau 3 apparaît : « On a vraiment besoin d'au moins un canal pour te tenir informé. Choisis encore : ».
  7. Cliquer « Oui continue sans » à nouveau (re-refus final).
  8. Vérifier backend Convex.
- **Attendu** : étape 7 : mutation `customer.pushEnrollment.markNoChannelPossible` fire, modal niveau 3 ET modal push enrollment se ferment immédiatement (Convex sub flip), bouton **Payer X €** devient actif (couleur pleine, `data-gate="active"`) ; étape 8 : fiche `customers` a `pushEnrollment.noChannelPossible = true` + 1 ligne `auditLog` avec `action: "customer.pushEnrollment.markNoChannelPossible"`, `actorRole: "customer"`, `targetType: "customer"`, `targetId: <customerId>`.
- **Couvre** : US 34, US (fallback), Q8 + slices #455 + #456 + #457 + module `push-enrollment-orchestrator` (state machine complète : `decideModalStep` + `decideWebPushBranch` + `decideFallbackStep`).

### CHK — Test CHK.5 : iOS <16.4 option Web Push masquée + desktop bouton Wallet disabled

- **Acteur** : iPhone tournant iOS 15.x ou 16.0-16.3 (Safari avant Web Push) ; ET Desktop Chrome/Safari.
- **Pré-requis** : device iOS <16.4 disponible, OR émulateur Safari avec UA spoofé.
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. Sur iPhone iOS <16.4 : cart non vide → cliquer « Payer » → modal s'ouvre.
  2. Vérifier dans Safari DevTools l'absence de `data-testid="web-push-option"` dans le DOM.
  3. Effectuer le flow Wallet (clic « Ajouter à mon Wallet » → loader → install pass).
  4. Sur Desktop : ouvrir `/checkout` + cliquer Payer → modal apparaît.
- **Attendu** : étape 1-2 : SEULE l'option 1 « Ajouter à mon Wallet » visible ; option 2 « Autoriser les notifs » ABSENTE du DOM (pas grisée, RETIRÉE) ; étape 3 : checkout finalisable via Wallet (user a un chemin) ; étape 4 : modal apparaît mais bouton « Ajouter à mon Wallet » rendered disabled avec message « Disponible sur mobile uniquement. » (Q5 « desktop bloqué pour V1 »).
- **Couvre** : US 35, Q5 + slices #455 + #456 + module `decideWebPushCapability`, `decideDeviceTarget`.

---

## PAY — Stripe payment

> **Slices** : #458 (S7 Stripe payment + latching surge + saved-card branch — PR #478) · **Statut** : 🟡 EN COURS — 3 scénarios prêts à tester
>
> Couvre : Stripe Elements lazy-loaded uniquement sur `/checkout` (vérif DevTools Network sur `/menu`), saved card cross-resto pre-selected (tile + "Utiliser autre carte"), Payment Element neuve avec Apple Pay button visible iOS + Google Pay Android, latching `recaptureQuoteAtPayment` AVANT `stripe.confirmPayment` (modal bloquante si surge), 3DS handle par SDK transparent, retry inline ≤2 attempts → 3ᵉ échec toast + `captureException` Sentry shim, redirect direct `/c/[orderId]` post-`stripe.confirmPayment`.
>
> **Scope gap documenté (PR #478)** : la checkbox « Sauvegarder ma carte » côté flow new-card est **deliberately NOT rendered V1** (cross-resto save → platform-level SetupIntent flow non-collecté V1). La CONSUMPTION saved-card (tile pre-sélectionné + `payWithSavedCard`) est fully wired. Follow-up slice nécessaire pour la save side.

### PAY — Test PAY.1 : Paiement saved card cross-resto pre-selected → redirect tracking

- **Acteur** : Sophie sur iPhone Safari, cookie session valide, fiche customer avec `savedPaymentMethodId` non-null.
- **Pré-requis** :
  - Tenant `test-t1` actif avec `stripeAccountId: acct_1TgBUq4DuUOJbMhp` + `stripeStatus: ready` (déjà seedé).
  - Fiche customer `kn7…` patchée via Convex dashboard : `db.patch(<customerId>, { savedPaymentMethodId: "pm_test_visa_4242", stripeCustomerId: "cus_test_xxx" })` (créer le `pm_` + `cus_` côté Stripe Dashboard sandbox au préalable).
  - Push enrollment active sur la fiche (Wallet OU webPush OU `noChannelPossible=true`) — sinon le bouton Payer ouvre la modal push.
  - Cart ≥ 1 item, address-first validé (verdict `deliverable` cached).
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. Vérifier que le tile « Payer avec ma carte enregistrée » apparaît pré-sélectionné, avec lien « Utiliser une autre carte ».
  2. DevTools → Network : vérifier qu'AUCUN `m.stripe.com` request n'a fire au mount (saved-card branch ne charge pas `<PaymentElement>`).
  3. Taper « Payer XX € ».
  4. Observer le redirect automatique vers `/c/<orderId>`.
- **Attendu** : tile saved card visible avant clic ; aucun formulaire carte Stripe rendu ; post-clic : `/c/[orderId]` rendu (page tracking S8) ; Stripe Dashboard sandbox montre la commande payée + 240 cts `application_fee` (config 2€/cmd KB).
- **Couvre** : US 45 (saved card cross-resto), US 50 (redirect tracking), AC « Bundle Stripe lazy-loaded même sur saved-card branch » + slice #458 + modules `decidePaymentBranch`, `payWithSavedCard`.

### PAY — Test PAY.2 : Nouvelle carte avec 3DS + Apple Pay button + lazy-load vérifié

- **Acteur** : Sophie sur iPhone Safari, fiche SANS saved card.
- **Pré-requis** : idem PAY.1 mais `savedPaymentMethodId: undefined` sur la fiche customer.
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. DevTools → Network filter `stripe` : naviguer sur `/menu` puis `/panier` AVANT `/checkout` — vérifier qu'aucun request `m.stripe.com` n'a fire.
  2. Naviguer `/checkout`. Vérifier que les requests `m.stripe.com` apparaissent UNIQUEMENT à ce mount.
  3. Vérifier que le Payment Element Stripe s'affiche avec le bouton Apple Pay visible en haut de la modal Stripe.
  4. Saisir la carte test 3DS Stripe `4000 0027 6000 3184`, expiration `12/34`, CVC `123`.
  5. Taper « Payer XX € ».
  6. Sur la sheet 3DS qui s'ouvre, taper « Complete authentication ».
  7. Observer le redirect automatique vers `/c/<orderId>`.
- **Attendu** : étape 1-2 : SDK Stripe absent des bundles `/menu` et `/panier` (acceptance criterion lazy-load) ; étape 3 : Payment Element rendu, Apple Pay button rendered iOS ; étape 5-6 : sheet 3DS Stripe ouverte sans code custom (handled par SDK) ; étape 7 : redirect natif `/c/<orderId>` ; Stripe Dashboard : `payment_intent.succeeded` webhook reçu.
- **Couvre** : US 46 (Payment Element + Apple Pay), US 49 (3DS auto), AC « 3DS handle par SDK sans code custom », AC « Bundle Stripe lazy-loaded » + slice #458 + module `<StripePaymentLazy>` (`next/dynamic({ ssr: false })`).

### PAY — Test PAY.3 : Latching anti-surge — modal bloquante + fresh fee adopté

- **Acteur** : Sophie sur Android Chrome.
- **Pré-requis** :
  - Address validée → verdict cached avec `fee: 350` cts.
  - **Mock backend manuel** : patcher la valeur retournée par `lib/uberDirect/quote.requestQuote` pour qu'elle retourne `{deliverable: true, fee: 590, eta: 1700, quoteId: "qt_surge"}` à la prochaine invocation (vitest mock OR rajout temporaire d'un short-circuit `if (e2eForceSurge) return {...}` côté backend, à retirer après le test).
- **URL de départ** : `https://test-t1.kitchen-boost.com/checkout`
- **Étapes** :
  1. Taper « Payer XX € ».
  2. Observer la modal `<LatchingConfirmModal>` qui s'ouvre avec « Le tarif livraison est passé de 3,50 € à 5,90 € ».
  3. Tenter Esc + tap clic-outside.
  4. Taper « Oui, payer 5,90 € de livraison ».
  5. Observer que le flow continue (Payment Element neuve OR redirect direct saved-card branch selon la fiche).
  6. **Bonus** : refaire le test mais à étape 4 taper « Non » (ou bouton secondaire de retour).
- **Attendu** : étape 2 : modal bloquante affichée, fee old vs new explicit ; étape 3 : Esc / click-outside ne ferment pas la modal (non-skippable) ; étape 4 : flow paiement reprend avec FRESH fee dans le `pricingSnapshot` (Stripe Dashboard : amount = items + 590 cts livraison) ; étape 6 : retour à idle, AUCUNE commande créée côté `orders` Convex.
- **Couvre** : US 47 (latching surge), AC « Latching : surge artificiel → modal confirm bloquant apparaît » + slice #458 + module `decideLatchingOutcome`.

---

## TRK — Tracking realtime + incidents

> **Slices** : #459 (S8 tracking page realtime + incidents — PR #479) · **Statut** : 🟡 EN COURS — 3 scénarios prêts à tester
>
> Couvre : `/c/[orderId]` redirect direct post-paiement (état T+0 « Cmd reçue »), placeholders SVG simples 6 étapes delivery + 3 C&C (Lottie swap V1.1 post HITL-3, non-bloquant), ETA texte live dérivé webhook Uber (`setInterval 30s` countdown entre webhooks), Convex subscription realtime <500ms sans polling, récap items collapsible `<details>` natif (US 53), card « Incident livraison, tu as été remboursé » si `delivery.status ∈ {incident_after_pickup, refused_post_payment}`, URL `/c/[orderId]` non-protégée partageable (orderId Convex Id brut non-devinable + projection minimale sans `customerId`/`customerPhone`/`restaurantNote` pour MOAT ADR 0010).

### TRK — Test TRK.1 : Redirect post-paiement → timeline 6 étapes + collapsible items

- **Acteur** : iPhone Safari OU Android Chrome, anonyme (1ère visite).
- **Pré-requis** : tenant `test-t1` seedé actif, `stripeAccountId: acct_1TgBUq4DuUOJbMhp` + `stripeStatus: ready` (déjà OK), push enrollment active OR `noChannelPossible=true` sur fiche customer (sinon Payer ouvre modal CHK).
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Renseigner adresse Google Places → sélectionner une suggestion livrable.
  2. Choisir 1 item du menu → Ajouter au panier → naviguer `/panier` → tap « Paiement ».
  3. Remplir Prénom + Email + Téléphone (ou prefill si déjà fait au checkout précédent).
  4. Taper « Payer X € » avec carte test `4242 4242 4242 4242`, expiry future, CVC `123`.
  5. Tap « Voir le détail de ma commande » sur la page tracking.
- **Attendu** :
  - Après paiement réussi : redirect AUTO vers `/c/<orderId>` (URL avec id Convex long `j5…` non-devinable).
  - Page « Suivi de commande » rendered, nom du resto en sous-titre.
  - Timeline 6 étapes : « Cmd reçue » en `current` (rond plein vert animé), 5 autres en `pending` (rond vide gris).
  - Bouton « Voir le détail de ma commande » présent → cliquable → déplie items + adresse + total.
  - URL bar = `/c/<orderId>` (pas de `?param` polluant).
- **Couvre** : US 50 (redirect direct), US 51 (timeline + animations), US 53 (collapsible `<details>` natif) + slice #459 + module `decideTrackingSteps`.

### TRK — Test TRK.2 : Convex sub realtime <500ms entre changements KB Orders (US 52)

- **Acteur** : iPhone Safari avec PWA ouverte sur `/c/<orderId>` (laisser l'onglet visible) + tablette KB Orders côté `kb_manager`.
- **Pré-requis** : TRK.1 effectué, commande en statut `nouvelle`, accès `/orders` apps/admin connecté `kb_manager` du tenant `test-t1`.
- **URL de départ** : `https://test-t1.kitchen-boost.com/c/<orderId>` (déjà ouverte sur iPhone).
- **Étapes** :
  1. Sur la tablette KB Orders, trouver la nouvelle commande → tap « Accepter » → status `en préparation`.
  2. **Observer l'iPhone en parallèle, chronomètre en main.**
  3. Sur KB Orders, tap « Prête » → status `prête`.
  4. **Observer l'iPhone à nouveau.**
- **Attendu** :
  - L'iPhone met à jour la timeline EN MOINS DE 500ms après chaque action KB Orders (sans recharger la page, sans polling visible Network).
  - Étape 1 : « En préparation » passe `current`, « Cmd reçue » passe `done`.
  - Étape 3 : « Prête » passe `current`, « En préparation » passe `done`.
  - AUCUN reload visuel (pas de flash blanc).
- **Couvre** : US 52 (Convex sub realtime), AC #459 « Webhook simulé → re-render <500ms » + slice #459 + Convex live query.

### TRK — Test TRK.3 : URL partageable cross-device + card incident remboursé (US 54, 55)

- **Acteur** : 2 devices physiques distincts — téléphone A iOS Safari (proprio commande) + téléphone B Android Chrome (jamais visité ce tenant).
- **Pré-requis** : TRK.1 effectué sur téléphone A → copier l'URL `/c/<orderId>` complète. Accès Convex dashboard pour patch DB.
- **URL de départ** : URL `/c/<orderId>` du téléphone A → coller dans Android Chrome incognito du téléphone B.
- **Étapes** :
  1. Sur téléphone B (Android Chrome incognito), coller l'URL et charger.
  2. Vérifier que la page tracking s'affiche normalement (PAS de mur d'auth, PAS de « connecte-toi »).
  3. Vérifier que les champs MOAT-protégés NE sont PAS affichés : pas de prénom client, pas de téléphone, pas de Note resto (projection minimale ADR 0010).
  4. Depuis Convex dashboard : patcher le doc `deliveries` correspondant à l'orderId — `db.patch(<deliveryId>, { incidentType: "incident_after_pickup", status: "failed" })`.
  5. Observer téléphone A (toujours sur la page, ne pas recharger) ET refresh téléphone B.
- **Attendu** :
  - Étape 2 : timeline rendered identique au téléphone A (URL publique fonctionne sans cookie auth ni session).
  - Étape 3 : aucune fuite PII vérifiable dans le DOM.
  - Étape 5 : les 2 téléphones affichent une card rouge « Incident livraison » avec icône SVG + message « Ta commande n'a pas pu être livrée. Tu as été remboursé automatiquement. » ; téléphone A reçoit le changement <500ms sans refresh (Convex sub).
- **Couvre** : US 54 (incident card), US 55 (URL partageable non-protégée), MOAT ADR 0010 (projection minimale) + slice #459 + modules `decideIncident`, `getOrderTracking` (publicTenantQuery).

---

## WAL — Wallet pass install + bridge identité

> **Slices** : #460 (S9a Wallet install button + 3 paliers) + #461 (S9b Wallet bridge identité au tap deep-link) · **Statut** : 🟡 EN COURS — 4 scénarios prêts à tester
>
> Couvre : palier 1 (card pleine page après submit address-first, dismissable "Plus tard"), palier 2 (bandeau permanent menu/panier, dismissable session-scoped), palier 3 = modal CHK ci-dessus, install effectif iPhone Safari (Blob `.pkpass` MIME sheet natif Apple Wallet), install effectif Android Chrome (`googleSaveLink` Google Wallet preview), Convex sub flip `walletStatus = "enrolled"` au webhook `pass_installed`, bridge identité au tap deep-link `?wallet=<serial>` (re-signIn cookie session sur customer global → firstName + address + savedPaymentMethodId cross-device/cross-resto immédiats), re-branding pass à chaque cmd nouveau resto via `triggerUpdate.recordBrandChange` silent push.

### WAL — Test WAL.1 : Palier 1 card pleine page post-address-first + palier 2 bandeau session-scoped

- **Acteur** : iPhone Safari OU Android Chrome, anonyme frais (mode privé).
- **Pré-requis** : tenant `test-t1` actif, customer `pushEnrollment.walletStatus` absent ou `not_enrolled`.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Mode privé, taper adresse Paris dans périmètre livraison → sélectionner suggestion.
  2. Observer la card.
  3. Cliquer « Plus tard → ».
  4. Sur `/menu`, observer le haut de page.
  5. Ajouter article au panier → naviguer `/panier`.
  6. Cliquer « × » sur le bandeau /panier.
  7. Naviguer `/menu` (lien « ← Retour au menu »).
  8. Fermer l'onglet, ré-ouvrir `https://test-t1.kitchen-boost.com/menu` dans un nouvel onglet.
- **Attendu** : étape 2 : la page ne navigue PAS direct vers `/menu` — card pleine page avec emoji 🎁, titre « -10% sur ta prochaine commande », bouton primary « Ajouter à mon Wallet », lien skip « Plus tard → » ; étape 3 : navigation immédiate `/menu` ; étape 4 : bandeau fin vert clair en haut avec « 🎁 -10% offerts → ajoute la carte » + « × » à droite ; étape 5 : même bandeau sur `/panier` ; étape 6 : bandeau disparaît immédiatement ; étape 7 : bandeau reste caché (sessionStorage partagée intra-tab) ; étape 8 : bandeau RÉAPPARAÎT (sessionStorage neuve par tab).
- **Couvre** : US 27, US 28 + slice #474 + module `decideWalletPromptVisibility`.

### WAL — Test WAL.2 : Install Wallet effectif → 3 paliers cachés via Convex sub realtime

- **Acteur** : iPhone Safari (Apple Wallet) OU Android Chrome (Google Wallet).
- **Pré-requis** : card palier 1 visible (WAL.1 étape 2).
- **URL de départ** : (depuis card palier 1)
- **Étapes** :
  1. Depuis l'écran card palier 1, cliquer « Ajouter à mon Wallet ».
  2. iOS : sheet Apple Wallet → « Ajouter ». Android : redirige vers Google Wallet preview (`pay.google.com/gp/v/save/...`) → « Ajouter ».
  3. Revenir à l'onglet PWA.
  4. Sur `/menu` : observer bandeau palier 2.
  5. Naviguer `/panier`.
  6. Refresh `/menu`.
- **Attendu** : étape 3 : card palier 1 disparaît automatiquement et navigation vers `/menu` (Convex sub `walletStatus` flip `enrolled` → `useEffect` fire `onSkip`) ; étape 4 : bandeau palier 2 ne s'affiche PAS (même Convex sub veto) ; étape 5-6 : bandeau reste caché (state persisté côté serveur).
- **Couvre** : US 27, US 28, US 32 (Android Wallet install) + slices #474 + #455 + modules `decideWalletPromptVisibility`, `<AddToWalletButton>`.

### WAL — Test WAL.3 : Bridge identité device B brand-new (tap pass sur autre device)

- **Acteur** : device B iPhone (jamais ouvert `test-t1.kitchen-boost.com`, mode privé Safari) ; device A pour préparer le pass.
- **Pré-requis** : sur device A, checkout terminé jusqu'à install pass Wallet réel (fiche customer global avec `firstName + address + walletSerialNumber`) ; serial number récupéré (tap pass dans Apple Wallet → « (i) » info → champ « Serial Number » OR Convex dashboard `walletPasses.by_serial`).
- **URL de départ** : `https://test-t1.kitchen-boost.com/?wallet=<serialNumber>` (simule tap pass)
- **Étapes** :
  1. Sur device B, ouvrir l'URL avec serial valide.
  2. Vérifier la URL bar.
  3. Attendre 1-2s puis refresh la page.
  4. Inspecter cookies dans DevTools Safari.
- **Attendu** : étape 2 : redirection 307 immédiate vers `https://test-t1.kitchen-boost.com/` (URL propre, plus de `?wallet=` dans l'URL bar) ; étape 3 : champ adresse PRÉ-REMPLI silencieusement avec l'adresse Sophie de device A (fiche customer globale résolue via bridge) ; étape 4 : cookie `__Host-kb_wallet_bridge_pending` a DISPARU (clear API hit OK).
- **Couvre** : US 40 + slice #475 + module `decideWalletBridgeInterception`, `WalletBridge` ConvexCredentials provider.

### WAL — Test WAL.4 : Bridge cross-resto + serial invalide + deep-link sous-route

- **Acteur** : device A iPhone (cookies device A intacts) + device B fresh.
- **Pré-requis** : 2 tenants actifs (`test-t1` + `test-t2`), Sophie a déjà commandé sur `test-t1` (savedPaymentMethodId stripe), serial valide récupéré.
- **URL de départ** : `https://test-t2.kitchen-boost.com/?wallet=<serialNumber>` (cross-resto) puis 3 cas invalides.
- **Étapes** :
  1. Sur device A, ouvrir l'URL cross-resto avec serial valide. Vérifier URL bar + cookie tenant.
  2. Refresh la page.
  3. Terminer un checkout sur `test-t2` (Sophie n'y a JAMAIS commandé).
  4. Sur device B (vide cookies), ouvrir `https://test-t1.kitchen-boost.com/?wallet=fake-not-a-real-serial-99999`.
  5. Sur device B, ouvrir `https://test-t1.kitchen-boost.com/?wallet=abc` (trop court) et `?wallet=` (vide).
  6. Sur device B, ouvrir `https://test-t1.kitchen-boost.com/menu?wallet=<serialNumber>` (deep-link sous-route).
- **Attendu** : étape 1 : redirection 307 vers `https://test-t2.kitchen-boost.com/` (URL propre), cookie `__Host-kb_tenant` = id La Table Libanaise ; étape 2 : address-first pré-rempli avec adresse Sophie (même customer global cross-tenant) ; étape 3 : checkout réutilise `savedPaymentMethodId` Sophie (clone Stripe Customer cross-tenant — chantier 2.5-D), pas de re-saisie carte ; étape 4 : 307 vers URL propre, PAS de cookie `_pending` (fail closed côté backend — `null` retourné), UI ne crash pas, address-first s'affiche normalement ; étape 5 : URL clean, pas de cookie, pas de bridge (`strip-only` côté middleware) ; étape 6 : 307 vers `https://test-t1.kitchen-boost.com/menu` (path préservé), `<WalletBridgeRunner>` s'active sur `/menu` aussi, refresh → menu Test Restaurant 1 avec session Sophie bridgée.
- **Couvre** : US 41, US 42 + slice #475 + module `decideWalletBridgeInterception`.

---

## A2H — A2HS install (Android + iOS)

> **Slices** : #462 (S10 A2HS Android post-cart) + #463 (S11 A2HS iOS post-tracking — PR #480) · **Statut** : 🟡 EN COURS — 5 scénarios prêts à tester (2 Android + 3 iOS)
>
> Couvre : Android `beforeinstallprompt` capturé en `<PWAInstallContext>`, bouton install bottom-right rendered après 1er add cart, click → prompt natif Android, accept → `appinstalled` event → `recordA2hsAccepted` flip `a2hsStatus = "enrolled"`, masquage bouton à la visite suivante via Convex sub. iOS bottom-sheet Vaul sur `/c/[orderId]` état T+0 (GIF 8s loop Share→"Sur l'écran d'accueil"→"Ajouter"), heuristique standalone à la visite suivante (`matchMedia('(display-mode: standalone)').matches` + flip enrolled).

### A2H — Test A2H.1 : Android Chrome install accepté → flip enrolled → bouton disparaît + iOS bouton JAMAIS visible

- **Acteur** : téléphone Android avec Chrome ET iPhone avec Safari (test en parallèle).
- **Pré-requis** : tenant `test-t1`, accès Convex dashboard pour vérif backend.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes (Android)** :
  1. Sur Android Chrome, valider l'adresse address-first, attendre `/menu`.
  2. Observer absence de bouton (cart vide).
  3. Ajouter un item au panier depuis `/menu`.
  4. Tap sur le bouton `📲 Installer Test Restaurant 1` (bottom-right).
  5. Dans la sheet Chrome native, tap « Installer ».
  6. Vérifier home screen + bouton.
  7. Rouvrir le PWA depuis l'icône (mode standalone), naviguer add cart → `/menu` → `/panier`.
  8. Vérifier backend Convex.
- **Étapes (iOS en parallèle)** : 9. Sur iPhone Safari, address-first → `/menu` → add 1, 2, puis 3 items → naviguer entre `/menu` et `/panier` plusieurs fois. 10. Vérifier backend Convex pour ce customer iOS.
- **Attendu** : étape 2 : aucun bouton (cart vide gate) ; étape 3 : bouton vert pill `📲 Installer Test Restaurant 1` apparaît bottom-right sur `/menu` ET `/panier` ; étape 4-5 : sheet native Android Chrome s'ouvre, install OK ; étape 6 : PWA s'installe sur écran d'accueil, bouton flottant disparaît immédiatement `/menu` ET `/panier` ; étape 8 : doc `customers` a `pushEnrollment.a2hsStatus = "enrolled"` + nouveau row `auditLog` avec `action = "customer.pushEnrollment.recordA2hsAccepted"`, `actorRole = "customer"`, `targetType = "customer"`, `targetId = <customerId>` ; étape 9 : **aucun bouton « Installer » n'apparaît jamais** sur iOS (iOS Safari ne fire jamais `beforeinstallprompt`) ; étape 10 : doc `customers` iOS n'a **aucun** `a2hsStatus` posé, aucun `auditLog recordA2hsAccepted`.
- **Couvre** : US 56, US 57, US 59 + slice #462 + module `decideA2hsButtonVisibility`, `<PWAInstallProvider>`, `recordA2hsAccepted` mutation.

### A2H — Test A2H.2 : Android install dismissed → bouton disparaît mais `a2hsStatus` PAS posé (event single-use spec)

- **Acteur** : Android Chrome, domaine resto frais (mode incognito ou autre device pour `beforeinstallprompt` non consommé).
- **Pré-requis** : `beforeinstallprompt` disponible (mode incognito).
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Mode incognito Android Chrome, address-first → add cart sur `/menu`.
  2. Observer bouton « 📲 Installer ».
  3. Tap sur le bouton, puis dans la sheet Chrome native tap **« Annuler »** (ou close gesture).
  4. Vérifier disparition du bouton ET backend.
  5. Recharger la page (pull-to-refresh).
- **Attendu** : étape 2 : bouton « 📲 Installer » apparaît ; étape 4 : bouton **disparaît** (event single-use spec → `clearPrompt()` dans le `finally`), mais doc `customers` n'a **pas** de `pushEnrollment.a2hsStatus` posé, **aucun** auditLog `recordA2hsAccepted` (le `userChoice.outcome === "dismissed"` n'a pas trigger la mutation) ; étape 5 : Chrome PEUT re-firer un nouveau `beforeinstallprompt` (heuristique propriétaire) — si oui, bouton ré-apparaît post-cart ; si non, OK (palier soft, pas blocker).
- **Couvre** : US 56 (event single-use) + slice #462 + module `decideA2hsButtonVisibility`.

### A2H — Test A2H.3 : iOS Safari sur tracking T+0 → bottom-sheet visible + dismiss session-scoped

- **Acteur** : iPhone Safari (cookie + cache vidés), mode privé. Tester aussi iPad Safari si dispo.
- **Pré-requis** : tenant `test-t1` actif (seeds e2e OK), customer `pushEnrollment.a2hsStatus` absent ou `not_enrolled`, Stripe sandbox + Uber Direct sandbox configurés.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Address-first → menu → add cart → `/checkout` → push enrollment (Wallet OR `noChannelPossible=true` pour débloquer) → payer carte test `4242 4242 4242 4242`.
  2. Observer la page `/c/<orderId>` directement après redirect post-paiement.
  3. Toucher « OK plus tard » dans la bottom-sheet.
  4. Recharger `/c/<orderId>`.
  5. Naviguer `/menu` puis revenir `/c/<orderId>`.
  6. Fermer Safari complètement (swipe-up app switcher → close tab), ré-ouvrir `https://test-t1.kitchen-boost.com/c/<orderId>` dans un nouvel onglet.
- **Attendu** : étape 2 : bottom-sheet Vaul s'ouvre depuis le bas avec titre « Ajoute ce resto à ton écran d'accueil », illustration 3 étapes inline SVG (1. Touche l'icône Partager + icône share / 2. Choisis Sur l'écran d'accueil / 3. Confirme avec Ajouter — animation pulse sur l'icône finale) + bouton « OK plus tard » ; étape 3 : drawer se ferme ; étape 4-5 : bottom-sheet **ne réapparaît PAS** (sessionStorage `kb_a2hs_ios_sheet_dismissed = "1"`) ; étape 6 : bottom-sheet **réapparaît** (nouvelle session = nouveau sessionStorage).
- **Couvre** : US 58 + slice #463 + modules `decideIosBottomSheetVisibility`, `isIosSafari`, `A2HS_IOS_SHEET_DISMISS_KEY`.

### A2H — Test A2H.4 : Install A2HS iOS → revisit standalone → `a2hsStatus = "enrolled"` flip + sheet disparaît

- **Acteur** : iPhone Safari (suite de A2H.3).
- **Pré-requis** : A2H.3 effectué (au moins étape 2 OK pour avoir le orderId), accès Convex dashboard pour vérif backend.
- **URL de départ** : `https://test-t1.kitchen-boost.com/c/<orderId>` (sheet ouverte ou dismissed peu importe).
- **Étapes** :
  1. Dans Safari, tap l'icône Partager (rectangle avec flèche vers le haut, en bas de l'écran).
  2. Faire défiler la liste, taper « Sur l'écran d'accueil ».
  3. Confirmer le nom du raccourci, taper « Ajouter ».
  4. Sortir de Safari (Home button / swipe up) → lancer la PWA depuis l'icône fraîchement ajoutée à l'écran d'accueil.
  5. Naviguer une page quelconque (`/`, `/menu`, ou re-ouvrir `/c/<orderId>` via partage SMS).
  6. Vérifier la doc `customers` correspondante dans Convex dashboard.
- **Attendu** :
  - Étape 4 : la PWA s'ouvre sans barre d'URL Safari (`display-mode: standalone`).
  - Étape 5 : bottom-sheet **n'apparaît PAS** sur `/c/<orderId>` (déjà standalone → décision retourne `hidden / already-standalone` + `<IOSStandaloneHeuristicRunner>` fire la mutation).
  - Étape 6 : doc `customers` a `pushEnrollment.a2hsStatus = "enrolled"` ; nouveau row `auditLog` avec `action: "customer.pushEnrollment.recordA2hsAccepted"`, `actorRole: "customer"`, `targetType: "customer"`, `targetId: <customerId>`. **Un seul row** par installation (single-fire ref + idempotence pure decision).
- **Couvre** : US 59 + slice #463 + modules `decideIosStandaloneHeuristic`, `<IOSStandaloneHeuristicRunner>`, `recordA2hsAccepted` mutation.

### A2H — Test A2H.5 : Android Chrome → bottom-sheet iOS jamais visible (iOS-only assertion)

- **Acteur** : Android Chrome (incognito).
- **Pré-requis** : tenant `test-t1` actif, flow checkout complet possible.
- **URL de départ** : `https://test-t1.kitchen-boost.com/c/<orderId>` (atteindre via checkout normal).
- **Étapes** :
  1. Sur Android Chrome incognito, compléter un flow checkout normal jusqu'à `/c/<orderId>` (cf. TRK.1 étapes 1-4).
  2. Observer la page tracking attentivement (timeline + détail commande).
  3. Naviguer `/menu` puis revenir `/c/<orderId>`.
- **Attendu** : **aucune bottom-sheet iOS** ne s'affiche à AUCUNE étape (UA gate `isIosSafari` rejette Android). Le bouton flottant `<AndroidInstallButton>` (#462) reste fonctionnel par contre sur `/menu` ET `/panier` — c'est sa branche dédiée. (Note : la matrice complète des in-app browsers iOS — Instagram/Facebook/TikTok/etc. — est couverte par 34 unit tests `is-ios-safari` dans la PR, pas nécessaire de retester en E2E manuel.)
- **Couvre** : US 58 AC 4 « Android → bottom sheet n'apparaît jamais » + slice #463 + module `isIosSafari` (rejection matrix).

---

## REC — Recognition retour

> **Slices** : #464 (S12 Bandeau « Bonjour firstName » + « Ce n'est pas moi » — PR #481) · **Statut** : 🟡 EN COURS — 2 scénarios prêts à tester
>
> Couvre : 3 branches `decideReturnGreeting` (`banner` / `silent` / `none`). Branche `banner` (fiche avec firstName) → bandeau « Bonjour {firstName} 👋 » au-dessus du form + subtitle « Confirme ton adresse de livraison, ou modifie-la. » + form Google Places pré-rempli + lien discret « Ce n'est pas moi → ». Branche `silent` (fiche avec adresse mais sans firstName) → AUCUN bandeau, juste prefill silencieux + lien désaveu. Branche `none` (1ère visite, pas de cookie) → form vide, subtitle « Indique-nous ton adresse, on vérifie si on peut te livrer. », aucun lien. Click « Ce n'est pas moi → » → `signOut()` SDK + POST `/api/signout` (HttpOnly cookies SDK) + `window.location.reload()` → retour état branche `none`. **Garde-fou Q3 « hospitality vs surveillance » enforced by type** : `decideReturnGreeting` ne surface QUE `firstName` (whitelist pinned par test sur `Object.keys`) — aucune adresse, aucun historique, aucun `lastCheckoutAt`.
>
> **Baseline implicite (branche `none`)** : 1ère visite mode privé → bandeau absent, lien absent, form vide, subtitle « Indique-nous ton adresse… ». Couverte par 7 unit tests vitest dans la PR + visuellement vérifiable en début de chaque autre test E2E quand l'environnement est reset (pas dédupliquée en scénario E2E dédié).

### REC — Test REC.1 : 2ᵉ visite avec firstName → bandeau + prefill + « Ce n'est pas moi → » reset

- **Acteur** : iPhone Safari OU Android Chrome, session normale (PAS mode privé — cookies persistants).
- **Pré-requis** : avoir fait un checkout complet sur ce device + ce resto (fiche `customers` a `firstName` + `address` stampés via S7). Sinon seed manuel Convex : `db.patch(<customerId>, { firstName: "Sophie", address: "10 rue de la Paix, Paris" })` sur la fiche du `userId` correspondant au cookie présent.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Ouvrir l'URL.
  2. Observer le bandeau au-dessus du form + le subtitle + le contenu du champ Google Places.
  3. DevTools → DOM : vérifier l'absence de toute mention « adresse », « dernière commande », « historique », etc. dans le bandeau (audit visuel garde-fou anti-surveillance).
  4. Cliquer le lien « Ce n'est pas moi → » sous le form.
  5. Attendre le reload auto.
  6. DevTools → Cookies : vérifier les cookies après reload.
- **Attendu** :
  - Étape 2 : bandeau **« Bonjour Sophie 👋 »** visible au-dessus du form ; subtitle = **« Confirme ton adresse de livraison, ou modifie-la. »** ; champ Google Places pré-rempli avec « 10 rue de la Paix, Paris » ; lien discret « Ce n'est pas moi → » visible sous le form (font-size petit, gris).
  - Étape 3 : aucun texte « On a ton adresse » / « Voici tes X dernières commandes » / mention historique — UNIQUEMENT le firstName apparaît côté bandeau (Q3 hospitality vs surveillance).
  - Étape 5 : bandeau **disparu**, form **vide**, subtitle = « Indique-nous ton adresse, on vérifie si on peut te livrer. » (état branche `none`).
  - Étape 6 : cookie `__Host-kb_tenant` toujours présent (le resto résolu n'a pas changé — Q3 cohabitation rule) ; cookies `__Host-` SDK Convex Auth SUPPRIMÉS.
- **Couvre** : US 9 (banner), US 10, 11, 12, 13 + slice #464 + modules `decideReturnGreeting`, `<GreetingBanner>`, `<NotMeLink>`, `makeNotMeHandlers`, `/api/signout` route handler.

### REC — Test REC.2 : Cookie présent + adresse SANS firstName → branche `silent` (prefill sans bandeau)

- **Acteur** : iPhone Safari OU Android Chrome.
- **Pré-requis** : avoir validé une adresse en S3 (`requestDeliveryQuote` OK) mais **JAMAIS** finalisé un checkout S7 (fiche `customers` a `address` stampée mais `firstName` undefined/null). Sinon seed manuel Convex : `db.patch(<customerId>, { firstName: undefined, address: "20 rue Cler, Paris" })`.
- **URL de départ** : `https://test-t1.kitchen-boost.com/`
- **Étapes** :
  1. Ouvrir l'URL.
  2. Observer le haut de page + le champ Google Places + le lien sous le form.
- **Attendu** :
  - **AUCUN bandeau** « Bonjour … » (firstName absent → branche `silent`).
  - Subtitle = « Confirme ton adresse de livraison, ou modifie-la. » (prefill détecté quand même).
  - Form Google Places pré-rempli avec « 20 rue Cler, Paris ».
  - Lien « Ce n'est pas moi → » **visible** (la fiche est désavouable même sans nom).
- **Couvre** : US 9 (cas silent) + slice #464 + module `decideReturnGreeting` (branche `silent`).

---

## Notes méthodologie campagne

### Comment l'orchestrateur peuple ce fichier

Pour chaque PR sub-agent qui merge :

1. **Récupérer** les 1-3 scénarios E2E proposés dans la description PR (constraint non-négociable cf. issues #449-#464 bloc Constraints).
2. **Filtrer** :
   - Écarter les tautologies ("le bouton apparaît quand on le rend visible")
   - Écarter les tests trop bas-niveau ("le bouton est vert") — couverts par audit visuel inline, pas un test E2E dédié
   - Écarter les redondances avec scénarios déjà présents dans un autre groupe
   - Écarter les tests qui dupliquent un unit test déjà mergé avec le code (les unit tests sont écrits par l'agent dans la PR, on ne les redoit pas en E2E manuel)
3. **Agréger** : fusionner les scénarios qui peuvent se chaîner en 1 parcours continu plus efficace. Exemple : "S4 add cart depuis menu" + "S5 toggle livraison/C&C" → 1 scénario "Groupe M : Menu → add cart Smash Burger → toggle livraison → fees re-calculés" plutôt que 2 scénarios isolés.
4. **Inscrire** dans le bon groupe avec format strict **Acteur / Pré-requis / URL de départ / Étapes / Attendu / Couvre**.
5. **Mettre à jour le statut du groupe** : `⏳ EN ATTENTE` → `🟡 EN COURS — X scénarios prêts à tester` → `✅ X/X validés` une fois testé sur device réel par Alex.

### Tests NON couverts par ce fichier

- **Tests unitaires + cross-tenant fuzz + tests React Testing Library** : réalisés directement par les sub-agents dans leur PR, mergés avec le code (vitest, mock convex/react, etc.). Pas filtrés par l'orchestrateur — c'est l'agent qui implémente qui les écrit. Référence : pattern `apps/admin` fichiers `.test.tsx` validé.
- **Snapshots UI** : non utilisés (brittle, couverts par E2E manuel ici).
- **Tests automatisés Playwright/Cypress** : V1 = manuel sur device, retour V2 si volume justifie.

### Devices cibles V1

| Device                                 | OS              | Browser | Cas couverts                                                                                                                                                                  |
| -------------------------------------- | --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone 15+                             | iOS 17+         | Safari  | A2HS bottom-sheet GIF, Wallet `.pkpass` Blob sheet, Apple Pay, push Wallet, iOS <16.4 Web Push masking (test secondaire sur iPhone OS 15 si dispo)                            |
| Android récent (Pixel 8 ou équivalent) | Android 14+     | Chrome  | A2HS `beforeinstallprompt`, Google Wallet preview, Google Pay, Web Push, `actionUri` deep-link                                                                                |
| Desktop fallback                       | macOS / Windows | Chrome  | Vérification : bouton Wallet désactivé "Disponible sur mobile uniquement", message "Continue depuis ton mobile pour finaliser" au modal push enrollment (PRD V1 mobile-first) |
