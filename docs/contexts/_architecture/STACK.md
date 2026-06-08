# Stack technique V1 — KitchenBoost

> **Statut** : ✅ Acté 2026-05-25 — Version 1.0
> **Owner** : Alex
> **Source de vérité** : ce document consolide le gap analysis stack vs PRDs + ADRs. Toute déviation = ADR dédié.

Ce document est le **point d'entrée technique** du projet. Il sert de :

- Cartographie code ↔ bounded contexts (méthode BMAD-ready)
- Référence des décisions techniques V1
- Liste exhaustive des ajouts à faire au template monorepo `kitchen-boost-repo`

---

## 1. Template monorepo hérité (read-only)

Le repo est cloné depuis `../kitchen-boost-repo` (template NativeSquare). **Aucune refonte de structure** — on étend, on ne reconstruit pas.

### Structure de base

```
kitchen-boost-repo/
├── apps/
│   ├── web/                    Next.js 16 (App Router) — PWA client final
│   ├── admin/                  Next.js 16 (App Router) — KB Admin + KB Manager
│   └── native/                 Expo SDK 55 — KB Orders mobile
├── packages/
│   ├── backend/                Convex (schema + functions + auth + crons + http)
│   ├── shared/                 Constants partagées (APP_NAME, APP_SLUG, APP_DOMAIN)
│   └── transactional/          Templates React Email
├── turbo.json
└── pnpm-workspace.yaml
```

### Stack template (déjà câblée)

| Couche            | Choix                                                           | Version                              |
| ----------------- | --------------------------------------------------------------- | ------------------------------------ |
| Monorepo          | Turborepo + pnpm workspaces                                     | turbo 2.6, pnpm 9                    |
| Backend           | Convex + Convex Auth                                            | convex 1.29, @convex-dev/auth 0.0.90 |
| Composants Convex | `@convex-dev/migrations` + `@convex-dev/resend`                 | 0.3 / 0.2                            |
| Web               | Next.js 16 + React 19 + Tailwind v4 + Radix UI + React Compiler | 16.1 / 19.2                          |
| Mobile            | Expo SDK 55 + Expo Router + NativeWind                          | expo 55                              |
| Email             | Resend + React Email                                            | resend 3.2                           |
| Forms             | react-hook-form + zod + @hookform/resolvers                     | latest                               |
| Tables/dashboards | @tanstack/react-table + recharts + @dnd-kit                     | latest                               |
| OAuth             | Apple + Google + GitHub (Convex Auth)                           | @auth/core 0.37                      |
| TypeScript        | partout, strict mode                                            | 5.9                                  |

### Conventions du template (à respecter et étendre)

**Backend Convex** (`packages/backend/convex/`) :

- `schema.ts` = orchestre, importe les tables modulaires
- `table/<entity>.ts` = 1 fichier par entité (ex: `users.ts`, `feedback.ts`)
- `lib/<feature>/` = helpers groupés par feature
- `utils/` = utilitaires transverses
- `http.ts` = routes HTTP (auth, webhooks)
- `crons.ts` = scheduled functions
- `emails.ts` = `"use node"` actions pour Resend
- `convex.config.ts` = Convex components (`migrations`, `resend`, à étendre avec `@convex-dev/rate-limiter`)

**Apps Next.js** (`apps/web/`, `apps/admin/`) :

- App Router (`src/app/`)
- `src/components/` `src/hooks/` `src/lib/` `src/providers/` `src/utils/`
- `proxy.ts` (Convex client proxy)

**App Expo** (`apps/native/`) :

- Expo Router (`app/`)
- `@rn-primitives/*` pour les composants UI cross-platform (équivalent Radix)

---

## 2. Décisions techniques V1 (actées)

### 2.1 Stack template = OK, on étend

La stack template couvre **~70% du What V1**. Les ajouts sont des libs externes ciblées, pas une refonte. Cf. gap analysis 10 contextes (session 2026-05-24).

### 2.2 Convex comme source de vérité unique

