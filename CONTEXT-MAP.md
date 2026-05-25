# Context Map — KitchenBoost

KitchenBoost est un SaaS multi-tenant pour la restauration (PWA client + app native KB Orders + app web KB Admin avec RBAC). Le produit est décomposé en **10 bounded contexts**, chacun avec son propre vocabulaire et ses propres règles métier.

Ce document liste les contextes, où trouver leur glossaire, et comment ils communiquent entre eux. Les **specs** (quoi build) vivent dans [docs/prd/](docs/prd/README.md). Les **décisions d'architecture** vivent dans [docs/adr/](docs/adr/).

## Contexts

| Contexte | Glossaire | PRD associé | Description |
|----------|-----------|-------------|-------------|
| **Client Ordering** | [docs/contexts/client-ordering/](docs/contexts/client-ordering/CONTEXT.md) | [10](docs/prd/10_pwa_client_commande.md) | PWA web client final : menu, panier, checkout, suivi cmd, captation profil |
| **KB Orders** | [docs/contexts/kb-orders/](docs/contexts/kb-orders/CONTEXT.md) | [20](docs/prd/20_kb_orders.md) | App native iOS + Android pour le resto : workflow cmd (nouvelle → prep → prête → remise), modes livraison + click & collect, push APNs/FCM. Surface unique téléphone + tablette cuisine |
| **Payment** | [docs/contexts/payment/](docs/contexts/payment/CONTEXT.md) | [30](docs/prd/30_paiement_stripe_connect.md) | Stripe Connect Express, direct charges, Apple/Google Pay, refund |
| **Pricing** | [docs/contexts/pricing/](docs/contexts/pricing/CONTEXT.md) | [35](docs/prd/35_pricing_engine.md) | Moteur de règles configurables par tenant sur les frais de livraison |
| **Delivery** | [docs/contexts/delivery/](docs/contexts/delivery/CONTEXT.md) | [40](docs/prd/40_livraison_uber_direct.md) | Uber Direct (quote, course, courier), click & collect |
| **Multi-Tenant** | [docs/contexts/multi-tenant/](docs/contexts/multi-tenant/CONTEXT.md) | [50](docs/prd/50_multi_tenant_saas.md) | Isolation tenants, RBAC à 3 rôles, users + user_tenants (N-N), Stripe partagé si même SIRET |
| **Marketplaces** | [docs/contexts/marketplaces/](docs/contexts/marketplaces/CONTEXT.md) | [60](docs/prd/60_integration_marketplaces.md) | Agrégation Uber Eats + Deliveroo via Hubrise |
| **KB Admin** | [docs/contexts/kb-admin/](docs/contexts/kb-admin/CONTEXT.md) | [70](docs/prd/70_kb_admin.md) | App web unique avec RBAC : pipeline onboarding + CRM + contrats + monitoring (côté root) ; édition menu + cmds + clients masqués + campagnes + pricing + QR (côté KB Manager) |
| **Notifications** | [docs/contexts/notifications/](docs/contexts/notifications/CONTEXT.md) | [80](docs/prd/80_notifications.md) | Push web (PWA client), push système APNs/FCM (KB Orders), email, SMS, opt-in/opt-out, segments |
| **Customer Data** | [docs/contexts/customer-data/](docs/contexts/customer-data/CONTEXT.md) | [90](docs/prd/90_donnees_clients_crm.md) | Base clients globale cross-tenant (MOAT KB) + anti-extraction |

## Relationships

