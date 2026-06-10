# Setup env + provisioning — KitchenBoost

**Référentiel canonique** de tout ce qui doit être configuré pour faire tourner KitchenBoost — en dev, en prod, et lors de l'ajout d'un nouveau restaurant partenaire.

- **Dernière update** : 2026-06-10 (soir)
- **État dev** : tenant `test-t1` actif, **23/23 scénarios E2E PWA Client débloqués côté setup**. Bloqueurs restants = code (4 slices PRD #458/#459/#463/#464 pas codées) — pas le setup.
- **Convention** :
  - ⚠️ = secret à **régénérer en prod** (jamais réutiliser le secret dev)
  - 🔒 = secret à **garder identique** dev↔prod (cert long-lived, paire VAPID)
  - 👤 = action **toi (Alex)** requise (KYC, dashboard externe, cert physique)
  - 🤖 = je peux setter seul (random, base64 d'un cert public, etc.)

---

## TL;DR — Cheatsheet

### Setup Wallet complet ✅ (debloqué 2026-06-10 soir)

| Var                       | État | Valeur (dev)                                                             |
| ------------------------- | ---- | ------------------------------------------------------------------------ |
| `WALLET_WWDR_CERT_BASE64` | ✅   | Cert public Apple WWDR G4 base64 (2118 chars)                            |
| `GOOGLE_WALLET_ISSUER_ID` | ✅   | `3388000000023143401` (demo mode actif, `[TEST ONLY]` prefix sur passes) |
| `WALLET_SAVE_ORIGINS`     | ✅   | `https://test-t1.kitchen-boost.com,https://admin.kitchen-boost.com`      |

Plus constante code `WALLET_CARD_NAME = "Mes Restos"` (anciennement « Resto Paris ») — cf commit `9435d90` + ADR 0003.

**Google Wallet demo mode** : les passes en dev sont préfixés `[TEST ONLY]` et installables UNIQUEMENT sur les comptes Gmail whitelistés (Google Pay & Wallet Console → Google Wallet API → « Set up test accounts »). Le passage en prod = `Create a class` + `Request publishing access` côté console (sans changer l'Issuer ID, sans changer le code). Tuto Annexe A inchangé pour la régénération prod.

### 4 cibles distinctes pour les env vars

```
KitchenBoost env stack
├── Convex backend          (npx convex env set / .env.local de packages/backend/)
├── Vercel apps/web         (PWA client, dashboard Vercel "kitchen-boost-web")
├── Vercel apps/admin       (back-office, dashboard Vercel "kitchen-boost-repo")
└── Expo apps/native        (mobile KB Orders, app.config + EAS secrets)
```

Plus une **5e dimension par-tenant** : credentials Uber Direct + Stripe Connect account ID, stockés en DB Convex (table `tenantCredentials`, envelope-encrypted), saisis depuis l'UI admin. **PAS d'env vars per-tenant.**

---

## 1. Onboarder un nouveau restaurant partenaire

**Ce qu'on ne touche PAS** (déjà set globalement) : env vars Convex, Vercel, Apple PassKit, Google Wallet, etc. Le tenant hérite de l'infra.

**Ce qu'on configure par tenant (UI Admin, jamais env)** :

| Étape                            | Où dans l'admin                                                       | Données collectées                                                             | Vérif                                                   |
| -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 1. Créer le tenant               | `/pipeline/[prospectId]/provision/` (wizard)                          | nom, slug, SIRET, branding (logo + couleur)                                    | tenant doc en DB                                        |
| 2. Stripe Connect KYC            | wizard étape 3 OU `/t/[id]/parametres/stripe` (a posteriori)          | KYC restaurateur via Stripe-hosted onboarding link                             | `stripeStatus: "ready"` après webhook `account.updated` |
| 3. Uber Direct creds             | wizard étape Uber (skippable) OU `/t/[id]/parametres/uber-direct`     | `client_id`, `client_secret`, `customer_id`, `webhook_signing_key` (optionnel) | bouton « Tester la connexion » sur la page              |
| 4. Menu (catégories + items)     | `/t/[id]/menu`                                                        | catégories, items, prix, allergens, modifier groups                            | `publishMenu` → `getPublicMenu`                         |
| 5. Plages horaires               | `/t/[id]/parametres` (à connecter UI)                                 | windows hebdo (Europe/Paris)                                                   | `isOpenNow=true`                                        |
| 6. Custom domain Vercel          | manuel côté Vercel                                                    | `<slug>.kitchen-boost.com` pointe sur `kitchen-boost-web`                      | DNS résolu, route 200                                   |
| 7. Apple Pay domain registration | https://dashboard.stripe.com → Settings → Payment methods → Apple Pay | Ajouter `<slug>.kitchen-boost.com`                                             | check token signing OK                                  |

**Webhook Uber Direct par tenant** : à configurer côté Uber Direct dashboard pour pointer sur `https://impartial-goshawk-798.convex.site/webhooks/uber/<tenantId>` (URL unique par tenant). Voir §5.

---

## 2. Référence exhaustive — Convex backend

Setter via `npx convex env set <KEY> <VALUE>` depuis `packages/backend/`. Lister via `npx convex env list`. Le `.env.local` de `packages/backend/` n'est qu'une **copie locale** pour le dev mode `convex dev` — la source de vérité est le deployment Convex.

### 2.1 Auth + identité

| Variable          | Rôle                                                                                  | État dev                                | Prod                              | Comment l'obtenir                      |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------- | -------------------------------------- |
| `JWT_PRIVATE_KEY` | Clé privée RS256 (Convex Auth)                                                        | ✅ set                                  | ⚠️ régénérer                      | `npx @convex-dev/auth` génère la paire |
| `JWKS`            | Pub JWKS associée à `JWT_PRIVATE_KEY`                                                 | ✅ set                                  | ⚠️ régénérer                      | idem (sortie de la même commande)      |
| `AUTH_RESEND_KEY` | API key Resend pour magic-link auth                                                   | ✅ set                                  | ⚠️ live key                       | https://resend.com → API keys          |
| `SITE_URL`        | URL canonique pour les liens dans emails                                              | ⚠️ `http://localhost:3000` (à corriger) | `https://admin.kitchen-boost.com` | manuel                                 |
| `CONVEX_SITE_URL` | URL `.convex.site` (httpAction host)                                                  | ✅ auto-set                             | ✅ auto-set                       | rien à faire — Convex le set seul      |
| `IS_DEV`          | Active branche `[DEV] console.log` (Resend OTP, etc.) au lieu d'envoyer un vrai email | `true`                                  | `false` ou unset                  | manuel                                 |

### 2.2 Stripe (plateforme)

| Variable                | Rôle                                                                       | État dev       | Prod                     | Comment l'obtenir                                                                   |
| ----------------------- | -------------------------------------------------------------------------- | -------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Secret key plateforme (server-side, `sk_*`)                                | ✅ `sk_test_…` | ⚠️ `sk_live_…`           | https://dashboard.stripe.com → Developers → API keys                                |
| `STRIPE_WEBHOOK_SECRET` | Signing secret du webhook `account.updated` (et futurs `payment_intent.*`) | ✅ `whsec_…`   | ⚠️ webhook prod distinct | Dashboard Stripe → Developers → Webhooks → clic sur l'endpoint → « Signing secret » |

### 2.3 Chiffrement enveloppe (credentials per-tenant)

| Variable         | Rôle                                                                                                                                  | État dev | Prod                          | Comment l'obtenir         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- | ------------------------- |
| `KMS_MASTER_KEY` | Clé AES-256 (base64, 32 bytes) pour `lib/crypto.envelope`. Chiffre les `tenantCredentials` (Uber Direct aujourd'hui, futurs PSP/POS). | ✅ set   | 🚨 **OBLIGATOIRE**, régénérer | `openssl rand -base64 32` |

⚠️ **Rotation = perte des creds chiffrées** : tous les tenants devront re-saisir leurs creds Uber. Pas de migration automatique en V1.

### 2.4 Web push (VAPID)

Même paire à mettre des 2 côtés (Convex pour dispatch, Vercel apps/web pour le route handler `/api/push/send`).

| Variable            | Rôle                                              | État dev                          | Prod                    | Comment l'obtenir                         |
| ------------------- | ------------------------------------------------- | --------------------------------- | ----------------------- | ----------------------------------------- |
| `VAPID_PUBLIC_KEY`  | Clé publique VAPID (dispatch côté Convex actions) | ✅ set                            | 🔒 même paire           | `npx web-push generate-vapid-keys` (Node) |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID (signature)                      | ✅ set                            | ⚠️ régénérer paire prod | idem                                      |
| `VAPID_SUBJECT`     | Mailto contact push providers                     | `mailto:office@kitchen-boost.com` | idem                    | manuel                                    |

### 2.5 Wallet — Apple PassKit + Google Wallet

| Variable                             | Rôle                                                                                  | État dev                                 | Prod                                                          | Comment l'obtenir                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WALLET_PASS_CERT_P12_BASE64`        | Cert Apple Pass Type ID en P12 base64 (ta signature)                                  | ✅ set (dev cert)                        | ☐ cert prod distinct                                          | https://developer.apple.com → Certificates → Pass Type IDs → créer + télécharger P12 → `base64 -i cert.p12` |
| `WALLET_PASS_CERT_PASSWORD`          | Password qui déchiffre le P12                                                         | ✅ set                                   | ☐ password prod                                               | choisi lors de la création du P12                                                                           |
| `WALLET_WWDR_CERT_BASE64`            | Cert intermédiaire Apple WWDR G4 (chaîne de confiance). Sans lui iOS rejette le pass. | ✅ set                                   | ✅ même cert (publique, valide jusqu'en 2030)                 | Cert PUBLIC — Annexe A.1                                                                                    |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` | Service account Google Cloud (clé RS256) en JSON base64                               | ✅ set                                   | ☐ SA prod distinct                                            | https://console.cloud.google.com → IAM → Service Accounts → créer + télécharger JSON → `base64 -i sa.json`  |
| `GOOGLE_WALLET_ISSUER_ID`            | Issuer ID numérique Google Wallet (≠ `client_id` du SA)                               | ✅ set `3388000000023143401` (demo mode) | ☐ même issuer après request publishing access (ne change pas) | https://pay.google.com/business/console → Google Wallet API — Annexe A.2                                    |
| `WALLET_SAVE_ORIGINS`                | Whitelist CSV d'origines autorisées à appeler le save link Google (anti-CSRF)         | ✅ set (`test-t1` + `admin`)             | ☐ ajouter chaque domaine tenant prod                          | Annexe A.3                                                                                                  |
| `WALLET_APNS_AUTH_KEY`               | Apple APNs auth key (.p8) pour push update pass                                       | ☐ optionnel V1                           | ☐ optionnel V1                                                | https://developer.apple.com → Keys → Apple Push Notification service                                        |
| `WALLET_APNS_KEY_ID`                 | Key ID associé à l'APNs auth key                                                      | ☐ optionnel V1                           | ☐ optionnel V1                                                | dashboard Apple lors de la création                                                                         |
| `WALLET_APNS_TEAM_ID`                | Team ID Apple Developer                                                               | ☐ optionnel V1                           | ☐ optionnel V1                                                | https://developer.apple.com → Membership                                                                    |

### 2.6 HMAC channels Convex ↔ Vercel

Secrets **partagés** des 2 côtés (Convex pour signer, route Next pour vérifier). Si dépareillés → 401 silencieux.

| Variable                        | Rôle                                        | État dev                                                                     | Prod                            |
| ------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| `MENU_REVALIDATE_HMAC_SECRET`   | HMAC Convex → Next pour invalider ISR menu  | ✅ set                                                                       | ⚠️ régénérer paire identique    |
| `WEB_PUSH_INTERNAL_HMAC_SECRET` | HMAC Convex → Next pour `/api/push/send`    | ✅ set                                                                       | ⚠️ régénérer                    |
| `WALLET_INTERNAL_HMAC_SECRET`   | HMAC Convex → Admin pour `/api/wallet/push` | ✅ set                                                                       | ⚠️ régénérer                    |
| `MENU_REVALIDATE_ROUTE_URL`     | URL Next `/api/revalidate` à appeler        | `https://test-t1.kitchen-boost.com/api/revalidate` ⚠️ tenant-specific en dev | ☐ pattern par tenant à scripter |
| `WEB_PUSH_ROUTE_URL`            | URL Next `/api/push/send`                   | `https://test-t1.kitchen-boost.com/api/push/send` ⚠️ tenant-specific         | ☐ idem                          |
| `WALLET_PUSH_ROUTE_URL`         | URL Admin `/api/wallet/push`                | `https://admin.kitchen-boost.com/api/wallet/push`                            | ✅ même URL prod                |

Générer un HMAC : `openssl rand -hex 32`.

### 2.7 Monitoring ops (optionnel)

| Variable                             | Rôle                                                                                                                                                                                              | État dev             | Prod                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------- |
| `SLACK_OPS_WEBHOOK_URL`              | URL webhook Slack (channel ops). Le cron `runMonitoringScan` (15min) y poste : latence webhook > 30s, KYC pending > 48h, commande payée sans course Uber, chargeback. Sans = warn log silencieux. | ☐                    | ☐ recommandé prod       |
| `MONITORING_PAID_NO_COURSE_GRACE_MS` | Override délai « commande payée sans course Uber »                                                                                                                                                | ☐ unset (default OK) | ☐ unset sauf tuning ops |

### 2.8 Uber Direct (PAS d'env vars globales)

⚠️ **PAS d'env vars `UBER_DIRECT_*`.** Les credentials sont **per-tenant** (un compte Uber Direct par restaurant, PRD 40 §1) et stockés chiffrés via envelope encryption (`KMS_MASTER_KEY` ci-dessus) dans `tenantCredentials`, provider `"uber_direct"`. Saisie via UI Admin (cf §1 étape 3).

URLs Uber hardcodées dans `lib/uberDirect/account.ts` + `lib/delivery/*` : `https://login.uber.com/oauth/v2/token` + `https://api.uber.com/v1`. Pas de switch sandbox/prod — c'est le credential qui détermine l'environnement.

Scope OAuth : **toujours** envoyer `direct.organizations eats.deliveries` (combo SDK officiel — un scope seul est refusé `invalid_scope` sur certaines apps test).

---

## 3. Référence exhaustive — Vercel apps/web (PWA client)

Project Vercel `kitchen-boost-web` (root dir `apps/web`).

| Variable                             | Rôle                                                                         | État dev                                                           | Prod                                            |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`             | URL Convex backend (browser + SSR)                                           | `https://impartial-goshawk-798.eu-west-1.convex.cloud`             | ☐ URL prod deployment                           |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`  | Clé Google Places (browser, restreinte HTTP referrer)                        | ✅ set + restrictions `*.kitchen-boost.com/*` + `localhost:3000/*` | ⚠️ régénérer clé prod (restrictions identiques) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`       | Clé VAPID publique (browser, pour `subscribe`)                               | ✅ set                                                             | 🔒 même paire que côté Convex                   |
| `VAPID_PUBLIC_KEY`                   | VAPID public (Node route handler `/api/push/send`)                           | ✅ idem                                                            | 🔒 idem                                         |
| `VAPID_PRIVATE_KEY`                  | VAPID privée (Node only, signature push)                                     | ✅ set                                                             | ⚠️ régénérer paire prod                         |
| `VAPID_SUBJECT`                      | Mailto contact push providers                                                | `mailto:office@kitchen-boost.com`                                  | idem                                            |
| `MENU_REVALIDATE_HMAC_SECRET`        | HMAC partagé Convex → ce Next                                                | ✅ set                                                             | ⚠️ régénérer                                    |
| `WEB_PUSH_INTERNAL_HMAC_SECRET`      | HMAC partagé Convex → ce Next                                                | ✅ set                                                             | ⚠️ régénérer                                    |
| `WALLET_INTERNAL_HMAC_SECRET`        | HMAC partagé Convex → Admin (utilisé ici car le SW relaye)                   | ✅ set                                                             | ⚠️ régénérer                                    |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ⏳ Anticipé pour la slice #458 (Stripe Elements) — pas encore lu par le code | ☐ pas encore set                                                   | ⚠️ `pk_live_…`                                  |

---

## 4. Référence exhaustive — Vercel apps/admin (back-office)

Project Vercel `kitchen-boost-repo` (root dir `apps/admin`).

| Variable                      | Rôle                                                      | État dev                                                     | Prod         |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ------------ |
| `NEXT_PUBLIC_CONVEX_URL`      | URL Convex backend (browser + SSR)                        | ✅ set                                                       | ☐ URL prod   |
| `CONVEX_SITE_URL`             | URL `.convex.site` pour relayer les webhooks              | auto-set par integration Convex-Vercel                       | auto-set     |
| `WALLET_INTERNAL_HMAC_SECRET` | HMAC pour `/api/wallet/push` (Convex → Admin)             | ☐ **À set côté Vercel cloud** (absent du `.env.local` local) | ⚠️ régénérer |
| `WALLET_APNS_AUTH_KEY`        | APNs auth key (relayé via /api/wallet/push, optionnel V1) | ☐ optionnel                                                  | ☐ optionnel  |
| `WALLET_APNS_KEY_ID`          | Key ID associé                                            | ☐ optionnel                                                  | ☐ optionnel  |
| `WALLET_APNS_TEAM_ID`         | Team ID Apple                                             | ☐ optionnel                                                  | ☐ optionnel  |

---

## 5. Référence exhaustive — Expo apps/native (KB Orders mobile)

App mobile KDS pour les restaurateurs (Android tablette). Config via `app.config.ts` + EAS Secrets.

| Variable                 | Rôle                                  | État dev | Prod        |
| ------------------------ | ------------------------------------- | -------- | ----------- |
| `EXPO_PUBLIC_CONVEX_URL` | URL Convex (lue par l'app en runtime) | ✅ set   | ⚠️ URL prod |

---

## 6. Provisioning externe (comptes + APIs activées)

| Fournisseur           | API / Service                         | Où activer                                                                                                                                | Dev                              | Prod                          |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| Google Cloud Platform | Places API (New)                      | console.cloud.google.com → APIs & Services → Library                                                                                      | ✅                               | ☐                             |
| GCP                   | Maps JavaScript API                   | idem                                                                                                                                      | ✅                               | ☐                             |
| GCP                   | Geocoding API                         | idem                                                                                                                                      | ✅                               | ☐                             |
| GCP                   | Billing account linké                 | console → Billing                                                                                                                         | ✅                               | ☐                             |
| Stripe                | Compte plateforme                     | dashboard.stripe.com                                                                                                                      | ✅ (test mode)                   | ☐ (live + KYB)                |
| Stripe                | Stripe Connect Express                | Dashboard → Connect → Settings                                                                                                            | ✅                               | ☐                             |
| Stripe                | Webhook destination                   | Dashboard → Developers → Webhooks → `account.updated` sur connected accounts → `https://impartial-goshawk-798.convex.site/stripe-webhook` | ✅                               | ☐ URL prod                    |
| Stripe                | Apple Pay domain registration         | Stripe → Settings → Payment methods → Apple Pay                                                                                           | ✅ (`test-t1.kitchen-boost.com`) | ☐ par tenant en prod          |
| Apple Developer       | Pass Type ID + cert P12               | https://developer.apple.com → Certificates                                                                                                | ✅ (dev cert)                    | ☐ cert prod                   |
| Google Wallet         | Issuer account + Service Account JSON | https://pay.google.com/business/console                                                                                                   | ✅ SA / ❌ issuer ID             | ☐ issuer prod                 |
| Resend                | API key transactional mail            | resend.com                                                                                                                                | ✅                               | ☐ live key + DKIM/SPF domaine |
| Convex                | Project + dev deployment              | dashboard.convex.dev                                                                                                                      | ✅ `impartial-goshawk-798`       | ☐ prod deployment             |
| Uber Direct           | Compte + app developer                | direct.uber.com (per-tenant — chaque resto a son compte)                                                                                  | ✅ test app validée 2026-06-10   | ☐ prod par resto              |
| Vercel                | Account + 2 projets (admin, web)      | vercel.com                                                                                                                                | ✅                               | ✅ même comptes               |

---

## 7. Webhooks à configurer côté providers

| Provider                 | URL endpoint Convex                                                  | Events                                                                   | Dev          | Prod                  |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------ | --------------------- |
| Stripe                   | `https://impartial-goshawk-798.convex.site/stripe-webhook`           | `account.updated` (+ futur `payment_intent.*`, `charge.dispute.created`) | ✅           | ☐ URL prod deployment |
| Uber Direct (par tenant) | `https://impartial-goshawk-798.convex.site/webhooks/uber/<tenantId>` | delivery status events                                                   | ☐ par tenant | ☐ par tenant          |

---

## 8. Domaines + DNS

| Domaine                          | Rôle                                    | Provider DNS      | Projet Vercel                   | Dev                                         | Prod |
| -------------------------------- | --------------------------------------- | ----------------- | ------------------------------- | ------------------------------------------- | ---- |
| `kitchen-boost.com` (apex)       | Brand corpo / redirect                  | Vercel NS         | autre repo (kitchen-boost)      | ✅                                          | ✅   |
| `www.kitchen-boost.com`          | Site corpo                              | Vercel            | autre repo                      | ✅                                          | ✅   |
| `admin.kitchen-boost.com`        | Back-office                             | Vercel            | kitchen-boost-repo (apps/admin) | ✅                                          | ☐    |
| `admin.kitchen-boost.fr`         | Redirect 308 → `.com` (défensif)        | Vercel            | kitchen-boost-repo              | ✅                                          | ☐    |
| `*.kitchen-boost.com` (wildcard) | PWA tenants par sous-domaine            | Vercel            | kitchen-boost-web (apps/web)    | ✅                                          | ☐    |
| `test-t1.kitchen-boost.com`      | Tenant E2E                              | Vercel            | kitchen-boost-web               | ✅                                          | N/A  |
| `*.kitchen-boost.fr`             | Redirect 308 → `*.com` (anti-squatting) | Vercel            | kitchen-boost-web               | ⏳ partiel (admin OK, wildcard à finaliser) | ☐    |
| `*.kitchen-boost.org` / `.store` | Réservés défensifs (inutilisés)         | Vercel ou parking | —                               | ☐                                           | ☐    |

---

## 9. Vercel deployment integration

- **Vercel ↔ GitHub** : repo `NativeSquare/kitchen-boost-repo` connecté → auto-deploy sur push `main`.
- **Vercel ↔ Convex** : integration installée → sync auto de `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOY_KEY` dans chaque projet Vercel.
- **2 projets Vercel** sur le même repo : `kitchen-boost-repo` (root dir `apps/admin`) + `kitchen-boost-web` (root dir `apps/web`).

---

## 10. Checklist passage prod (résumé exécutable)

Ordre rationnel pour le jour J.

1. **GCP prod** — créer projet, activer 3 APIs (Places New / Maps JS / Geocoding), billing linké, nouvelle clé API avec restrictions `*.kitchen-boost.com/*` (sans `localhost`).
2. **Stripe live** — passer en mode live, KYB validé, créer webhook prod (mêmes events), Apple Pay domain prod, copier `pk_live_` + `sk_live_` + `whsec_`.
3. **VAPID prod** — régénérer paire (`npx web-push generate-vapid-keys`).
4. **HMAC prod** — régénérer 3 secrets (`openssl rand -hex 32`).
5. **Convex prod** — créer deployment, set toutes les vars du §2 avec valeurs prod, `npx convex deploy --prod`.
6. **Apple PassKit prod** — créer Pass Type ID prod + cert P12 (passwd distinct), base64 → Convex env. WWDR cert reste le même (PUBLIC).
7. **Google Wallet prod** — créer issuer prod si pas déjà fait + SA prod → JSON base64 → Convex env.
8. **Resend prod** — créer API key live + ajouter domaine `kitchen-boost.com` au compte (DKIM/SPF DNS).
9. **Uber Direct** — chaque resto passe son app test en prod (KYB par tenant).
10. **Vercel prod** — pour chaque project, dupliquer env vars dev → prod avec valeurs prod.
11. **DNS** — confirmer `*.kitchen-boost.com` + `kitchen-boost.com` + `admin.kitchen-boost.com` pointent sur Vercel prod (+ `.fr` si on garde le redirect).
12. **Sanity check E2E** — refaire `docs/tests/PWA-CLIENT-E2E-checklist.md` en pointant sur un tenant prod.

---

## Annexe A — Tuto obtention des 3 env vars Wallet manquantes

### A.1 `WALLET_WWDR_CERT_BASE64` (🤖 je peux faire seul)

Le **cert intermédiaire Apple Worldwide Developer Relations G4**. Cert PUBLIC (pas un secret), même valeur pour tous les développeurs Apple. Sans lui, iOS rejette ton `.pkpass` avec « unrecognized signer ».

```bash
# 1. Télécharger le cert G4 depuis Apple
curl -o /tmp/AppleWWDRCAG4.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer

# 2. Convertir DER → PEM
openssl x509 -inform DER -in /tmp/AppleWWDRCAG4.cer -out /tmp/AppleWWDRCAG4.pem

# 3. Base64 le PEM
base64 -i /tmp/AppleWWDRCAG4.pem | tr -d '\n' > /tmp/wwdr.b64

# 4. Set dans Convex
cd packages/backend
npx convex env set WALLET_WWDR_CERT_BASE64 "$(cat /tmp/wwdr.b64)"
```

⚠️ Le cert expire en 2030. Documenter une alerte calendar pour la rotation.

### A.2 `GOOGLE_WALLET_ISSUER_ID` (👤 toi)

L'ID numérique de ton compte issuer Google Wallet. **Différent du `client_id` du service account JSON.** Format : 19-20 chiffres commençant par `33` (ex `3388000000022000000`).

**Étapes pour le récupérer** :

1. Ouvre https://pay.google.com/business/console
2. Connecte-toi avec le Google account qui a créé l'issuer KitchenBoost
3. Si ton compte n'a pas encore d'issuer : clique « Create issuer » → renseigne le nom du business (« KitchenBoost » ou « NativeSquare »), accepte les CGU. Validation manuelle Google **~24-48h**.
4. Une fois l'issuer créé/approuvé : tu vois ton **Issuer ID** affiché en haut du dashboard (sous le nom de l'issuer). Format `3388xxxxxxxxxxxxxxxx`.
5. Copie-le et envoie-le moi, je set la var :
   ```bash
   npx convex env set GOOGLE_WALLET_ISSUER_ID 3388xxxxxxxxxxxxxxxx
   ```

Documentation officielle : https://developers.google.com/wallet/generic/web/prerequisites#prerequisites

### A.3 `WALLET_SAVE_ORIGINS` (🤖 je peux faire seul)

CSV des origines autorisées à appeler le **Google Save link** (anti-CSRF côté Google). Si vide, Google rejette le save link avec un message générique.

Valeur dev/staging : **les domaines qui hébergent ton bouton « Add to Google Wallet »**, c'est-à-dire :

- `https://test-t1.kitchen-boost.com` (tenant de test)
- `https://admin.kitchen-boost.com` (back-office, pour le test depuis dashboard si jamais)

```bash
npx convex env set WALLET_SAVE_ORIGINS "https://test-t1.kitchen-boost.com,https://admin.kitchen-boost.com"
```

**En prod** : ajouter tous les domaines tenants prod (`<slug>.kitchen-boost.com`). Pattern à scripter dans le wizard d'onboarding tenant : à chaque nouveau resto, append `https://<slug>.kitchen-boost.com` à la liste.
