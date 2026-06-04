# Grilling PWA Client — Decisions log

Session démarrée 2026-06-04. **Documentation entièrement hors repo** (Alex a des agents qui bossent sur app mobile en parallèle, pas d'interférence).

Tout ce qu'on tranche ici sera recopié dans le repo à la fin de la session (CONTEXT.md, ADRs, PRDs).

---

## Contexte de départ

- Repo : `kitchen-boost-repo` (monorepo pnpm)
- `apps/web` : scaffold legacy Next.js 16.1.6 + Convex Auth + Tailwind 4 + web-push installé, **aucun code PWA client** — juste login/signup/dashboard copiés du starter admin. À nettoyer.
- `apps/admin` : terminé V1, route via path `/t/[tenantId]/...` (pas applicable au client).
- `apps/native` : KB Orders, en cours de grilling parallèle (NE PAS toucher).
- Backend Convex prêt côté tenants/menus/orders, à compléter pour le moteur push web + Wallet + Stripe Customer cross-tenant + Uber Direct quote.

## Spec figée (à ne pas re-grilling)

Cf. ces fichiers dans le repo (read only pour cette session) :

- `docs/contexts/client-ordering/CONTEXT.md` — language complet (Cart, Item, Allergènes, Wallet pass, A2HS, Push enrollment bloquant, Branding asymétrique, etc.)
- `docs/contexts/payment/CONTEXT.md` — Stripe Connect direct charge, application_fee_amount=240, Stripe Customer cross-tenant + clone PaymentMethod, frais d'acceptation par direct charge
- `docs/contexts/delivery/CONTEXT.md` — Uber Direct, Quote au address-first, courier flows, click & collect
- `docs/contexts/notifications/CONTEXT.md` — Cascade marketing/transactionnel, Wallet push channel commun, push web tenant-scoped
- `docs/contexts/pricing/CONTEXT.md` — Règles, Latching au paiement, fallback client paie 100%, affichage prix barré + "Offert par X"
- `docs/contexts/customer-data/CONTEXT.md` — Cookie HttpOnly device-only, Wallet pass = bridge cross-resto, pas de match email/tel V1
- `docs/prd/10_pwa_client_commande.md` — scope V1/V2/V3, 12 sections fonctionnelles, edge cases
- ADRs : 0002 (push dual stack), 0003 (Wallet commun marque neutre), 0004 (PWA standalone pas widget), 0007 (consent par clic Payer), 0008 (identité cookie device-only), 0012 (push enrollment / identity / customer data / notifications), 0013 (pricing backend-only), 0015 (publishedMenus brouillon→atomique)

---

## Décisions tranchées (chronologique)

### 2026-06-04 · Q1 — Tenant resolution

**Décision** : Middleware Next.js sur hostname, app vit dans `apps/web` (scrap le scaffold legacy auth/dashboard).

**Mécanisme** :

1. Wildcard DNS `*.kitchen-boost.fr` → Vercel route vers `apps/web`.
2. Middleware Edge lit `host` :
   - 1ʳᵉ visite : query Convex `tenants.bySlug("bunsbao")` (ou `tenants.byCustomDomain("bunsbao.fr")` si domaine custom) → résout `tenantId`.
   - Pose cookie HttpOnly `__Host-kb_tenant=<tenantId>` (long-lived 30j, refresh à chaque visite).
   - `NextResponse.rewrite` interne (jamais redirect — préserve SEO + cookie scope).
3. Hits suivants : middleware lit le cookie, **zéro query DB**.

**Pas en V1, V2+** :

- Edge Config Vercel (table `slug → tenantId` synchronisée par webhook). Acté overkill V1.
- Vercel "always-on" pour cold start Edge.

**Pourquoi pas path-based `/t/[slug]/...`** : casse [ADR 0008](docs/adr/0008-identite-customer-cookie-device-only-v1.md) (cookies device intra-tenant via domaine), casse push web origin-scoped, casse domaine custom resto, casse branding "vraie vitrine resto".

**Mythe SEO middleware démythifié** : Google reçoit le HTML après rewrite, invisible au bot (confirmé J. Mueller août 2023). Cold start Edge ~50ms, négligeable vs LCP cible 2.5s. Coût Vercel ~$3.25/mois à 100k cmds.

**TODO infra V1** :

- [ ] Provisionner wildcard DNS `*.kitchen-boost.fr` chez registrar avant launch
- [ ] Configurer Vercel Edge region pinning (Paris/Frankfurt) cohérent Convex EU
- [ ] Backend Convex : exposer `tenants.bySlug` + `tenants.byCustomDomain` en query publique non-authenticated (lecture middleware Edge), retourne `{ tenantId, slug, customDomain, brandingHash }`

### 2026-06-04 · Q2 — Route map + rendering strategy

**Routes user-facing V1 (6)** :
| Route | Rendu |
|---|---|
| `/` | RSC streaming, lit cookie `kb_customer` pour pré-remplir adresse |
| `/menu` | **ISR + on-demand revalidate au clic "Publier"** (tag `menu:<tenantId>`) |
| `/panier` | Client-only (localStorage) |
| `/checkout` | RSC + boundaries client (Stripe Elements) |
| `/c/[orderId]` | RSC initial + Convex realtime subscription |
| `/legal/cgv`, `/legal/privacy` | Static |

**Routes système (3)** :
| Route | Rendu |
|---|---|
| `/manifest.webmanifest` | API route dynamic par host, cache 1h CDN |
| `/sw.js` | Static depuis `public/sw.js` |
| `/api/...` | API routes (wallet PassKit web service, stripe webhook, uber webhook, push send/subscribe) |

**Sous-décisions tranchées** :

- (a) **Item détail = modal Vaul URL-stateful** `?item=<itemId>` (bottom-sheet mobile, side-drawer desktop). Pas de route séparée.
- (b) **`/menu` ISR + on-demand revalidate** : `publishedMenus` change uniquement au clic "Publier" admin → mutation Convex déclenche `revalidateTag('menu:<tenantId>')` via webhook → Vercel invalide CDN cache, prochain visiteur déclenche re-render. `available` (out-of-stock) overlay LIVE via Convex subscription par-dessus HTML cached (~200ms latence toggle KDS, sans full reload).
- (c) **Tracking URL = `/c/[orderId]`** (court, scannable SMS/push). `orderId` = Convex `Id<"orders">` brut (non-devinable cuid, pas besoin de short ID V1).
- (d) **Manifest dynamic API route** par host (logo, color, name spécifiques tenant). Idem `/icon.png` + `/apple-touch-icon.png`.
- (e) **Service worker unique `apps/web/public/sw.js`** scope `/`. Subscription push web naturellement origin-scoped (= `bunsbao.kitchen-boost.fr`). Pas de Workbox V1, pas d'offline cache complexe.

**LCP attendu** : < 1.5s sur 4G (largement sous cible PRD 2.5s) grâce à ISR + CDN Vercel + lazy images.

**Trade-offs assumés V1** :

- Pas d'app shell offline (cmd nécessite réseau de toute façon).
- `/panier` perdu si l'utilisateur change de device (pas de sync, juste un buffer pré-checkout).
- `/c/[orderId]` non-protégé par auth forte (mitigé : orderId non-devinable, pas de PII sensible affiché).

**TODO infra V1** :

- [ ] Hook Vercel `revalidateTag` côté backend Convex publishMenu mutation
- [ ] API route `/manifest.webmanifest/route.ts` qui lit host + sert JSON branded
- [ ] `public/sw.js` minimal : push event handler + click handler (deep link)

### 2026-06-04 · Q3 — Sign-in anonymous : timing + reconnaissance retour

**Ce qui était déjà acté (backend chantier 2.1-B mergé)** :

- Provider Convex Auth `Anonymous` dans `auth.ts` stamp `role: customer` + `isAnonymous: true`
- `getOrCreateCurrentCustomer` mutation silent fiche provisioning
- `getCurrentCustomer` query self-scoped
- Wrappers `customerQuery/customerMutation` avec `tenantId` explicite
- `publicTenantQuery` pour menu sans auth
- Cookie = native Convex Auth session cookie (HttpOnly, Secure, host-only)

**Décision V1 — Timing signIn** : **Option C** — `signIn("anonymous")` déclenché au **submit du form address-first**, pas au mount client ni en middleware.

Raisons :

1. Évite pollution table `users` par bots / visiteurs qui rebondissent (90% du noise éliminé).
2. Sign-in coïncide avec 1ère écriture utile (address + lat/lng + déclenche quote Uber).
3. Cohérent ADR 0008 (cookie device-only intra-tenant) + bonus RGPD (pas de tracking sans intent).

Trade-off : 2ᵉ visite cold après expiration cookie 1 an → re-submit adresse (acceptable, Google Places autocomplete = 5s).

**Décision V1 — Session lifetime** : **365 jours total + 365 jours inactive** (sliding window). Override Convex Auth default (30j) via `convexAuth({ session: { totalDurationMs: 365*24*3600*1000, inactiveDurationMs: 365*24*3600*1000 } })` dans `auth.ts`.

**Décision V1 — Reconnaissance retour (UX)** :

| État capté                                                        | UI affichée                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `firstName` connu (checkout précédent terminé)                    | Bandeau `"Bonjour {firstName} 👋"` (warm, social, pas d'historique mentionné) |
| `firstName` absent (cookie présent mais checkout jamais finalisé) | Aucun bandeau, juste pré-rempli silencieux du form                            |

- Form adresse : `defaultValue = customer.address`, bouton `"Confirmer"` (au lieu de `"Valider"`).
- Lien discret en-dessous : `"Ce n'est pas moi →"` qui clear cookie Convex Auth + refresh (use case device partagé : couple/famille/smartphone passé).
- **JAMAIS** "On a ton adresse" / "Voici tes 4 dernières cmds" / mention adresse explicite → flippant (= surveillance), on optimise pour hospitalité ("Bonjour {firstName}" = social, accueillant).

**Décision V1 — Lecture identité RSC** : `convexAuthNextjsToken()` server-side dans RSC `/` → `preloadQuery(api.customer.identity.getCurrentCustomer, {tenantId}, {token})` → injecte `firstName` + `address` dans le HTML pré-rendu (pas de FOUC au mount).

**Décision V1 — Cohabitation cookies** : 2 cookies indépendants, aucune fusion. `__Host-kb_tenant=<id>` (notre middleware) + `__Host-...convexAuthJWT...` (framework). Au "Ce n'est pas moi", on clear UNIQUEMENT le Convex Auth (tenant cookie reste — il identifie le resto, pas l'humain).

**Mécanisme exact de reconnaissance retour** :

À la 1ʳᵉ visite (submit address-first) : `signIn("anonymous")` → POST `/api/auth` → backend Set-Cookie `__Host-...convexAuthJWT...` HttpOnly+Secure+SameSite=Lax+host-only. Mutations `getOrCreateCurrentCustomer({tenantId})` + `updateAddress({address, lat, lng})` provisonnent la fiche.

À la 2ᵉ visite (même browser/device/domaine, < 1 an) : browser envoie cookie automatiquement → RSC `convexAuthNextjsToken()` extrait token → `preloadQuery(getCurrentCustomer, {tenantId}, {token})` server-side → injecte `firstName` + `address` dans HTML pré-rendu.

**Tableau exhaustif des 7 cas de figure** (à acter pour ne pas avoir de surprise terrain) :

| Cas                                                  | Reconnu ?       | Pourquoi                                                                                                                                                                                                          |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Même browser, même domaine, < 1 an                   | **Oui**         | Cookie présent, lifetime non expiré                                                                                                                                                                               |
| Même browser, autre resto KB (autre domaine)         | **Non**         | Cookies cloisonnés host-only (ADR 0008) — doublon assumé sauf Wallet pass                                                                                                                                         |
| Autre device (mobile vs desktop)                     | **Non**         | Pas de cookie sur l'autre device — doublon assumé sauf Wallet pass                                                                                                                                                |
| Mode privé Safari/Chrome                             | **Non**         | Cookies non persistés en privé — doublon à chaque session privée                                                                                                                                                  |
| Cache navigateur vidé                                | **Non**         | Cookie effacé avec le cache — doublon                                                                                                                                                                             |
| > 1 an sans visite                                   | **Non**         | Cookie expiré, nouveau user au prochain submit address                                                                                                                                                            |
| Wallet pass installé, n'importe quel device/resto KB | **Oui (cross)** | `serial_number` du pass envoyé via deep link → `customers.byWalletSerial(serial)` → résout `customer_id` global → rebind cookie session sur ce customer (Stripe Customer + address + LTV cross-resto disponibles) |

**UX pré-remplissage 2ᵉ visite** :

- Form Google Places avec `defaultValue={preloadedCustomer.address}` + bandeau `"Bonjour {firstName} 👋"` au-dessus si firstName connu.
- Bouton `"Confirmer"` (au lieu de `"Valider"`) si pré-rempli.
- Lien petit en dessous : `"Ce n'est pas moi →"` reset le form (clear cookie Convex Auth, refresh page, tenant cookie inchangé).
- **Reconnaissance silencieuse pas de pop-up "Re-bienvenue"** (intrusion / inquiétude device public).

**Edge cases actés** :

- **Tenant orphelin** : middleware re-query tenant via cookie → si null → clear cookie + page erreur "Resto non disponible". Pas de fallback vers autre tenant.
- **Fiche customer orpheline** (user supprimé en DB) : `getCurrentCustomer` retourne null → traité comme 1ère visite (pas de crash).
- **Session expirée** : framework déclenche re-signIn anonymous au prochain submit, nouveau user (doublon assumé ADR 0008).
- **Wallet pass installé** : bridge cross-device/cross-resto via `walletSerialNumber` → résout `customer_id` global → rebind cookie session sur ce customer (détaillé en Q5 Wallet).

**TODO infra V1** :

- [ ] Override `session.totalDurationMs` + `inactiveDurationMs` à 365j dans `auth.ts`
- [ ] Composant client `<AddressFirstForm>` qui : (a) si `firstName` → bandeau "Bonjour {firstName} 👋", (b) pré-remplit form si `address` cached, (c) au submit → `signIn("anonymous")` puis `getOrCreateCurrentCustomer` puis `updateAddress` (chain async), (d) déclenche quote Uber Direct sur succès.
- [ ] Composant `<NotMeLink>` qui clear cookie Convex Auth + refresh page.
- [ ] RSC `/` : `preloadQuery` customer fiche + props down au form.

**CONTEXT updates à acter** (à recopier dans repo plus tard) :

- `client-ordering/CONTEXT.md` — ajouter terme `Bandeau de retour` ou similaire : règle UX = "Bonjour {firstName}" si connu, jamais mention adresse/historique explicite. Lien discret "Ce n'est pas moi".
- `customer-data/CONTEXT.md` — préciser dans le terme `Anonymous account` : signIn déclenché au submit address-first (pas au mount), session 365j sliding.

### 2026-06-04 · Q4 — PWA manifest dynamique + service worker + A2HS

**Manifest endpoint** : `app/manifest.webmanifest/route.ts` (Next API route dynamique). Lit `host` → query `tenants.brandingByHost(host)` → JSON branded resto avec `Cache-Control: public, max-age=3600, s-maxage=3600`.

JSON shape V1 :

- `id: "/"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `orientation: "portrait"`
- `name + short_name` = nom resto, `theme_color` = couleur primaire resto, `background_color: "#FFFFFF"`
- `icons: [192, 512]` avec `purpose: "any maskable"` (Android adaptatif + iOS compat)
- `categories: ["food"]`, `lang: "fr"`
- Pas de `screenshots`/`shortcuts` V1

Routes icônes dynamiques : `app/icon-192.png/route.ts`, `app/icon-512.png/route.ts`, `app/apple-touch-icon.png/route.ts` (180x180) — toutes pipent `ctx.storage.get(tenant.logoStorageId)`.

**Service worker** : fichier statique `public/sw.js`, ~50 lignes, scope `/`, **PAS de Workbox, PAS d'offline cache V1**.

- Events handled : `install` (skipWaiting), `activate` (claim), `push` (showNotification avec `tag: orderId|campaignId` pour collapse), `notificationclick` (deep-link via `clients.openWindow` ou focus+navigate existing window).
- Registration côté client : composant `<ServiceWorkerRegistration />` mount dans root layout, useEffect non-blocking, échec silencieux.
- Update strategy : `skipWaiting + clients.claim` → nouvelle version active au prochain hit sans toast user (friction inutile pour client final).

**A2HS triggers** :

- **Android** : capture `beforeinstallprompt` event, stocke en contexte React `<PWAInstallContext>`. Trigger affichage bouton fixed bottom-right `"📲 Installer Buns & Bao"` **après 1er ajout au panier** (signal intent). Track `pushEnrollment.a2hsStatus = "enrolled"` sur `prompt.userChoice === "accepted"`.
- **iOS** : pas d'API. Détection via `userAgent /iPhone|iPad/ && !matchMedia('(display-mode: standalone)')`. Trigger bottom-sheet Vaul **à la page Tracking T+0** (cmd validée = signal intent maximal). Contenu : GIF 8s loop Share→"Sur l'écran d'accueil"→"Ajouter" + texte court + bouton "OK plus tard". Track standalone à la visite suivante.

**Incentive promo — 3 options évaluées** (proposition Alex de promo négociée avec resto pour install A2HS aussi) :

Découverte clé pendant grilling : **Incentive Wallet est déjà entièrement mergé** (chantier 2.8-E, table `walletIncentiveDeliveries`, module `lib/wallet/incentive.ts`, contrat non-négociable ADR 0002 "no fake reward"). Le code promo n'est délivré **que sur event `pass_installed` réellement constaté** (webhook Apple/Google PassKit), keyé sur `serialNumber` du pass.

| Option                          | Mécanique                                                                                                          | Effort                                           | Risque                                                  | Verdict        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------- | -------------- |
| **A — Étendre**                 | Renommer `Incentive Wallet` → `Incentive Install`, table re-keyée sur `customerId + channel`, ajouter handler A2HS | 1-2 slices backend refactor + spec ADR à updater | Refactor de code en prod, dilue focus V1 final          | ❌ Écartée     |
| **B — Parallèle**               | Garder Incentive Wallet figé, ajouter `Incentive A2HS` en table séparée                                            | 1 slice backend                                  | 2 setups distincts côté resto KB Admin (UX moins clean) | ❌ Écartée     |
| **C — Statu quo + A2HS gratos** | Incentive Wallet reste unique mécanisme, A2HS sans promo dédiée                                                    | 0 backend                                        | Pas d'incentive directe A2HS                            | ✅ **Choisie** |

**Raisons du choix C** :

1. **Détection A2HS iOS intrinsèquement floue** = risque fake reward. iOS n'a pas d'event `appinstalled` fiable, seule détection = `display-mode: standalone` à la prochaine visite. Un client qui ajoute à l'écran d'accueil puis rouvre Safari standard 5 min plus tard → détection standalone → code délivré → install peut-être déjà désinstallé → casse contrat ADR 0002 "no fake reward".
2. **L'incitation Wallet est l'attracteur principal — pas besoin de la diluer**. Push enrollment bloquant au paiement (PRD §9) force le choix. Si Wallet et A2HS sont tous deux incentivés à valeur égale, le client iOS choisira A2HS (canal moins moat : scopé tenant uniquement, pas de cross-resto, pas de bridge cross-device). On perd l'effet réseau V1 entier.
3. **A2HS apporte déjà son propre gain au client SANS promo** (icône écran d'accueil + experience full-screen + push web Android). Win UX intrinsèque, le client le fait pour son confort.
4. **Le canal qui a vraiment besoin d'une incitation = Wallet (déjà en place)**. Wallet = 2 taps install, friction "apparence fidélité card random" → l'incentive Wallet compense précisément cette friction. A2HS n'a pas cette friction.

**Application V1** :

- **Incentive Wallet = uniquement à l'install pass Apple/Google** (statu quo chantier 2.8-E mergé)
- **A2HS sans promo dédiée V1**
- 1 seul champ "Incentive Wallet" à configurer en Phase C onboarding KB Admin
- V2 envisageable (option A refactor) si terrain confirme iOS users skip massivement Wallet

**Trade-offs assumés V1** :

- Pas d'install banner Android au tout 1er hit (-10/20% taux install vs prompt agressif, mais protège UX globale).
- iOS GIF instructions = friction réelle (~30-40% skip), mitigé par push enrollment Wallet bloquant qui suffit.
- Pas de detection install post-iOS fine, juste heuristique standalone.

**TODO infra V1** :

- [ ] `app/manifest.webmanifest/route.ts` + 3 routes icônes dynamiques
- [ ] `public/sw.js` minimal (push handler + notificationclick handler)
- [ ] Composant `<ServiceWorkerRegistration />` dans root layout
- [ ] Composant `<PWAInstallContext>` capture beforeinstallprompt
- [ ] Composant `<AndroidInstallButton />` rendered après 1er ajout panier
- [ ] Composant `<IOSInstallBottomSheet />` rendered sur `/c/[orderId]` état T+0
- [ ] Tracking mutations `customer.pushEnrollment.recordA2hsAccepted` (Android `appinstalled` event) + heuristique standalone iOS

### 2026-06-04 · Q5 — Wallet pass frontend PWA

**Modèle conceptuel — métaphore Sephora** (clarifié pendant grilling suite confusion légitime "si la carte est unique, qu'est-ce qu'on génère ?") :

- **La carte KitchenBoost = un design commun** sous marque neutre (ADR 0003). Visuel identique pour tous les clients KB : même fond, même nom de carte, même logo générique. Apple/Google appellent ça un "template" (Apple = "Pass Type", Google = "Class").
- **Chaque client reçoit SA propre instance** de cette carte, avec un numéro unique (le `serialNumber`). Comme une carte Sephora : tout le monde a la même carte beige, mais le code-barres est unique et c'est lui qui identifie le compte client.
- **"Générer le pass"** = créer cette instance personnelle (avec UUID opaque), la signer cryptographiquement (preuve d'émission KB, pas faussaire), la transmettre au téléphone pour qu'il l'ajoute dans son app Wallet native (Apple Wallet / Google Wallet).

Une fois ajoutée :

- La carte vit dans le téléphone du client (visible swipe-right iPhone, dans Google Wallet sur Android).
- KB peut pousser des notifs lock-screen via cette carte.
- Tap sur la carte → ouvre URL configurée par nous → reconnaissance auto cross-resto (le moat).

**Synthèse implémentation** :
1 carte design commune sous marque neutre (ADR 0003), 1 instance par client avec `serialNumber` UUID opaque unique. "Générer le pass" = créer cette instance personnelle + la signer cryptographiquement + la transmettre au device.

**Ce qui est déjà acté backend (mergé chantier 2.8 end-to-end)** :

- `generatePass` action `"use node"` avec REAL signing (.pkpass PKCS#7 via passkit-generator + Google Save JWT RS256, POC #3 validé)
- 3 routes HTTP Apple PassKit Web Service dans `apps/admin/api/wallet/*` : pass/[serial], registrations/[...path], push
- Bridge identité `linkSerialToCustomer` (cross-device/cross-resto via serial)
- `triggerUpdate` push update silent (re-branding header + mutabilité URL embedded)
- `deliverIncentive` (Q4 statu quo)

**Décisions V1 (frontend)** :

**(1) Génération pass = LAZY au clic "Ajouter à mon Wallet"** (pas pré-warm au load PWA). Action `generatePass({tenantId, brandTenantId})` ~300ms, imperceptible. Pas de surcoût Convex pour visiteurs qui ne cliquent pas.

**(2) Distribution device-specific** (imposé par Apple/Google) :

- **iOS Safari** : Blob `application/vnd.apple.pkpass` à partir du `pkpassBase64` → `URL.createObjectURL` → assign `window.location` → Safari intercepte MIME → sheet natif "Ajouter à Wallet". Cleanup blob après 5s.
- **Android Chrome** : `window.location.href = googleSaveLink` (URL `pay.google.com/gp/v/save/...`) → ouvre Google Wallet preview.
- **Desktop** : bouton désactivé, message "Disponible sur mobile uniquement".

**(3) URL embedded "back of pass" = host du `lastBrandTenantId`** avec `?wallet=<serialNumber>` (ex: `bunsbao.kitchen-boost.fr/?wallet=kb-xxx-yyy`). Cohérent avec branding visible (logo BB header pass) — pas de hub neutre KB intermédiaire (friction inutile).

**(4) Mutabilité URL acté** :

- **Back of pass URL** : ✅ modifiable plus tard via `triggerUpdate` (Apple webhook PassKit refetch + Google API Update).
- **URLs différentes par push notif** : ⚠️ asymétrie iOS/Android :
  - **Android** : ✅ natif via `actionUri` push payload (1 niveau d'indirection : tap → URL direct).
  - **iOS** : ⚠️ pas direct. Tap push → ouvre Wallet → tap carte → URL. **Workaround** = update `app-launch-url` du pass via `triggerUpdate` silent JUSTE AVANT envoi push, puis push. 2 niveaux d'indirection. Drop estimé 20-30% iOS users qui n'iront pas jusqu'au tap carte. Limitation Apple non-contournable sans app native iOS, acceptable V1.

**(5) Bridge identité au tap deep-link** (le moat cross-resto/cross-device) :

- Middleware lit `?wallet=<serial>` → action `wallet.bridgeSerialToSession({serial})` → query `customers.byWalletSerial(serial)` → résout `customerId` global → re-signIn avec `userId` du customer bridgé (clear ancien cookie Convex Auth, set nouveau).
- Redirect `/` URL clean.
- Client se retrouve loggué sur son customer global même sur device neuf / autre resto KB.
- **Sécurité** : serial UUID opaque non-devinable. Leak via screenshot pass = accès LECTURE SEULE (firstName/address/LTV), pas de payment (Stripe Customer cross-tenant nécessite backend operations non-exposées). Acceptable V1.
- **Cas conflit** : session anonymous active sur ce device avant tap → ancien user orphan (anonymisé V2 par cron), nouveau session = customer bridgé.

**(6) Re-branding du pass à chaque cmd nouveau resto** : auto-mergé via `triggerUpdate.recordBrandChange({customerId, newBrandTenantId})` côté Order chantier. Silent push APNs → app Wallet refresh local → header pass montre nouveau logo. Pas de notif lock-screen.

**Logique produit révisée — 3 paliers de friction Wallet install** :
| Moment | UI | Bloquant ? |
|---|---|---|
| Juste après submit address-first | Card pleine page "🎁 -10% sur ta prochaine cmd → Ajoute la carte" + bouton primary + "Plus tard" link | **NON** skippable |
| Bandeau top permanent menu/panier | Banderole fine "🎁 -10% offerts → ajoute la carte", dismissable session-scoped | **NON** |
| Modal au clic "Payer" (= PRD spec) | Modal incontournable "Choisis comment recevoir confirmation + offres" Wallet primary / Web Push secondary | **OUI** (V1 spec inchangée) |

Effet attendu : capter aussi les visiteurs low-intent (scan QR curieux) qui auraient skip un push enrollment uniquement-au-paiement.

**PRD à updater** (à recopier dans repo plus tard) :

- PRD 10 §9 "Push enrollment BLOQUANT à la validation paiement" → ajouter paliers soft prompt address-first + bandeau permanent en amont. Bloquant au paiement reste.
- CONTEXT client-ordering — préciser dans `Push enrollment` les 3 paliers.

**Trade-offs V1** :

- Push iOS limitation native non-contournable (2 niveaux indirection).
- Pas de fallback desktop Wallet install.
- Bridge serial leak = lecture seule (acceptable).
- Pas de prompt OTP confirmation bridge V1.

**TODO infra V1** :

- [ ] Composant `<AddToWalletButton>` avec détection iOS/Android/desktop
- [ ] Composant `<WalletPromptCard>` rendered après submit address (palier 1)
- [ ] Composant `<WalletPromptBanner>` bandeau permanent (palier 2)
- [ ] Modal push enrollment au paiement (Q8 plus tard)
- [ ] Middleware route handler `?wallet=<serial>` → bridgeSerialToSession action
- [ ] Convex subscription sur `customers.pushEnrollment.walletStatus` pour flip UI en realtime à l'install effectif

### 2026-06-04 · Q6 — Stripe frontend PWA

**Ce qui est déjà acté (backend chantier 2.5 A→E mergé)** :

- Onboarding Express + account.updated webhook (validé E2E groupe W)
- Direct charge via `Stripe-Account: acct_resto` header
- `application_fee_amount = 240` immutable V1
- Apple Pay / Google Pay via Payment Element automatic_payment_methods
- Saved card cross-tenant : `saveCard` + `payWithSavedCard` (clone PaymentMethod, POC #6)
- Refund 3 chemins (refusOnRefusal + abortedOrder + chargeRefunded webhook), idempotent
- Chargeback monitoring (Slack-only V1, pas d'UI KB Admin)
- Wording checkbox : « Sauvegarder ma carte pour mes prochaines commandes » (neutre, sans mention KB)

**Décisions V1 (frontend PWA)** :

**(1) Stack Stripe.js** : `@stripe/stripe-js` + `@stripe/react-stripe-js` officiels. Init `loadStripe(PUBLISHABLE_KEY_PLATFORM_KB, { stripeAccount: 'acct_resto' })` → contexte direct charge front. **Lazy load uniquement sur `/checkout`** (économise bundle JS sur menu/panier). +200ms au mount checkout acceptable (client très engagé à ce stade).

**(2) Flow checkout** :

- Page RSC : form email/tel/firstName + consentement implicite par clic Payer.
- Si `customer.savedPaymentMethodId` détecté serveur-side via `preloadQuery` → tile "Payer avec ma carte enregistrée terminant en `XXXX`" + lien "Utiliser une autre carte".
- Sinon Payment Element vide + checkbox "Sauvegarder" en dessous.
- Bouton `"Payer {totalTTC} €"` :
  - Saved card → mutation `stripe.savedCard.payWithSavedCard({orderId})` → backend clone PM + direct charge
  - New card → `stripe.confirmPayment({elements, confirmParams: {return_url}})` → SDK Stripe handle 3DS → webhook `payment_intent.succeeded` → seed Order

**(3) Domain verification Apple Pay / Google Pay** :

- Apple Pay nécessite chaque domaine enregistré dans Stripe Dashboard "Payment method domains".
- Fichier `apple-developer-merchantid-domain-association` servi à `/.well-known/...` (un fichier unique partagé, dans `apps/web/public/.well-known/`).
- **V1 manuel** : Alex tape `<slug>.kitchen-boost.fr` + domaine custom dans Stripe Dashboard à chaque Phase C onboarding (2 min/tenant). Documenté runbook.
- **V2 automatisation** : action Convex `payment_method_domains.create` API Stripe au provisionTenant + customDomainSet.

**(4) Edge cases V1** :

- Saved card avec session orpheline → Payment Element vide en fallback.
- Payment failed → retry inline max 3 (PRD spec) → toast + log Sentry.
- 3DS handle par Stripe.js, pas de code custom.
- Stripe Customer cross-tenant orphan avec savedPaymentMethodId stale → action throw NOT_FOUND propre, Payment Element en fallback.

**Trade-offs V1** :

- Domain verification manuelle = OK low-volume (3-5 restos V1), refactor V2 si 20+.
- Pas de pre-load Stripe.js global = +200ms checkout (acceptable).
- Pas de Apple Pay button standalone sur menu (pattern Stripe Shop) — V2 si bench gain conversion.

**TODO infra V1** :

- [ ] Composant `<CheckoutForm>` avec Payment Element + branches saved card vs new card
- [ ] `apps/web/public/.well-known/apple-developer-merchantid-domain-association` (fichier statique partagé)
- [ ] Runbook Phase C : étape "ajouter domaine Stripe Dashboard"
- [ ] Variable env `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (key plateforme KB live)

### 2026-06-04 · Q7 — Uber Direct frontend PWA

**Ce qui est déjà acté (backend chantier 2.6 A→D mergé)** :

- `lib/uberDirect/credentials` OAuth par tenant (self-signup self-managed)
- `lib/delivery/quote.requestDeliveryQuote` action address-first → verdict `{deliverable, fee, eta, reason?}` (`reason ∈ {hors_zone, hors_horaire, surge}`)
- `lib/delivery/quote.recaptureQuoteAtPayment` action latching anti-surge
- `lib/delivery/course.createCourseOnPaymentConfirmed` (gate visibilité cmd ; [[Cmd avortée]] = refund auto si Uber refuse post-paiement)
- `lib/delivery/webhooks.uberWebhook` httpAction signature-verified par tenant + idempotent
- 4 cas incident state machine actés (Q40-Q6→Q40-Q14) : courier annule avant pickup silent re-dispatch, incident après pickup refund auto, client absent refund manuel discrétionnaire resto, petit retard push si >10min drift

**Décisions V1 (frontend PWA)** :

**(1) Google Places API** :

- Stack : `@googlemaps/js-api-loader` + Places Autocomplete widget officiel.
- Clé exposée publiquement (`NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`) avec **HTTP referrer restriction** Google Cloud Console : `*.kitchen-boost.fr/*` + domaines custom resto (mise à jour à chaque nouveau custom domain).
- Restrictions : `componentRestrictions: { country: 'fr' }`, `types: ['address']`.
- Coût estimé : ~$85/mois après quota gratos $200/mois (10k cmds × 5 searches/cmd).

**(2) Flow address-first UI** :

- Composant `<AddressFirstForm>` rendu sur `/`.
- **Auto-validate au sélection** suggestion Google (= 1 tap de moins vs bouton Valider).
- Chain au sélection : `signIn("anonymous")` si pas session → `getOrCreateCurrentCustomer` → `updateAddress` → `requestDeliveryQuote`.
- Pendant quote (~500-800ms) : spinner inline "On vérifie la livraison…"
- Selon verdict :
  - `deliverable: true` → redirect `/menu` (livraison sélectionnée default)
  - `hors_zone` → toast + bouton "Voir le menu (retrait sur place)"
  - `hors_horaire` → message contextualisé "Le resto est fermé, ouvre à XXh" + checkout désactivé
  - `surge` → "Indisponible à cet horaire, réessaie" + bouton Retry
- Édit du champ adresse après validation → quote re-fire automatiquement.

**(3) Toggle Livraison / C&C (header permanent)** :

- Composant `<DeliveryModeToggle>` rendu dans header de `/menu`, `/panier`, `/checkout`.
- Layout : `[🛵 Livraison · 2,95 €] [🚶 Retrait · Gratuit]`
- État dans Context React `<DeliveryModeContext>` (pas localStorage — évite stale cross-tabs).
- **Switch sans re-quote** : les 2 modes cachés dans le verdict initial. Au switch, juste re-render `<CartTotals>` avec nouveaux fees.
- Mode initial : `deliverable: true` → livraison ; `hors_zone` → livraison grisée, C&C ; `hors_horaire` → 2 grisés.

**(4) Latching au clic Payer** :

- Au clic `"Payer"` sur `/checkout` : mutation `recaptureQuoteAtPayment({orderId})` AVANT `stripe.confirmPayment`.
- Si fee ≤ panier (identique ou meilleur) → silent apply + proceed Stripe.
- Si fee > panier (surge ou pricing rule désactivée) → modal bloquant "Le tarif livraison est passé de {ancien} € à {nouveau} €. Confirmes-tu ?" + Oui/Non.
- Accept → re-render panier + re-click "Payer" + re-latching (idempotent).

**(5) Tracking page `/c/[orderId]` realtime** :

- `useQuery(api.orders.getOrderTracking, {orderId})` Convex subscription realtime.
- Webhook Uber écrit `deliveries.status` → Convex push → UI re-render sans polling.
- État machine UI : 6 étapes mode livraison + 3 étapes C&C (PRD §11), animation Lottie par étape (assets Phase 4 design).
- ETA dérivé webhook Uber `pickup_eta` / `dropoff_eta` (~30s refresh côté Uber).
- Récap items collapsible : `<details>` natif HTML, pas de lib.
- Animation incident : si `delivery.status === 'incident_after_pickup' | 'refused_post_payment'` → card "Incident livraison, tu as été remboursé" + Lottie incident.
- **URL non-protégée** : pas d'auth, orderId Convex ID brut (cuid non-devinable), partageable.

**Trade-offs V1** :

- Pas de map embed (PRD spec, Lottie + ETA texte suffit, V2 si demande terrain).
- Polling Google Places à chaque keystroke = debounced 300ms par widget.
- Pas de fallback courier post-paiement si Uber refuse = refund auto + push (acté CONTEXT delivery).
- Adresse cached pré-remplie à 2ᵉ visite, mais re-quote quand même (dispo Uber + horaires changent).

**TODO infra V1** :

- [ ] Variable env `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` + Google Cloud Console referrer restriction
- [ ] Composant `<AddressFirstForm>` avec Places Autocomplete + chain mutations
- [ ] Composant `<DeliveryModeToggle>` + `<DeliveryModeContext>`
- [ ] Composant `<TrackingPage>` avec Convex subscription
- [ ] Assets Lottie (6 delivery + 3 C&C + 1 incident) — Phase 4 design
- [ ] Modal `<LatchingConfirmModal>` au surge détecté

### 2026-06-04 · Q8 — Push enrollment bloquant + orchestration modal final

**Ce qui était déjà acté (à ne pas re-trancher)** :

- PRD §9 modal bloquant au clic Payer si aucun canal push actif
- Cascade marketing tenant (Push web > Wallet > Email) / cross-tenant (Wallet > Email, PWA exclue)
- 3 catégories transactionnelles routing hardcoded V1 (Archive / Temps-réel / Info statut)
- Templates campagne pré-validés, rate limit 3/sem global
- Soft opt-in L34-5 marketing tenant ; consentement marketing cross-tenant = acte ajout Wallet
- Backend reachability tracking `customers.pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}` (chantier 2.1-G mergé)
- 3 paliers Wallet acté Q5 : soft prompt address-first + bandeau permanent + modal bloquant Payer

**Décisions V1 (frontend modal)** :

**(1) Détection canal actif côté front pour gate Payer** :

- RSC `/checkout` `preloadQuery(getCurrentCustomer)` → check `pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}`
- Si au moins UN = `"enrolled"` → modal NE s'affiche PAS, bouton `"Payer X €"` actif direct
- Sinon → bouton `"Payer X €"` ouvre modal bloquant (pas direct Stripe)
- **Convex subscription** sur `customers.pushEnrollment` côté client `/checkout` → si install Wallet ou subscribe Web Push réussi pendant client sur la page (ex: au palier 1 address-first 5 min plus tôt) → bouton se débloque auto

**(2) Modal bloquant — design single-screen** (pas wizard multi-step) :

- Layout : 2 options visibles ensemble (Wallet primary + Web Push secondary) + 1 fallback caché initialement
- Header : "Pour finaliser ta cmd, choisis comment recevoir ta confirmation + offres"
- Hook : Incentive Wallet texte resto config (ex: "🎁 Reçois -10% sur ta prochaine cmd")
- Option 1 (primary) : "🥇 Carte fidélité Wallet — 2 taps · push lock-screen" + bouton `[ Ajouter à mon Wallet ]`
- Option 2 (secondary) : "🥈 Notifs navigateur — 1 tap · pas de lock-screen iOS" + bouton `[ Autoriser les notifs ]`
- Fallback caché : lien microscopique `Continuer sans notifs →` (apparaît après 2 échecs)
- **Modal non-skippable** par Esc / click outside (sinon bypass trivial)
- Pas de bouton "Annuler" — sortie via (a) succès enrollment 1 canal, ou (b) lien fallback frictionnel
- Si Desktop détecté → message "Continue depuis ton mobile pour finaliser" (PRD V1 mobile-first, payment desktop bloqué)

**(3) Flow async install Wallet** (le plus subtil — cycle long 30s à 2min) :

1. Clic "Ajouter à mon Wallet" → action `generatePass({tenantId, brandTenantId})` (~300ms signing)
2. Distribution device-specific (iOS Blob `.pkpass` MIME / Android `googleSaveLink` redirect — cf. Q5)
3. Client part dans app Wallet native — durée variable
4. **Modal reste ouvert avec loader** :
   ```
   ⏳ En attente confirmation Wallet...
   Tu peux fermer Wallet et revenir.
   [ J'ai changé d'avis — essayer une autre option ]
   ```
5. **Convex subscription** sur `customers.pushEnrollment.walletStatus` → flip `"enrolled"` quand webhook `pass_installed` reçu → modal se ferme auto → bouton `"Payer X €"` réactivé
6. Si clic "J'ai changé d'avis" avant succès → retour modal initial avec choix

**Timeout 30s** : si webhook tarde > 30s sans flip (~5% cas réels), ajout bouton secondary `[ Tester sans attendre ]` qui force poll backend `wallet.checkInstallStatus(serialNumber)` (1 round-trip Apple PassKit Web Service `GET /devices/.../registrations`). Si confirmé → flip statut. Si pas confirmé → reste loader.

**(4) Flow Web Push** (plus simple) :

1. Clic "Autoriser les notifs" → `Notification.requestPermission()` popup natif browser
2. Si `granted` → `navigator.serviceWorker.ready.then(reg => reg.pushManager.subscribe({applicationServerKey: VAPID_PUBLIC, userVisibleOnly: true}))` → reçoit `subscription`
3. Mutation `customer.webPush.register({endpoint, p256dh, auth})` (déjà mergée 2.1-G)
4. Backend flip `pushEnrollment.webPushStatus = "enrolled"` → Convex sub flip UI → close modal + proceed
5. Si `denied` ou `default` (popup fermé sans choix) → display inline "Refusé — essaie une autre option" + compteur échecs incrémenté

**Cas iOS < 16.4 ou iOS sans A2HS** : `'PushManager' in window === false` détecté côté front → option Web Push **masquée** par le modal. Seule option = Wallet. Si Wallet refusé aussi → fallback frictionnel ouvert direct (pas attendre 2 échecs).

**(5) Fallback "Continuer sans notifs" — 3 niveaux** (comme PRD spec) :
Apparaît après 2 échecs documentés (Wallet refusé/timeout + Web Push refusé) :

- **Niveau 1** : lien microscopique en bas du modal `Continuer sans notifs →` (font-size 12px, color muted)
- **Niveau 2** : clic → modal confirm `"Sans notifs : tu n'auras AUCUNE confirmation de cmd reçue, AUCUN suivi livraison live, AUCUNE offre. Sûr ?"` + 2 boutons `"Je veux les notifs après tout"` (primary) / `"Oui continue sans"` (link discret)
- **Niveau 3** : si "Oui continue sans" → modal final `"On a vraiment besoin d'au moins un canal pour te tenir informé. Choisis encore :"` → modal initial re-displayed UNE dernière fois. Si re-refus → flag backend `customer.pushEnrollment.noChannelPossible = true` + close modal + proceed paiement (SMS fallback transactionnel via Cascade Notifications, coût ~0.5-1€/mois/resto cas <5%)

**(6) Pas de A2HS dans le modal** :

- Android natif déjà couvert par Web Push (équivalent UX, 1 tap permission)
- iOS GIF instructions trop friction en modal-context
- A2HS reste sur triggers séparés (bouton Android post-cart Q4, bottom-sheet iOS post-tracking Q4)

**Trade-offs assumés V1** :

- Modal bloquant fort = drop conversion estimé 5-10% iOS (clients rebondissent au modal). Compensé par moat ×3 sur ceux qui restent.
- Loader 30s en attente Wallet = friction réelle. Mitigé par "Tester sans attendre" + "J'ai changé d'avis".
- Pas de A2HS dans modal (canaux séparés).
- Cas no-channel-possible (~5%) → flag backend + SMS fallback transactionnel + retargeting email V2.
- Desktop bloqué pour payment V1 (cohérent mobile-first PRD).

**TODO infra V1** :

- [ ] Composant `<PushEnrollmentModal>` non-skippable single-screen
- [ ] Composant `<WalletInstallLoader>` avec timeout 30s + "Tester sans attendre" + "J'ai changé d'avis"
- [ ] Composant `<WebPushSubscribeButton>` avec `Notification.requestPermission` flow
- [ ] Composant `<NoNotifsFallback>` 3 niveaux frictionnels
- [ ] Détection `'PushManager' in window` pour masquer option Web Push iOS <16.4
- [ ] Mutation `customer.pushEnrollment.markNoChannelPossible({customerId})`
- [ ] Action `wallet.checkInstallStatus(serialNumber)` (poll backend Apple PassKit Web Service)
- [ ] Hook RSC `/checkout` `preloadQuery(getCurrentCustomer)` + Convex subscription client-side sur `pushEnrollment`

---

---

## Consolidation finale — à recopier dans le repo

### Sub-PRD à créer

`docs/prd/sub/10-pwa-client/` (sous-domaines techniques V1, parallèle aux sub-PRDs admin/native existants) :

- `01-architecture.md` — Q1+Q2+Q3 (middleware tenant resolution, route map + rendering, identité customer + sign-in timing)
- `02-pwa-shell.md` — Q4 (manifest dynamique, service worker, A2HS triggers, Incentive option C)
- `03-wallet.md` — Q5 (3 paliers prompt, génération lazy, distribution device-specific, URL embedded + mutabilité, bridge identité, re-branding)
- `04-payment.md` — Q6 (Stripe Elements lazy load, branches saved card vs new card, domain verification Apple Pay manual V1)
- `05-delivery.md` — Q7 (Google Places setup, address-first flow auto-validate, toggle livraison/C&C sans re-quote, latching, tracking realtime)
- `06-push-enrollment.md` — Q8 (à finaliser, orchestration modal bloquant + cascade canaux)

Note : pas de sub-PRD séparé pour Q8 si on l'intègre directement dans `02-pwa-shell.md` + `03-wallet.md` (push enrollment touche les 2 surfaces). À décider à la fin de Q8.

### ADRs à drafter

**Aucun nouvel ADR identifié pour Q1-Q7.** Toutes les décisions architecturales s'appuient sur les ADRs existants :

- 0002 (push moat dual stack Wallet + A2HS)
- 0003 (Wallet carte commune marque neutre)
- 0004 (PWA standalone, pas widget embed)
- 0007 (consentement par clic Payer)
- 0008 (identité customer cookie device-only)
- 0010 (isolation multi-tenant Convex applicative)
- 0011 (Convex Auth V1, WorkOS différé)
- 0012 (push enrollment + identity + customer data + notifications split)
- 0013 (pricing backend-only)
- 0015 (édition menu brouillon + publication globale atomique)

Potentiellement à créer si Q8 introduit de la nouveauté architecturale forte :

- ADR éventuel sur le timing fin du push enrollment (3 paliers) — mais probablement update du 0002 suffit.

### CONTEXT updates (consolidé)

`docs/contexts/client-ordering/CONTEXT.md` :

- Préciser `Push enrollment` : 3 paliers (soft prompt address-first + bandeau permanent menu/panier + modal bloquant Payer) — décrits Q5.
- Ajouter nouveau terme `Bandeau de retour` : règle UX = `"Bonjour {firstName} 👋"` si firstName connu, JAMAIS mention adresse/historique (anxiogène = surveillance vs hospitalité). Lien discret `"Ce n'est pas moi →"` reset session.
- Préciser `Item out of stock` : overlay LIVE via Convex subscription par-dessus HTML cached ISR (~200ms latence toggle KDS sans full reload).

`docs/contexts/customer-data/CONTEXT.md` :

- Préciser `Anonymous account` : sign-in déclenché au submit address-first (pas au mount client, pas au middleware Edge — option C compromis : évite pollution table users par bots/rebondisseurs, coïncide avec 1ère écriture utile).
- Préciser `Anonymous account` : session lifetime = **365 jours total + 365 jours inactive** (sliding window), override Convex Auth default 30j via `convexAuth({ session: { totalDurationMs: 365*24*3600*1000, inactiveDurationMs: 365*24*3600*1000 } })` dans `auth.ts`.

`docs/contexts/notifications/CONTEXT.md` :

- Aucun changement nécessaire (asymétrie iOS/Android Wallet push déjà documentée comme "1 niveau indirection back of pass").

`docs/prd/10_pwa_client_commande.md` :

- §9 "Push enrollment BLOQUANT à la validation paiement" → ajouter paliers soft prompt address-first + bandeau permanent en amont (le bloquant au paiement reste).
- §5 "Catalogue / menu" — préciser overlay LIVE `available` Convex sub.
- §2 "Address-first flow" — préciser auto-validate au sélection suggestion (pas bouton Valider indépendant).
- §11 "Page Tracking" — préciser Convex subscription realtime sans polling.

### TODO infra global V1 (consolidé tous Q1-Q7)

Infra DNS / Vercel / Stripe Dashboard :

- [ ] Provisionner wildcard DNS `*.kitchen-boost.fr`
- [ ] Configurer Vercel Edge region pinning Paris/Frankfurt
- [ ] Configurer Stripe Dashboard "Payment method domains" pour chaque tenant onboardé (manual V1)
- [ ] Configurer Google Cloud Console referrer restriction `*.kitchen-boost.fr/*` + custom domains
- [ ] Assets Lottie (6 delivery + 3 C&C + 1 incident) — Phase 4 design

Backend Convex (queries/mutations à ajouter) :

- [ ] Public queries `tenants.bySlug` + `tenants.byCustomDomain` + `tenants.brandingByHost` (lecture middleware Edge)
- [ ] Hook `revalidateTag('menu:<tenantId>')` côté `publishMenu` mutation
- [ ] Action `wallet.bridgeSerialToSession({serial})` (rebind cookie au tap deep-link)
- [ ] Override `auth.ts` session lifetime à 365j
- [ ] Mutations `customer.pushEnrollment.recordA2hsAccepted` (Android event + heuristique iOS)

Frontend `apps/web` (composants à créer) :

- [ ] Middleware `middleware.ts` : résolution hostname + cookie HttpOnly tenant + interception `?wallet=<serial>`
- [ ] `app/manifest.webmanifest/route.ts` + 3 routes icônes dynamiques
- [ ] `public/sw.js` minimal
- [ ] `public/.well-known/apple-developer-merchantid-domain-association`
- [ ] Composants `<ServiceWorkerRegistration>`, `<PWAInstallContext>`, `<AndroidInstallButton>`, `<IOSInstallBottomSheet>`
- [ ] Composants `<AddressFirstForm>` (Google Places + chain mutations), `<NotMeLink>`
- [ ] Composants `<WalletPromptCard>`, `<WalletPromptBanner>`, `<AddToWalletButton>` (détection device)
- [ ] Composants `<DeliveryModeToggle>` + `<DeliveryModeContext>`, `<LatchingConfirmModal>`
- [ ] Composants `<CheckoutForm>` (Payment Element + branches saved/new card)
- [ ] Composant `<TrackingPage>` avec Convex subscription
- [ ] Modal push enrollment (Q8 à finaliser)
- [ ] **Scrap** : tout le scaffold legacy `apps/web/src/app/(auth)/*` + `(app)/dashboard` + components inutilisés

Variables env :

- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (clé plateforme KB live)
- [ ] `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`

Runbooks ops :

- [ ] Runbook Phase C onboarding : étape "ajouter domaine Stripe Dashboard" (2 min)
- [ ] Runbook Phase C onboarding : étape "configurer Google referrer restriction" si custom domain