```
Client Ordering ──[OrderPlaced]──► Payment
Client Ordering ──[QuoteRequested]──► Delivery
Client Ordering ──[CartPriced]──► Pricing
Client Ordering ──[ProfileCaptured]──► Customer Data

Payment ──[PaymentSucceeded]──► KB Orders (push APNs/FCM)
Payment ──[PaymentSucceeded]──► Delivery (création course Uber Direct)
Payment ◄──[RefundRequested]──── KB Orders (refus cmd)

Pricing ──[FeesComputed]──► Payment (application_fee + total Stripe)
Pricing ──[FeesComputed]──► Client Ordering (transparence affichage)

Delivery ──[CourierStatus]──► Client Ordering (suivi temps réel)
Delivery ──[CourierStatus]──► KB Orders (ETA courier, alerte timeout)

Marketplaces ──[ExternalOrder]──► KB Orders (cmds Uber Eats/Deliveroo via Hubrise)

KB Admin ──[MenuPublished]──► Client Ordering (édition par KB Manager)
KB Admin ──[CampaignTriggered]──► Notifications (campagne lancée par KB Manager)
KB Admin ──[PricingRulesEdited]──► Pricing (config règles par KB Manager)
KB Admin ──[TenantProvisioned]──► Multi-Tenant (wizard par KB Admin root)
KB Admin ──[ContractSigned]──► Multi-Tenant (passage prospect → tenant via webhook Odoo)

Notifications ──[PushSent]──► Client Ordering (push web transactionnel + marketing)
Notifications ──[PushSent]──► KB Orders (APNs/FCM nouvelle cmd, refus, etc.)

Customer Data ──[CustomerProfile]──► Notifications (segments, opt-in)
Customer Data ──[CustomerProfile]──► KB Admin (vue "Mes clients" masquée côté KB Manager)

Multi-Tenant ──[tenant_id, RBAC, user_tenants]──► TOUS les autres contextes (transverse)
```

## Shared types (vocabulaire transverse)

Ces termes ont la **même définition partout** dans le système. Chaque CONTEXT.md peut s'y référer sans les redéfinir.

**Tenant** (= **Établissement**) :
1 location physique d'un resto avec 1 menu, 1 sous-domaine `<slug>.kitchen-boost.fr`, **1 compte Uber Direct** (toujours), 1 compte Stripe Connect Express (**potentiellement partagé** entre tenants même SIRET). Statuts : `active` / `pending` / `suspended` / `disabled`. Cf. [Multi-Tenant CONTEXT](docs/contexts/multi-tenant/CONTEXT.md).
_Avoid_: Account, Client, Workspace, Organization

**Restaurateur** :
Terme **business** pour parler du gérant qui exploite 1 ou plusieurs Tenants. **Pas une entité DB séparée** — synonyme du user [[KB Manager]]. Si Khan a 2 boutiques = 1 user + 2 lignes `user_tenants`. Le contrat est signé par le **représentant légal de l'entité juridique titulaire du SIRET** (cf. `contrat_template.md`).
_Avoid_: Lead, Owner (utiliser KB Manager), Account holder

**Prospect** :
Un resto démarché ou identifié comme cible mais **pas encore signé**. État précédant le statut Tenant (phases A et B dans le pipeline onboarding). Suivi dans le CRM KB interne. À la signature contrat (phase B → B+), bascule en Tenant via le wizard.
_Avoid_: Suspect, Candidat

**KB** (KitchenBoost) :
La plateforme et l'entité (NativeSquare SAS). KB n'est **PAS** merchant of record sur les paiements (direct charges Stripe Connect). KB **n'est pas** le transporteur (Uber Direct l'est). KB est responsable de traitement RGPD sur les données clients finaux.
_Avoid_: Platform, Service, Provider

**Customer** (KB) :
Le client final mangeur. Identifié par email + tel + position géo + prénom + adresse. Sa data appartient à KB (Article 2 ter contrat), pas au resto. Cross-tenant (table `customers` globale = MOAT).
_Avoid_: User (générique), Consumer, End-user

**Order** (Commande) :
Une transaction validée entre un client final et un tenant. Items + modifiers, total, statut (paid → preparing → ready → delivered/collected), source (direct / marketplace), tenant_id.
_Avoid_: Purchase, Transaction

**Direct vs Marketplace** :
Une cmd est **direct** si passée via la PWA KB. Elle est **marketplace** si arrivée via Uber Eats ou Deliveroo (agrégées via Hubrise V1). Toutes les cmds entrent dans KB Orders, taggées par source.
_Avoid_: Channel, Origin

**KB Admin (rôle)** :
Rôle root, interne KB (Alex en V1, équipe ops/support V2). Voit tous les tenants. Pas d'attache `user_tenants` (accès illimité via role).
_Avoid_: Superuser, Root

**KB Manager (rôle)** :
Rôle du gérant resto. Attaché à 1 ou N tenants via `user_tenants`. **Multi-tenant per user dès V1** (cas Walid Thai Street). Switcher dans header de KB Admin + KB Orders.
_Avoid_: Owner, Gérant (acceptable français informel)

**Staff (rôle, V2)** :
Rôle employé d'un tenant précis. Accès limité (consult cmds + toggle out of stock). V1 pas implémenté.
_Avoid_: Employee, Worker

