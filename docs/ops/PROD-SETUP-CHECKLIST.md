# Prod setup checklist — KitchenBoost

Référentiel exhaustif de **tout ce qui doit être configuré** pour faire tourner KitchenBoost en production. Mis à jour au fur et à mesure du setup dev pour qu'au passage en prod il suffise de cocher chaque ligne.

- **Dernière update** : 2026-06-08
- **État** : dev en cours (E2E PWA Client en train d'être testé)
- **Convention** : ⚠️ = secret à régénérer en prod (jamais réutiliser le secret dev) · 🔒 = secret à garder identique (cert long-lived)

---

## 1. APIs externes activées

| Fournisseur               | API / Service                         | Où l'activer                                         | Dev                                                                                                       | Prod                   |
| ------------------------- | ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Google Cloud Platform** | Places API (**New**)                  | console.cloud.google.com → APIs & Services → Library | ✅                                                                                                        | ☐                      |
| GCP                       | Maps JavaScript API                   | idem                                                 | ✅                                                                                                        | ☐                      |
| GCP                       | Geocoding API                         | idem                                                 | ✅                                                                                                        | ☐                      |
| GCP                       | Billing account linké                 | console.cloud.google.com → Billing                   | ✅                                                                                                        | ☐                      |
| **Stripe**                | Compte plateforme                     | dashboard.stripe.com                                 | ✅ (mode test)                                                                                            | ☐ (live + KYB)         |
| Stripe                    | Stripe Connect Express                | Stripe Dashboard → Connect → Settings                | ✅                                                                                                        | ☐                      |
| Stripe                    | Webhook destination                   | Stripe Dashboard → Developers → Webhooks             | ✅ (`account.updated` sur comptes connectés → `https://impartial-goshawk-798.convex.site/stripe-webhook`) | ☐                      |
| Stripe                    | Apple Pay domain registration         | Stripe → Settings → Payment methods → Apple Pay      | ✅ (`test-t1.kitchen-boost.com`)                                                                          | ☐                      |
| **Apple**                 | PassKit Developer cert (.p12)         | developer.apple.com → Certificates                   | ✅                                                                                                        | ☐ (cert prod distinct) |
| **Google Wallet**         | Issuer account + service account JSON | pay.google.com/business/console                      | ✅                                                                                                        | ☐                      |
| **Resend**                | API key transactional mail            | resend.com                                           | ✅                                                                                                        | ☐                      |
| **Convex**                | Project + dev deployment              | dashboard.convex.dev                                 | ✅ `impartial-goshawk-798`                                                                                | ☐ (prod deployment)    |
| **Uber Direct**           | Sandbox creds (delivery)              | developer.uber.com                                   | ☐ (simulé en dev)                                                                                         | ☐                      |
| **Vercel**                | Account + 2 projets (admin, web)      | vercel.com                                           | ✅                                                                                                        | ✅ même comptes        |

---

## 2. Domaines

| Domaine                          | Rôle                                                           | Provider DNS       | Projet Vercel lié                   | État dev | État prod       |
| -------------------------------- | -------------------------------------------------------------- | ------------------ | ----------------------------------- | -------- | --------------- |
| `kitchen-boost.com` (apex)       | Brand corpo / redirect                                         | Vercel nameservers | autre repo (kitchen-boost)          | ✅       | ✅              |
| `www.kitchen-boost.com`          | Site brand corporate                                           | Vercel             | autre repo (kitchen-boost)          | ✅       | ✅              |
| `admin.kitchen-boost.com`        | Back-office KB + restaurateurs                                 | Vercel             | `kitchen-boost-repo` (apps/admin)   | ✅       | ☐               |
| `admin.kitchen-boost.fr`         | Redirect 308 → `.com` (défensif)                               | Vercel             | `kitchen-boost-repo` (apps/admin)   | ☐        | ☐               |
| `*.kitchen-boost.com` (wildcard) | PWA tenants par sous-domaine                                   | Vercel             | `kitchen-boost-web` (apps/web)      | ✅       | ☐               |
| `test-t1.kitchen-boost.com`      | Tenant de test E2E                                             | Vercel             | `kitchen-boost-web`                 | ✅       | N/A (test-only) |
| `*.kitchen-boost.fr`             | Redirect 308 → `*.kitchen-boost.com` (défensif anti-squatting) | Vercel             | `kitchen-boost-web` (redirect mode) | ☐        | ☐               |
| `*.kitchen-boost.org` / `.store` | Réservés défensifs (inutilisés)                                | Vercel ou parking  | —                                   | ☐        | ☐               |

---

## 3. Env vars — Vercel admin (`apps/admin`)

| Variable                 | Rôle                                  | Dev                                                    | Prod                  |
| ------------------------ | ------------------------------------- | ------------------------------------------------------ | --------------------- |
| `NEXT_PUBLIC_CONVEX_URL` | URL Convex backend (lue côté browser) | `https://impartial-goshawk-798.eu-west-1.convex.cloud` | ☐ URL prod deployment |
| `CONVEX_DEPLOYMENT`      | (auto Vercel-Convex integration)      | dev                                                    | ☐ prod                |

---

## 4. Env vars — Vercel web (`apps/web`)

| Variable                             | Rôle                                                  | Dev                                                                | Prod                                            |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`             | URL Convex backend (browser)                          | `https://impartial-goshawk-798.eu-west-1.convex.cloud`             | ☐ URL prod                                      |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`  | Clé Google Places (browser, restreinte HTTP referrer) | ✅ set + restrictions `*.kitchen-boost.com/*` + `localhost:3000/*` | ⚠️ régénérer clé prod (restrictions identiques) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clé publique Stripe (browser, Elements + Apple Pay)   | ✅ set `pk_test_...`                                               | ⚠️ `pk_live_...`                                |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`       | Clé VAPID publique web-push (browser)                 | ✅ set                                                             | 🔒 même paire dev/prod ou ⚠️ régénérer          |
| `VAPID_PUBLIC_KEY`                   | VAPID public (Node route `/api/push/send`)            | ✅ idem ci-dessus                                                  | 🔒 idem                                         |
| `VAPID_PRIVATE_KEY`                  | VAPID privée (signature push, Node only)              | ✅ set                                                             | ⚠️ régénérer paire prod                         |
| `VAPID_SUBJECT`                      | Mailto contact push providers                         | `mailto:office@kitchen-boost.com`                                  | idem                                            |
| `MENU_REVALIDATE_HMAC_SECRET`        | HMAC partagé Convex→Next pour `revalidate` menu       | ✅ set                                                             | ⚠️ régénérer                                    |
| `WEB_PUSH_INTERNAL_HMAC_SECRET`      | HMAC partagé Convex→Next pour `/api/push/send`        | ✅ set                                                             | ⚠️ régénérer                                    |
| `WALLET_INTERNAL_HMAC_SECRET`        | HMAC partagé Convex→Admin pour `/api/wallet/push`     | ✅ set                                                             | ⚠️ régénérer                                    |

---

## 5. Env vars — Convex backend (`packages/backend/convex`)

Setter via `npx convex env set <KEY> <VALUE>` depuis `packages/backend/`.

### Auth + identity

| Variable          | Rôle                                   | Dev                                                | Prod                                |
| ----------------- | -------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `JWT_PRIVATE_KEY` | Clé privée signature JWT (Convex Auth) | ✅ set                                             | ⚠️ régénérer                        |
| `JWKS`            | Clés publiques JWT (Convex Auth)       | ✅ set                                             | ⚠️ régénérer                        |
| `AUTH_RESEND_KEY` | API key Resend pour magic-link auth    | `re_LuzFTSdt_...`                                  | ⚠️ clé live Resend distincte        |
| `SITE_URL`        | URL canonique du site (links emails)   | `http://localhost:3000` ⚠️ à corriger en dev aussi | ☐ `https://admin.kitchen-boost.com` |
| `IS_DEV`          | Flag dev                               | `true`                                             | `false` ou absent                   |

### Stripe

| Variable                | Rôle                                       | Dev                  | Prod                     |
| ----------------------- | ------------------------------------------ | -------------------- | ------------------------ |
| `STRIPE_SECRET_KEY`     | Secret key plateforme Stripe (server-side) | `sk_test_...`        | ⚠️ `sk_live_...`         |
| `STRIPE_WEBHOOK_SECRET` | Signing secret du webhook Stripe → Convex  | ✅ set (`whsec_...`) | ⚠️ webhook prod distinct |

### Chiffrement enveloppe (tenant credentials)

| Variable         | Rôle                                                                                                                                                                 | Dev    | Prod                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KMS_MASTER_KEY` | Master key AES-256 (base64, exactement 32 bytes) pour `lib/crypto.envelope`. Chiffre les `tenantCredentials` (Uber Direct creds aujourd'hui ; futurs PSP/POS aussi). | ✅ set | 🚨 **OBLIGATOIRE — REGÉNÉRER**. Sans elle, `setUberCredentials` jette `KMS_MASTER_KEY is not set`. Génération : `openssl rand -base64 32`. Rotation = perte des creds chiffrées (re-saisir chaque tenant). |

### Web push (VAPID)

| Variable            | Rôle                                        | Dev                               | Prod                                       |
| ------------------- | ------------------------------------------- | --------------------------------- | ------------------------------------------ |
| `VAPID_PUBLIC_KEY`  | VAPID public (dispatch côté Convex actions) | ✅ set                            | 🔒 même paire que apps/web ou ⚠️ régénérer |
| `VAPID_PRIVATE_KEY` | VAPID private (signature côté Convex)       | ✅ set                            | ⚠️ régénérer                               |
| `VAPID_SUBJECT`     | Mailto contact push providers               | `mailto:office@kitchen-boost.com` | idem                                       |

### Wallet (Apple PassKit + Google Wallet)

| Variable                             | Rôle                                        | Dev               | Prod                                                     |
| ------------------------------------ | ------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `WALLET_PASS_CERT_P12_BASE64`        | Cert Apple PassKit P12 base64               | ✅ set (cert dev) | ☐ cert prod distinct (Apple Developer Pass Type ID prod) |
| `WALLET_PASS_CERT_PASSWORD`          | Password du P12                             | ✅ set            | ☐ password prod                                          |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` | Service account Google Wallet (JSON base64) | ✅ set            | ☐ service account prod                                   |

### HMAC channels Convex ↔ Vercel routes

| Variable                        | Rôle                                       | Dev                                                                          | Prod                                     |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `MENU_REVALIDATE_HMAC_SECRET`   | HMAC partagé (cf. apps/web)                | ✅ même valeur que côté web                                                  | ⚠️ régénérer paire identique des 2 côtés |
| `WEB_PUSH_INTERNAL_HMAC_SECRET` | HMAC partagé (cf. apps/web)                | ✅ idem                                                                      | ⚠️ régénérer                             |
| `WALLET_INTERNAL_HMAC_SECRET`   | HMAC partagé (cf. apps/admin)              | ✅ idem                                                                      | ⚠️ régénérer                             |
| `MENU_REVALIDATE_ROUTE_URL`     | URL Vercel web `/api/revalidate` à appeler | `https://test-t1.kitchen-boost.com/api/revalidate` ⚠️ tenant-specific en dev | ☐ URL pattern par tenant (à scripter)    |
| `WEB_PUSH_ROUTE_URL`            | URL Vercel web `/api/push/send`            | `https://test-t1.kitchen-boost.com/api/push/send` ⚠️ tenant-specific         | ☐ idem                                   |
| `WALLET_PUSH_ROUTE_URL`         | URL Vercel admin `/api/wallet/push`        | `https://admin.kitchen-boost.com/api/wallet/push`                            | ✅ même URL prod                         |

### Uber Direct (à venir)

| Variable                    | Rôle                              | Dev        | Prod                   |
| --------------------------- | --------------------------------- | ---------- | ---------------------- |
| `UBER_DIRECT_CLIENT_ID`     | OAuth client_id                   | ☐ (simulé) | ☐                      |
| `UBER_DIRECT_CLIENT_SECRET` | OAuth client_secret               | ☐          | ☐                      |
| `UBER_DIRECT_BASE_URL`      | `https://api.uber.com` ou sandbox | ☐          | `https://api.uber.com` |
| `UBER_WEBHOOK_SIGNING_KEY`  | HMAC vérif webhook entrant        | ☐          | ☐                      |

---

## 6. HTTP routes / webhooks à configurer côté providers

| Provider                 | Type               | URL endpoint Convex                                         | Events                                                                    | Dev         | Prod                  |
| ------------------------ | ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- | --------------------- |
| Stripe                   | Webhook plateforme | `https://impartial-goshawk-798.convex.site/stripe-webhook`  | `account.updated` (+ futur: `payment_intent.*`, `charge.dispute.created`) | ⏳ en cours | ☐ URL prod deployment |
| Uber Direct (par tenant) | Webhook            | `https://<deployment>.convex.site/webhooks/uber/<tenantId>` | delivery status events                                                    | ☐           | ☐ par resto           |

---

## 6 bis. Stripe Connect par tenant (onboarding restos)

Chaque resto a son propre compte Stripe Connect Express. Deux chemins pour l'onboarder :

| Cas                                                    | Chemin admin                                            | Notes                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Nouveau tenant via wizard prospect                     | `/pipeline/[prospectId]/provision/` → Step 3 Stripe KYC | Génère `account_link`, opérateur transmet l'URL au gérant resto.                                                          |
| Tenant **déjà existant** (seed, legacy, KYC à refaire) | `/t/[tenantId]/parametres/stripe` (ajouté par PR #477)  | Mêmes mécaniques que le wizard, exposé a posteriori. KB Admin only pour générer le lien (kb_manager peut lire le statut). |

Le webhook `account.updated` (Stripe → Convex) met à jour `tenants.stripeStatus` automatiquement (pending → ready). Pas d'action manuelle requise après KYC validé.

---

## 7. Vercel deployment integration

- **Vercel ↔ GitHub** : repo `NativeSquare/kitchen-boost-repo` connecté → auto-deploy sur push `main`.
- **Vercel ↔ Convex** : integration installée → sync auto de `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOY_KEY` par projet Vercel.
- **2 projets Vercel** sur le même repo : `kitchen-boost-repo` (root dir `apps/admin`) + `kitchen-boost-web` (root dir `apps/web`).

---

## 8. Checklist passage prod (résumé)

1. **GCP** : créer projet prod, activer les 3 APIs, billing, créer nouvelle clé API avec restrictions `*.kitchen-boost.com/*` (sans `localhost`).
2. **Stripe** : passer en mode live, refaire le compte plateforme avec KYB validé, créer un webhook prod (mêmes events), Apple Pay domain prod, copier `pk_live_` + `sk_live_` + `whsec_` prod.
3. **VAPID** : régénérer une paire prod (`web-push generate-vapid-keys` côté Node).
4. **HMAC** : régénérer 3 secrets prod (32 bytes random hex).
5. **Convex** : créer prod deployment, set toutes les vars du tableau §5 avec valeurs prod, run `npx convex deploy --prod`.
6. **Apple PassKit** : générer un Pass Type ID prod + cert P12 prod (passwd distinct), base64 → Convex env.
7. **Google Wallet** : créer issuer prod si pas déjà fait + service account prod → JSON base64 → Convex env.
8. **Resend** : créer API key live + ajouter domaine `kitchen-boost.com` au compte Resend (DKIM/SPF DNS).
9. **Uber Direct** : sortir du sandbox, validation Uber par compte resto.
10. **Vercel** : pour chaque projet, dupliquer les env vars de dev → prod avec valeurs prod.
11. **DNS** : confirmer `*.kitchen-boost.com` + `kitchen-boost.com` + `admin.kitchen-boost.com` pointent sur Vercel prod (idem `.fr` si on garde le redirect défensif).
12. **Sanity check** : refaire la checklist E2E (`docs/tests/PWA-CLIENT-E2E-checklist.md`) en pointant sur le tenant de production.
