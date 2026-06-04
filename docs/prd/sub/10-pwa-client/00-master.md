# PRD — PWA Client KitchenBoost V1

**Statut** : 🟢 Draft à publier comme parent issue GitHub (étiquette `ready-for-agent` + `epic`)
**Auteur** : Alex (via grilling 2026-06-04 avec Claude)
**Source décisionnelle** : `decisions-log.md` Q1→Q8 (hors-repo, à recopier dans `docs/prd/sub/10-pwa-client/` à la fin du grilling)
**Lié au PRD existant** : [10_pwa_client_commande.md](../10_pwa_client_commande.md) (V1 scope + sections fonctionnelles déjà actées)
**Lié aux ADRs** : 0002 / 0003 / 0004 / 0007 / 0008 / 0010 / 0011 / 0012 / 0013 / 0015

---

## Problem Statement

Le client final mangeur (Sophie) arrive sur l'écosystème KitchenBoost via 4 entry-points distincts :

1. **QR code dans son sac de livraison Uber Eats** (scan chez elle après réception d'une cmd Uber Eats du resto Buns & Bao)
2. **QR code sur la table du resto** (scan sur place pour consulter le menu / commander à emporter)
3. **Lien push notification** depuis sa carte fidélité Wallet KB (transactionnel ou marketing tenant)
4. **URL directe** (`bunsbao.kitchen-boost.fr` ou domaine custom resto, tapée manuellement ou cliquée depuis un email)

Dans tous les cas, elle doit pouvoir :

- **Découvrir l'app sans friction** : LCP < 1.5s sur 4G, identique perception "vraie vitrine resto" (pas portail KB-branded).
- **Donner son adresse en 1 sélection Google Places**, savoir immédiatement si on livre chez elle ou si elle doit basculer click & collect.
- **Voir le menu instantanément**, allergènes visibles, items in/out of stock en temps réel, modifier groups (sauces / cuissons / options) clairement guidés.
- **Composer son panier sereinement** : ajout 1 tap, edit quantité, note resto allergies/demandes spéciales, frais livraison transparents avec mention "Offert par {resto}" si applicable.
- **Payer en 2 clics avec Apple Pay/Google Pay**, ou avec sa carte sauvegardée cross-resto KB déjà enregistrée si revenu d'un autre resto KB.
- **Suivre sa livraison en temps réel** avec animations + ETA live, sans avoir à recharger la page.

EN PARALLÈLE, KitchenBoost doit pouvoir **capter Sophie dans le moat consumer-side** via l'installation de sa carte fidélité Wallet commune (cf. ADR 0003), qui débloque :

- Push lock-screen 99% open-rate transactionnel + marketing tenant/cross-tenant
- Bridge identité cross-device et cross-resto KB
- Carte CB sauvegardée réutilisable sur tous restos KB sans re-saisie

**État actuel** : aucune PWA client n'existe. `apps/web` contient un scaffold legacy Next.js + Convex Auth + login/signup/dashboard hérité d'un starter admin, à scrap entièrement. Le backend (auth, paiement Stripe Connect, livraison Uber Direct, Wallet pass real signing, web push, pricing engine, notifications cascade) est **mergé à 80%** sur les chantiers 2.1 / 2.5 / 2.6 / 2.7 / 2.8 — il ne manque que la **couche frontend PWA** + quelques mutations très spécifiques.

## Solution

Construire la PWA client dans `apps/web` (réutiliser le scaffold après scrap legacy) : Next.js 16 + RSC + Tailwind v4 + Convex client + Stripe Elements + Apple/Google Wallet integration + Google Places autocomplete + web-push API.

**Tenant resolution** : middleware Next.js Edge sur hostname (`<slug>.kitchen-boost.fr` ou domaine custom resto), résout `tenantId` via query Convex puis pose cookie HttpOnly `__Host-kb_tenant=<id>` (zéro re-query DB sur hits suivants). Wildcard DNS `*.kitchen-boost.fr` + Vercel project pinned region Paris/Frankfurt.

**Rendering strategy hybrid** :

- `/` : RSC streaming, lit cookie pour pré-remplir adresse 2ᵉ visite via `convexAuthNextjsToken()` + `preloadQuery(getCurrentCustomer)`
- `/menu` : **ISR + on-demand revalidate au clic "Publier" admin** (LCP <1.5s grâce à CDN Vercel + HTML pré-rendu) — `available` (out-of-stock) overlay LIVE via Convex subscription par-dessus HTML cached
- `/panier` : client-only (localStorage, panier = buffer pré-checkout)
- `/checkout` : RSC + boundaries client pour Stripe Elements (lazy load sur cette route)
- `/c/[orderId]` : RSC initial + Convex realtime subscription pour tracking live
- `/manifest.webmanifest` : API route dynamic par host (logo + color + name branded resto)
- `/sw.js` : service worker minimal ~50 lignes (push + notificationclick handlers, pas de Workbox/offline)

**Identité client** : Convex Auth Anonymous provider (déjà mergé chantier 2.1-B) avec session sliding 365 jours. Sign-in déclenché au **submit address-first** (pas au mount client, pas en middleware) — coïncide avec 1ère écriture utile, évite pollution table users par bots/visiteurs rebondissants.

**Reconnaissance retour** : bandeau `"Bonjour {firstName} 👋"` si firstName connu (capté à un checkout précédent) — JAMAIS mention adresse/historique (anxiogène vs hospitalier). Lien discret `"Ce n'est pas moi →"` pour device partagé. Reconnaissance silencieuse autrement.

**Push enrollment moat-first** : 3 paliers progressifs pour pousser le client à installer la carte Wallet commune :

1. **Soft prompt** card pleine page après submit address-first (skippable "Plus tard")
2. **Bandeau permanent** menu/panier "🎁 -10% offerts → ajoute la carte" (dismissable session-scoped)
3. **Modal bloquant** au clic Payer si aucun canal `pushEnrollment` actif (PRD §9 V1 spec)

Le modal bloquant final propose Wallet (primary) + Web Push (secondary, masqué iOS <16.4). Loader async 30s pour confirmation Wallet réelle via webhook `pass_installed` (Apple PassKit Web Service routes hébergées dans `apps/admin/api/wallet/*` — déjà mergées). Fallback 3 niveaux frictionnels si refus complet → flag `noChannelPossible` + SMS fallback transactionnel via Cascade Notifications.

**Bridge identité cross-resto/cross-device** : URL embedded "back of pass" = `<host_lastBrandTenantId>/?wallet=<serialNumber>`. Tap pass dans Wallet sur device B / autre resto KB → middleware lit `?wallet=` → action `wallet.bridgeSerialToSession` → résout `customer_id` global → re-signIn cookie session sur ce customer (adresse + firstName + Stripe Customer cross-tenant disponibles immédiatement).

**Paiement** : Stripe Elements avec `loadStripe(PUBLISHABLE_KEY_PLATFORM, { stripeAccount: 'acct_resto' })` (direct charge — resto = merchant of record, `application_fee_amount = 240` immutable). Apple/Google Pay via `automatic_payment_methods`. Carte sauvegardée cross-resto via clone PaymentMethod (chantier 2.5-D mergé). Latching anti-surge au clic Payer (mutation `recaptureQuoteAtPayment` AVANT `confirmPayment`). 3DS handle par SDK.

**Tracking realtime** : Convex subscription sur `getOrderTracking(orderId)` → webhook Uber Direct écrit `deliveries.status` → Convex push toutes UIs subscribers → re-render sans polling. Animation Lottie par étape (6 delivery + 3 C&C + 1 incident — placeholders SVG si Lottie pas livré, swap après).

## User Stories

### Découverte + Address-first

1. As a first-time Sophie (no cookie), I want to arrive on `bunsbao.kitchen-boost.fr` and see the resto's logo + color in <2s, so that I trust I'm on a real brand and not a generic portal.
2. As a first-time Sophie, I want to be required to enter my delivery address via Google Places autocomplete (no free typing), so that the address is normalized and Uber Direct can quote reliably.
3. As Sophie, I want my address to be validated automatically when I select a Google suggestion (no extra "Validate" button click), so I save one tap.
4. As Sophie, I want to see in <1s whether delivery is possible from this resto to my address, so I don't waste time browsing a menu I can't order from.
5. As Sophie out of zone, I want to be offered click & collect as an alternative with a clear message "trop éloignée — viens chercher", so I have an option instead of a dead-end.
6. As Sophie arriving when the resto is closed, I want to see "Le resto est fermé, ouvre à 18h30" and be blocked from cmd, so I'm not surprised by a failed checkout.
7. As Sophie hitting an Uber Direct surge spike, I want to retry the quote rather than abandoning, so I can recover transparently.
8. As Sophie scanning a QR code at the resto's table, I want the same address-first flow even though I'm on-premise, so the UX is consistent (and to capture my address for the moat).

### Recognition retour

9. As returning Sophie (cookie present, firstName captured at previous checkout), I want to see "Bonjour Sophie 👋" above the address form, so I feel recognized and welcomed.
10. As returning Sophie, I want my address pre-filled with a "Confirm" button (vs "Validate"), so I save typing if my address hasn't changed.
11. As returning Sophie on a shared device (couple/family/passed smartphone), I want a discreet "Ce n'est pas moi →" link that clears my session, so my partner can use the app as themselves.
12. As returning Sophie, I want NO message mentioning my address explicitly ("on a ton adresse") so I don't feel surveilled — only "Bonjour" + silent pre-fill.
13. As returning Sophie >1 year later (cookie expired), I want to re-enter my address without confusion, treated as a fresh customer (doublon assumed per ADR 0008).

### Browsing menu

14. As Sophie on `/menu`, I want categories scrollable with anchor sidebar, so I can jump to the section I want without endless scrolling.
15. As Sophie, I want to see item photos lazy-loaded with hero/first-4 prioritized, so LCP stays under 1.5s on 4G.
16. As Sophie, I want allergens displayed as badges on items + filters "Sans gluten / Vegan / Végé" on home menu, so I can avoid items I shouldn't eat (regulatory compliance EU 1169/2011).
17. As Sophie, I want items currently out-of-stock to be visibly grayed "Indisponible ce soir" in real-time (not after page refresh), so I don't waste time tapping a sold-out item.
18. As Sophie tapping an item, I want a bottom-sheet modal (mobile) opening with full description + modifiers + quantity selector, with URL state `?item=<id>` so back button closes the modal, so I don't lose my scroll position on /menu.
19. As Sophie configuring an item with required modifiers (cuisson, sauce), I want the "Ajouter au panier" button disabled until I've satisfied all min_select requirements, with "À choisir" badge on the missing group, so I don't accidentally add an unconfigured item.

### Cart manipulation

20. As Sophie, I want each `item × modifiers` combination as a distinct line in my cart (not aggregated), so the kitchen receives unambiguous instructions.
21. As Sophie, I want a single textarea "Note pour le resto (allergies, demandes spéciales)" max 200 chars, so I can flag personal needs.
22. As Sophie, I want to edit quantity and delete lines directly in the cart, so I can adjust before checkout.
23. As Sophie, I want to see sous-total + frais livraison (with strike-through + "Offert par {resto}" if pricing rule applies) + total clearly, so I have no surprise at checkout.

### Mode toggle Livraison / Click & Collect

24. As Sophie with delivery available, I want a permanent header toggle `[🛵 Livraison · X €] [🚶 Retrait · Gratuit]`, switchable any time before payment, so I can change mind without losing my cart.
25. As Sophie, I want the mode switch to be instant (no waiting for re-quote), so the UX feels native.
26. As Sophie out of delivery zone, I want the Livraison button grayed and C&C selected by default, so the choice is clear.

### Push enrollment moat — 3 paliers Wallet

27. As Sophie just-validated-address (palier 1), I want a non-blocking card "🎁 -10% sur ta prochaine cmd → Ajoute la carte" with "Plus tard" option, so I can choose now or skip without friction.
28. As Sophie browsing menu/cart without pass installed (palier 2), I want a discreet permanent banner "🎁 -10% offerts → ajoute la carte" dismissable for the session, so I'm gently reminded without being spammed.
29. As Sophie clicking "Payer" without any push channel enrolled (palier 3), I want a blocking modal forcing me to choose at least one channel, so KB captures my moat at the high-intent moment.
30. As Sophie, I want the blocking modal to be non-skippable by Esc / click outside, so the requirement is unambiguous.
31. As Sophie iOS choosing Wallet, I want the `.pkpass` file to open Apple Wallet directly in a native sheet (2 taps install), so the friction is minimal.
32. As Sophie Android choosing Wallet, I want to be redirected to Google Wallet preview, so I can install in 1 tap.
33. As Sophie waiting for Wallet install confirmation (loader 30s), I want a "Tester sans attendre" option that polls backend explicitly, so I'm not stuck if Apple webhook is slow.
34. As Sophie waiting Wallet, I want a "J'ai changé d'avis" link back to the modal, so I can pick another option.
35. As Sophie iOS <16.4 (Web Push unsupported), I want the Web Push option masked from the modal, so I'm not offered something that won't work.
36. As Sophie refusing both Wallet AND Web Push twice, I want a discreet "Continuer sans notifs →" link to appear, so I have an escape hatch (after 2 explicit refusals).
37. As Sophie clicking the fallback link, I want a frictionful 3-step confirmation flow ("Sans notifs : AUCUNE confirmation, AUCUN suivi, AUCUNE offre"), so I'm fully aware of the consequence.
38. As Sophie completing 3-level fallback, I want my account flagged `noChannelPossible` and SMS transactional fallback enabled, so I still receive critical messages.

### Wallet bridge identité cross-device/cross-resto

39. As Sophie installing Wallet pass on iPhone, I want my carte to be configured with my last resto's URL embedded so that tapping the pass anywhere opens that resto's PWA.
40. As Sophie tapping the pass on a brand-new device (no cookie), I want to be automatically recognized via the pass serial, so my firstName + address + saved card are immediately available cross-device.
41. As Sophie tapping the pass on a different KB resto (other domain), I want to land on that resto's PWA with my profile bridged via the pass, so the cross-resto network effect kicks in.
42. As KB, I want the pass back-of-pass URL to be updatable later via silent push update, so I can re-orient the tap behavior without re-issuing passes.
43. As KB, I want push notifications from the Wallet card to be deep-linkable per-push on Android (`actionUri`) and via update+push trick on iOS (limitation Apple), so each campaign can target a specific page.

### Checkout + payment

44. As Sophie on `/checkout` with form pre-filled (email/tel/firstName captured previously), I want to confirm in 1 click + proceed to payment, so I save typing.
45. As Sophie with a saved card from a previous KB resto, I want it pre-selected as a tile "Payer avec ma carte \*\*\*\*1234" with option "Use another card", so cross-resto network effect is invisible-but-felt.
46. As Sophie with no saved card, I want a clean Stripe Payment Element showing Apple/Google Pay buttons + manual card input + checkbox "Sauvegarder ma carte pour mes prochaines commandes", so I can choose my preferred method.
47. As Sophie at the moment of clicking "Payer X €", I want the delivery quote re-captured (latching) — if the price went up due to surge, I want a blocking confirm modal "Le tarif livraison est passé de X € à Y €. Confirmes-tu ?" — so I'm never charged more than I agreed to.
48. As Sophie facing a payment failure, I want up to 3 inline retries without losing my cart/form data, so a transient issue doesn't ruin the flow.
49. As Sophie needing 3DS authentication, I want the SDK Stripe to handle the challenge transparently (popup or redirect), so the friction is on the bank UI not on us.

### Tracking realtime

50. As Sophie post-payment, I want to be redirected immediately to `/c/[orderId]` showing "Cmd reçue" at T+0, with no separate "thanks for ordering" page in between, so the flow feels continuous.
51. As Sophie on tracking page, I want animations + ETA texte live for each step (6 for delivery, 3 for C&C), so I have visual feedback that things are happening.
52. As Sophie, I want the tracking page to update in real-time without me having to refresh (Convex subscription), so I see "Courier en route" appear instantly when the webhook fires.
53. As Sophie, I want a collapsible "Voir le détail de ma cmd" section showing items + modifiers + total + address, so I can verify what I ordered without scrolling main view.
54. As Sophie experiencing an incident (courier abandonment, etc.), I want a clear card "Incident livraison, tu as été remboursé" with appropriate animation, so I'm not left in suspense.
55. As Sophie's friend/partner receiving the tracking URL via shared SMS, I want them to be able to follow the order too (no auth required, orderId non-guessable), so we can coordinate.

### A2HS install

56. As Sophie Android adding her first item to cart, I want a fixed bottom-right button "📲 Installer Buns & Bao" to appear, so I'm prompted at the right moment (post-intent, pre-checkout).
57. As Sophie Android tapping that button, I want the native Android install prompt to appear, so I install in 1 tap.
58. As Sophie iOS on the tracking page T+0, I want a bottom-sheet with a GIF showing "Safari → Share → Sur l'écran d'accueil → Ajouter", so I have visual instructions for the iOS limitation.
59. As Sophie iOS post-install, I want my next visit to be detected as `display-mode: standalone` and my a2hsStatus flipped enrolled in backend, so I'm counted as a moat member.

### Receiving notifications

60. As Sophie with Wallet installed, I want push notifications appearing on my lock-screen with the resto's emoji prefix "🥢 Buns & Bao : ...", so I distinguish them from other Wallet pass notifs.
61. As Sophie tapping a transactional push (cmd reçue / courier arrived / livré), I want to land directly on my tracking page state corresponding to the event, so I see relevant info immediately.
62. As Sophie tapping a marketing push (tenant promo), I want to land on the menu with the promoted item pinned at the top, so I can act on it.
63. As Sophie receiving a cross-tenant push from KB ("Nouveau resto à 5 min de chez toi"), I want to land on the home of the target resto's PWA, so I can discover the new place.

### Edge cases

64. As Sophie hitting a Stripe payment failure 3 times, I want a clear toast "Paiement impossible, contacte ton resto" + Sentry log, so I have a non-tech path forward.
65. As Sophie whose item went out-of-stock between cart add and checkout, I want the cart to reflect this in real-time via Convex sub on `available`, so I'm not surprised at payment.
66. As Sophie with a tenant orphan cookie (resto deleted between visits), I want a clear "Resto non disponible" message + redirect home, so I'm not confused by 404.

_(Anciennement US 64 "offline form recovery checkout" droppée V1 — cf. Out of Scope. Re-saisie 30s acceptable si connexion perdue mid-checkout ; firstName/email/phone déjà persistés server-side dès la 1ère cmd via fiche customer.)_

## Implementation Decisions

### Architecture top-level

**Tenant resolution via middleware Edge** (Q1) :

- Wildcard DNS `*.kitchen-boost.fr` + Vercel project routes to `apps/web`.
- Middleware reads `host` header, on 1st hit queries Convex `tenants.bySlug` or `tenants.byCustomDomain`, sets cookie `__Host-kb_tenant=<tenantId>` (HttpOnly, Secure, host-only, 30j refresh).
- Subsequent hits: middleware reads cookie, zero DB query.
- `NextResponse.rewrite` internal (never redirect) to preserve SEO + cookie scope.
- Path-based `/t/[slug]/...` explicitly rejected (breaks ADR 0008 device-only cookie isolation, breaks push web origin-scoped, breaks domaine custom resto, breaks branding "vraie vitrine resto").
- Edge Config Vercel deferred V2+ (overkill V1).

**App location**: reuse `apps/web` (scrap legacy auth/dashboard scaffold entirely). Next.js 16.1.6 + Convex Auth + Tailwind 4 + web-push already installed.

### Route map + rendering strategy (Q2)

| Route                          | Rendu                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `/`                            | RSC streaming, lit cookie pour pré-remplir adresse                         |
| `/menu`                        | ISR + on-demand revalidate au clic "Publier" admin (tag `menu:<tenantId>`) |
| `/panier`                      | Client-only (localStorage)                                                 |
| `/checkout`                    | RSC + boundaries client (Stripe Elements lazy load)                        |
| `/c/[orderId]`                 | RSC initial + Convex realtime subscription                                 |
| `/legal/cgv`, `/legal/privacy` | Static                                                                     |
| `/manifest.webmanifest`        | API route dynamic par host, cache 1h CDN                                   |
| `/sw.js`                       | Static depuis `public/sw.js`                                               |
| `/api/...`                     | API routes (push subscribe forwarding, etc.)                               |

- Item détail = modal Vaul URL-stateful `?item=<id>` (bottom-sheet mobile, side-drawer desktop). Pas de route séparée.
- Tracking URL = `/c/[orderId]` (court, scannable SMS/push). `orderId` = Convex Id brut (non-devinable cuid).
- `available` (out-of-stock) overlay LIVE via Convex subscription par-dessus HTML cached menu (~200ms latence toggle KDS sans full reload).

### Customer identity (Q3)

**Backend déjà mergé chantier 2.1-B** (NOT to rebuild) :

- Convex Auth Anonymous provider in `auth.ts` stamps `role: customer` + `isAnonymous: true`
- `getOrCreateCurrentCustomer` mutation silent fiche provisioning
- `getCurrentCustomer` query self-scoped
- Wrappers `customerQuery / customerMutation` with explicit `tenantId`
- `publicTenantQuery` for menu without auth
- Cookie = native Convex Auth session cookie (HttpOnly, Secure, host-only)

**Frontend decisions** :

- Sign-in triggered at **submit address-first** (not at mount, not in middleware) — option C compromise: avoids polluting users table by bots/rebounders, coincides with first useful write (address + lat/lng + triggers Uber quote).
- Session lifetime **365 days total + 365 days inactive** (sliding window). Override Convex Auth default 30j via `convexAuth({ session: { totalDurationMs: 365*24*3600*1000, inactiveDurationMs: 365*24*3600*1000 } })` in `auth.ts`.
- RSC `/` reads cookie via `convexAuthNextjsToken()` + `preloadQuery(getCurrentCustomer)` for pre-fill 2nd visit.

**Recognition UX** : bandeau `"Bonjour {firstName} 👋"` if firstName known (captured at previous checkout). **NEVER** mention adresse/historique explicitly (anxiogène = surveillance vs hospitalité). Adresse pre-filled silently in form. Discreet link `"Ce n'est pas moi →"` (clears Convex Auth cookie + refresh, tenant cookie unchanged).

**7 cas de figure reconnaissance** :
| Cas | Reconnu ? | Pourquoi |
|---|---|---|
| Même browser, même domaine, < 1 an | Oui | Cookie présent |
| Même browser, autre resto KB | Non | Cookies cloisonnés host-only — doublon assumé sauf Wallet pass |
| Autre device | Non | Pas de cookie sur l'autre device — doublon assumé sauf Wallet pass |
| Mode privé Safari/Chrome | Non | Cookies non persistés — doublon |
| Cache navigateur vidé | Non | Cookie effacé — doublon |
| > 1 an sans visite | Non | Cookie expiré |
| Wallet pass installé, n'importe quel device/resto | Oui (cross) | Bridge via serial deep-link |

### PWA shell (Q4)

**Manifest dynamic** : `app/manifest.webmanifest/route.ts` lit `host` → query `tenants.brandingByHost(host)` → JSON branded avec `Cache-Control: public, max-age=3600, s-maxage=3600`. JSON shape: `id: "/"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `orientation: "portrait"`, `name + short_name = nom resto`, `theme_color = couleur primaire resto`, `background_color: "#FFFFFF"`, `icons: [192, 512]` with `purpose: "any maskable"`, `categories: ["food"]`, `lang: "fr"`. 3 routes icônes dynamiques pipent `ctx.storage.get(tenant.logoStorageId)`.

**Service worker** : `public/sw.js` static, ~50 lignes, scope `/`. PAS de Workbox, PAS d'offline cache V1. Handlers: `install` (skipWaiting), `activate` (claim), `push` (showNotification avec `tag: orderId|campaignId`), `notificationclick` (deep-link via `clients.openWindow` / focus+navigate existing window). Registration via `<ServiceWorkerRegistration />` mount in root layout, useEffect non-blocking, échec silencieux. Update strategy: `skipWaiting + clients.claim` (pas de toast user).

**A2HS triggers** :

- **Android**: capture `beforeinstallprompt` → `<PWAInstallContext>` → bouton "📲 Installer" rendered après 1er ajout panier. Click → `prompt.prompt()` → mutation `customer.pushEnrollment.recordA2hsAccepted`.
- **iOS**: pas d'API. Détection via `userAgent /iPhone|iPad/ && !matchMedia('(display-mode: standalone)')`. Bottom-sheet Vaul rendered sur `/c/[orderId]` état T+0 avec GIF instructions Share menu + bouton "OK plus tard". Visite suivante : heuristique standalone → flip `a2hsStatus = "enrolled"`.

**Incentive promo** : option C statu quo (3 options évaluées A étendre / B parallèle / C statu quo). Incentive Wallet uniquement à l'install pass Apple/Google (déjà mergé chantier 2.8-E, contrat ADR 0002 "no fake reward"). A2HS sans promo dédiée V1 — install vaut pour son UX propre + détection iOS unreliable = risque fake reward + dilution attracteur Wallet.

### Wallet pass frontend (Q5)

**Modèle conceptuel — métaphore Sephora** : 1 carte design commune sous marque neutre (ADR 0003) + 1 instance par client avec `serialNumber` UUID opaque unique. "Générer le pass" = créer cette instance + signer cryptographiquement + transmettre au device.

**Backend déjà mergé chantier 2.8 (A→E)** avec real signing :

- `generatePass` action `"use node"` (.pkpass PKCS#7 via passkit-generator + Google Save JWT RS256, POC #3 validé)
- 3 routes HTTP Apple PassKit Web Service dans `apps/admin/api/wallet/*` : pass/[serial], registrations/[...path], push
- Bridge identité `linkSerialToCustomer` (cross-device/cross-resto via serial)
- `triggerUpdate` push update silent (re-branding header + mutabilité URL embedded)
- `deliverIncentive` (option C statu quo)

**Décisions frontend V1** :

- Génération **LAZY** au clic "Ajouter à mon Wallet" (~300ms imperceptible). Pas de pré-warm.
- Distribution device-specific :
  - iOS Safari : Blob `application/vnd.apple.pkpass` à partir du `pkpassBase64` → `URL.createObjectURL` → assign `window.location` → Safari intercepte MIME → sheet natif. Cleanup blob après 5s.
  - Android Chrome : `window.location.href = googleSaveLink` → ouvre Google Wallet preview.
  - Desktop : bouton désactivé, message "Disponible sur mobile uniquement".
- URL embedded "back of pass" = host du `lastBrandTenantId` avec `?wallet=<serialNumber>`.
- Mutabilité URL : OUI via `triggerUpdate` silent push (Apple webhook PassKit refetch + Google API Update).
- URLs différentes par push notif : Android natif via `actionUri` ; iOS workaround update `app-launch-url` JUSTE AVANT push (2 niveaux indirection, ~20-30% drop iOS, limitation Apple non-contournable).
- Bridge identité au tap : middleware lit `?wallet=<serial>` → action `wallet.bridgeSerialToSession` → résout customer global → re-signIn cookie session sur ce customer.
- Re-branding pass à chaque cmd nouveau resto : auto-mergé via `triggerUpdate.recordBrandChange`.

**3 paliers Wallet install** (logique produit révisée Q5 grilling) :
| Moment | UI | Bloquant ? |
|---|---|---|
| Juste après submit address-first | Card pleine page "🎁 -10% sur ta prochaine cmd → Ajoute la carte" + bouton primary + "Plus tard" link | NON skippable |
| Bandeau top permanent menu/panier | Banderole fine "🎁 -10% offerts → ajoute la carte", dismissable session-scoped | NON |
| Modal au clic "Payer" (= PRD spec) | Modal incontournable | OUI (V1 spec) |

### Stripe payment frontend (Q6)

**Backend déjà mergé chantier 2.5 (A→E)** : onboarding Express + direct charge + clone PaymentMethod cross-tenant + refund 3 chemins + chargeback monitoring Slack-only. Onboarding validé E2E groupe W.

**Frontend** :

- Stack `@stripe/stripe-js` + `@stripe/react-stripe-js`. Init `loadStripe(PUBLISHABLE_KEY_PLATFORM, { stripeAccount: 'acct_resto' })`.
- **Lazy load uniquement sur `/checkout`** (économise bundle JS sur menu/panier).
- Flow : RSC pré-rempli email/tel/firstName + branche saved card (tile + "Utiliser autre carte") vs Payment Element vide. Bouton "Payer X €" → mutation `payWithSavedCard` (clone backend) OU `stripe.confirmPayment` (Stripe handle 3DS).
- Wording checkbox neutre : « Sauvegarder ma carte pour mes prochaines commandes » (acté CONTEXT payment).

**Apple Pay domain verification** : V1 manuel via Stripe Dashboard à chaque Phase C onboarding (2 min/tenant + fichier `apple-developer-merchantid-domain-association` partagé dans `public/.well-known/`). V2 automatisation via API.

### Uber Direct frontend (Q7)

**Backend déjà mergé chantier 2.6 (A→D)** : OAuth credentials par tenant + address-first orchestration + course creation au payment + 4 cas incident state machine actés.

**Frontend** :

- Google Places `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` exposé + HTTP referrer restriction `*.kitchen-boost.fr/*` + custom domains. `componentRestrictions: { country: 'fr' }`, `types: ['address']`. Coût ~$85/mois après quota gratos $200.
- Address-first **auto-validate** au sélection suggestion (1 tap de moins). Chain : `signIn("anonymous")` → `getOrCreateCurrentCustomer` → `updateAddress` → `requestDeliveryQuote`.
- Toggle Livraison/C&C header permanent, Context React (pas localStorage). **Switch sans re-quote** (2 modes cached dans verdict initial).
- Latching au clic Payer : mutation `recaptureQuoteAtPayment` AVANT `confirmPayment`. Si fee monte → modal bloquant confirm.
- Tracking page `/c/[orderId]` Convex subscription realtime. États : 6 étapes mode delivery + 3 étapes C&C. ETA dérivé webhook Uber `pickup_eta` / `dropoff_eta`. Récap items collapsible `<details>` natif HTML. URL non-protégée (orderId non-devinable).

### Push enrollment orchestration (Q8)

**Détection canal actif côté front** : RSC `/checkout` `preloadQuery(getCurrentCustomer)` → check `pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}`. Si au moins UN = "enrolled" → modal NE s'affiche PAS, bouton "Payer" actif direct. Sinon → bouton "Payer" ouvre modal. Convex subscription pour realtime update si install effectif pendant client sur la page.

**Modal single-screen non-skippable** :

- Layout : 2 options visibles ensemble (Wallet primary + Web Push secondary) + 1 fallback caché initialement
- Header : "Pour finaliser ta cmd, choisis comment recevoir ta confirmation + offres"
- Hook : Incentive Wallet texte resto config
- Option 1 (primary) : Wallet — 2 taps · push lock-screen
- Option 2 (secondary) : Web Push — 1 tap · pas de lock-screen iOS
- Fallback caché : lien microscopique "Continuer sans notifs →" apparait après 2 échecs
- Non-skippable Esc / click outside. Pas de "Annuler". Sortie via succès enrollment OU fallback frictionnel.

**Flow async install Wallet** : loader 30s + "Tester sans attendre" (poll `wallet.checkInstallStatus`) + "J'ai changé d'avis" (retour modal initial). Convex sub `customers.pushEnrollment.walletStatus` flip "enrolled" → modal close auto.

**Flow Web Push** : `Notification.requestPermission()` → si granted, `pushManager.subscribe({applicationServerKey: VAPID_PUBLIC, userVisibleOnly: true})` → mutation `customer.webPush.register` (déjà mergée 2.1-G).

**iOS < 16.4** : `'PushManager' in window === false` détecté → option Web Push **masquée** par le modal. Seule option = Wallet.

**Fallback 3 niveaux** :

- Niveau 1 : lien microscopique 12px muted
- Niveau 2 : modal confirm explicit "Sans notifs : AUCUNE confirmation, AUCUN suivi, AUCUNE offre. Sûr ?"
- Niveau 3 : modal final "On a vraiment besoin..." → re-display modal initial une dernière fois
- Re-refus final → flag backend `customer.pushEnrollment.noChannelPossible = true` + close modal + proceed paiement (SMS fallback transactionnel via Cascade Notifications).

**Pas de A2HS dans le modal** : Android natif déjà couvert par Web Push (équivalent UX). iOS GIF instructions trop friction modal-context. A2HS sur triggers séparés (bouton Android post-cart Q4, bottom-sheet iOS post-tracking Q4).

**Desktop bloqué pour payment V1** : message "Continue depuis ton mobile pour finaliser" (cohérent mobile-first PRD).

### Deep modules à extraire (7 modules)

| #   | Module                         | Interface                                                              | Encapsule                                                                                                                                                   |
| --- | ------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tenant-resolver`              | `resolveTenantFromHost(host) → tenantId \| null`                       | DNS wildcard + cookie lifecycle + Convex query + cache hit/miss + 410 handling                                                                              |
| 2   | `customer-identity`            | `useCustomer() → { customer, signInAnonymous, signOut, isLoading }`    | Convex Auth Anonymous + fiche provisioning + session 365j + cookie cohabitation                                                                             |
| 3   | `cart-store`                   | `useCart() → { items, add, remove, updateQty, note, totals, clear }`   | Persistence localStorage + cross-tab stale + dédup item×modifiers + Note resto                                                                              |
| 4   | `delivery-quote`               | `useDeliveryQuote(address) → { verdict, refire }`                      | Chain signIn+updateAddress+quoteUber + cache 2 modes + re-fire à édit + spinner state                                                                       |
| 5   | `push-enrollment-orchestrator` | `usePushEnrollment() → { status, openModal, channels, fallbackLevel }` | 3 paliers Wallet + modal bloquant + détection Convex sub + fallback 3 niveaux + iOS<16.4 masking + noChannelPossible                                        |
| 6   | `wallet-distribution`          | `useWalletInstall() → { generate, install, status }`                   | Device detection (iOS Blob / Android Save link / Desktop disabled) + action `generatePass` + loader async 30s + poll `checkInstallStatus` + Convex sub flip |
| 7   | `tracking-subscription`        | `useTracking(orderId) → { state, etaPickup, etaDropoff, incident }`    | Convex realtime sub + state machine 6/3 étapes + incident derivation + ETA mapping webhook Uber                                                             |

Modules NON-extraits (juste composants React simples) : `<AddressFirstForm>`, `<MenuView>`, `<ItemModal>`, `<CartView>`, `<CheckoutForm>`, `<TrackingPage>` — testés via intégration avec deep modules + E2E manuel.

### Conventions (déjà actées repo)

- Vocabulary domain : respecter CONTEXT.md (Tenant, Customer, Cart, Wallet pass, Order, Cmd avortée, Latching, etc.)
- ADRs à respecter : 0002 / 0003 / 0004 / 0007 / 0008 / 0010 / 0011 / 0012 / 0013 / 0015
- Sanctioned wrappers Convex : `customerQuery / customerMutation / publicTenantQuery` (cf. `lib/tenancy/customer.ts`)
- Pas de `getAuthUserId` hors lib auth (ADR 0011)
- ESLint `no-untenanted-query` respecté
- Tests cross-tenant fuzz pour toute nouvelle query/mutation tenant-scoped

## Testing Decisions

### Philosophie : un bon test = comportement externe, pas implémentation

Un test pertinent doit pouvoir échouer pour une vraie raison fonctionnelle (pas un changement cosmétique), et son échec doit pointer vers un bug réel et pas vers un détail d'implémentation. Cf. `feedback_no_brittle_tests` (mémoire repo) + convention KitchenBoost (validée campagne E2E V1 admin 12/12 groupes).

### Modules à tester EXHAUSTIVEMENT (state machines / orchestrateurs)

**Module 1 — `tenant-resolver`** :

- `resolveTenantFromHost("bunsbao.kitchen-boost.fr") → "tenant_id_bunsbao"` (par slug)
- `resolveTenantFromHost("bunsbao.fr") → "tenant_id_bunsbao"` (par custom domain)
- `resolveTenantFromHost("unknown.fr") → null` (host inconnu)
- Cookie cache hit/miss (poser cookie au 1er hit, lire cookie au 2ème sans re-query)
- Cookie expiré (>30j) → re-query
- Tenant supprimé entre cookie et middleware re-query → clear cookie + page erreur
- Cross-tenant fuzz : un cookie valide pour tenant A ne donne pas accès à tenant B

**Module 4 — `delivery-quote`** :

- Chain submit → quote `deliverable: true` → verdict OK
- Chain submit → quote `hors_zone` → verdict + reason mapping
- Chain submit → quote `hors_horaire` → verdict + reason
- Chain submit → quote `surge` → verdict + reason
- Édit address → re-fire quote idempotent
- Cache 2 modes (livraison + C&C) → switch mode sans re-quote

**Module 5 — `push-enrollment-orchestrator`** (state machine la plus complexe — couvrir exhaustivement) :

- État initial : 0 canal enrolled → modal s'ouvre au "Payer"
- Wallet enrolled → modal ne s'ouvre pas, "Payer" actif
- Web Push enrolled (Android) → modal ne s'ouvre pas
- A2HS enrolled (mais 0 push) → modal ne s'ouvre pas (A2HS compte comme canal)
- Modal ouvert : flow Wallet → install → flip enrolled → close
- Modal ouvert : flow Web Push grant → register → flip enrolled → close
- Modal ouvert : Wallet timeout 30s → "Tester sans attendre" → poll → flip
- Modal ouvert : Wallet user cancels via "J'ai changé d'avis" → retour modal initial
- Modal ouvert : Web Push denied → compteur échecs incrémenté
- 2 échecs (Wallet refusé + Web Push denied) → fallback link visible
- iOS <16.4 → Web Push option masquée
- Fallback 3 niveaux : Niveau 1 → 2 → 3 → flag `noChannelPossible` posé
- Convex sub realtime : install effectif pendant client sur page → modal close auto

**Module 6 — `wallet-distribution`** :

- Détection device iOS → flow Blob `.pkpass`
- Détection device Android → flow `googleSaveLink` redirect
- Détection device Desktop → bouton disabled
- Action `generatePass` returns `{ pkpassBase64, googleSaveLink, serialNumber }`
- Poll `checkInstallStatus` returns `{ installed: true/false }`
- Convex sub flip `walletStatus = "enrolled"` au webhook `pass_installed`

**Module 7 — `tracking-subscription`** :

- État `paid` → step "Cmd reçue" affiché
- État `preparing` → step "En préparation"
- État `courier_assigned` → courier name + ETA pickup
- État `courier_at_pickup` → "Courier en route vers le resto"
- État `courier_at_dropoff` → "Courier en route vers toi" + ETA dropoff
- État `delivered` → "Livré"
- État `incident_after_pickup` → card "Incident livraison, tu as été remboursé"
- État `refused_post_payment` → card "Désolé, livraison non disponible"
- Click & Collect : 3 états seulement (cmd reçue → en préparation → prête à récupérer)
- Convex sub : webhook Uber → re-render UI <500ms

### Modules à tester sur invariants critiques (composables thin)

**Module 2 — `customer-identity`** :

- `useCustomer()` returns `null` si pas de cookie
- `useCustomer()` returns `{ customer }` si cookie valide
- `signInAnonymous()` triggers Convex Auth → cookie posé
- `signOut()` clears Convex Auth cookie (tenant cookie inchangé)
- Cohabitation cookies : `__Host-kb_tenant` reste après signOut

**Module 3 — `cart-store`** :

- Add 1 item → liste contient 1 entrée
- Add même item × mêmes modifiers → quantité incrémentée (dédup)
- Add même item × modifiers différents → 2 entrées distinctes
- Update qty → recalcul totals
- Remove → liste mise à jour
- Persist localStorage → reload page → cart restauré
- Cross-tab stale : tab A modifie cart → tab B ne voit pas changement (acceptable, comportement attendu)
- Note resto persistée, max 200 chars enforced

### Composants pages testés en intégration légère

`<AddressFirstForm>`, `<MenuView>`, `<ItemModal>`, `<CartView>`, `<CheckoutForm>`, `<TrackingPage>` : smoke tests + 1-2 scenarios critiques :

- Render sans crash
- Bouton submit déclenche action attendue
- Etat error affiche message attendu

Pas de tests visuels/snapshots redondants (ex: "le bouton a la couleur verte" — couvert par E2E manuel).

### Prior art tests

Pattern `apps/admin` (vitest + React Testing Library + composants `.test.tsx`) déjà établi sur la campagne E2E V1 admin (12/12 groupes A/MC/QR/MO/T/P/AC/M/CMD/PR/SUP/W validés 2026-06-03). Pour modules pures (resolver, state machines, mappings), vitest unit isolation. Pour composables avec Convex, mock `convex/react` hooks. Backend tests : cross-tenant fuzz pattern via `lib/tenancy/fuzz.ts` (déjà mergé), `withIdempotence` pattern pour webhooks.

### E2E manuel sur device réel (campagne post-implémentation)

Cohérent avec la campagne E2E V1 admin validée. Groupes E2E à concevoir post-implémentation :

- Groupe **A** : address-first sur device iOS/Android, verdicts livrable/hors_zone/hors_horaire
- Groupe **M** : menu browsing, item modal, modifiers required/optional
- Groupe **C** : cart manipulation, Note resto, toggle livraison/C&C, switch fees
- Groupe **CHK** : checkout form, push enrollment modal (3 paliers + fallback 3 niveaux + iOS <16.4), saved card / new card / Apple Pay
- Groupe **PAY** : Stripe payment success, 3DS, retry échec, latching surge confirm
- Groupe **TRK** : tracking realtime (6 étapes delivery + 3 C&C + incident)
- Groupe **WAL** : Wallet install iOS/Android, bridge identité cross-device, re-branding
- Groupe **A2H** : A2HS Android post-cart, A2HS iOS post-tracking, heuristique standalone
- Groupe **REC** : reconnaissance retour 2ème visite, "Bonjour Sophie", "Ce n'est pas moi" reset

## Out of Scope

**V1 — Explicitement hors scope** :

- **Offline form recovery checkout** (anciennement US 64 du draft initial) — re-saisie 30s acceptable si connexion perdue mid-checkout. Le firstName/email/phone sont déjà persistés server-side dès la 1ère cmd dans la fiche customer, donc pré-remplissage RSC les ramène à la 2ᵉ visite. Pas besoin de localStorage redondant.
- App native client final (Q10-Q1 acté CONTEXT — PWA suffit, app native client = V3 si métriques PWA insuffisantes)
- Widget embed dans site host resto (ADR 0004 — casse push iOS)
- Codes promo manuels ad-hoc (Q10-Q7 acté CONTEXT — V2)
- Search dans menu (Q10-Q8b acté — V2)
- Banner cookie (acté — first-party only, CNIL exempte, V2 si analytics tiers)
- Marketplace consumer-facing KB (V3 — V1 = 1 PWA par resto, pas listing global)
- Reviews gating post-livraison (V2, cible Google My Business jamais Uber Eats)
- Pré-commande planifiée (V3)
- Tip courier (V2 si demande terrain)
- Multi-langue (V3)
- Historique commandes client visible (V2)
- Profil persistant cross-resto avec UI explicite (V2 — V1 = silent cross-resto via Wallet pass)
- A/B testing variants PWA (V2)
- Carte Wallet premium par resto (V2 — V1 = carte commune neutre)
- Horaires séparés livraison vs C&C (V2)
- Map embed tracking GPS live (V2 si demande terrain)
- Email marketing cross-tenant co-branded (V2)
- Mode widget embed sans push iOS (V2)

**Décisions explicitement REJETÉES pendant le grilling** :

- Tenant resolution path-based `/t/[slug]/...` (casse ADR 0008, push web origin, domaine custom, branding)
- Edge Config Vercel V1 (overkill MVP, V2+)
- Sign-in anonymous au mount client (pollue users table)
- Sign-in anonymous dans middleware Edge (Convex Auth pas conçu pour Edge runtime)
- Bandeau "On a ton adresse" (anxiogène = surveillance)
- Incentive A2HS V1 (option A étendre / B parallèle rejetées — détection iOS unreliable, dilution attracteur Wallet)
- URL embedded pass = domaine neutre KB (friction inutile, casse "vraie vitrine resto")
- Modal push enrollment wizard multi-step (single-screen Wallet+Web Push ensemble plus rapide)
- A2HS comme option dans modal push enrollment (canaux séparés)

## Further Notes

### Note US 43 — orchestration backend pour URLs différentes par push Wallet iOS

US 43 stipule que les push Wallet doivent être deep-linkables par-push (URLs différentes pour chaque campagne). **Backend déjà mergé** chantiers 2.7 (`lib/notifications/dispatch`) + 2.8-D (`lib/wallet/triggerUpdate`). Sur iOS, l'orchestration est : `lib/notifications/dispatch` appelle `wallet.triggerUpdate` (update silent du champ `app-launch-url` du pass) JUSTE AVANT d'envoyer la push notification → l'utilisateur tap la push → ouvre Wallet → tap la carte → URL fraîchement updatée est ouverte.

Le frontend PWA n'a **rien à faire** pour cette US. Elle est satisfaite par backend mergé. À vérifier en E2E groupe WAL post-implémentation que le workaround fonctionne effectivement sur device iOS réel.

### État du backend (80% déjà mergé)

Le grilling a confirmé que **80% du backend nécessaire à la PWA client est déjà mergé** :

- Customer/Auth : chantier 2.1 (A-B-C-D-E-F-G) — fiche customer + Anonymous provider + reachability + RGPD + webPush register
- Notifications : chantier 2.7 (engine + cascade + templates + rate limit + dispatch + webPushDispatch)
- Stripe Connect end-to-end : chantier 2.5 (A-B-C-D-E) — onboarding + direct charge + clone PaymentMethod cross-tenant + refund + chargeback monitoring
- Uber Direct + Delivery : chantier 2.6 (A-B-C-D) — credentials + quote + course + webhooks + incidents
- Wallet pass real signing + PassKit Web Service : chantier 2.8 (A-B-C-D-E) — generatePass + registrations + linkSerial + triggerUpdate + incentive
- Pricing engine + règle défaut KB : chantier 2.4

**Conséquence vélocité V1** : l'implémentation `apps/web` peut démarrer immédiatement avec un scope frontend pur (+ quelques mutations spécifiques : `wallet.bridgeSerialToSession`, `wallet.checkInstallStatus`, `customer.pushEnrollment.markNoChannelPossible`, `customer.pushEnrollment.recordA2hsAccepted`).

### Source décisionnelle exhaustive

Le `decisions-log.md` hors-repo (582 lignes) contient :

- Q1-Q8 chronologiquement avec mécanismes exacts, edge cases, trade-offs
- 7 cas de figure reconnaissance tabulés
- 3 options Incentive (A/B/C) avec arguments
- Métaphore Sephora pour Wallet
- TODO infra global consolidé
- Sub-PRD à créer, ADRs à drafter, CONTEXT updates consolidés

À recopier dans `docs/prd/sub/10-pwa-client/00-decisions-log.md` à la fin du grilling (quand agents mobile finis).

### Vertical slices breakdown (pour /to-issues)

18 stories vertical slices proposées :

- 3 HITL (DNS, Vercel config, Lottie assets)
- 12 AFK Foundation + Menu/Cart + Checkout/Payment (S6 splitté en 4)
- 4 AFK Moats (Wallet 9a/9b, A2HS 10/11)
- 1 AFK Recognition (S12)

Cf. `02-issues-breakdown.md` pour détail complet avec acceptance criteria + dependencies + estimation effort.

### Updates spec à recopier dans le repo

Quand les agents mobile auront fini :

- `docs/contexts/client-ordering/CONTEXT.md` : préciser `Push enrollment` 3 paliers + ajouter terme `Bandeau de retour` + préciser `Item out of stock` overlay LIVE Convex sub
- `docs/contexts/customer-data/CONTEXT.md` : préciser `Anonymous account` signIn au submit address + session 365j sliding
- `docs/contexts/notifications/CONTEXT.md` : aucun changement nécessaire
- `docs/prd/10_pwa_client_commande.md` : §9 ajouter paliers soft + bandeau en amont, §5 préciser overlay LIVE, §2 préciser auto-validate, §11 préciser Convex sub realtime