**Prestation A / Prestation B** :
Découpage contractuel des services KB. **Prestation A** = exploitation marque virtuelle sous marque concédée. **Prestation B** = SaaS commande directe (PWA + KB Admin + Stripe + Uber Direct). Un resto peut souscrire A seule, B seule, ou A&B.
_Avoid_: Service A/B (acceptable), Module

**V1 / V2 / V3** :
Horizons produit. **V1** = scope du soft-launch progressif sur Buns & Bao, cible 2026-09-30 (cf. [roadmap](docs/prd/roadmap.md)). **V2** = scaling 5-15 restos. **V3** = effet réseau, scale 50+.
_Avoid_: MVP/Beta/GA (différents jalons, pas équivalents)

## Resolved ambiguities (règles prescriptives)

Ces règles sont **actées 2026-05-23**. Le linter / la revue de doc doit faire respecter.

### Termes bannis nus (toujours qualifier ou alias)

| Terme banni | Pourquoi | À utiliser à la place |
|-------------|----------|------------------------|
| **`Compte`** (nu) | 5 sens possibles | `compte Stripe`, `compte Uber Direct`, `compte Uber Manager`, **`user`** (pour login KB), **`Stripe Customer`** (pour CB sauvegardée), **`Customer`** (pour client final) |
| **`CRM`** (nu) | 2 sens incompatibles | **`CRM KB`** ou **`Pipeline + CRM Prospects`** (côté admin, ex `crm_prospects.csv`) ; **`Vue Mes clients`** (côté resto, vue masquée) |
| **`Manager`** (nu) | Risque confusion UI Uber ↔ rôle KB | **`Uber Eats Manager`** (UI Uber tierce) ou **`KB Manager`** (rôle KB) |
| **`frais Stripe`** (nu) | Stripe a plein de frais | **`application_fee_amount`** (commission KB, 2,40 € TTC) ou **`frais d'acceptation des paiements`** (= commission monétique, 1,5 % + 0,25 €, à la charge du resto via `on_behalf_of`) |

### Termes préfixés (qualifier seulement en cross-context)

| Terme | Sens nu par défaut | Préfixe à utiliser si cross-context |
|-------|---------------------|--------------------------------------|
| **`Customer`** | Client final mangeur KB (table `customers` globale) | **`Stripe Customer`** dans le contexte [Payment](docs/contexts/payment/CONTEXT.md) (objet API Stripe pour CB sauvegardée cross-tenant) |
| **`KB Admin`** | Le rôle (`role=kb_admin`) ou l'app — le contexte de phrase tranche en général | **`rôle KB Admin`** vs **`app KitchenBoost Admin`** si ambigu |
| **`Restaurateur`** | Terme **strictement business** pour parler du gérant | Dans le code / data model / PRD technique → utiliser **`user` (avec `role=kb_manager`)** ou **`Tenant`** selon l'objet désigné. Jamais d'entité `restaurateurs` en DB. |
| **`Admin`** | Rarement utilisable nu | Préférer **`KB Admin`**, **`rôle KB Admin`**, ou **`app KitchenBoost Admin`** |

### Termes contractuels figés (verbatim)

Ces termes viennent du contrat ou de Stripe et **ne se renomment pas** — leur précision dépend du contexte d'usage.

| Terme | Sens | Référence |
|-------|------|-----------|
| **`application_fee_amount`** | Commission KB en centimes TTC (240 = 2,40 € TTC = 2 € HT + 20 % TVA). Champ Stripe verbatim. | API Stripe Connect |
| **`frais d'acceptation des paiements`** | Commission Stripe au resto (1,5 % + 0,25 €), via `on_behalf_of`. Analogue commissions TPE bancaire. | Article 3.2 + 3.3 contrat |
| **`Prestation A` / `Prestation B` / `Prestation A&B`** | Découpage contractuel des services KB. | `contrat_template.md` |
| **`Article 2 ter`** | Verrou juridique base clients KB (MOAT). | `contrat_template.md` |

## Single vs multi-context

KitchenBoost est **multi-contextes** (10 contextes listés). Quand le sujet d'une session grilling n'est pas clair, demander explicitement quel contexte est concerné. Si transverse (tenant_id, RBAC, audit log, switcher tenant), c'est en général **Multi-Tenant** ou **KB Admin**.
