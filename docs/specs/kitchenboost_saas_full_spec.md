# KitchenBoost SaaS — Spec Technique Phase 1 + 2 + Post-MVP

**Statut** : draft v1 — 2026-05-15
**Auteur** : Alex / Claude (session technique)
**Vision** : plateforme SaaS multi-tenant où chaque resto a son propre domaine et son PWA "native-quality", avec ordering Uber Direct, push notifications, review Google, admin module pour onboarder de nouveaux restos en 30 min. Continuité directe du V0 PWA spec'd dans `mvp_pwa_review_push.md`.

---

## 1. Executive Summary

KitchenBoost devient une plateforme **multi-tenant** où chaque restaurant client est un tenant isolé techniquement mais partageant une infrastructure unique.

**Choix architecturaux validés** (session 2026-05-15) :
- ✅ **Custom domain par resto** (`pizza-tony.fr` pointe vers infra KB via CNAME)
- ✅ **Compte client unique cross-restos** (un compte KB fonctionne sur tous les restos du réseau)
- ✅ **Stripe Connect Express** pour les paiements (KB ne touche jamais l'argent, le resto encaisse direct)

**Valeur produit pour le resto** :
- Encaisse **+28% par commande** vs Uber Eats marketplace (22,40 € net vs 17,50 € net sur 25 €)
- Récupère le canal direct au client via push notifications (taux ouverture 50-90% vs 20% email)
- Possède son domaine, son branding, ses clients
- Pas de commission mensuelle, juste 2 € par nouveau client converti

**Valeur produit pour le client (mangeur)** :
- Commande sur le site du resto (impression d'authenticité, pas Uber Eats marketplace)
- Reçoit push pour suivre sa commande en temps réel
- 1 compte fonctionne pour tous les restos du réseau (friction zéro à la 2e commande)
- Peut laisser un avis Google ou un feedback privé

---

## 2. Architecture globale

```
[Custom Domain Resto: pizza-tony.fr]
            │
            ▼ DNS CNAME → cname.vercel-dns.com
[Vercel Edge Network — SSL auto Let's Encrypt]
            │
            ▼
[Next.js Middleware (edge)]
   - req.headers.get('host')
   - Lookup tenant by domain (cached 1h via Vercel KV)
            │
            ▼
[Next.js 15 App Router — PWA + API routes]
            │
   ┌────────┼────────┬────────────┬────────────┬────────────┐
   ▼        ▼        ▼            ▼            ▼            ▼
[Supabase][Stripe][Uber Direct][Web Push API][Google Places][Resend]
PostgreSQL Connect  REST API    web-push lib   review URL   transactional
+ Auth     Express                                          email
+ Storage
```

**Principes** :
- Une seule codebase Next.js 15 déployée sur Vercel
- Le tenant est identifié à chaque requête via le `Host` header
- Toutes les données sont isolées par `restaurant_id` (Row Level Security Supabase)
- Les modules optionnels (réservation, facturation) sont chargés conditionnellement par tenant

---

## 3. PHASE 1 — PWA client multi-tenant

### 3.1 Multi-domaine custom (par resto)

**Setup côté resto** (5 min) :
1. Resto possède déjà son domaine (`pizza-tony.fr`) ou en achète un (~10 €/an Gandi/OVH)
2. KB lui envoie une instruction : "Va chez ton registrar, ajoute un CNAME : `@` → `cname.vercel-dns.com` (ou A record `76.76.21.21` si CNAME root pas supporté)"
3. KB ajoute le domaine dans Vercel Project Settings → domains
4. Vercel provisionne le SSL Let's Encrypt automatiquement (15-60 min)
5. Quand SSL OK, KB toggle le resto en `status: live` dans la DB

**Setup côté code** :
```typescript
// middleware.ts (Next.js edge middleware)
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host') // ex: "pizza-tony.fr"

  // Lookup tenant (cached via Vercel KV ou edge cache)
  const tenant = await getTenantByHost(host)

  if (!tenant) {
    // Fallback : essayer subdomain kitchen-boost.fr
    return NextResponse.redirect('https://kitchen-boost.fr/404')
  }

  // Inject tenant in headers for downstream
  const reqHeaders = new Headers(req.headers)
  reqHeaders.set('x-tenant-id', tenant.id)
  reqHeaders.set('x-tenant-slug', tenant.slug)

  return NextResponse.next({ request: { headers: reqHeaders } })
}

export const config = {
  matcher: ['/((?!api/admin|_next/static|_next/image|favicon.ico).*)']
}
```

**Fallback** : tant que le custom domain n'est pas prêt (SSL en provisioning), le resto est accessible via `<slug>.kitchen-boost.fr` (wildcard subdomain).

### 3.2 Compte client unique cross-restos

**Modèle** : un seul compte par mangeur, fonctionne sur tous les restos KB.

**UI behavior** :
- Le client crée son compte sur Pizza Tony (signup avec email + OTP)
- Le lendemain, il commande chez Burger Bob via `burger-bob.fr` → déjà loggé (cookie cross-domain via 3rd party flow, ou re-login OTP éclair)
- Côté UI, chaque resto est entièrement marqué (logo + couleurs + nom resto) — le client ne voit PAS "KitchenBoost" partout
- Mention "Powered by KitchenBoost" discrète en footer (gérable selon les préférences resto)

**Modèle data** :
- Table `users` partagée (Supabase Auth)
- Table `user_restaurants` qui track l'attribution (premier resto où le user s'est inscrit)
- Chaque commande/push est attribuée à un resto via `restaurant_id`
- Admin resto voit UNIQUEMENT ses propres clients (filtre par `user_restaurants.restaurant_id`)
- KB admin a une vue cross-cut (mais ne la partage jamais avec les restos)

**Considération RGPD** :
- Politique de confidentialité claire : "Votre compte fonctionne sur tous les restaurants partenaires KitchenBoost"
- Consentement explicite au signup (case à cocher pas pré-cochée)
- DPO KitchenBoost déclaré CNIL
- Possibilité d'export / suppression des données (article 20 RGPD)

### 3.3 Stripe Connect Express (paiements)

**Architecture** : KB est la "Platform", chaque resto est un "Connected Account Express".

**Onboarding resto** (one-time, 5-10 min) :
1. Admin KB clique "Connecter Stripe" dans le profil resto
2. KB appelle Stripe API : `accounts.create({ type: 'express', country: 'FR', ... })`
3. KB génère un `account_link` Stripe : `account_links.create({ account, refresh_url, return_url, type: 'account_onboarding' })`
4. KB envoie le lien au resto par WhatsApp/SMS
5. Resto remplit le form hébergé Stripe : identité dirigeant, SIRET, RIB
6. Stripe valide (24-48h, parfois immédiat)
7. Webhook `account.updated` → KB stocke `stripe_account_id` et passe le resto en `live`

**Paiement d'une commande** :
```typescript
// /api/orders/[id]/checkout
const order = await db.orders.findFirst(...)
const restaurant = await db.restaurants.findFirst(...)

const paymentIntent = await stripe.paymentIntents.create({
  amount: order.total_cents,
  currency: 'eur',
  application_fee_amount: 200, // 2€ KB fee
  on_behalf_of: restaurant.stripe_account_id,
  transfer_data: { destination: restaurant.stripe_account_id },
  metadata: { order_id: order.id, tenant_id: restaurant.id }
})

return { clientSecret: paymentIntent.client_secret }
```

**Flux d'argent** :
- Client paie 25 € via Stripe
- Stripe prélève 0,60 € (1,4% + 0,25€) → reste 24,40 €
- 2 € application_fee → compte Stripe KB
- 22,40 € → compte Stripe Connect du resto
- Resto reçoit son payout selon son calendrier Stripe (J+2 par défaut FR, configurable)

**Avantages** :
- KB ne porte JAMAIS l'argent → pas de risque ACPR/PSP
- Chargebacks gérés par Stripe (assurance plateforme via Stripe Radar)
- Reportings comptables automatiques côté resto (export CSV/PDF dans son dashboard Stripe Express)

### 3.4 Ordering flow complet

```
[Client navigue sur pizza-tony.fr]
      ↓
[Middleware identifie tenant Pizza Tony]
      ↓
[Page d'accueil : menu visible immédiatement, pas de signup wall]
      ↓
[Client ajoute au panier (session anonyme ou loggé)]
      ↓
[Checkout : saisie adresse livraison + login/signup OTP éclair]
      ↓
[Stripe Elements (CB) — paiement via Stripe Connect, fonds vers resto direct]
      ↓
[Backend KB confirme paiement via webhook stripe]
      ↓
[Backend KB appelle Uber Direct API POST /v1/deliveries]
   - Body: pickup_address (resto), dropoff_address (client), items, value, etc.
   - Auth: customer_id + api_key du resto (stocké chiffré DB)
      ↓
[Uber Direct retourne delivery_id + tracking_url]
      ↓
[KB stocke delivery_id, expose tracking_url au client dans son PWA]
      ↓
[Client voit la livraison en temps réel (Uber tracking embed ou pull status)]
      ↓
[Uber Direct webhook → KB → push notif client : "Ton livreur est en route"]
      ↓
[Livraison "delivered" → push notif client : "C'était bon ? Laisse un avis ⭐"]
      ↓
[Flow review gating V0 existant (positif → Google, négatif → form privé)]
```

### 3.5 Intégration Uber Direct (voie marchand individuel)

**Stratégie MVP** : chaque resto a son propre compte Uber Direct (créé via merchants.ubereats.com), KB stocke son API key et appelle l'API en son nom.

**Setup resto** (one-time, 30 min) :
1. Resto crée un compte Uber Direct sur merchants.ubereats.com
2. Uber Direct fournit `customer_id` + `api_key`
3. Resto transmet ces creds à KB (via form sécurisé dans l'admin)
4. KB chiffre via Supabase Vault et stocke dans `restaurants.uber_direct_*`
5. KB lance un order test pour valider la connectivité (avec adresse fake)
6. Si OK → resto en `live`

**Pourquoi voie marchand vs voie agrégateur** :
- MVP : voie marchand = pas d'autorisation Uber préalable nécessaire, démarrage immédiat
- Voie agrégateur (KB centralise l'auth) = nécessite contrat commercial Uber, à explorer Phase 3 quand on a 10+ restos

**Webhook Uber Direct** :
```
POST /api/webhooks/uber-direct/:restaurantId
Body: { delivery_id, status, courier_info, ... }

Status possibles : pending → dispatched → pickup → dropoff → delivered → returned/canceled
```

KB met à jour `orders.status` + trigger push notif au client selon le status.

### 3.6 Google Review collection

**Flow** :
1. Livraison `delivered` → KB schedule push notif 1h après
2. Push : "C'était bon chez Pizza Tony ? 😍 Bof"
3. Si 😍 → redirect vers `https://search.google.com/local/writereview?placeid={tenant.google_place_id}`
4. Si Bof → form privé KB (V0 flow) → notification Slack ops KB

**Setup tenant** :
- `restaurants.google_place_id` (récupéré via Google Places API ou manuel)
- KB peut auto-fetch via `Places API → Find Place from Text` lors du setup

**Légalité** :
- Pas de "review gating" explicite (pas de "donne 5 étoiles pour avoir une surprise")
- Wording neutre : "C'était bon ?" puis bouton vers Google sans préciser de note
- Le client est libre de mettre la note qu'il veut une fois sur Google

### 3.7 Push notifications (THE feature)

**Stack** (réutilisé du V0 spec) :
- Frontend : Service Worker `/public/sw.js`
- Subscription via `navigator.serviceWorker.register()` + `pushManager.subscribe()`
- Stockage subscription en DB (endpoint, p256dh, auth)
- Backend : `web-push` npm lib (envoi à partir des creds VAPID)

**Use cases push** :

| Trigger | Audience | Wording |
|---------|----------|---------|
| Commande payée | Client de la commande | "🍕 Pizza Tony prépare ta commande ! ETA livraison : 35 min" |
| Livreur en route | Client de la commande | "🛵 Ton livreur arrive dans ~10 min" |
| Livraison terminée | Client de la commande | "📦 C'était bon ? Note ton expérience ⭐" |
| Re-engagement 7j | Subscribers inactifs | "Promo flash chez Pizza Tony aujourd'hui : -20% sur la Margherita 🍕" |
| Lancement nouveau plat | Tous subscribers d'un resto | "Nouveau au menu : Pizza Truffe 🌟" |
| Cross-resto recommendation | User multi-restos | "Tu adores Pizza Tony, essaie Burger Bob — 5€ offerts sur ta 1ère commande" |

**iOS PWA push (le piège)** :
- Disponible depuis iOS 16.4 (mars 2023) MAIS uniquement si PWA installée en home screen
- Donc onboarding iOS dédié : tutorial illustré "Ajoute Pizza Tony à ton écran d'accueil pour recevoir tes updates"
- Android : popup natif standard, zéro friction
- Fallback iOS pour users qui refusent : option SMS (Twilio) — payant donc à activer sélectivement

**Rate limiting** :
- Max 3 push marketing/semaine par user (transactionnels exclus)
- Si user clique "Désabonner" → unsubscribed_at set en DB
- Pas de push après 22h ou avant 8h heure locale

### 3.8 PWA native-quality UX

**Checklist obligatoire** :
- [x] `manifest.json` complet (icons 192/512, theme color, display: standalone, orientation: portrait)
- [x] Service Worker offline-first via Workbox (cache menu, images, assets)
- [x] Skeleton loaders partout (jamais d'écran blanc en chargement)
- [x] View Transitions API pour transitions de page natives
- [x] Touch optimisations : `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`
- [x] Vibration API pour haptic feedback (boutons CTA, validation paiement)
- [x] Pull-to-refresh sur listes
- [x] System font stack uniquement (zéro FOUT)
- [x] Lazy-load tout sauf critical path
- [x] Pre-fetch routes au hover/touch
- [x] Stockage local pour panier (zustand + localStorage)
- [x] Optimistic UI partout (ajout panier instantané, sync backend en background)
- [x] Add to Home Screen prompt contextuel (Android : popup natif après 2e visite, iOS : tutorial illustré)

**Anti-patterns à éviter** :
- ❌ Spinner full-screen au load
- ❌ Bottom sheet qui se ferme accidentellement au scroll
- ❌ Modals qui pop sans animation
- ❌ Boutons qui ne donnent pas de feedback tactile
- ❌ Images sans dimensions définies (layout shift)
- ❌ Fonts externes chargées avant le critical path
- ❌ Service Worker qui sert du contenu obsolète sans stratégie de revalidation

---

## 4. PHASE 2 — Admin module Uber Direct onboarding

### 4.1 Objectif

Réduire l'onboarding d'un nouveau resto de **~4h de boulot manuel actuel** (création subdomain + setup Uber Direct + config menu + tests) à **30 min via UI admin**.

### 4.2 Flow admin

```
[Login admin.kitchen-boost.fr]
      ↓
[Dashboard : liste restos + bouton "+ Nouveau resto"]
      ↓
[Form "Nouveau resto"]
   - Nom commercial
   - Adresse (auto-complete Google Places → récupère place_id)
   - Custom domain (optionnel, sinon assign subdomain auto)
   - Logo upload (Supabase Storage)
   - Couleur primaire
   - Catégorie cuisine
   - Contact resto (WhatsApp/SMS pour onboarding)
      ↓
[Création tenant en DB → status: setup]
      ↓
[Wizard étape 1 : Stripe Connect onboarding]
   - Click "Générer lien Stripe"
   - KB API : stripe.accounts.create() + stripe.accountLinks.create()
   - Affiche lien à copier-coller dans WhatsApp resto
   - Polls Stripe API pour détecter quand onboarding terminé
      ↓
[Wizard étape 2 : Uber Direct setup]
   - Si resto a déjà compte Uber Direct :
     - Form : customer_id + api_key (collés depuis dashboard resto)
     - KB chiffre + stocke en DB
   - Sinon :
     - Bouton "Créer compte Uber Direct" → ouvre merchants.ubereats.com dans nouvel onglet
     - Une fois resto inscrit → retour KB admin → coller creds
      ↓
[Wizard étape 3 : Test intégration]
   - Click "Tester l'API Uber Direct"
   - KB envoie un faux order (adresse fake) → check 200 OK
   - Affiche le résultat + delivery_id de test
   - Si fail : log l'erreur, propose troubleshooting (creds invalides, IP non whitelisted, etc.)
      ↓
[Wizard étape 4 : Menu setup]
   - Option A : import manuel (CSV ou form item-by-item)
   - Option B : pull depuis Uber Eats Manager (si API merchant dispo, à valider)
   - Édition des items : nom, description, prix, image, dispo
      ↓
[Wizard étape 5 : Custom domain check]
   - Affiche les instructions DNS pour le resto (CNAME)
   - Polls Vercel API pour détecter quand SSL est ready
   - Si custom domain pas encore prêt, fallback sur subdomain
      ↓
[Activation → status: live]
   - Tenant est désormais accessible en production
   - Push notification d'onboarding envoyée à toi (Alex) pour confirm
   - Email/SMS au resto avec lien de son nouveau site
```

### 4.3 UI Admin minimaliste

Stack : Next.js routes protégées `/admin/*`, auth Supabase avec role `kb_admin`.

Routes principales :
```
/admin                          → Dashboard (liste restos + stats globales)
/admin/restaurants/new          → Wizard création
/admin/restaurants/:id          → Détails resto (édition config, statut)
/admin/restaurants/:id/stripe   → Onboarding Stripe Connect
/admin/restaurants/:id/uber     → Config Uber Direct + test
/admin/restaurants/:id/menu     → Édition menu
/admin/restaurants/:id/orders   → Liste commandes (debug + support)
/admin/push/broadcast           → Envoi push à un segment
/admin/users                    → Cross-cut users (data controller view)
/admin/modules                  → Activation modules par resto
```

### 4.4 Sécurité admin

- Auth Supabase + role check sur chaque route
- Audit log : toute action admin (modification config, activation, push manuel) loggée en DB
- 2FA obligatoire pour les comptes admin (TOTP via Supabase)
- Secrets chiffrés via Supabase Vault (clé API Uber, etc.)
- Webhooks signés (Stripe + Uber Direct) avec vérification HMAC

---

## 5. POST-MVP — Modules optionnels (1 clic d'activation)

### 5.1 Architecture modulaire

**Principe** : chaque module est un sous-dossier `/modules/<name>/` qui contient :
- Composants React (UI client + UI admin)
- Routes Next.js
- Schéma de config (Zod)
- Migration DB (si nouvelle table)

**Activation** :
- Admin KB → resto → onglet "Modules" → toggle "Réservation : ON"
- Update `restaurant_modules` en DB
- Routes du module deviennent accessibles sur le tenant
- UI client affiche le nouveau lien (ex: "Réserver une table")

### 5.2 Module Réservation

**Use case** : permettre aux clients de réserver une table en salle (pas de livraison).

**UI client** :
- Bouton "Réserver une table" dans le menu nav du PWA
- Form : date, heure, nb couverts, contact, message optionnel
- Confirmation par push + email + SMS optionnel

**Backend** :
- Table `reservations(id, restaurant_id, user_id, date, time, party_size, contact, message, status, created_at)`
- Webhook au resto : email + SMS Twilio (optionnel)
- Intégration Google Calendar du resto (oauth2, optionnel)
- Anti-spam : 1 réservation par user par jour, captcha si IP suspecte

**Effort dev** : ~3 jours pipeline IA NS.

### 5.3 Module Facturation Factur-X

**Use case** : générer des factures conformes Factur-X (obligation légale FR depuis septembre 2026).

**UI client** :
- Lien "Télécharger ma facture" dans le détail commande
- PDF + XML embarqué (format Factur-X)

**Backend** :
- Génération via lib `node-factur-x` ou équivalent
- Stockage Supabase Storage (archivage 10 ans obligatoire)
- Email auto au client si compte avec email vérifié
- Intégration optionnelle PDP (Plateforme de Dématérialisation Partenaire) pour transmission B2B

**Effort dev** : ~5 jours (la complexité est dans le format Factur-X compliant).

### 5.4 Module Loyauté

**Use case** : programme fidélité simple par resto.

**UI client** :
- Badge progression dans le profil ("8/10 commandes → boisson offerte")
- Notification quand reward débloqué

**Backend** :
- Table `loyalty_progress(user_id, restaurant_id, points, rewards_unlocked, ...)`
- Règles configurables par resto (ex: 10e commande = -5€, 20e = boisson offerte)
- Trigger automatique sur `orders.delivered`

**Effort dev** : ~3 jours.

### 5.5 Module Analytics resto

**Use case** : dashboard analytique pour le restaurateur (commandes/jour, plats populaires, heures de pointe, panier moyen).

**UI resto** :
- `/resto/analytics` (accessible au compte resto, pas KB admin)
- Graphes Chart.js ou Tremor
- Compare période N vs N-1
- Export CSV

**Backend** :
- Queries d'agrégation sur `orders` (group by date, item, hour, etc.)
- Cache 1h via Vercel KV pour perf

**Effort dev** : ~5 jours.

### 5.6 Module Marketing automation

**Use case** : campagnes push automatisées sur triggers comportementaux.

**Exemples de triggers** :
- User n'a pas commandé depuis 14 jours → push "Tu nous manques 😢 -3€ sur ta prochaine commande"
- User a commandé 3 fois en 1 mois → push "Tu es VIP, voici un cadeau"
- Anniversaire user → push promo

**Backend** :
- Cron jobs (Vercel Cron) qui scannent les triggers chaque nuit
- Templates de campagnes par resto
- A/B testing optionnel

**Effort dev** : ~7 jours.

---

## 6. Stack technique consolidé

| Couche | Choix | Pourquoi |
|--------|-------|----------|
| **Frontend** | Next.js 15 App Router + TypeScript + Tailwind | Stack NativeSquare existante, pipeline IA optimisé, edge middleware natif |
| **PWA** | Service Worker manuel (next-pwa optionnel) | Contrôle fin requis pour push iOS et offline-first |
| **State** | Zustand + React Query (TanStack Query) | Léger, performant, cache backend bien géré |
| **Auth** | Supabase Auth (email OTP magique + optionnel social) | Gratuit jusqu'à 50k MAU, intégré DB, JWT compatible RLS |
| **DB** | Supabase PostgreSQL | Validé V0, gratuit jusqu'à 500MB, Row Level Security natif |
| **Storage** | Supabase Storage | Logos, photos plats, factures Factur-X |
| **Hosting** | Vercel | Custom domains illimités, edge middleware, SSL auto, Vercel KV pour cache tenant |
| **Paiement** | Stripe Connect Express | Standard marketplace, compliance gérée, KB pas custodial |
| **Push** | web-push npm + Service Worker + VAPID keys | Validé V0, no vendor lock-in |
| **Uber Direct** | REST API direct (voie marchand individuel) | MVP rapide, voie agrégateur à explorer Phase 3 |
| **Email** | Resend (transactional) | 100 emails/jour free, scaling cheap |
| **SMS optionnel** | Twilio (pay-per-use) | Fallback iOS push refus |
| **Monitoring** | Vercel Analytics + Sentry | Free tier, suffit pour MVP |
| **Cron jobs** | Vercel Cron | Triggers push schedule, retry orders failed, etc. |
| **Encryption** | Supabase Vault | Stockage chiffré creds Uber Direct |

**Coût infra estimé pour 10 restos pilotes** : ~0 €/mois (tout en free tier)
**Coût infra estimé pour 100 restos en prod** : ~150 €/mois (Supabase Pro + Vercel Pro + Resend + monitoring)

---

## 7. Schéma DB Supabase

```sql
-- Tenants (restaurants)
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) UNIQUE NOT NULL,
  custom_domain VARCHAR(255) UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  logo_url TEXT,
  primary_color VARCHAR(7), -- hex
  address JSONB NOT NULL, -- {street, city, zip, country, lat, lng}
  google_place_id VARCHAR(255),
  cuisine_category VARCHAR(64),
  contact_phone VARCHAR(32),
  contact_email VARCHAR(255),
  status VARCHAR(16) NOT NULL DEFAULT 'setup', -- setup, live, suspended
  stripe_account_id VARCHAR(64),
  uber_direct_customer_id VARCHAR(64),
  uber_direct_api_key_encrypted TEXT, -- via Supabase Vault
  uber_direct_webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Clients (compte cross-restos, géré par Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(32),
  first_name VARCHAR(64),
  last_name VARCHAR(64),
  default_address JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Attribution (effet réseau)
CREATE TABLE user_restaurants (
  user_id UUID NOT NULL REFERENCES users(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  first_order_at TIMESTAMPTZ,
  last_order_at TIMESTAMPTZ,
  total_orders INT DEFAULT 0,
  PRIMARY KEY (user_id, restaurant_id)
);

-- Menu items
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  external_id VARCHAR(64), -- Uber Eats item ID si synced
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price_cents INT NOT NULL,
  image_url TEXT,
  category VARCHAR(64),
  available BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Commandes
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  user_id UUID REFERENCES users(id), -- nullable pour guest checkout
  items JSONB NOT NULL, -- snapshot
  subtotal_cents INT NOT NULL,
  delivery_fee_cents INT NOT NULL,
  total_cents INT NOT NULL,
  currency VARCHAR(3) DEFAULT 'EUR',
  stripe_payment_intent_id VARCHAR(64),
  stripe_application_fee_cents INT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_payment',
  -- pending_payment, paid, dispatched, picked_up, in_transit, delivered, canceled, refunded
  delivery_address JSONB NOT NULL,
  uber_delivery_id VARCHAR(64),
  uber_tracking_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orders_restaurant ON orders(restaurant_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- Push subscriptions
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id), -- attribution
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_type VARCHAR(16), -- ios, android, desktop
  last_push_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_push_user ON push_subscriptions(user_id);
CREATE INDEX idx_push_restaurant ON push_subscriptions(restaurant_id);

-- Reviews
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  order_id UUID REFERENCES orders(id),
  rating INT, -- 1-5 si feedback privé
  text TEXT,
  posted_to_google BOOLEAN DEFAULT false,
  private_feedback BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Modules optionnels
CREATE TABLE restaurant_modules (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  module_name VARCHAR(64) NOT NULL, -- reservation, invoicing, loyalty, analytics, marketing
  enabled BOOLEAN DEFAULT false,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (restaurant_id, module_name)
);

-- Audit log admin
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES auth.users(id),
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64), -- restaurant, user, order
  target_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Row Level Security (RLS)** :
- Tables `orders`, `reviews`, `push_subscriptions`, `menu_items` : isolation par `restaurant_id`
- Users authentifiés voient leurs propres données (`user_id = auth.uid()`)
- Restos voient leurs propres données (claim `restaurant_id` dans JWT)
- KB admin a un role bypass (claim `kb_admin: true`)

---

## 8. Endpoints API

### Public (PWA client, tenant-scoped via middleware)

```
GET    /api/menu                              → liste menu du tenant courant
POST   /api/cart/add                          → ajout au panier (session-based)
GET    /api/cart                              → panier courant
POST   /api/orders                            → crée order (status: pending_payment)
POST   /api/orders/:id/checkout               → crée Stripe PaymentIntent
GET    /api/orders/:id/tracking               → status + Uber tracking URL
POST   /api/push/subscribe                    → enregistre push subscription
POST   /api/push/unsubscribe                  → désabonne
POST   /api/reviews                           → soumet review (private ou Google redirect)
GET    /api/auth/me                           → user courant (si loggé)
POST   /api/auth/signin                       → OTP magic link
POST   /api/auth/signout                      → logout
```

### Webhooks (entrants, signature-verified)

```
POST   /api/webhooks/stripe                   → payment success/failure, account.updated
POST   /api/webhooks/uber-direct/:tenantId    → delivery status updates
```

### Admin KB (auth role: kb_admin)

```
GET    /api/admin/restaurants                            → liste tenants
POST   /api/admin/restaurants                            → crée tenant
GET    /api/admin/restaurants/:id                        → détails
PATCH  /api/admin/restaurants/:id                        → update config
POST   /api/admin/restaurants/:id/stripe-onboarding-link → génère lien Stripe Connect
POST   /api/admin/restaurants/:id/uber-direct-test       → test API Uber Direct
GET    /api/admin/restaurants/:id/analytics              → stats
POST   /api/admin/restaurants/:id/menu/import            → import CSV menu
POST   /api/admin/modules/:name/toggle                   → active/désactive module
GET    /api/admin/users                                  → cross-cut users (data controller)
POST   /api/admin/push/broadcast                         → envoi push segmenté
GET    /api/admin/audit-log                              → log actions admin
```

### Resto self-service (Phase 3+, auth role: restaurant_owner)

```
GET    /api/resto/orders                      → ses commandes
GET    /api/resto/users                       → ses clients (scopés)
POST   /api/resto/push                        → envoi push à ses subscribers
PATCH  /api/resto/menu/:itemId                → édite son menu
GET    /api/resto/analytics                   → ses stats
```

---

## 9. Risques + Mitigations

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Uber Direct refuse l'API access aux nouveaux marchands | Faible | Bloquant Phase 1 | Validation pré-build avec sales Uber Direct (1 appel) |
| Stripe Connect refuse un compte resto (KYC fail) | Moyen | Resto bloqué | Fallback paiement à la livraison + suivi support Stripe |
| iOS PWA push UX trop friction (add to home screen) | Élevé | Adoption iOS basse | Onboarding illustré + A/B testing wording + fallback SMS Twilio |
| Custom domain DNS mal configuré côté resto | Moyen | Site inaccessible | Checker DNS auto dans wizard admin + fallback subdomain |
| Cross-resto cannibalisation push | Moyen | Réputation KB | Rate limiting 3 push/sem/user + segmentation fine |
| RGPD : compte cross-resto = data sharing implicite | Élevé | Sanctions CNIL | PolicyConfidentialité claire + consentement explicite + DPO déclaré + droit accès/suppression |
| Uber Direct kill l'API à terme | Faible | Pivot total | Architecture découplée : Uber Direct = 1 adapter, structure d'autres adapters (Stuart, Coursier Privé) |
| Resto leaks ses creds Uber Direct (compromission) | Moyen | Frais frauduleux | Chiffrement at-rest + rotation périodique + alerting sur usage anormal |
| Custom domain expire (resto oublie de renouveler) | Élevé | Site DOWN | Monitoring expiry + alerting 30j avant + fallback subdomain auto |
| Vercel/Supabase facture surprise à scale | Moyen | Cash burn | Monitoring usage hebdo + caps configurables + migration plan vers infra dédiée si volume >100 restos |

---

## 10. Roadmap + Estimations (pipeline IA NativeSquare)

### V1 — Phase 1 minimaliste (4 semaines)

- **Semaine 1** : multi-domaine + tenant routing + auth Supabase + DB schema + RLS
- **Semaine 2** : ordering flow + Stripe Connect onboarding + paiement
- **Semaine 3** : Uber Direct integration + tracking + push subscriptions (étend V0)
- **Semaine 4** : Google review flow + polish PWA + onboarding iOS push + 1 resto pilote en prod

**Livrable V1** : 1 resto pilote (Buns & Bao ou Caverne) commandant via custom domain, livraison Uber Direct, push notifications fonctionnelles.

### V2 — Phase 2 admin module (1 semaine après V1)

- Admin UI Stripe Connect onboarding (wizard)
- Admin UI Uber Direct connection test
- Module modulaire architecture (table `restaurant_modules`)
- Audit log admin

**Livrable V2** : KB onboarde un nouveau resto en 30 min via l'admin (vs ~4h aujourd'hui).

### V3 — Modules post-MVP (2-3 semaines, échelonné)

- Module réservation (~3j)
- Module loyauté (~3j)
- Module analytics resto (~5j)
- Module facturation Factur-X (~5j) ← deadline septembre 2026
- Module marketing automation (~7j)

### V4 — Self-service resto + Phase 3 (3+ semaines)

- Dashboard resto pour gérer son menu, voir ses commandes, lancer push
- API Uber Direct voie agrégateur (négociation Uber)
- App KitchenBoost catalogue (l'app mobile transversale aux restos)

---

## 11. Décisions encore à valider

- [ ] Modèle pricing fee KB : 2 € fixe par commande convertie, ou % du panier (5%) ? À comparer sur scénarios concrets
- [ ] Wording UX iOS pour "add to home screen" : décliner et A/B tester
- [ ] Source de vérité menu : KB DB (édition manuelle dans admin) ou pull live depuis Uber Eats Manager API (si dispo) ?
- [ ] Première resto pilote pour V1 : Buns & Bao (déjà familier KB) ou Caverne (volume plus stable) ?
- [ ] Custom domain : KB fournit le domaine (achat groupé `<resto>.kitchen-boost.shop`) ou resto achète le sien ?
- [ ] Fallback iOS users qui refusent push : SMS Twilio (~0,08 €/SMS) ou simple email Resend (gratuit mais taux ouverture <20%) ?
- [ ] Politique de réservation domain par resto (qui paye, qui possède, que se passe-t-il si le resto quitte KB) ?
- [ ] Stratégie de migration si Uber Direct change ses CGU ou kill l'API (build l'abstraction couche livraison maintenant ou plus tard) ?

---

## 12. Référence

- Spec V0 PWA review/push : `docs/specs/mvp_pwa_review_push.md` (la fondation, à étendre)
- Contexte projet KB : `CLAUDE.md` racine
- Uber Direct CGU FR : https://www.uber.com/legal/en/document/?country=france&lang=fr&name=uber-direct-merchant-service-terms
- Uber Direct API T&C FR : https://www.uber.com/legal/en/document/?name=uber-direct-api-terms-and-conditions&country=france&lang=fr
- Stripe Connect Express docs : https://stripe.com/docs/connect/express-accounts
