# PWA Client — Breakdown vertical slices (pour /to-issues)

**Statut** : Validé par Alex 2026-06-04 (granularité + corrections audit). En attente feu vert explicite pour publish GitHub.
**Source** : `01-prd-master.md` (66 user stories) + `decisions-log.md` Q1→Q8.
**Cible** : `NativeSquare/kitchen-boost-repo`.
**Convention triage** : `ready-for-agent` pour AFK, `ready-for-human` pour HITL.

---

## Constraints applicables à TOUTES les slices AFK

Chaque issue publiée DOIT contenir un bloc Constraints identique à celui-ci, copié verbatim :

```
## Constraints (NON-NÉGOCIABLE)

- **Code uniquement dans `apps/web`** — INTERDICTION ABSOLUE de modifier `apps/admin`
  (campagne E2E V1 admin validée 12/12 groupes 2026-06-03, code freeze). Backend OK à
  étendre dans `packages/backend/convex/` si nouvelle mutation/query/action PWA-spécifique
  nécessaire (utiliser les wrappers sanctionnés `customerQuery/customerMutation/publicTenantQuery`,
  cf. ADR 0010/0011). Aussi OK : ajouter routes Apple PassKit dans `apps/admin/api/wallet/*`
  UNIQUEMENT si extension d'un endpoint existant (les 3 routes pass/registrations/push y vivent
  déjà par convention domaine neutre — c'est l'EXCEPTION, pas la règle).

- **Plan de test E2E** — la description de la PR doit inclure **1 à 3 scénarios E2E manuels**
  validables sur device réel (iPhone Safari OU Android Chrome), qui démontrent que la story
  est implémentée end-to-end (pas juste les tests unitaires). Format : numérotés, étape par
  étape, avec attendu observable. Ces scénarios alimenteront la campagne E2E V1 PWA client
  post-implémentation (cf. PRD section Testing Decisions, groupes A/M/C/CHK/PAY/TRK/WAL/A2H/REC).
```

---

## Légende

- **AFK** : un sub-agent peut implémenter end-to-end sans intervention humaine
- **HITL** : besoin d'action humaine (config externe, validation design, ops manuelle)
- **Blocked by** : doit attendre que ces slices soient mergées
- **User stories covered** : numéros des US du PRD `01-prd-master.md` (cf. mapping section "User Stories" du PRD)
- **Decision refs** : numéros Q tranchées dans le grilling (decisions-log.md)

---

## 18 vertical slices

### Pré-requis HITL — infra externe (3 stories ops)

#### HITL-1 — Provisionner wildcard DNS `*.kitchen-boost.com` chez registrar

**Type** : HITL · **Blocked by** : aucun · **Decision refs** : Q1 · **User stories covered** : US 1 (foundation pour résolution tenant via hostname)

**Action** : ajouter CNAME wildcard `*.kitchen-boost.com` → Vercel chez registrar. Vérifier propagation.

**Acceptance** :

- [ ] `dig test.kitchen-boost.com` retourne IP Vercel
- [ ] `bunsbao.kitchen-boost.com` accessible (même si la PWA n'est pas encore déployée, le DNS résout)

#### HITL-2 — Configurer Vercel project (region + env vars + domains)

**Type** : HITL · **Blocked by** : HITL-1 · **Decision refs** : Q1, Q6, Q7 · **User stories covered** : US 1, US 46 (Stripe key) et infrastructure générale

**Action** : créer project Vercel `apps/web`, pin region `cdg1` (Paris) ou `fra1` (Frankfurt), ajouter env vars (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`), ajouter wildcard domain `*.kitchen-boost.com`.

**Acceptance** :

- [ ] Vercel deploy preview accessible sur `<branch>.kitchen-boost.com`
- [ ] Env vars visibles dans Vercel dashboard
- [ ] Region pinning confirmé sur project settings

#### HITL-3 — Assets Lottie (6 delivery + 3 C&C + 1 incident)

**Type** : HITL · **Blocked by** : aucun · **Decision refs** : Q7 · **User stories covered** : US 51 (animations + ETA), US 54 (Lottie incident)
**Note** : NON bloquant S8 — placeholders SVG simples utilisés en attendant (swap quand assets livrés via PR cosmétique séparée).

**Action** : briefer designer, livrer 10 fichiers `.lottie` ou `.json` dans `apps/web/public/lottie/`.

**Acceptance** :

- [ ] 10 fichiers livrés, dimensions cohérentes (1:1 carré, 200×200px ou 400×400px)
- [ ] Loop OK pour 9 fichiers, animation incident non-loop (one-shot)
- [ ] Poids total < 500 KB (compatible 4G mobile)

---

### Phase 1 — Foundation shell (3 stories AFK séquentielles)

#### S1 — Tenant resolution shell (middleware + scrap legacy)

**Type** : AFK · **Blocked by** : aucun · **Decision refs** : Q1 · **User stories covered** : US 1 (logo + color visibles, foundation), US 67 (tenant orphan cookie → page erreur)

**Vertical slice** :

- Backend Convex : `tenants.bySlug` + `tenants.byCustomDomain` + `tenants.brandingByHost` exposés en `publicTenantQuery`
- Frontend : `apps/web/middleware.ts` middleware Edge — résout tenantId depuis host, pose cookie `__Host-kb_tenant=<id>` 30j, `NextResponse.rewrite`
- Frontend : root layout vide branded color + scrap `apps/web/src/app/(auth)/*` + `(app)/dashboard` + composants legacy associés
- Tests unitaires : middleware (hostname → tenantId), cookie cache hit/miss, tenant orphan, cross-tenant fuzz

**Acceptance** :

- [ ] Visite `bunsbao.kitchen-boost.com` → cookie posé visible DevTools Application > Cookies
- [ ] Visite avec cookie présent → middleware ne re-query pas Convex (check logs)
- [ ] Visite host inconnu → page erreur "Resto non disponible"
- [ ] Visite tenant supprimé (cookie stale) → clear cookie + page erreur
- [ ] Scaffold legacy auth/dashboard supprimé, `pnpm typecheck` passe
- [ ] Test cross-tenant fuzz vert : cookie tenant A ne donne pas accès données tenant B

**Constraints** : cf. bloc en tête de ce fichier.

#### S2 — PWA shell (manifest + service worker + icons + .well-known)

**Type** : AFK · **Blocked by** : S1 · **Decision refs** : Q2, Q4 · **User stories covered** : US 1 (manifest branded), US 60 (SW affiche push avec emoji prefix verbatim payload), US 61 (notificationclick deep-link tracking)

**Vertical slice** :

- Frontend : `app/manifest.webmanifest/route.ts` dynamic per host (logo + color + name)
- Frontend : `app/icon-192.png/route.ts` + `app/icon-512.png/route.ts` + `app/apple-touch-icon.png/route.ts` (pipe `ctx.storage.get(tenant.logoStorageId)`)
- Frontend : `public/sw.js` minimal (~50 lignes) — handlers `install` (skipWaiting), `activate` (claim), `push` (showNotification avec `tag: orderId|campaignId` pour collapse), `notificationclick` (deep-link via `clients.openWindow` / focus+navigate existing window)
- Frontend : composant `<ServiceWorkerRegistration>` mount root layout (useEffect non-blocking, échec silencieux)
- Frontend : `public/.well-known/apple-developer-merchantid-domain-association` (fichier static partagé pour Apple Pay verification)
- Tests : manifest renvoie JSON branded par host (snapshot test), SW handler `push` affiche notification avec title verbatim, `notificationclick` open URL du payload

**Acceptance** :

- [ ] Android Chrome DevTools "Application" → manifest correct + SW active
- [ ] Logo + color spécifiques au tenant visibles dans manifest
- [ ] Manifest cacheable (Cache-Control 1h)
- [ ] Fichier `.well-known/...` accessible HTTP 200
- [ ] **SW affiche push notifications avec le `title` verbatim du payload** (le payload backend contient déjà l'emoji prefix + nom resto formatés, ex: "🥢 Buns & Bao : -20% bao ce soir")
- [ ] Tap notification → `clients.openWindow(payload.data.url)` → ouvre la PWA à l'URL deep-link spécifiée
- [ ] Update SW → `skipWaiting + clients.claim` → nouvelle version active au prochain hit sans toast user

**Constraints** : cf. bloc en tête de ce fichier.

#### S3 — Address-first flow (Google Places + quote Uber + signIn anonymous)

**Type** : AFK · **Blocked by** : S1 · **Decision refs** : Q3, Q7 · **User stories covered** : US 2, 3, 4, 5, 6, 7, 8

**Vertical slice** :

- Backend : override `auth.ts` session lifetime à 365j (`totalDurationMs` + `inactiveDurationMs`)
- Frontend : `app/page.tsx` RSC qui lit `convexAuthNextjsToken()` + `preloadQuery(getCurrentCustomer)` (pour pré-remplissage 2ᵉ visite — silencieux à ce stade, bandeau "Bonjour" arrive S12)
- Frontend : composant `<AddressFirstForm>` avec `@googlemaps/js-api-loader` Places Autocomplete (`componentRestrictions: { country: 'fr' }`, `types: ['address']`)
- Frontend : auto-validate au sélection suggestion → chain async : `signIn("anonymous")` → `getOrCreateCurrentCustomer` → `updateAddress({address, lat, lng})` → action `delivery.quote.requestDeliveryQuote`
- Frontend : redirect selon verdict : `deliverable` → `/menu` ; `hors_zone` → toast "trop éloignée" + bouton "Voir le menu (retrait sur place)" ; `hors_horaire` → message contextualisé + checkout désactivé ; `surge` → "Indisponible à cet horaire, réessaie" + bouton Retry
- Tests : chain submit → quote → redirect par verdict (mock Google Places + mock action quote)

**Acceptance** :

- [ ] Type adresse → suggestion sélection → spinner "On vérifie la livraison…" → quote <1s → redirect `/menu`
- [ ] Adresse hors zone → message + bouton C&C
- [ ] Resto fermé → message contextualisé avec heure d'ouverture
- [ ] Cookie session posé après signIn (visible DevTools)
- [ ] Édit adresse après validation re-fire quote
- [ ] `customer.address` + `customer.lat` + `customer.lng` persistés en DB

**Constraints** : cf. bloc en tête de ce fichier.

---

### Phase 2 — Menu + Cart (2 stories AFK)

#### S4 — Menu page ISR + item modal Vaul + overlay LIVE + URL params deep-link

**Type** : AFK · **Blocked by** : S1, S3 · **Decision refs** : Q2 · **User stories covered** : US 14, 15, 16, 17, 18, 19, US 62 (push marketing tenant → menu avec item pinned), US 66 (item out-of-stock pendant cart via overlay LIVE)

**Vertical slice** :

- Backend : hook côté `publishMenu` mutation qui POST Vercel `/api/revalidate` avec tag `menu:<tenantId>` (extension du backend déjà mergé)
- Frontend : `app/menu/page.tsx` RSC fetch `getPublicMenu(tenantId)` avec `revalidate` tag
- Frontend : catégories scrollables + ancres latérales + items avec photo lazy-loaded (`next/image priority` sur hero + 4 premiers items above-the-fold)
- Frontend : badges allergènes + filtres "Sans gluten / Vegan / Végé" (filter front-side appliqué sur le set 14 allergènes UE 1169/2011)
- Frontend : item détail = modal Vaul URL-stateful `?item=<id>` (bottom-sheet mobile, side-drawer desktop ≥ md), back button ferme modal
- Frontend : modifier groups UI (min/max select, badge "À choisir" inline si modifier required non-satisfait, bouton "Ajouter au panier" disabled jusqu'à satisfaction)
- Frontend : overlay LIVE `available` via Convex subscription par-dessus HTML cached (item out-of-stock grisé "Indisponible ce soir" en realtime sans full reload, ~200ms latence toggle KDS)
- Frontend : context React `<CartContext>` initialisé (state synchro localStorage)
- Frontend : **URL params deep-link** : `?item=<itemId>` ouvre modal item correspondant ; `?promo=<itemId>` scroll vers item + highlight visuel (border pulse animation 2s)
- Tests : menu rendered + item modal opens + add to cart updates context + URL param `?item` ouvre modal + URL param `?promo` scroll+highlight

**Acceptance** :

- [ ] LCP < 2s sur 4G throttling DevTools (cible <1.5s)
- [ ] Publier admin → menu se met à jour <30s (revalidateTag hook fire)
- [ ] Tap item → modal ouvre, URL `?item=...`, back button ferme modal
- [ ] Modifier obligatoire bloque ajout panier + badge "À choisir" visible
- [ ] Item out-of-stock grisé en temps réel sans reload (toggle KDS depuis admin → <500ms côté PWA)
- [ ] Visite URL `bunsbao.kitchen-boost.com/menu?promo=<smashBurgerId>` → scroll vers Smash Burger + highlight animation
- [ ] Visite URL `bunsbao.kitchen-boost.com/menu?item=<id>` → modal Smash Burger ouvre directement

**Constraints** : cf. bloc en tête de ce fichier.

#### S5 — Cart + Note resto + Delivery mode toggle (header)

**Type** : AFK · **Blocked by** : S4 · **Decision refs** : Q2, Q7 · **User stories covered** : US 20, 21, 22, 23, 24, 25, 26

**Vertical slice** :

- Frontend : `app/panier/page.tsx` client-only — liste items (1 ligne par combo item × modifiers, dédup au add), edit qty, suppression par ligne
- Frontend : textarea Note resto 200 chars max, optionnel, label "Une note pour le resto ? — allergies, demandes spéciales"
- Frontend : sous-total + frais livraison (prix barré + montant final + "Offert par {resto}" si pricing rule absorbe) + total
- Frontend : composant `<DeliveryModeToggle>` rendu header — `[🛵 Livraison · X €] [🚶 Retrait · Gratuit]`
- Frontend : `<DeliveryModeContext>` React (pas localStorage, évite stale cross-tabs)
- Frontend : **switch sans re-quote** : les 2 modes cachés dans verdict initial de S3, switch instant + re-render `<CartTotals>` avec nouveaux fees
- Frontend : Mode initial selon verdict (deliverable → livraison default, hors_zone → C&C par défaut livraison grisée, hors_horaire → 2 grisés)
- Tests : add/edit/remove cart items + persistence localStorage + Note resto 200 chars enforced + toggle switch updates totals

**Acceptance** :

- [ ] Add to cart depuis menu → panier visible bon item × modifiers
- [ ] Add même item × mêmes modifiers → qty incrémentée (dédup)
- [ ] Add même item × modifiers différents → 2 lignes distinctes
- [ ] Edit qty + suppression OK
- [ ] Note resto persistée localStorage + 200 chars max enforced
- [ ] Toggle switch instant, fees re-render (pas de spinner réseau)
- [ ] Mode initial cohérent avec verdict S3

**Constraints** : cf. bloc en tête de ce fichier.

---

### Phase 3 — Checkout + payment (6 stories AFK, dont S6 split en 4)

#### S6 — Checkout form RSC + détection canal actif (sans modal push enrollment)

**Type** : AFK · **Blocked by** : S5, S2 · **Decision refs** : Q3, Q6, Q8 · **User stories covered** : US 44 (form pré-rempli)

**Vertical slice** :

- Frontend : `app/checkout/page.tsx` RSC — `preloadQuery(getCurrentCustomer)` pour pré-remplissage form + détection canal actif
- Frontend : form email/tel/firstName avec defaultValue cached depuis fiche customer
- Frontend : wording CGV au-dessus du bouton "Payer" (consentement par clic Payer ADR 0007) — phrase non-cliquable ≥ 12 px : _"En cliquant sur Payer, tu acceptes les CGV de **{Resto}** et le service de fidélité **{Marque KB}**..."_
- Frontend : Convex subscription client-side sur `customers.pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}` → bouton "Payer X €" gated dynamiquement (disabled si 0 canal, active si ≥ 1 canal `"enrolled"`)
- Frontend : bouton stub qui pour l'instant fait juste un `console.log` au click (modal vient S6a, payment vient S7) — placeholder visible : "Coming next: modal push enrollment (S6a)"
- Tests : RSC rendering avec/sans preloaded customer, Convex sub update bouton state

**Acceptance** :

- [ ] Visite `/checkout` sans cmd dans panier → redirect `/panier`
- [ ] Form pré-rempli si firstName/email/phone capturés à un checkout précédent
- [ ] Bouton "Payer" disabled si aucun canal `pushEnrollment` = "enrolled"
- [ ] Bouton "Payer" active immédiatement si au moins 1 canal enrolled
- [ ] Convex sub realtime : install Wallet pendant client sur page → bouton se débloque sans reload
- [ ] Wording CGV visible et lisible (≥ 12px)

**Constraints** : cf. bloc en tête de ce fichier.

#### S6a — Push enrollment modal — branche Wallet

**Type** : AFK · **Blocked by** : S6, S2 · **Decision refs** : Q5, Q8 · **User stories covered** : US 29 (modal bloquant), 30 (non-skippable), 31 (iOS install), 32 (Android install), 33 (loader 30s "Tester sans attendre"), 34 ("J'ai changé d'avis")

**Vertical slice** :

- Frontend : composant `<PushEnrollmentModal>` non-skippable single-screen — header "Pour finaliser ta cmd…" + hook Incentive Wallet texte resto config + option 1 Wallet primary (bouton "Ajouter à mon Wallet") + option 2 Web Push secondary (placeholder branche S6b, désactivé pour cette slice)
- Frontend : composant `<WalletInstallLoader>` — loader async 30s avec wording "⏳ En attente confirmation Wallet... Tu peux fermer Wallet et revenir." + bouton "J'ai changé d'avis" (retour modal initial) + bouton secondary "Tester sans attendre" (poll backend)
- Frontend : composant `<AddToWalletButton>` avec détection device : iOS = Blob `application/vnd.apple.pkpass` (`URL.createObjectURL` → assign `window.location` → Safari intercepte MIME) ; Android = `window.location.href = googleSaveLink` ; Desktop = bouton disabled + message "Disponible sur mobile uniquement"
- Frontend : action `wallet.generatePass.generatePass({tenantId, brandTenantId})` au clic Wallet → reçoit `{pkpassBase64, googleSaveLink, serialNumber, appleSigned}` → distribution device-specific
- Backend : nouvelle action `wallet.checkInstallStatus({serialNumber})` (poll backend Apple PassKit Web Service `GET /v1/devices/.../registrations/.../passes/...`)
- Frontend : Convex subscription sur `customers.pushEnrollment.walletStatus` → flip `"enrolled"` quand webhook `pass_installed` reçu → modal close auto + bouton "Payer" réactivé
- Frontend : modal non-skippable par Esc / click outside (sinon bypass trivial)
- Tests : flow Wallet install (mock generatePass + mock Convex sub flip), loader timeout 30s + "Tester sans attendre" poll, retour "J'ai changé d'avis", modal non-skippable

**Acceptance** :

- [ ] Bouton "Payer" sans canal → modal apparaît, non-skippable (Esc / click outside ignorés)
- [ ] iPhone Safari → click "Ajouter à Wallet" → sheet natif Apple Wallet s'ouvre → install effectif
- [ ] Android Chrome → click → Google Wallet preview s'ouvre → install effectif
- [ ] Loader 30s visible, bouton "Tester sans attendre" pollable
- [ ] Webhook `pass_installed` arrive → `pushEnrollment.walletStatus = enrolled` → modal close auto via Convex sub
- [ ] Bouton "J'ai changé d'avis" → retour modal initial avec choix
- [ ] Action `wallet.checkInstallStatus` retourne `{installed: true/false}` correctement

**Constraints** : cf. bloc en tête de ce fichier.

#### S6b — Push enrollment modal — branche Web Push

**Type** : AFK · **Blocked by** : S6a · **Decision refs** : Q8 · **User stories covered** : US 35 (iOS <16.4 mask Web Push)

**Vertical slice** :

- Frontend : composant `<WebPushSubscribeButton>` rendered dans option 2 du modal — `Notification.requestPermission()` → si `granted`, `navigator.serviceWorker.ready.then(reg => reg.pushManager.subscribe({applicationServerKey: VAPID_PUBLIC, userVisibleOnly: true}))` → reçoit `subscription` → mutation `customer.webPush.register({endpoint, p256dh, auth})` (déjà mergée 2.1-G)
- Frontend : détection capability iOS / browser : `if (!('PushManager' in window) || isIOSBelow164())` → option Web Push **masquée** par le modal (seule option Wallet restante)
- Frontend : compteur échecs incrémenté si `denied` ou `default` (popup fermé sans choix), display inline "Refusé — essaie une autre option"
- Tests : flow Web Push permission grant/deny + iOS <16.4 cas masking + compteur échecs

**Acceptance** :

- [ ] Click "Autoriser les notifs" Android → popup permission natif browser
- [ ] Granted → subscription → mutation register → flip `webPushStatus = enrolled` → modal close
- [ ] Denied → display "Refusé — essaie autre option" + compteur incrémenté
- [ ] iOS <16.4 / sans A2HS → option Web Push absente du modal (seule option = Wallet)
- [ ] `'PushManager' in window === false` → masquage correct

**Constraints** : cf. bloc en tête de ce fichier.

#### S6c — Push enrollment fallback 3 niveaux + noChannelPossible

**Type** : AFK · **Blocked by** : S6a, S6b · **Decision refs** : Q8 · **User stories covered** : US 36 (lien micro), 37 (3 niveaux frictionnels), 38 (flag noChannelPossible)

**Vertical slice** :

- Frontend : composant `<NoNotifsFallback>` — lien microscopique `"Continuer sans notifs →"` (font-size 12px, color muted) apparaît uniquement après 2 échecs documentés (Wallet refusé/timeout + Web Push denied)
- Frontend : Niveau 1 click → modal confirm `"Sans notifs : tu n'auras AUCUNE confirmation de cmd reçue, AUCUN suivi livraison live, AUCUNE offre. Sûr ?"` + 2 boutons "Je veux les notifs après tout" (primary) / "Oui continue sans" (link discret)
- Frontend : Niveau 2 click "Oui continue sans" → Niveau 3 modal final "On a vraiment besoin d'au moins un canal pour te tenir informé. Choisis encore :" → re-display modal initial UNE dernière fois
- Frontend : re-refus → mutation `customer.pushEnrollment.markNoChannelPossible({customerId})` + close modal + proceed paiement (SMS fallback transactionnel sera utilisé via Cascade Notifications, cf. CONTEXT)
- Backend : nouvelle mutation `customer.pushEnrollment.markNoChannelPossible({customerId})` — flip flag, audit log
- Tests : 2 échecs → lien fallback apparaît, flow 3 niveaux, flag posé correctement

**Acceptance** :

- [ ] Lien fallback caché avant 2 échecs (compteur visible dans state)
- [ ] Après 2 échecs Wallet + Web Push → lien fallback apparaît
- [ ] Click Niveau 1 → modal confirm Niveau 2 affiché
- [ ] Click "Oui continue sans" → modal Niveau 3 re-display options
- [ ] Re-refus → flag `noChannelPossible` posé en DB + modal close + bouton "Payer" active
- [ ] Audit log entry créé pour `customer.pushEnrollment.markNoChannelPossible`

**Constraints** : cf. bloc en tête de ce fichier.

#### S7 — Stripe payment + latching surge + Apple Pay verification

**Type** : AFK · **Blocked by** : S6c, HITL-2 · **Decision refs** : Q6, Q7 · **User stories covered** : US 45 (saved card), 46 (Payment Element), 47 (latching surge), 48 (retry échec), 49 (3DS), 65 (Sentry log)

**Vertical slice** :

- Frontend : composant `<CheckoutForm>` avec `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, { stripeAccount: 'acct_resto' })` lazy (chargé uniquement sur `/checkout`)
- Frontend : branche saved card (tile "Payer avec ma carte enregistrée terminant en `XXXX`" + lien "Utiliser une autre carte") vs Payment Element (Apple Pay / Google Pay via `automatic_payment_methods`)
- Frontend : checkbox "Sauvegarder ma carte pour mes prochaines commandes" (wording neutre acté CONTEXT, sans mention KB)
- Frontend : bouton `"Payer {totalTTC} €"` → mutation `delivery.quote.recaptureQuoteAtPayment({orderId})` (latching) AVANT `stripe.confirmPayment`
- Frontend : si fee monte → modal `<LatchingConfirmModal>` bloquant "Le tarif livraison est passé de {ancien} € à {nouveau} €. Confirmes-tu ?" + Oui/Non
- Frontend : flow paiement : saved card → mutation `stripe.savedCard.payWithSavedCard({orderId})` (backend clone PM + direct charge) ; new card → `stripe.confirmPayment({elements, confirmParams: {return_url}})` (SDK Stripe handle 3DS)
- Frontend : retry inline max 3 échecs Stripe.js → 3ᵉ échec : toast "Paiement impossible, contacte ton resto" + `Sentry.captureException`
- Tests : flow nouveau card + saved card + Apple Pay + latching surge confirm + retry échec + 3DS

**Acceptance** :

- [ ] Bundle Stripe lazy-loaded sur /checkout (DevTools Network : `stripe.js` n'apparaît pas sur /menu)
- [ ] Payment Element s'affiche correctement avec Apple Pay button visible iOS
- [ ] Saved card pre-selected si `customer.savedPaymentMethodId` non-null
- [ ] Latching : surge artificiel → modal confirm bloquant apparaît
- [ ] 3DS handle par SDK sans code custom (test avec test card Stripe 3DS)
- [ ] 1ᵉʳ et 2ᵉ échec → retry inline, 3ᵉ échec → toast + Sentry log visible
- [ ] Webhook `payment_intent.succeeded` arrive → redirect `/c/[orderId]` automatique

**Constraints** : cf. bloc en tête de ce fichier.

#### S8 — Tracking page realtime + incidents (placeholders SVG si Lottie pas livré)

**Type** : AFK · **Blocked by** : S7 · **Decision refs** : Q7 · **User stories covered** : US 50 (redirect direct), 51 (animations + ETA), 52 (Convex sub realtime), 53 (collapsible), 54 (incident card), 55 (URL partageable non-protégée)
**Note** : HITL-3 Lottie NON bloquant — placeholders SVG simples utilisés en attendant. Swap après livraison assets via PR cosmétique séparée.

**Vertical slice** :

- Frontend : `app/c/[orderId]/page.tsx` RSC initial + `useQuery(api.orders.getOrderTracking, {orderId})` Convex sub client-side
- Frontend : 6 étapes mode delivery + 3 étapes mode C&C — **placeholders SVG simples** (cercles + check-marks par étape, transitions CSS) si Lottie pas livré
- Frontend : ETA texte live (dérivé webhook Uber `pickup_eta` / `dropoff_eta`, format "ETA: 12 min")
- Frontend : récap items collapsible via `<details><summary>Voir le détail de ma cmd</summary>…</details>` natif HTML (pas de lib)
- Frontend : animation incident si `delivery.status === 'incident_after_pickup' | 'refused_post_payment'` → card "Incident livraison, tu as été remboursé" + placeholder SVG incident
- Frontend : URL `/c/[orderId]` non-protégée (pas d'auth required), `orderId` Convex Id brut (cuid non-devinable), partageable
- Tests : tracking page renders + Convex sub updates UI au webhook arrivée + états incident + URL accessible sans auth

**Acceptance** :

- [ ] Post-paiement (webhook `payment_intent.succeeded`) → redirect direct `/c/[orderId]` état T+0 "Cmd reçue"
- [ ] Placeholders SVG visibles, transitions étapes fonctionnent
- [ ] Webhook Uber Direct simulé → UI re-render <500ms (Convex push)
- [ ] Récap collapsible fonctionne (tap → expand items + modifiers + total + adresse)
- [ ] Cas incident → card "Incident livraison, tu as été remboursé" + placeholder SVG incident affiché
- [ ] URL `/c/[orderId]` partagée à autre device sans cookie → tracking visible (URL publique)

**Constraints** : cf. bloc en tête de ce fichier.

---

### Phase 4 — Moats (4 stories AFK : Wallet split en 2 + A2HS Android + iOS)

#### S9a — Wallet install button + 3 paliers de prompt (sans bridge identité)

**Type** : AFK · **Blocked by** : S2, S3 · **Decision refs** : Q5 · **User stories covered** : US 27 (palier 1 soft prompt post-address), US 28 (palier 2 bandeau permanent menu/panier)

**Vertical slice** :

- Frontend : composant `<AddToWalletButton>` réutilisable avec détection iOS (Blob `.pkpass`) / Android (redirect `googleSaveLink`) / Desktop (disabled) — réutilise code de S6a si déjà extrait, sinon partage de logique
- Frontend : `<WalletPromptCard>` palier 1 rendered après submit address-first dans `<AddressFirstForm>` flow (card pleine page avec "🎁 -10% sur ta prochaine cmd → Ajoute la carte" + bouton primary + "Plus tard" link skippable)
- Frontend : `<WalletPromptBanner>` palier 2 bandeau top permanent menu/panier "🎁 -10% offerts → ajoute la carte", dismissable session-scoped (sessionStorage key)
- Frontend : Convex subscription sur `customers.pushEnrollment.walletStatus` → hide paliers 1 et 2 si déjà `"enrolled"` (realtime)
- Tests : 3 paliers s'affichent au bon moment + hide quand enrolled + dismiss session-scoped persiste pendant 1 session

**Acceptance** :

- [ ] Palier 1 visible après submit address-first, dismissable via "Plus tard"
- [ ] Palier 2 visible permanent menu/panier, dismissable via X session-scoped
- [ ] Install Wallet effectif → 3 paliers hidden via Convex sub realtime
- [ ] Dismiss palier 2 → ne ré-apparaît pas pour la session, re-apparaît à la session suivante

**Constraints** : cf. bloc en tête de ce fichier.

#### S9b — Wallet bridge identité au tap deep-link (cross-device/cross-resto)

**Type** : AFK · **Blocked by** : S9a · **Decision refs** : Q5 · **User stories covered** : US 39 (carte URL configurée), 40 (tap brand-new device), 41 (tap autre resto), 42 (URL mutable confirmé)

**Vertical slice** :

- Frontend : middleware (extension de S1) — détecte query param `?wallet=<serialNumber>` → call action `wallet.linkSerial.bridgeSerialToSession({serial})` → si OK, clear ancien cookie Convex Auth + re-signIn avec userId du customer bridgé + redirect `/` URL clean (sans `?wallet=`)
- Backend : nouvelle action `wallet.linkSerial.bridgeSerialToSession({serial})` — query `customers.byWalletSerial(serial)` → résout `customerId` global → retourne user pour re-signIn (orchestration côté middleware pour le cookie swap)
- Tests : flow bridge identity at tap deep-link + cas conflit session anonymous existante (ancien user orphan)

**Acceptance** :

- [ ] Tap pass Wallet sur device B (sans cookie tenant) → ouvre PWA → bridge identité → fiche customer global chargée (firstName + address + savedPaymentMethodId disponibles)
- [ ] Tap pass sur autre resto KB (autre domaine) → bridge identité même `customer_id` global
- [ ] Cas conflit : session anonymous existante sur ce device → ancien user devient orphan (anonymisé V2 par cron), nouvelle session = customer bridgé
- [ ] URL `?wallet=<serial>` cleared après bridge (URL finale propre `/`)
- [ ] Serial invalide / non-trouvé → graceful (pas de crash, juste pas de bridge)

**Constraints** : cf. bloc en tête de ce fichier.

#### S10 — A2HS Android (post-cart)

**Type** : AFK · **Blocked by** : S2, S5 · **Decision refs** : Q4 · **User stories covered** : US 56 (bouton install après cart), 57 (Android prompt natif)

**Vertical slice** :

- Frontend : `<PWAInstallContext>` capture `beforeinstallprompt` event au mount root layout, stocke le `prompt` (ne pas appeler immédiatement — consomme l'event)
- Frontend : composant `<AndroidInstallButton>` fixed bottom-right `"📲 Installer {nom_resto}"` rendered conditionnellement après `cart.items.length >= 1` ET `prompt` capturé ET pas déjà standalone
- Frontend : click → `prompt.prompt()` → `prompt.userChoice` → si `'accepted'`, mutation `customer.pushEnrollment.recordA2hsAccepted({customerId})`
- Backend : nouvelle mutation `customer.pushEnrollment.recordA2hsAccepted({customerId})` — flip `a2hsStatus = "enrolled"`, audit log
- Frontend : event `appinstalled` détecté → flip enrolled + masque bouton (via Convex sub déjà existante)
- Tests : Android prompt triggered + status recorded + masquage post-install

**Acceptance** :

- [ ] Add cart Android → bouton install apparaît bottom-right
- [ ] Click → prompt natif Android visible
- [ ] User accept → `a2hsStatus = "enrolled"` posé en DB
- [ ] Visite suivante après install → bouton n'apparaît plus
- [ ] iOS → bouton n'apparaît jamais (pas de `beforeinstallprompt` event sur iOS)

**Constraints** : cf. bloc en tête de ce fichier.

#### S11 — A2HS iOS (post-tracking)

**Type** : AFK · **Blocked by** : S2, S8 · **Decision refs** : Q4 · **User stories covered** : US 58 (iOS bottom-sheet GIF), 59 (heuristique standalone post-install)

**Vertical slice** :

- Frontend : détection iOS Safari + pas standalone : `userAgent /iPhone|iPad/ && !matchMedia('(display-mode: standalone)').matches`
- Frontend : composant `<IOSInstallBottomSheet>` (Vaul Drawer) rendered sur `app/c/[orderId]/page.tsx` état T+0 "Cmd reçue"
- Frontend : contenu bottom-sheet : GIF 8s loop instructions `Safari → Share → "Sur l'écran d'accueil" → "Ajouter"` + texte court + bouton "OK plus tard"
- Frontend : à la visite suivante (n'importe quelle page), si `matchMedia('(display-mode: standalone)').matches === true` AND `customer.pushEnrollment.a2hsStatus !== "enrolled"` → mutation `recordA2hsAccepted` (heuristique)
- Tests : iOS detection + bottom sheet renders + post-install standalone detection

**Acceptance** :

- [ ] Cmd validée iOS Safari (pas standalone) → bottom sheet apparaît sur `/c/[orderId]` T+0
- [ ] GIF visible + bouton "OK plus tard" fonctionne
- [ ] Install A2HS depuis Safari (suivre instructions GIF) → revisit PWA depuis icône écran d'accueil → `display-mode: standalone` détecté → `a2hsStatus = "enrolled"` posé
- [ ] Android → bottom sheet n'apparaît jamais (détection iOS-only)

**Constraints** : cf. bloc en tête de ce fichier.

---

### Phase 5 — Recognition retour (1 story AFK petite)

#### S12 — Bandeau "Bonjour {firstName}" + "Ce n'est pas moi"

**Type** : AFK · **Blocked by** : S3, S7 · **Decision refs** : Q3 · **User stories covered** : US 9, 10, 11, 12, 13

**Vertical slice** :

- Frontend : sur `app/page.tsx` RSC, lit `preloadQuery(getCurrentCustomer)` → si `customer.firstName` non-null → bandeau `"Bonjour {firstName} 👋"` au-dessus form Google Places
- Frontend : bouton form passe de "Valider" à "Confirmer" si address pré-remplie (defaultValue cached visible)
- Frontend : composant `<NotMeLink>` (lien petit font-size 12px color muted en-dessous du form) — click → POST `/api/signout` → clear cookie Convex Auth + refresh page (tenant cookie inchangé)
- Frontend : route handler `app/api/signout/route.ts` qui clear le cookie Convex Auth (côté server pour bypass HttpOnly)
- **Garde-fou design** : JAMAIS mention adresse/historique explicite dans l'UI (audit visuel obligatoire — anxiogène)
- Tests : visite 2ᵉ fois après checkout → bandeau visible + form pré-rempli + "Ce n'est pas moi" reset

**Acceptance** :

- [ ] Cmd terminée (S7 mergé) → revisit `/` → bandeau "Bonjour {firstName} 👋"
- [ ] Form pré-rempli avec address cached + bouton "Confirmer"
- [ ] Click "Ce n'est pas moi →" → clear cookie + page reload → form vide + bandeau absent
- [ ] Visite avec cookie présent mais `firstName === null` → AUCUN bandeau, juste pré-rempli silencieux
- [ ] Aucun texte mentionnant "On a ton adresse" / "Voici tes 4 dernières cmds" / historique explicite (audit visuel)

**Constraints** : cf. bloc en tête de ce fichier.

---

## Récap DAG dépendances (18 stories)

```
HITL-1 ─> HITL-2 (debloque deploy preview Vercel)
HITL-3 (Lottie) — indépendant, NON bloquant S8

S1 ─┬─> S2 ─┬─> S6a ─> S6b ─> S6c ─> S7 ─> S8 ─> S11
    │       │
    │       ├─> S10 (need S5 aussi)
    │       │
    │       └─> S9a (need S3 aussi) ─> S9b
    │
    └─> S3 ─> S4 ─> S5 ─> S6 ──┘
             │
             └─> S12 (need S7 aussi)
```

## Estimation effort total

| Phase              | Stories                   | Sessions agent AFK estimées                  |
| ------------------ | ------------------------- | -------------------------------------------- |
| HITL pré-requis    | 3 (HITL-1/2/3)            | ~2h Alex + 2 semaines designer (out of loop) |
| Foundation shell   | S1, S2, S3                | 3-4 sessions                                 |
| Menu + Cart        | S4, S5                    | 2-3 sessions                                 |
| Checkout + payment | S6, S6a, S6b, S6c, S7, S8 | 6-8 sessions                                 |
| Moats              | S9a, S9b, S10, S11        | 3-4 sessions                                 |
| Recognition        | S12                       | 0.5 session                                  |
| **Total AFK**      | **15 stories AFK**        | **~15-20 sessions agent**                    |

Avec drain AFK séquentiel ~5-7 jours wall-clock. Avec worktree parallel divisible par 3-4 = ~2-3 jours.

---

## Status final breakdown

✅ **Validé par Alex 2026-06-04** :

- Granularité S6 split en 4 (S6 + S6a/S6b/S6c)
- A2HS séparés Android (S10) / iOS (S11)
- S12 pré-V1 confirmé
- Lottie NON bloquant S8 (placeholders SVG)

✅ **Audit cohérence PRD ↔ Breakdown** :

- 66/66 user stories couvertes (US 64 retirée car drop V1)
- US 60 (emoji prefix push) → ajouté acceptance S2
- US 62 (push marketing item pinned) → ajouté acceptance S4
- US 43 (URLs par push iOS workaround) → backend déjà mergé, noté PRD Further Notes

✅ **Constraints non-négociables** ajoutées à toutes les slices AFK :

- Code uniquement dans `apps/web` (jamais `apps/admin` freeze post-V1)
- Plan de test E2E 1-3 scénarios manuels dans description PR

⏳ **Étape suivante** : feu vert explicite Alex pour publish 18 issues GitHub avec parent issue PRD.