Toute donnée métier vit dans Convex. **Pas de duplication** vers une base externe. Multi-tenant via `tenant_id` sur chaque table + helpers applicatifs (`withTenant`) — cf. §5.1.

### 2.3 Offload Next.js API routes pour code crypto-lourd

Convex actions tournent dans un runtime V8 limité. Pour :

- Signature `.pkpass` (Apple Wallet, PKCS#7)
- `web-push` (VAPID ECDH AES-GCM)
- Apple Wallet Web Service endpoints (binary body, APNs HTTP/2)

→ **Next.js API routes avec `export const runtime = 'nodejs'`** dans `apps/admin/` ou `apps/web/` selon l'usage. Convex reste la source de vérité data, déclenche via fetch HMAC-signé.

Pattern : Convex action `requestWalletPassUpdate(customerId)` → fetch `apps/admin/api/wallet/push` (HMAC) → Next.js Node runtime appelle APNs HTTP/2.

### 2.4 Multi-tenant sans RLS Postgres → discipline applicative

Convex n'a pas d'équivalent RLS. **4ᵉ couche de défense du PRD 50 = disparue**. Compensation :

1. Helpers obligatoires `tenantQuery` / `tenantMutation` (wrappers Convex) qui throw si `args.tenantId ∉ accessibleTenants(ctx)`
2. Custom ESLint rule interdisant `ctx.db.query(...)` direct hors des helpers
3. Suite Vitest `multi-tenant-isolation.test.ts` qui fuzz chaque mutation/query avec `tenantId` non autorisé
4. Coverage gate CI ≥ 95% des fonctions exportées

**Cf. ADR à créer** : `0010-convex-multi-tenant-app-level-rls.md`.

### 2.5 Secrets per-tenant : envelope encryption maison

Pas de KMS externe V1 (V2 si > 5 tenants).

- **1 master key** dans env var Convex (`KMS_MASTER_KEY`, 32 bytes random base64)
- **Table `tenant_credentials`** : `tenant_id`, `provider` (`uber_direct` | `hubrise` V2), `encrypted_blob` (ciphertext + iv + authTag, AES-256-GCM)
- Helper `encryptForTenant` / `decryptForTenant` dans `convex/lib/crypto/`
- Decrypt à la volée dans Convex actions seulement

Env vars Convex globales (`STRIPE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `KMS_MASTER_KEY`, `RESEND_WEBHOOK_SECRET`, etc.) pour les secrets KB-wide.

### 2.6 Adressage multi-tenant — domaine de marque custom par resto (norme V1)

- **Face publique = le domaine de marque du resto** (ex. `bunsbao.fr`), apporté par le resto (registrar type OVH) + CNAME vers KB. **Norme V1** (modèle Owner.com). Un **sous-domaine `<slug>.kitchen-boost.com`** technique sert de bootstrap/preview (URL Day-1, **jamais la face publique**).
- Wildcard DNS + cert SSL sous-domaines : Vercel (auto). Domaines custom : SSL auto (Vercel/Cloudflare for SaaS).
- **Middleware Next.js** dans `apps/web/middleware.ts` : match le hostname complet sur `tenants.byCustomDomain(host)` → sinon fallback slug du sous-domaine bootstrap → injecte `tenant_id` dans la session. Cf. §5.6.
- **Apple Pay domain verification** : route dynamique `apps/web/app/.well-known/apple-developer-merchantid-domain-association/route.ts` + appel Stripe `paymentMethodDomains.create()` automatique à la mise en ligne (par domaine actif du tenant).
- **Identité = cookie par origine (host-only)**. Chaque resto étant un domaine distinct, **pas de cookie partagé cross-resto** ; reconnaissance cross-resto = carte Wallet ([ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md) Amendement 2026-05-25).

### 2.7 Webhooks idempotence (Stripe, Uber Direct, Hubrise V2, Resend)

Pattern unique pour tous les webhooks externes :

```typescript
// convex/lib/webhooks/handler.ts
export async function processWebhook(
  ctx,
  { provider, eventId, payload, verifyFn },
) {
  // 1. Verify HMAC on raw body (read via await request.text() BEFORE parse)
  // 2. Check idempotence : table `processed_webhook_events` unique index (provider, eventId)
  // 3. Insert event row → if conflict, return 200 silent
  // 4. Dispatch via ctx.scheduler.runAfter(0, ...)
  // 5. Return 200
}
```

Table Convex `processedWebhookEvents { provider, externalId, processedAt }` + index unique composé `["provider", "externalId"]`.

### 2.8 KB Orders V1 sans Critical Alerts Apple

Push notif Expo standard + `expo-av` son en boucle au foreground app. Si feedback terrain "j'ai raté une cmd", demander entitlement Critical Alerts V2 (2-6 sem délai Apple).

Mode kiosque tablette : `expo-keep-awake` (always-on) + `notifee` Android (lock task) + iOS Guided Access (manuel). Sortie d'Expo Go obligatoire dès V1 (dev client Expo).

### 2.9 Anonymous Auth + cookie device 1 an

Cf. [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md) (Amendement 2026-05-25).

- Convex Auth Anonymous adapter, **cookie de session natif par origine** (host-only `__Host-`). Portée **intra-resto** : reconnaît le retour sur le même domaine de marque.
- **Pas de table `customerSessions`, pas de cookie « domaine parent »** : prémisse sous-domaine caduque (chaque resto = domaine distinct). POC #4 abandonné.
- **Reconnaissance cross-resto = carte Wallet uniquement** : bridge via `serial_number` ↔ `customer_id`.

### 2.10 Anti-extraction MOAT (Customer Data)

V1 = **aucune liste individuelle de clients côté KB Manager**. KPI globaux uniquement (`aggregateCustomerKPIs(tenantId)`).

Convention : aucune query exposée ne retourne d'objet `customer` au rôle `kb_manager`. Test Vitest qui scan les queries exportées et assert ce contrat.

Cf. memory `feedback_db_clients_moat.md`.

---

## 3. Mapping bounded contexts → code

10 bounded contexts (cf. [CONTEXT-MAP.md](../../../CONTEXT-MAP.md)). Mapping vers le monorepo :

| Contexte                      | Backend (`packages/backend/convex/`)                                                                                                                                        | Frontend                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Multi-Tenant** (transverse) | `table/tenants.ts`, `table/userTenants.ts`, `table/auditLog.ts`, `lib/tenancy/withTenant.ts`                                                                                | tous                                                                                       |
| **Customer Data** (MOAT)      | `table/customers.ts`, `table/cgvVersions.ts`, `table/customerOrdersPerTenant.ts`, `lib/customer/`                                                                           | `apps/web` (capture), `apps/admin` (KPI vue)                                               |
| **Client Ordering**           | `table/orders.ts`, `table/orderItems.ts`, `table/menus.ts`, `table/menuItems.ts`, `table/modifiers.ts`, `lib/cart/`                                                         | `apps/web` (PWA client)                                                                    |
| **Payment**                   | `table/payments.ts`, `lib/stripe/`, `http.ts` (Stripe webhooks)                                                                                                             | `apps/web` (checkout Stripe Elements), `apps/admin` (refund)                               |
| **Pricing**                   | `table/pricingRules.ts`, `lib/pricing/evaluate.ts` + `packages/shared/pricing` (module pur **backend-only**, cf. [ADR 0013](../../adr/0013-pricing-engine-backend-only.md)) | `apps/web` (prix reçu via API, **pas d'évaluation locale**), `apps/admin` (éditeur règles) |
| **Delivery**                  | `table/deliveries.ts`, `lib/uberDirect/`, `http.ts` (Uber webhooks)                                                                                                         | `apps/web` (suivi Lottie), `apps/native` (notif KDS T-3)                                   |
| **KB Orders**                 | `table/orderEvents.ts`, `lib/orders/workflow.ts`, push via Expo Push API                                                                                                    | `apps/native` exclusivement                                                                |
| **KB Admin**                  | `table/prospects.ts`, `table/contracts.ts`, `lib/admin/`, `lib/onboarding/`                                                                                                 | `apps/admin` exclusivement                                                                 |
| **Notifications**             | `table/pushSubscriptions.ts`, `table/notificationTemplates.ts`, `table/notificationEvents.ts`, `lib/notifications/` + `apps/admin/api/push/` (Next.js Node runtime)         | `apps/web` (SW push), `apps/native` (Expo Push), `apps/admin` (campagnes)                  |
| **Marketplaces** (V2)         | `table/tenantIntegrations.ts`, `lib/hubrise/`, `http.ts`                                                                                                                    | `apps/admin` (mapping menu V2)                                                             |

**Règle BMAD** : chaque module dans `convex/lib/<feature>/` expose son API publique via un fichier `index.ts` qui re-exporte uniquement ce qui doit être consommé hors-module. Le reste = private. Cf. skill `/improve-codebase-architecture`.

---

## 4. Ajouts à la stack template (shopping list)

### 4.1 `packages/backend` (Convex)

```bash
pnpm add @convex-dev/rate-limiter convex-helpers stripe twilio web-push
pnpm add -D @types/web-push
```

Plus en runtime `"use node"` actions :

- `passkit-generator` (Apple Wallet `.pkpass`)
- `google-wallet` (Google Wallet API SDK)
- `node-apn` (APNs HTTP/2 pour Wallet pass updates)
- `firebase-admin` (FCM fallback si Expo Push insuffisant)
- `date-fns-tz` (timezone Europe/Paris)

Convex components additionnels à `convex.config.ts` :

```typescript
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
app.use(rateLimiter);
```

### 4.2 `apps/web` (PWA client)

```bash
pnpm add @stripe/stripe-js @stripe/react-stripe-js @react-google-maps/api @serwist/next lottie-react @sentry/nextjs
pnpm add -D pwa-asset-generator
```

Note : `@dnd-kit`, `react-hook-form`, `zod`, `recharts`, `@tanstack/react-table` déjà dans le template.

### 4.3 `apps/admin` (KB Admin + KB Manager)

```bash
pnpm add @stripe/stripe-js @stripe/react-stripe-js @react-pdf/renderer qrcode @sentry/nextjs
pnpm add -D @types/qrcode
```

`@dnd-kit`, `recharts`, `@tanstack/react-table`, `react-hook-form` déjà dans le template = OK pour Kanban, dashboards, tables, formulaires complexes.

### 4.4 `apps/native` (KB Orders)

```bash
pnpm add expo-av expo-keep-awake expo-sqlite react-native-mmkv @notifee/react-native
pnpm add @sentry/react-native
```

Sortie d'Expo Go obligatoire (config plugin Expo dev client requis pour Lock Task Android + audio loop + foreground service).

### 4.5 Services externes à provisionner

| Service                                   | Quand                | Coût                            | Action                                |
| ----------------------------------------- | -------------------- | ------------------------------- | ------------------------------------- |
| Apple Developer Program                   | sprint 0             | déjà payé (Alex)                | OK                                    |
| Apple Pass Type ID + cert                 | sprint 0             | inclus                          | générer dans Apple Developer Console  |
| Google Cloud (Places + Maps + Wallet API) | sprint 0             | pay-as-you-go                   | activer dans GCP console              |
| Stripe Connect Express                    | sprint 0             | gratuit (KB) + 1,5%+0,25€ resto | activer Connect dans Stripe Dashboard |
| Uber Direct (self-signup)                 | sprint 0             | 5,90€/livraison resto           | direct.uber.com par tenant            |
| Resend Pro                                | sprint 1 (>5 restos) | 20$/mois                        | upgrade depuis free                   |
| Sentry                                    | sprint 1             | gratuit jusqu'à 5k events/mois  | activer SDK                           |
| SMS provider (Twilio ou OVH)              | V2                   | ~0,05€/SMS                      | différé                               |
| Hubrise / Deliverect                      | V2                   | 30€/mois ou 100-150€/mois       | différé                               |

### 4.6 Env vars Convex (production)

```
# KB-wide secrets
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx
RESEND_API_KEY=re_xxx                  # déjà géré par template via AUTH_RESEND_KEY
RESEND_WEBHOOK_SECRET=xxx
VAPID_PUBLIC_KEY=xxx                   # 2.7-C: paire VAPID web-push, 1 par env (route Node apps/web). Jamais commit.
VAPID_PRIVATE_KEY=xxx
VAPID_SUBJECT=mailto:ops@kitchen-boost.com # 2.7-C: VAPID `sub` (optionnel, défaut mailto KB ops).
WEB_PUSH_INTERNAL_HMAC_SECRET=xxx      # 2.7-C: HMAC partagé canal Convex↔route Node web-push. Aussi en env Next (apps/web).
WEB_PUSH_ROUTE_URL=xxx                 # 2.7-C: URL de la route Node apps/web/api/push/send (cible du fetch HMAC-signé).
KMS_MASTER_KEY=xxx                     # base64, 32 bytes
WALLET_PASS_CERT_P12_BASE64=xxx        # certificat Apple Pass Type ID
WALLET_PASS_CERT_PASSWORD=xxx
WALLET_WWDR_CERT_BASE64=xxx            # cert Apple WWDR G4 (signature .pkpass)
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=xxx
GOOGLE_WALLET_ISSUER_ID=xxx           # Google Wallet issuer id (2.8-A)
WALLET_INTERNAL_HMAC_SECRET=xxx       # 2.8-B: HMAC partagé canal Convex↔routes Node Wallet (US 23). Aussi en env Next (apps/admin) + CONVEX_SITE_URL.
GOOGLE_MAPS_API_KEY=xxx
SENTRY_DSN=xxx
IS_DEV=false

# Déjà gérés par le template
JWT_PRIVATE_KEY=xxx
JWKS=xxx
SITE_URL=https://kitchen-boost.com
```

---

## 5. Patterns clés (à coder une fois, réutiliser partout)

### 5.1 `withTenant` wrapper (RLS app-level)

```typescript
// convex/lib/tenancy/withTenant.ts
export const tenantQuery = customQuery(query, {
  args: { tenantId: v.id("tenants") },
  input: async (ctx, { tenantId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");
    const accessible = await getAccessibleTenantIds(ctx, userId);
    if (!accessible.includes(tenantId)) throw new Error("Forbidden");
    return { ctx: { ...ctx, tenantId }, args: {} };
  },
});
```

Toute query/mutation métier passe par `tenantQuery` / `tenantMutation`. Helper `kbAdminQuery` séparé pour le rôle root.

### 5.2 Webhooks idempotence

```typescript
// convex/lib/webhooks/idempotent.ts
export async function withIdempotence(ctx, provider, eventId, handler) {
  const existing = await ctx.db
    .query("processedWebhookEvents")
    .withIndex("by_provider_event", (q) =>
      q.eq("provider", provider).eq("externalId", eventId),
    )
    .unique();
  if (existing) return; // already processed
  await ctx.db.insert("processedWebhookEvents", {
    provider,
    externalId: eventId,
    processedAt: Date.now(),
  });
  await handler();
}
```

### 5.3 Pricing engine — backend only (cf. [ADR 0013](../../adr/0013-pricing-engine-backend-only.md))

> ⚠️ **Révisé 2026-05-25 ([ADR 0013](../../adr/0013-pricing-engine-backend-only.md))** : le moteur **ne tourne PAS côté front** (règles trop sensibles). `apps/web` n'importe pas le moteur — il envoie sa demande à l'API et reçoit le prix calculé (indicatif au panier, définitif au paiement).

```
packages/shared/pricing/
├── engine.ts       # évaluateur pur TS, input → output
├── types.ts        # Rule, Condition, Action types
└── index.ts        # API publique
```

Module pur testable en isolation, **importé uniquement par le backend** (Convex) pour l'évaluation autoritaire. La projection de prix au panier côté `apps/web` = un appel backend qui renvoie le prix, jamais une évaluation locale.

### 5.4 Wallet pass : signature Apple + push updates

```
apps/admin/app/api/wallet/
├── pass/[serial]/route.ts          # GET pkpass binary (Apple Wallet Web Service)
├── registrations/[...]/route.ts    # POST register/DELETE unregister
└── push/route.ts                   # Convex action → APNs HTTP/2

packages/backend/convex/lib/wallet/
├── generatePass.ts                 # "use node" action, lib passkit-generator
├── linkSerialToCustomer.ts         # mutation backend
└── triggerUpdate.ts                # → fetch apps/admin/api/wallet/push
```

### 5.5 Web Push : VAPID + Service Worker

```
apps/web/public/sw.js               # Service Worker custom (push + notificationclick)
apps/web/app/api/push/send/route.ts # Next.js Node runtime, lib web-push
packages/backend/convex/lib/push/
├── subscriptions.ts                # gestion endpoints clients
└── send.ts                         # Convex action → fetch apps/web/api/push/send (HMAC)
```

### 5.6 Résolution du tenant (domaine de marque, fallback sous-domaine bootstrap)

```typescript
// apps/web/middleware.ts
export async function middleware(req) {
  const host = req.headers.get("host");
  // 1. Face publique : domaine de marque du resto (norme V1)
  let tenant = await fetchTenantByCustomDomain(host); // edge-cached 60s
  // 2. Fallback : sous-domaine bootstrap <slug>.kitchen-boost.com
  if (!tenant && host.endsWith(".kitchen-boost.com")) {
    tenant = await fetchTenantBySlug(host.split(".")[0]);
  }
  if (!tenant) return NextResponse.redirect("/404");
  const res = NextResponse.next();
  // cookie tenant HOST-ONLY (pas de Domain parent : cookies cloisonnés par resto)
  res.cookies.set("kb_tenant_id", tenant._id, { httpOnly: true, secure: true });
  return res;
}
```

---

## 6. Conventions BMAD-ready

### 6.1 Module isolation + API publique

Chaque feature dans `convex/lib/<feature>/` expose son contrat via `index.ts`. Tout ce qui n'est pas exporté est privé au module. Pas d'import croisé entre modules sauf via cette API publique.

Exemple :

```
convex/lib/stripe/
├── index.ts                # re-export public API
├── createPaymentIntent.ts
├── handleWebhook.ts
├── refund.ts
└── _internal/              # privé (préfixe _)
    ├── client.ts
    └── verifySignature.ts
```

### 6.2 Tests Vitest obligatoires

- **Multi-tenant isolation** : `multi-tenant-isolation.test.ts` qui fuzz chaque mutation exportée
- **Pricing engine** : tests purs sur `packages/shared/pricing`
- **Webhooks idempotence** : tests sur le helper `withIdempotence`
- **Anti-extraction** : test qui scan les queries `customers.*` et assert pas de pagination > 20

### 6.3 Convex schema modulaire

Continuer le pattern du template : 1 table = 1 fichier dans `convex/table/`. `schema.ts` orchestre.

### 6.4 Audit log systématique sur mutations sensibles

Helper `logAudit(ctx, {action, tenantId, targetType, targetId, metadata})` appelé depuis les wrappers `kbAdminMutation` / `tenantMutation` automatiquement (composition).

---

## 7. POCs sprint 0 (avant lock-in stack)

À valider avant d'écrire le premier code métier. Si l'un échoue, on offload sur Next.js Node runtime — la stack tient quand même.

**Verdicts (exécutés le 2026-05-26 contre le dev Convex) → [`docs/spikes/`](../../spikes/README.md).** Bilan : **aucun échec, aucun offload Next.js Node requis** pour 2.5/2.6/2.7. POC #6 (clone Stripe cross-account) reste à valider en Phase B (clé Stripe test).

1. **Convex `httpAction` préserve raw body** pour vérif HMAC Stripe/Uber via `await request.text()` ? → ✅ **OK** — raw body fidèle + HMAC `crypto.subtle` (runtime par défaut, pas besoin de `"use node"`). [Détail](../../spikes/poc-1-httpaction-raw-body.md)
2. **Convex `"use node"` action supporte `web-push`** (deps natives ECDH AES-GCM) ? → ✅ **OK** — VAPID + chiffrement ECDH/HKDF/AES-128-GCM tournent en `"use node"`. [Détail](../../spikes/poc-2-web-push-use-node.md)
3. **Convex `"use node"` action supporte `passkit-generator`** (signature PKCS#7 OpenSSL) ? → ✅ **OK** — la lib charge + PKCS#7 (node-forge, pur JS) signe en `"use node"` ; `.pkpass` valide Apple = e2e device avec vrais certs (Phase B, #68). [Détail](../../spikes/poc-3-passkit-use-node.md)
4. ~~Convex Auth Anonymous cookie cross-subdomain~~ — **RETIRÉ 2026-05-25** : prémisse sous-domaine caduque (domaine de marque custom par resto). Identité intra-resto + cross-resto via Wallet ([ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md) Amendement).
5. **Convex `httpRouter`** supporte path params (`/webhooks/uber/:tenantId`) ? → ✅ **OK via `pathPrefix`** — `:param` nommé non supporté, mais `pathPrefix` + parse de l'URL route par tenant (pas d'offload). [Détail](../../spikes/poc-5-httprouter-path-params.md)
6. **Stripe `clone PaymentMethod` cross-account** (carte réutilisable cross-resto) ? → ✅ **OK** — Stripe **Connect activé** (profil **platform** = frais à la charge du compte connecté = direct charge confirmé) ; clone cross-account validé en test → #59 `ready-for-agent`. [Détail](../../spikes/poc-6-stripe-clone.md)

**Phase B (signature Wallet réelle, 2026-05-26)** → [`docs/spikes/poc-wallet-real-sign.md`](../../spikes/poc-wallet-real-sign.md) : `.pkpass` Apple signé (vrai cert Pass Type ID + WWDR G4) **et** JWT Google Wallet signé RS256 → ✅ **OK**. #68 passé `ready-for-agent`. Secrets en `.env.local` (local) ; pour le runtime déploiement, `npx convex env set …`.

Délivrable POC = 1 commit par POC avec README "verdict" + benchmark si applicable.

---

## 8. Décisions différées V2

| Sujet                              | Pourquoi V2                          | Trigger pour bascule            |
| ---------------------------------- | ------------------------------------ | ------------------------------- |
| Hubrise (marketplaces)             | ADR 0009                             | 3-5 restos pour mutualiser négo |
| KMS externe (AWS / Doppler)        | envelope encryption maison suffit V1 | > 5 tenants                     |
| SMS provider (Twilio / OVH)        | V1 = pas de SMS                      | besoin terrain confirmé         |
| APNs Critical Alerts               | délai Apple 2-6 sem                  | feedback "cmd ratée"            |
| Audit log UI                       | Q70-Q2 reportée V2                   | requis pour multi-user resto    |
| Stripe Connect Embedded Components | webhook-driven suffit V1             | UX KYC in-app souhaitée         |
| MDM tablettes cuisine              | lock task manuel suffit V1           | > 20 restos pilotes             |
| Map display tracking (Mapbox)      | Lottie SVG suffit V1 (Q40-Q7)        | si client réclame               |

---

## 9. Liens

- [CONTEXT-MAP.md](../../../CONTEXT-MAP.md) — bounded contexts
- [docs/prd/](../../prd/) — source de vérité produit
- [docs/adr/](../../adr/) — décisions architecture
- Template repo : `../kitchen-boost-repo`
- Skill `/improve-codebase-architecture` — pour organiser le code intelligemment
- Skill `/to-prd` puis `/to-issues` — pour transformer le plan d'attaque en backlog GitHub

## 10. Changelog

| Date       | Version | Notes                                                            |
| ---------- | ------- | ---------------------------------------------------------------- |
| 2026-05-25 | 1.0     | Création, consolide gap analysis 10 contextes session 2026-05-24 |
