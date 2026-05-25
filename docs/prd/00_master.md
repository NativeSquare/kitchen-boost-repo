# PRD Master — KitchenBoost

**Statut** : ✅ Complet · **Version** : 2.1 · **Dernière mise à jour** : 2026-05-23 · **Owner produit** : Alex Pelloux

> **Changements v2.1** : refonte sémantique. Fusion ex-KDS PWA + ex-app native resto → **KB Orders** (app native iOS/Android unique, tablette cuisine = même build). Fusion ex-Dashboard Resto + ex-Admin Back-office KB → **KitchenBoost Admin** (app web unique avec RBAC à 3 rôles : KB Admin root / KB Manager resto / Staff V2). Passage de 12 à **10 blocs fonctionnels**. Multi-tenant per user V1 (cas Walid Thai Street). Anciens PRDs : [docs/_archive/](../_archive/).

> **Changements v2.0** : scope V1 étendu suite revue produit (10 points critiques). Suppression de la décomposition V1.A/V1.B. Stratégie de release = **soft-launch progressif** sur premier pilote Buns & Bao avec checkpoints incrémentaux. Ajout RBAC, app native resto, moteur pricing dynamique, dashboard resto, agrégation marketplaces, compte client unifié cross-resto comme features V1.

---

## 1. Vision produit

KitchenBoost est un **ERP de restauration pour restaurants indépendants** qui réduit leur dépendance aux plateformes de livraison à 30% de commission (Uber Eats, Deliveroo, Just Eat) en leur offrant :

1. **Un canal de commande directe** (PWA brandée par resto, scannée via QR code dans les sacs Uber Eats) qui ramène le client en direct au resto, sans intermédiaire de place de marché.
2. **Une livraison à coût bas** via Uber Direct (~5,90€ HT/course en marque blanche) **ou en click & collect** (sans livraison), selon la modalité choisie par le resto et le client.
3. **Une base de données clients propriétaire à KitchenBoost** (les coordonnées + position géographique des mangeurs captés via le canal direct), qui devient le moat de KB **et** un actif que KB peut partager avec ses restaurateurs (argument "KB te ramène des clients", cf. [90_donnees_clients_crm.md](90_donnees_clients_crm.md)).
4. **Une commission unitaire faible** (2,00 € HT par commande encaissée) au lieu d'un abonnement fixe — modèle "no win, no fee" qui aligne KB sur la performance.
5. **Une expérience de paiement smooth** (Apple Pay / Google Pay dès la première version, carte sauvegardée réutilisable cross-resto KB plus tard dans le soft-launch) pour réduire la friction à la commande.
6. **Une UI cuisine unifiée** qui agrège les commandes directes ET les commandes Uber Eats / Deliveroo (via Hubrise) **dès V1**, pour que le resto n'ait plus qu'une seule interface en cuisine.

**Position de marché** : KitchenBoost vient remplacer progressivement Uber Eats dans le cœur du business du resto, en se positionnant comme une **alternative dont la commission ne dépasse pas le coût marginal de la livraison + un service fee minimaliste**. Les places de marché Uber Eats / Deliveroo restent un canal de visibilité, mais ne capturent plus le client, ni la marge.

**Horizon long terme** (V3+, hors scope MVP) : Captation client active (SEO local, ads, push marketing avancé), à terme un système de livraison propre (flotte coursiers indépendants ou partenariat), multi-pays.

## 2. État actuel (2026-05-23)

- **Validation marché terrain (Phase 1 commercial)** : 3 restaurants ont signé un contrat KitchenBoost ([clients/japonais-falguiere](../../clients/japonais-falguiere), [clients/thai-street-saint-michel](../../clients/thai-street-saint-michel), Buns & Bao / Khan Street Kebab), 1 contrat blank disponible pour le prochain closing.
- **Contrat & cadre légal** : finalisé ([docs/legal/contrat_template.md](../legal/contrat_template.md)). Couvre les prestations A (marque virtuelle Uber Eats) et B (canal direct via Plateforme KitchenBoost). Article 2 ter verrouille la base de données clients comme propriété exclusive KB.
- **Pricing produit** : 2,00 € HT/commande (toutes prestations confondues), tablette KDS 99 € HT flat si le resto n'en a pas (BYOD sinon).
- **Stack produit** : aucun code écrit. PRD = première étape avant lancement du dev.
- **Exploration technique préalable** : 8 documents de recherche/specs (Stripe Connect, Uber Direct, web push, alternatives livraison, intégration Hubrise, notification cuisine, onboarding resto) — synthèse consolidée dans ce PRD master + sous-PRDs.

## 3. Personas

### 3.1 Restaurateur (utilisateur opérateur)

- **Profil type** : gérant ou propriétaire d'un restaurant indépendant Paris/IDF, CA 25-100K€/mois, dont 30-60% via Uber Eats. Pas d'équipe tech, pas de DSI.
- **Pain points actuels** :
  - Perd 30% de chaque commande Uber Eats en commission.
  - Aucune visibilité sur l'identité de ses clients (Uber les "possède").
  - Aucun canal pour relancer un client passé.
  - Doit jongler entre tablette Uber Eats, tablette Deliveroo, téléphone pour cmds direct.
  - Outils techniques (POS, KDS) souvent disparates ou inexistants.
- **Goal vis-à-vis de KitchenBoost** :
  - Récupérer une partie de sa marge sur chaque commande directe (passer de 70% à ~85-90% net après frais Stripe + commission KB).
  - Avoir un canal direct pour fidéliser sans payer de marketing.
  - Continuer à utiliser Uber Eats comme canal d'acquisition de nouveaux clients (sans le quitter), mais voir TOUTES les cmds dans une seule UI cuisine.
  - Pouvoir éditer son menu et lancer des campagnes marketing simples sans dépendre de KB.
- **Niveau de tolérance technique** : très bas. Tout ce qui demande plus de 15 min de setup chez lui est un échec. L'install KB doit être assistée à 100% par Alex/équipe KB (Phase 1) ou par un wizard ultra-guidé (Phase 2).

### 3.2 Client final mangeur (utilisateur consommateur)

- **Profil type** : 18-45 ans, résidant Paris/IDF, commande 2-8 fois/mois en livraison, principalement via Uber Eats.
- **Pain points actuels** :
  - N'a aucun moyen de revenir directement chez un resto qu'il apprécie sans repasser par Uber Eats.
  - Frais de livraison Uber Eats variables et opaques.
  - Doit re-saisir sa CB à chaque resto (même via Uber Eats il y a quelques frictions selon l'app).
- **Goal vis-à-vis de KitchenBoost** :
  - Commander chez son resto préféré en bypassant Uber Eats.
  - Recevoir sa commande dans le même délai et la même qualité que via Uber Eats.
  - Payer en 2 clics via Apple Pay / Google Pay, ou avec une CB déjà mémorisée par KB (réutilisable cross-resto à terme).
  - Être informé des promos / nouveautés du resto via push notifs.
- **Friction max tolérée** : 2 clics pour ouvrir l'app après scan QR, 1 inscription rapide (téléphone + email + position), pas de download d'app.

### 3.3 Cuisinier / personnel de service (utilisateur opérationnel)

- **Profil type** : cuisinier en service, gérant de la prep en cuisine, salarié resto.
- **Pain points actuels** :
  - Doit jongler entre tablette Uber Eats, tablette Deliveroo, tickets manuels, téléphone qui sonne pour les commandes directes.
  - Pas de notification audio fiable quand une commande arrive.
- **Goal vis-à-vis de KitchenBoost** :
  - Une seule interface qui montre **toutes les commandes en cours**, direct + Uber Eats + Deliveroo (via Hubrise dès V1).
  - Une notification fiable (sonore + visuelle) à chaque nouvelle commande, via app native iOS/Android (équivalent Uber Eats Orders).
  - Workflow simple : voir cmd → cliquer "préparée" → cliquer "remise au coursier" (livraison) ou "remise au client" (click & collect).

### 3.4 Admin KB (utilisateur interne)

- **Profil type** : Alex en V1, équipe ops/support en V2+. Bonne maîtrise technique mais pas dev.
- **Goal** :
  - Onboarder un nouveau resto en < 30 min (idéal).
  - Voir l'état de tous les tenants en un coup d'œil (statut Stripe, Uber Direct, Hubrise, cmds du jour, incidents).
  - Intervenir manuellement sur un tenant en cas de besoin (édition menu, refund, suspension).
  - Avoir accès en R/W à tous les tenants via RBAC.

## 4. Business model

### 4.1 Revenus KitchenBoost

| Source | Montant | Quand |
|--------|---------|-------|
| Commission sur commande Plateforme KB | **2,00 € HT / commande encaissée** | Prélevée automatiquement par Stripe au moment de la transaction (intégrée dans `application_fee_amount` TTC) |
| Commission Uber Eats (prestation A, marque virtuelle louée) | 2,00 € HT / commande | Facturée mensuellement au resto, payable à 15j |
| Tablette KDS fournie (option 2) | 99 € HT one-shot | Facturée à la commande de la tablette |
| Frais annexes (site internet additionnel, modules tiers) | Sur devis | Accord écrit préalable (Article 12 bis du contrat) |

**Pas d'abonnement mensuel KB.** Pas de frais de setup KB (le seul coût "setup" facturé est la tablette si BYOD impossible).

### 4.2 Coûts produit majeurs (côté resto)

| Poste | Coût (pris en charge resto) | Notes |
|-------|-----------------------------|-------|
| Frais d'acceptation des paiements (Stripe PSP) | 1,5% + 0,25€ / transaction (cartes EU) | Régis par contrat Partenaire ↔ Stripe direct, KB ne touche pas |
| Livraison Uber Direct | ~5,90 € HT / course (tarif public, négocié au volume futur) | Facturée au resto via mandat de paiement Uber. **Le resto peut configurer dans le dashboard la part qu'il prend en charge vs celle facturée au client final (cf. [35_pricing_engine.md](35_pricing_engine.md))** |
| Tablette KDS (si BYOD impossible) | 99 € HT one-shot | KB fournit Samsung Galaxy Tab A9 ou équivalent |
| Coût Hubrise (si KB ne l'absorbe pas) | À déterminer (30€/mois/loc pricing public, négo en cours) | Activation Hubrise pour agrégation cmds Uber Eats/Deliveroo |

### 4.3 Hypothèse de marge KB par resto

Resto type ~150 commandes/mois via Plateforme KB en régime établi (post-90j) :
- Revenu KB : 150 × 2 € = **300 €/mois HT** par resto en régime
- Objectif Phase 1 (validation) : 5 restos installés, ~15 cmd/jour cumulés
- Objectif Phase 2 (industrialisation) : 50 restos, ~750 cmd/jour cumulés = 22 500 €/mois HT

## 5. Surface fonctionnelle macro (vue d'oiseau)

KitchenBoost se compose de **10 blocs fonctionnels** indépendants mais inter-dépendants. Chaque bloc dispose de son sous-PRD détaillé.

| # | Bloc | Description en 1 phrase | Sous-PRD |
|---|------|-------------------------|----------|
| 1 | **PWA Client Commande** | Webapp brandée par tenant, accessible via QR code, permet au client final de commander en livraison ou click & collect | [10_pwa_client_commande.md](10_pwa_client_commande.md) |
| 2 | **KB Orders (App native iOS + Android)** | App native unique pour le resto (équivalent Uber Eats Orders) : workflow cmd (nouvelle → prep → prête → remise), modes livraison + click & collect, push APNs/FCM, surface téléphone + tablette cuisine | [20_kb_orders.md](20_kb_orders.md) |
| 3 | **Paiement Stripe Connect** | Onboarding Stripe par tenant + flux paiement direct charge avec application_fee KB + Apple Pay / Google Pay + carte sauvegardée cross-tenant | [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md) |
| 4 | **Moteur Pricing Dynamique** | Moteur de règles configurables par tenant : qui prend en charge quelle part de la livraison selon panier / date / item | [35_pricing_engine.md](35_pricing_engine.md) |
| 5 | **Livraison Uber Direct + Click & Collect** | Création de course Uber Direct au paiement validé, OU mode click & collect, suivi temps réel, webhooks de statut | [40_livraison_uber_direct.md](40_livraison_uber_direct.md) |
| 6 | **Multi-tenant SaaS + RBAC** | Provisioning, isolation, custom domain. RBAC 3 rôles : KB Admin (root) / KB Manager (resto, 1→N tenants) / Staff (V2). Multi-tenant per user V1 (cas Walid). | [50_multi_tenant_saas.md](50_multi_tenant_saas.md) |
| 7 | **Intégration marketplaces (Hubrise)** | Récupération automatique des cmds Uber Eats/Deliveroo dans KB Orders **dès V1** | [60_integration_marketplaces.md](60_integration_marketplaces.md) |
| 8 | **KitchenBoost Admin** | App web unique avec RBAC. Côté KB Admin (root) : pipeline onboarding + CRM + contrats + monitoring + wizard tenant + partage KB→resto. Côté KB Manager : édition menu + personnalisations (modifiers) + cmds + clients masqués + campagnes + pricing UI + QR generator | [70_kb_admin.md](70_kb_admin.md) |
| 9 | **Notifications** | Web push (client PWA), push système APNs/FCM (KB Orders), email transactionnel + marketing, SMS fallback. Marketing déclenchable dès V1. | [80_notifications.md](80_notifications.md) |
| 10 | **Base de données clients (MOAT)** | Modèle de données clients KB cross-tenant + position géo, protections anti-extraction, partage KB→resto ("on te ramène des clients") | [90_donnees_clients_crm.md](90_donnees_clients_crm.md) |

## 6. Architecture fonctionnelle macro

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Client final                                                                 │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐ │
│  │ PWA Client Commande (10)           │  │ Push web + Email + SMS (80)    │ │
│  │ <slug>.kitchen-boost.fr            │  │ Service worker (PWA)           │ │
│  │ ou domaine custom resto            │  │ Transactionnel + marketing V1  │ │
│  └────────────────┬───────────────────┘  └────────────────────────────────┘ │
└───────────────────┼─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Backend KitchenBoost (50 multi-tenant + RBAC)                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ API publique + Moteur Pricing (35)                                    │  │
│  │  - Menus / catalogue par resto                                        │  │
│  │  - Commandes (création, statut, historique) — direct + Hubrise        │  │
│  │  - Clients (auth, profil, historique, position géo) — cross-tenant    │  │
│  │  - Webhooks Stripe, Uber Direct, Hubrise                              │  │
│  │  - Évaluation règles pricing (qui paye quoi sur la livraison)         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Base de données (multi-tenant)                                        │  │
│  │  - Tenants (1 row par resto)                                          │  │
│  │  - Menus, items, modifiers (par tenant)                               │  │
│  │  - Orders, payments (par tenant)                                      │  │
│  │  - Customers (90 — propriété KB, cross-tenant, position géo)          │  │
│  │  - Pricing rules (par tenant)                                         │  │
│  │  - Push subscriptions, RBAC users                                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└──┬─────────────────────┬─────────────────────┬──────────────────┬───────────┘
   │                     │                     │                  │
   ▼                     ▼                     ▼                  ▼
                ┌──────────────────────────┐   ┌──────────────────────────────┐
                │ KB Orders (20)           │   │ KitchenBoost Admin (70)      │
                │ App native iOS + Android │   │ admin.kitchen-boost.fr       │
                │ Téléphone + tablette     │   │ RBAC scoped :                │
                │ cuisine (même build)     │   │  • KB Admin → tous tenants   │
                │ Push APNs/FCM            │   │  • KB Manager → ses tenants  │
                │ Cmds direct + Hubrise    │   │ Pipeline / CRM / Menu /      │
                │ Livraison + click&collect│   │ Campagnes / Pricing / QR     │
                └──────────────────────────┘   └──────────────────────────────┘
                                │
                                │ via API
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Prestataires Tiers                                                           │
│  ┌─────────────┐  ┌────────────────┐  ┌─────────────────┐                  │
│  │ Stripe (30) │  │ Uber Direct(40)│  │ Hubrise (60)    │                  │
│  │ Connect Exp │  │ Self-signup    │  │ Cmds Uber Eats  │                  │
│  │ + Apple Pay │  │ par resto      │  │ + Deliveroo     │                  │
│  │ + cross-cust│  │ + click&collect│  │ V1 inclus       │                  │
│  └─────────────┘  └────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Principes architecturaux directeurs

1. **Multi-tenant by default** : tout objet métier (menu, commande, client, paiement, règles pricing) est lié à un `tenant_id`. Aucune feature ne peut être développée sans considérer le multi-tenant.
2. **RBAC dès V1 à 3 rôles** : `kb_admin` (root, voit tous tenants) / `kb_manager` (resto, attaché à 1 ou N tenants via `user_tenants`) / `staff` (V2, 1 tenant). Multi-tenant per user dès V1 (cas Walid Thai Street avec N restos).
3. **PWA = client final UNIQUEMENT** : pas de PWA tablette KDS, pas de PWA dashboard resto. La PWA est exclusivement le canal de commande client final. Tout le reste est app native (KB Orders) ou app web (KB Admin).
4. **1 app web, 1 app native** : pas de Merchant Dashboard séparé du Admin KB — c'est la même `KitchenBoost Admin` avec RBAC qui scope la vue. Pas de KDS PWA séparé de l'app native resto — c'est la même `KB Orders` installée en mode kiosque sur tablette si besoin.
5. **KB pas merchant of record** : KB n'encaisse pas, ne refacture pas Uber/Stripe. Le resto est seul vendeur, KB est mandataire (Article 2 bis du contrat). Direct charges Stripe + Uber Direct sur compte resto.
6. **Base clients = MOAT** : tous les schémas de données et toutes les UI doivent acter que la base clients est propriété KB. Le resto a un droit de **consultation** opérationnel et un droit de **partage assisté**. Mais **aucun droit d'extraction** (cf. Article 2 ter contrat + [90_donnees_clients_crm.md](90_donnees_clients_crm.md)).
7. **Pas de dépendance critique non-substituable** : pour chaque dépendance externe critique, on identifie un fallback. Uber Direct → Stuart (V2). Stripe → Mangopay (V3). Hubrise → intégration directe Uber Eats / Deliveroo (V3).
7. **Onboarding resto = process humain assisté en V1, wizard outillé en V2** : Phase 1, Alex installe lui-même chaque resto avec un wizard admin KB qui guide le process. Phase 2, on industrialise.
8. **Modularité livraison vs emporter (click & collect)** : chaque resto choisit dans son dashboard quelles modalités il accepte. Le client voit l'option correspondante au checkout.

## 7. Scope V1 / V2 / V3 (DÉCISIONS)

Cette section tranche explicitement ce qui est dans V1, V2, V3.

> **Stratégie de release V1** : pas de gates V1.A/V1.B figés. **Soft-launch progressif** sur Buns & Bao : on livre les features par ordre de priorité dans un flux continu, Buns & Bao reçoit chaque livraison au fur et à mesure, on apprend des opérations réelles. Cf. [roadmap.md](roadmap.md) pour l'ordre exact des livraisons et les checkpoints intermédiaires.

### 7.1 V1 — MVP complet (cible : 2026-09-30, ~4 mois dev, soft-launch progressif depuis ~mi-juin)

**Définition du done V1** : Tous les 10 blocs fonctionnels (cf. § 5) sont opérationnels en production sur au moins 3 restos installés (Buns & Bao + 2 autres). Le scope ci-dessous est livré dans son entièreté.

**Inclus dans V1 :**

#### 7.1.1 Client final mangeur
- ✅ PWA Client Commande complète : menu, panier, checkout, suivi commande, captation client + **position géo**
- ✅ Apple Pay / Google Pay au checkout (smoothness max)
- ✅ Carte sauvegardée réutilisable cross-resto KB (un client paie chez Resto X, sa CB est utilisable chez Resto Y sans re-saisie) — livré plus tard dans le soft-launch progressif
- ✅ Suivi commande temps réel (statut + map / ETA courier)
- ✅ Modes proposés : livraison Uber Direct OU click & collect (selon config resto)
- ✅ Push notifs (transactionnel + marketing) + email + SMS fallback iOS
- ✅ Branding logo + couleur primaire par resto

#### 7.1.2 Côté Restaurateur (rôle KB Manager dans `KitchenBoost Admin` + app native `KB Orders`)

- ✅ **`KitchenBoost Admin` web — vue KB Manager** (équivalent Uber Manager MVP) :
  - Édition menu (catégories, items, modifiers / personnalisations, prix, photos, disponibilité)
  - Vue commandes en cours et historique
  - Vue clients masqués (les siens + ceux que KB lui a partagés)
  - Campagnes marketing basiques (push + email vers segments, envoyées en proxy KB)
  - **Paramétrage moteur pricing livraison** (règles configurables no-code)
  - Génération QR code PDF (téléchargeable à volonté)
  - Statistiques basiques (CA, panier moyen, top items)
  - **Switcher tenant** dans header si user attaché à N tenants (cas Walid)
- ✅ **`KB Orders` app native iOS + Android** (équivalent Uber Eats Orders) :
  - Notifs push système APNs/FCM fiables sur nouvelles cmds
  - Workflow : nouvelle → en prep → prête → remise (au coursier OU au client)
  - Modes livraison ET click & collect différentiables visuellement
  - Refus cmd avec refund auto Stripe
  - Mode kiosque tablette cuisine (même build native installé sur tablette en plein écran)
  - Source cmd taggée (direct / Uber Eats / Deliveroo via Hubrise)

#### 7.1.3 Côté Admin KB interne (rôle KB Admin dans `KitchenBoost Admin`)
- ✅ Accès root tous tenants, monitoring incidents (Slack alerts), audit log basique
- ✅ **Pipeline onboarding visuel** par phases A→D (Approche / Closing / Prép menu / Kickoff / Opérationnel) avec checklist + liens externes pré-remplis + embed Stripe KYC
- ✅ **CRM prospects + clients** cliquable (consolide `crm_prospects.csv` + `crm_view.html` actuels)
- ✅ **Gestion contrats** : génération HTML via `tools/generate_contract.py` existant + signature via Odoo + tracking statut (`draft`/`sent`/`signed`)
- ✅ **Wizard création tenant** < 30 min (provisioning complet : Stripe, Uber, branding, QR PDF, user `kb_manager` créé/rattaché)
- ✅ **Partage manuel clients KB → tenant** depuis la base globale
- ✅ **Impersonation** d'un KB Manager pour assistance (audit log obligatoire)

#### 7.1.4 Intégrations
- ✅ **Stripe Connect Express direct charges** + Apple Pay/Google Pay + Stripe Customer cross-tenant (carte sauvegardée) + frais d'acceptation pass-through + commission KB TTC. **Stripe partagé entre tenants même SIRET** géré.
- ✅ **Uber Direct self-signup** par tenant (1 par tenant obligatoire, adresse pickup unique), création course au paiement validé, webhooks statut par tenant
- ✅ **Hubrise** pour agrégation cmds Uber Eats + Deliveroo dans KB Orders et `KitchenBoost Admin` dès V1
- ✅ **Moteur pricing dynamique** : règles configurables par tenant, évaluation au checkout, transparence client

#### 7.1.5 Infrastructure
- ✅ Multi-tenant + RBAC 3 rôles (KB Admin / KB Manager / Staff V2) + sous-domaine auto + custom domain CNAME + wizard onboarding
- ✅ **`users` + `user_tenants` (N-N) dès V1** : multi-tenant per user pour cas Walid (1 KB Manager → N tenants), switcher dans KB Admin + KB Orders
- ✅ Base clients globale cross-tenant + position géo + protections anti-extraction (UI + API)

**Exclu de V1 (push en V2) :**

- ❌ Fallback Stuart livraison (Uber Direct seul en V1).
- ❌ Module loyauté avancé (juste segmentation simple V1).
- ❌ Module réservation.
- ❌ Module facturation Factur-X (deadline sept 2026, à pousser V2).
- ❌ Marketing automation avancée (triggers comportementaux multi-step). V1 = campagnes manuelles déclenchées par resto.
- ❌ Multi-langue (FR only en V1).
- ❌ Multi-utilisateur par tenant V1 (1 KB Manager attaché au tenant — Staff cuisine/caisse en V2).
- ❌ Captation client active externe (SEO local, ads). V1 = captation passive via QR code dans sacs Uber Eats.

**Critères d'acceptation V1 :**
- 3+ tenants installés en production (Buns & Bao + 2 autres), tous les 10 blocs opérationnels.
- Une commande complète (PWA → Stripe → DB → KB Orders push → cuisine prep → Uber Direct OU click & collect → livraison → review) traverse le système sans intervention humaine KB.
- Aucune fuite cross-tenant (audit manuel + tests automatisés).
- Cas multi-tenant per user (Walid Thai Street) testé : 1 KB Manager attaché à N tenants, switch dans KB Admin + KB Orders, RBAC strict.
- 99 % uptime sur la PWA client en heures de service (12h-15h, 19h-23h).
- Push APNs/FCM fiabilité > 95 % (mesure par tenant).
- Apple Pay / Google Pay opérationnels sur 100 % des transactions.
- Carte sauvegardée cross-tenant fonctionnelle entre les 3 tenants installés.
- Hubrise opérationnel chez au moins 1 tenant (cmds Uber Eats visibles dans KB Orders).
- Moteur pricing dynamique configurable par le KB Manager, calcul transparent au checkout.

### 7.2 V2 — Industrialisation (cible : 2027-Q1, ~3 mois après V1)

**Définition du done V2** : 30-50 restos installés via wizard, time-to-install < 7j, fallback Stuart opérationnel, modules add-ons monétisables prêts.

**Inclus dans V2 :**

- ✅ Fallback Stuart livraison (intelligent routing Uber/Stuart).
- ✅ Module loyauté complet (points configurables par resto, paliers).
- ✅ Module réservation (1-click activation).
- ✅ Module Factur-X (deadline sept 2026, donc en V2 anticipé).
- ✅ Marketing automation avancée (triggers comportementaux : anniversaire, panier abandonné, segmentation fine).
- ✅ Analytics avancées (LTV client, cohortes, A/B testing campagnes).
- ✅ Multi-utilisateur par tenant + granularité rôles (owner / manager / staff cuisine / staff caisse).
- ✅ Self-serve onboarding resto (form public + Stripe Connect auto + activation pending review KB).
- ✅ Audit log RGPD complet par tenant.
- ✅ Outils de modération (reviews négatives, support tickets).

### 7.3 V3 — Croissance (cible : 2027-Q2 → 2028)

À détailler dans un PRD V3 dédié, à écrire après release V2.

- **Captation client active** : SEO local par resto, Google Ads géolocalisé, partenariats micro-influenceurs locaux, push promo géolocalisé.
- **Multi-langue** par tenant et multi-pays (TVA, devises).
- **Livraison propre KB** : flotte coursiers indépendants ou partenariat flotte logistique.
- **Intégration directe Uber Eats / Deliveroo** (sans intermédiaire Hubrise) si l'économie le justifie.
- **App mobile client final natif** (si métrique PWA insuffisante pour engagement).

## 8. Critères de succès / métriques

### 8.1 Métriques V1

| Métrique | Cible 30j post-V1 full | Mesure |
|----------|------------------------|--------|
| Restos installés en production | 3-5 | Compteur tenants actifs |
| Commandes via Plateforme KB | 200+/sem cumulé | DB orders.canal = 'direct' |
| Taux de scan QR code → commande | ≥ 3% | Conversion funnel |
| % paiements via Apple Pay/Google Pay | > 40% | Stripe metadata |
| % commandes cross-resto (client utilise CB sauvegardée chez 2e resto) | > 15% (post-soft-launch carte cross-resto) | DB customers |
| Uptime PWA en heures service | ≥ 99% | Monitoring (Sentry / UptimeRobot) |
| Fiabilité push native resto | > 95% | App analytics |
| Latence commande → notif resto | < 5 sec | Tracking webhook → push |
| Taux incidents bloquants | < 1% | Issues tracker |
| Hubrise opérationnel chez restos opt-in | 100% | Compteur |
| Moteur pricing : règles configurées par resto | ≥ 1 par resto | DB pricing_rules |

### 8.2 Métriques V2

| Métrique | Cible 90j post-V2 | Mesure |
|----------|-------------------|--------|
| Restos installés | 30-50 | Compteur tenants actifs |
| Time-to-install (closing → first order) | < 7j | Median histo |
| Revenue récurrent (run rate) | ≥ 15 K€/mois HT | Sum des commissions encaissées |
| Stuart fallback utilisé | ≥ 5% des courses | DB |
| NPS resto | ≥ 30 | Sondage trimestriel |
| Churn resto (3 mois post-install) | < 10% | Compteur résiliations |

### 8.3 Métriques V3

À cadrer dans le PRD V3 dédié.

## 9. Risques et mitigations

| Risque | Sévérité | Probabilité | Mitigation |
|--------|----------|-------------|------------|
| Scope V1 trop large → glissement timeline répété | **Critique** | Haute | Soft-launch progressif sur Buns & Bao → on livre par feature, on n'attend pas que tout soit prêt. Buns & Bao tourne avec un sous-ensemble dès la 1ère livraison. |
| Uber Direct refuse de servir un resto (couverture / zone / type cuisine) | Élevée | Moyenne | Click & collect activable en fallback **V1**. Fallback Stuart en V2. Vérifier couverture à l'install. |
| Stripe Connect Express bloque l'onboarding d'un resto | Élevée | Faible | Plan B Mangopay évalué (1-2 sem migration). Documenté en [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md). |
| Hubrise refuse l'intégration ou pricing prohibitif | Critique en V1 | Moyenne | Négo commerciale en S0/S1 indispensable. Si refus / blocage : intégration directe Uber Eats Orders API (long mais faisable, cf. [docs/research/uber_integration_partner.md](../research/uber_integration_partner.md)). Sinon livrer V1 sans Hubrise et activer post-V1. |
| Stripe Customer cross-tenant via Connect : complexité technique sous-estimée | Élevée | Moyenne | Recherche approfondie en S0 (test PoC dans sandbox Stripe). Si trop complexe : carte sauvegardée intra-tenant V1 et cross-tenant V2. |
| App native iOS + Android : effort sous-estimé | Élevée | Moyenne | À cadrer dès S0 par dev lead. Pas de stack imposée dans PRD, mais tracker du sub-PRD [20 KB Orders](20_kb_orders.md) sur livraison incrémentale (notifs d'abord, workflow cmd ensuite, edge cases enfin). |
| Un resto exfiltre la base clients via screenshot / copie manuelle | Faible | Élevée | Limitation contractuelle (Art 2 ter) + technique (pas d'export CSV, pas de copie massive, pas d'API publique, watermark visuel, audit log). |
| Push iOS désactivé par défaut → faible adoption canal direct côté client | Moyenne | Élevée | A2HS obligatoire sur iOS 16.4+ + SMS fallback opt-in V1. Pour resto : app native iOS Apple Push Notification Service (APNs) fiabilité > 95%. |
| Adoption PWA trop lente (clients scannent peu) | Élevée | Moyenne | Mitigation = puissance du QR sticker + offre lancement (BOGO, -20%) à la 1ère cmd directe. Mesurer taux conversion sur 30j. |
| Désalignement Alex (commercial) ↔ équipe dev sur scope V1 | Moyenne | Moyenne | Ce PRD est la source de vérité. Toute demande de feature additionnelle doit passer par mise à jour PRD avant dev. |
| Concurrence directe (Owner.com s'implante en FR, Toast acquiert un acteur FR) | Moyenne | Faible 12 mois | Vélocité d'install + densification verticale (chaînes de marques virtuelles) = barrière. |
| Bug critique paiement / livraison sur premier go-live (Buns & Bao) | Critique | Moyenne | Soft launch friends & family 3-7j avant ouverture publique. Alex sur place le jour J. Hotline support 24h en heures de service les 14 premiers jours. |
| Multi-tenant mal conçu en V1 → refonte coûteuse | Élevée | Moyenne | [50_multi_tenant_saas.md](50_multi_tenant_saas.md) prioritaire S0/S1. Tests automatisés cross-tenant obligatoires. |

## 10. Open questions et deadlines

| Q | Question | Bloquant pour | Deadline | Owner |
|---|----------|---------------|----------|-------|
| Q1 | Tarif Uber Direct exact en zones IDF (5,90€ public ou négocié plus bas dès volume ?) | V1 (impact pricing resto) | 2026-05-30 | Alex — call AM direct-fr@uber.com |
| Q2 | Self-serve onboarding Uber Direct API disponible en FR ou pas en 2026 ? | V2 (industrialisation) | 2026-06-15 | Alex — call AM |
| Q3 | Organizations API (parent + sub-accounts) accessible en FR sans contrat US ? | V2 (scale) | 2026-06-15 | Alex — call AM |
| Q4 | Webhook centralisé multi-tenant autorisé ou 1 webhook par tenant obligatoire ? | V2 | 2026-06-15 | Alex — call AM |
| Q5 | Stripe Connect Express : auto-validation CB en self-serve ou validation manuelle au RDV install ? | V1 (UX onboarding) | 2026-05-30 | Tester en sandbox + voir conf KYC |
| Q6 | Modèle pricing KB Phase 2+ : 2€ flat OU % du panier (5%) ? | V2 (validation business) | Q3 2026 | Validation terrain sur premiers 5 restos |
| Q7 | Custom domain : KB fournit (achat groupé sur .shop) ou resto achète sien ? | V1 (UX onboarding) | 2026-05-30 | Décision Alex |
| Q8 | Fallback iOS users refusant push : SMS Twilio (0,07€) ou email seul ? | V1 | 2026-05-30 | Décision Alex |
| Q9 | Imprimante cuisine CloudPRNT : KB prête (capex ~150€ × 10 = 1500€) ou resto achète ? | V1 selon resto | À l'install | Cas par cas — voir décision dans [20 KB Orders](20_kb_orders.md) |
| Q10 | Premier pilote V1 : Buns & Bao confirmé ? | V1 (jalon go-live) | ✅ Confirmé 2026-05-23 | ✅ Buns & Bao |
| Q11 | Refus de commande par le resto (cuisine surchargée, rupture stock) : workflow + refund auto ou manuel ? | V1 | Cadré dans [20 KB Orders](20_kb_orders.md) | Produit |
| Q12 | Audit trail RGPD (qui a modifié quoi, quand) : V1 ou V2 ? | V1/V2 RGPD compliance | À cadrer dans [70_kb_admin.md](70_kb_admin.md) | Produit |
| Q13 | Hubrise : contrat commercial KB master ou resto direct ? Impact pricing négocié. | V1 | 2026-06-15 | Alex — call commercial Hubrise |
| Q14 | Stripe Customer cross-tenant via Connect : PoC sandbox faisabilité ? | V1 (carte sauvegardée cross-resto) | 2026-06-30 | Dev lead PoC |
| Q15 | Click & collect : modulable par resto (toggle) ou imposé activé ? | V1 | 2026-05-30 | Alex |
| Q16 | Stack `KB Orders` app native (à décider par dev lead, pas dans PRD) : faisabilité 1 codebase iOS+Android dans le temps imparti ? | V1 | 2026-06-15 | Dev lead |

## 11. Hors scope explicite (à ne pas faire en V1 ni V2 même si demandé)

Pour éviter le scope creep, voici ce qui n'est pas dans le scope du produit en V1 ni V2, même si un resto le demande :

- ❌ POS caisse magasin physique (paiement en salle, gestion table).
- ❌ Gestion stock / approvisionnement / fournisseurs.
- ❌ Gestion RH / planning équipe.
- ❌ Comptabilité (juste export CSV des transactions pour comptable).
- ❌ Click & collect "borne self-service" autre que via PWA KB.
- ❌ Partenariat fidélité cross-restos (V3+).
- ❌ Marketplace KB (où le client choisirait son resto sur kitchen-boost.fr) — chaque resto a son propre URL en V1/V2.

## 12. Index des sous-PRDs

Voir [README.md](README.md) pour la liste complète et les statuts. Lecture conseillée dans l'ordre :

1. **Cadre transverse** : [50_multi_tenant_saas.md](50_multi_tenant_saas.md) → comprendre comment les tenants sont isolés, provisionnés, et le RBAC.
2. **Flux nominal commande** : [10_pwa_client_commande.md](10_pwa_client_commande.md) → [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md) → [35_pricing_engine.md](35_pricing_engine.md) → [40_livraison_uber_direct.md](40_livraison_uber_direct.md) → [20_kb_orders.md](20_kb_orders.md)
3. **Gestion resto** : [70_kb_admin.md](70_kb_admin.md) → [80_notifications.md](80_notifications.md) → [90_donnees_clients_crm.md](90_donnees_clients_crm.md)
4. **Intégrations + admin** : [60_integration_marketplaces.md](60_integration_marketplaces.md), [70_kb_admin.md](70_kb_admin.md)

## 13. Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 1.0 | Alex (via Claude) | Création initiale. |
| 2026-05-23 | 2.0 | Alex (via Claude) | Révision majeure scope V1 : extension aux 10 points critiques (app native resto, dashboard resto, agrégation marketplaces V1, moteur pricing dynamique, compte client unifié cross-resto, Apple Pay/Google Pay, click & collect, push marketing V1). Suppression V1.A/V1.B, adoption stratégie soft-launch progressif. Ajout RBAC. 12 blocs fonctionnels (vs 10 en v1.0). Ajout sous-PRDs 35_pricing_engine, 75_dashboard_resto, 76_app_native_resto. Persona admin KB explicité. |
