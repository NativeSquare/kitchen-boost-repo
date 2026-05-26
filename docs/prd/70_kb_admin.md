# 70 — KitchenBoost Admin

**Statut** : 🟡 Squelette · **Version** : 1.0 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 8](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v1.0 (fusion)** : ce PRD résulte de la **fusion** des anciens `70_admin_backoffice_kb.md` v0.3 (back-office interne KB) et `75_dashboard_resto.md` v0.1 (dashboard resto). Il n'y a plus deux apps web séparées — il y a **une seule app web `KitchenBoost Admin`** dont la vue est scopée par **RBAC** : un user **KB Admin** (root) voit tous les tenants, un user **KB Manager** voit son ou ses tenants. Ancien `75` : [docs/\_archive/](../_archive/).

---

## Vision

Une seule UI web (`admin.kitchen-boost.fr` ou équivalent) pour **toutes** les opérations business du système, avec une seule logique de permissions :

```
KB Admin (root)
  └── voit tous les tenants + tous les users + ops globales
      pipeline onboarding, CRM, monitoring, impersonation, audit log

KB Manager (gérant resto)
  └── voit le ou les tenants auxquels il est attaché via user_tenants
      édition menu, vue cmds, vue clients (masqués), campagnes,
      moteur pricing, QR generator, paramètres tenant, stats

Staff (V2)
  └── attaché à 1 tenant précis, accès limité
      consultation cmds + édition disponibilité items
```

Une seule codebase, une seule URL, une seule auth. Le RBAC scope les composants et les routes API ; l'isolation des données est **applicative Convex** ([ADR 0010](../adr/0010-isolation-multi-tenant-convex-applicative.md)), **pas de RLS Postgres**.

> **Chantier backend 2.9** = le backend **root/onboarding uniquement** (prospects/CRM, contrats, wizard de provisioning tenant, monitoring hooks). Les vues opérationnelles **KB Manager** (édition menu, commandes, KPI clients, campagnes, pricing, QR) sont du **front (Phase 3, Train B)** qui consomme les backends 2.1–2.7. Le contrat est **porté en TypeScript** (Convex ne peut pas exécuter `generate_contract.py`). Audit log UI = V2 (audit data-layer déjà via foundation `logAudit`).

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1**  | Auth (login email+password+2FA), RBAC à 3 rôles (KB Admin / KB Manager / Staff prévu V2). **Côté KB Admin (root)** : pipeline onboarding visuel (4 phases : Acquisition/Préparation/Installation/Opérationnel), CRM prospects/clients cliquable, gestion contrats (script `generate_contract.py` + Odoo), wizard création tenant < 30 min, liste + détail tenants, monitoring incidents (Slack alerts), partage manuel KB → resto de clients, impersonation, embed Stripe KYC. **Côté KB Manager** : dashboard home (KPIs jour), édition menu (catégories / items / modifiers/personnalisations), vue cmds en cours + historique, vue clients (masqués, sans export), campagnes marketing simples (push + email), configuration moteur pricing livraison, génération QR code PDF, paramètres tenant (branding, modes acceptés, horaires), stats basiques. **Multi-tenant per user dès V1** : un KB Manager attaché à N tenants (cas Walid Thai Street) voit un sélecteur de tenant courant en header. **Multi-utilisateur `kb_admin` dès V1** (table `users` supporte déjà N rôles). |
| **V2**  | Multi-utilisateur par tenant (Staff cuisine + Staff caisse), édition menu collaborative, A/B testing campagnes, analytics avancées (LTV, cohortes), modération reviews, import menu en bulk (CSV / parse Uber Eats Manager), Odoo API automatique (signature → webhook → statut), Grafana dashboards. **Audit log** (basique + RGPD complet, conservation 3 ans).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **V3**  | API publique pour resto (export programmable), intégrations tierces (Google Business Profile sync, Instagram catalog), feature flags KB-side, automation onboarding (validation auto Stripe + Uber après KYC).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Hors scope

- POS caisse / encaissement en salle.
- Comptabilité (juste export CSV).
- Gestion stock / approvisionnement / fournisseurs.
- Gestion RH / planning équipe.
- Recettes / fiches techniques cuisine.
- **Export brut clients pour le resto (JAMAIS — moat KB)**.
- CRM full-featured (pipeline opportunities $$, séquences automatisées, email tracking auto) — volontairement minimaliste V1.
- Outils marketing internes KB (pubs, SEO) — autres outils.

## Personas concernés

- **KB Admin** (interne KB — Alex en V1, équipe ops/support V2+)
- **KB Manager** (gérant resto — Khan, Walid, etc.)
- **Staff** (V2 — employés du resto avec accès limité)
- **Dev / SRE KB** (debugging, monitoring)

## Surface fonctionnelle

### 1. Auth + RBAC

- Login email + password + 2FA (V1)
- SSO unifié avec [20 KB Orders](20_kb_orders.md) (app native) — 1 user = 1 compte, web ou mobile
- JWT contient : `user_id`, `role`, et liste de `tenant_ids` accessibles (peut être vide pour KB Admin = root)
- Middleware backend filtre toutes les queries par `tenant_id` du contexte courant
- **KB Admin peut "impersonate" un KB Manager** pour assistance (V1 : sans audit log, V2 : audit log obligatoire + banner visible côté Manager)

### 2. Switcher tenant courant (V1, cas multi-tenant per user)

Un KB Manager attaché à N tenants (cas Walid Thai Street ou Khan multi-site) :

- Sélecteur en header : "Tenant courant : <nom>"
- Switch → recharge le contexte (URL, données affichées, sub-domain si custom)
- Persistance par device (cookie / localStorage)
- KB Admin (root) a un sélecteur global "Tous tenants" + filtre par tenant

### 3. Côté KB Admin (root) — supervision globale

#### 3.1 Liste tenants

- Table : slug, nom resto, KB Manager attaché, status (active/pending/suspended), statut Stripe, statut Uber Direct, statut Hubrise, dernière cmd, CA mensuel
- Filtres : par status, par mois actif, par KB Manager
- Recherche par nom / slug / SIRET / téléphone
- Lien vers détail tenant

#### 3.2 Détail tenant

- Infos : nom, SIRET, adresse, contact gérant
- KB Manager(s) attaché(s) (avec rôle + date d'attachement)
- Statuts intégrations : Stripe (account_id, KYC en temps réel, soldes), Uber Direct (customer_id, dernière course), Hubrise (V1+)
- Liste cmds récentes
- Bouton "suspendre" / "réactiver"
- Bouton "Impersonate KB Manager"
- Logs / audit trail

#### 3.3 Pipeline onboarding visuel (acté 2026-05-23)

Pipeline DB-driven dans `KitchenBoost Admin` (source de vérité opérationnelle). Le doc `project_onboarding_process.md` devient narratif uniquement.

**Structure à 4 phases visibles + 1 hors-Kanban** :

- **Acquisition** → **Préparation** → **Installation** → (Opérationnel, hors Kanban)
- Transition Acquisition → Préparation déclenchée automatiquement par l'**événement Closing** (composite : contrat signé + KBIS + pièce ID + RIB + facture tablette payée si applicable).

**Vue Kanban** : 3 colonnes visibles (Acquisition / Préparation / Installation) + onglet séparé "Clients actifs" pour Opérationnel.

**Liste exhaustive des milestones par phase** :

**Acquisition** :

- Prospect créé
- Canal d'acquisition (enum : `cold_call` / `whatsapp` / `referral` / `visite_physique`)
- Premier contact effectué
- RDV booké
- Devis présenté (inclut pitch)
- Contrat généré (via `tools/generate_contract.py`)
- Contrat envoyé Odoo
- Contrat signé (check manuel V1 ; webhook Odoo = V2, cf. Q70-Q8)
- KBIS reçu
- Pièce d'identité reçue
- RIB reçu
- (conditionnel si `tablette_mode=achat_kb`) Facture tablette émise
- (conditionnel) Facture tablette payée
- ⇨ **Closing atteint** → bascule auto Préparation

**Préparation** :

- Stripe Connect : statut courant + historique (`not_started` / `pending_kyc` / `verified` / `rejected` / `disabled`)
- Uber Direct : statut courant + historique (`not_started` / `pending_kyc` / `active` / `failed`)
- Hubrise (optionnel V1) : statut courant (`not_configured` / `configured` / `active`)
- (conditionnel si Prestation A) Marque virtuelle : identité + menu finalisés via skill `create-virtual-brand`
- Menu KB : importé en DB
- Photos emballages : reçues
- Décision packaging : actée (sticker / tampon / custom)
- ⇨ **GATE** → bascule Installation

**Installation** :

- (conditionnel) Tablette commandée / livrée / configurée mode kiosque
- Stickers QR imprimés
- Visite physique J-day (Alex ou ops futur)
- QR stickers collés dans sacs livraison
- Sticker boîtes / packaging branding appliqué
- `kb_manager` user créé + invité (lien magique)
- `kb_manager` user a complété login + 2FA
- Test cmd interne (Alex)
- **1ère cmd publique reçue** ⇨ bascule Opérationnel

**Opérationnel** (filtré du Kanban) :

- Statuts : `active` / `at_risk` / `churned`
- Métriques winner criteria (cf. `feedback_winner_criteria.md`)

**Liens externes pré-remplis** (un-click depuis page détail) :

- Lien Stripe Connect onboarding (généré + copy)
- Lien Odoo signature contrat
- direct.uber.com (instructions copy-paste pour le resto)
- WhatsApp deep-link `wa.me/<num>`

**Embed Stripe KYC** : statut temps réel dans la page détail.

**Gates indicatifs (V1)** : possible de bypass un gate avec un milestone manquant — bypass loggé en audit. Pas de strict V1 (la rigidité ralentit la micro équipe).

#### 3.4 CRM prospects + clients

Consolide l'actuel `crm_prospects.csv` + `crm_view.html` en UI persistante.

- **Vue cartes** : chaque resto (prospect ou tenant signé) = une carte (nom, statut, phase, dernière interaction, score)
- **Click → page détail** (= § 3.2 ci-dessus)
- **Search** par nom / slug / SIRET / téléphone
- **Filtres** : phase pipeline, source (cold call / referral / inbound), statut (prospect / signé / actif / churned)
- **Onglets** : Prospects | Clients signés | Tous
- **CRUD léger** : ajouter prospect manuellement, log interaction (note + date + canal), changer de phase
- **Pas de pipeline opportunités $$, pas d'email tracking, pas de séquences auto** — V1 minimaliste

#### 3.5 Gestion contrats

S'appuie sur l'outillage existant — **pas de réimplémentation**.

- **Bouton "Générer contrat"** sur page détail resto (depuis phase A ou B)
- **Inputs pré-remplis** depuis la fiche : raison sociale, SIRET, adresse, email, représentant
- **Sélecteur prestation** : A seul / B seul / A&B (cf. [contrat_template.md](../legal/contrat_template.md))
- Génération du contrat **portée en TypeScript** côté backend (Convex ne peut pas exécuter Python) — transcription de `tools/generate_contract.py`, qui reste la référence d'origine ; output HTML stocké
- **Bouton "Envoyer pour signature"** → upload sur Odoo (manuel V1, intégration API V2), génère le lien
- **Statut stocké** au tenant : `draft` / `sent` / `signed` / `expired`, daté
- **Webhook Odoo** (si dispo) ou check manuel pour passer en `signed`
- **PDF signé** stocké lié au tenant (Odoo storage ou bucket KB, Q70-Q9)
- Pas de signature dans KB direct (toujours Odoo)

#### 3.6 Wizard création tenant

- Step 1 : infos resto (nom, SIRET, adresse, contact)
- Step 2 : générer slug, vérifier dispo
- Step 3 : config domain (sous-domaine KB ou custom CNAME)
- Step 4 : créer ou rattacher Stripe Connect (cf. cas SIRET partagé [50](50_multi_tenant_saas.md))
- Step 5 : upload logo + couleur primaire
- Step 6 : import menu (CSV ou manual, parse Uber Eats Manager V2)
- Step 7 : générer QR sticker PDF imprimable
- Step 8 : créer ou rattacher KB Manager (user existant ou nouveau via email invite)
- Step 9 : activer tenant
- Total < 30 min

#### 3.7 Partage clients KB → resto — V2 (pas V1)

**Décision actée 2026-05-23** : repoussé V2. Le partage prend son sens uniquement quand les campagnes existent (cf. [90](90_donnees_clients_crm.md) § 5). Argument commercial à retirer du pitch V1. Pas d'UI partage V1.

#### 3.8 Monitoring incidents

- Dashboard : statut Stripe / Uber Direct / Vercel / DB / Hubrise par tenant
- Alertes Slack ops sur :
  - Webhook Stripe latence > 30 s
  - Webhook Uber latence > 30 s
  - Erreur 5xx récurrente (3+ en 5 min)
  - Tenant en KYC pending > 48 h
  - Cmd payée sans course Uber créée
- V2 : Grafana dashboards par tenant

#### 3.9 Audit log (V2 — pas V1)

Repoussé V2 (acté 2026-05-23, Q70-Q2). En V1, seul Alex en `kb_admin` → ROI nul.

V2 :

- Couverture complète (auth, tenant lifecycle, pipeline, contrats, menu, vue clients RGPD-sensible, payment refunds, RBAC, impersonation)
- Conservation 3 ans (RGPD)
- Recherche / filtre par who/what/when/where

### 4. Côté KB Manager — gestion de son tenant

#### 4.1 Dashboard home (vue d'ensemble)

- KPIs jour : CA total, nb cmds, panier moyen, cmds en cours
- Source des cmds (V1 = **direct** ; Uber Eats + Deliveroo via Hubrise = **V2**, [ADR 0009](../adr/0009-hubrise-reporte-v2.md))
- Statut tenant (ouvert / fermé / pause)
- Alertes (cmd en attente refus, stock bas — V2)
- Bandeau "KB est connecté à votre compte" si impersonation en cours (V2)

#### 4.2 Édition menu

- Vue arborescente : **Catégories → Items → Modifiers**
- CRUD complet :
  - **Catégorie** : nom, ordre, icône
  - **Item** : nom, description, **prix TTC** (valeur unique en centimes ; acté 2026-05-26 — le resto saisit/pense en TTC, et il est merchant of record sur la vente → KB ne gère pas de split HT sur les items ; pas de champ taux-TVA V1, le détail TVA de la vente relève du resto), photo (upload), disponibilité (toggle out of stock), tags (végé, vegan, allergènes), modifiers liés
  - **Modifier** : nom, type (single / multi choice), required/optional, options (avec prix delta)
- **Personnalisations (modifiers)** : édition des choix associés aux items (sauces, suppléments, cuisson), exactement comme Uber Manager. Pas de système séparé de suggestions cross-sell. Le terme "upsell" désigne ici l'effet business (augmentation panier moyen via modifiers payants), pas une feature UI distincte.
- Versioning : V2 (rollback possible)
- Preview : visualiser comment l'item s'affichera côté PWA client avant publication
- Drag & drop pour réordonner
- Publication = propagation < 30 sec en [10 PWA Client](10_pwa_client_commande.md)

#### 4.3 Vue commandes

- Liste cmds en cours (live update via SSE/WebSocket) : statuts, items, total, courier ETA
- Historique cmds (paginé, filtrable par date / statut / source)
- Détail cmd : récap complet, possibilité refund (V1 total, V2 partiel)
- Source taggée (icône direct / Uber Eats / Deliveroo via Hubrise)
- Export CSV cmds pour comptable (V1)

#### 4.4 Vue "Mes clients" — KPI globaux uniquement V1

**Décision Q90-Q2 actée 2026-05-23** : V1 = AUCUNE liste individuelle, AUCUNE coordonnée même masquée. Le resto voit uniquement des KPI globaux + atteignabilité par canal.

- Compteurs par segment : `actifs` / `inactifs` / `VIP` (cf. [90](90_donnees_clients_crm.md))
- Atteignabilité par canal : `# atteignables push`, `# email`, `# SMS`
- KPI macro : total clients tenant, nouveaux ce mois, taux de retour (% clients ayant ≥ 2 cmds)
- Filtre temporel global (30 / 90 / 365 jours)
- **PAS de table, PAS de prénom, PAS de coordonnées, PAS d'export CSV (JAMAIS)**
- Campagnes (V2) : le resto tape un segment, KB envoie en proxy — jamais de destinataires nominatifs visibles

#### 4.5 Campagnes marketing

- Créer campagne :
  - Type : push ou email (V1)
  - Segment : actifs / inactifs / VIP / tous (V1 simple, V2 critères fins)
  - Template : titre + corps + lien (vers item promo, vers menu, vers page resto)
  - Schedule : V1 envoyer maintenant only, V2 scheduling
- Preview avant envoi
- Quotas : 3 push marketing/sem/client max (anti-spam), illimité email
- Stats post-envoi : envoyés / ouverts / cliqués / convertis (cmds résultantes)
- KB envoie en proxy — KB Manager n'accède jamais aux coordonnées brutes

#### 4.6 Configuration moteur pricing livraison

- UI no-code pour configurer les règles (cf. [35_pricing_engine.md](35_pricing_engine.md) section 2)
- Liste règles (priorité **automatique/déterministe** : la règle qui minimise les frais client gagne — pas d'ordre manuel, Q35-Q2)
- Activate / Deactivate par règle
- Simulator V2 : "Si client X commande Y € à Z heure, voilà ce qui se passe"

#### 4.7 Génération QR code

- Bouton "Télécharger mon QR code"
- Génère un PDF imprimable avec :
  - QR code haute résolution (1 ou plusieurs, ex: format sticker 50 mm)
  - URL en clair (fallback texte)
  - Branding tenant (logo + couleur)
- Templates multiples : sticker rond, format A6 carte, format A4 affiche

#### 4.8 Paramètres tenant

- Infos : nom, adresse, téléphone, horaires d'ouverture
- Branding : upload logo, color picker primaire (reflété en PWA et admin)
- **Modes acceptés** : livraison (toggle) + click & collect (toggle)
- Zone livraison : automatiquement gérée par Uber Direct (affichage informatif)
- Notifications : config DNT heures, fallback SMS opt-in

#### 4.9 Statuts intégrations (lecture seule côté KB Manager)

- Stripe Connect (connecté / pending / disabled) + bouton "ré-authentifier"
- Uber Direct (configuré ou non)
- Hubrise (configuré ou non, activable depuis ici en V1)

#### 4.10 Statistiques basiques (V1)

- CA total / mois (graph)
- Nb cmds / jour
- Panier moyen
- Top 5 items vendus
- Heures de pointe
- Taux conversion PWA (visites → cmds)
- Comparatif CA direct vs Uber Eats / Deliveroo (avec Hubrise V1)

#### 4.11 Support / aide

- Lien chat support KB (Slack ou Intercom V2)
- FAQ
- Lien vers son contrat KB (PDF récupéré depuis Odoo)
- Bouton "Contacter mon CSM KB" (Alex en V1)

## Flows nominaux

1. **KB Admin onboarde un nouveau resto end-to-end** : Alex ajoute un prospect dans le CRM (nom, tel, source "cold call Malakoff") → phase A → relance / RDV physique → phase B (closing) → bouton "Générer contrat" → preview HTML → "Envoyer Odoo" → lien signature envoyé → resto signe → webhook Odoo → statut `signed` → phase B+ (checklist préparation menu) → quand OK, "Lancer Wizard tenant" → 9 steps → tenant actif → phase C (kickoff install physique) → phase D (opérationnel). **Une seule UI**.
2. **KB Admin vérifie un KYC Stripe pending** : ouvre CRM → carte du resto → page détail → bloc Stripe affiche statut en temps réel via embed → si pending depuis 48 h, badge alerte rouge + action "Relancer le resto via WhatsApp" en un clic.
3. **KB Admin réagit à un incident webhook Stripe** : alerte Slack → ouvre admin → voit tenant impacté → vérifie logs Sentry → identifie cause → fix manuel.
4. **KB Manager Khan édite son menu** : login → "Menu" → ajoute catégorie "Smashs" → ajoute item "Smash Triple" 14 € → upload photo → ajoute modifier "Steaks (1/2/3/4)" → save → publié en PWA < 30 sec.
5. **KB Manager Khan configure une règle pricing** : login → "Pricing livraison" → "Nouvelle règle" → condition `panier >= 25 €` → action `livraison_offerte_resto` → save.
6. **KB Manager Khan lance une campagne push** : login → "Campagnes" → segment "Inactifs 30j" → template "On vous a manqué, -20 % sur prochaine cmd" → preview → envoyer → KB envoie 150 push en proxy → 45 ouverts → 8 cmds générées → stats visibles.
7. **KB Manager Walid switche entre ses 3 restos** : login → sélecteur header affiche "Thai Street Saint Michel" → tap → choisit "Thai Street Châtelet" → toutes les vues (dashboard, menu, cmds, clients, pricing) rechargent avec les données du 2ᵉ tenant.

## Edge cases

- **KB Manager qui n'a pas encore signé son contrat** : tenant en status `pending`, login désactivé. Accessible seulement via lien magique d'invite après contrat signé.
- **KB Admin tente de supprimer un client final côté resto** : refus systématique. C'est un client KB (Article 2 ter contrat). Lui expliquer qu'on peut juste ne pas le solliciter.
- **2 KB Managers éditent le menu simultanément** (V2 multi-user) : optimistic locking, message si conflit.
- **KB Manager change la couleur primaire** : preview avant validation pour éviter coquille.
- **Tenant suspendu** : PWA affiche "service indisponible", KB Orders affiche bannière "tenant suspendu, contacter KB", KB Manager peut toujours se connecter pour voir l'historique mais pas modifier.
- **KB Admin action critique** (drop données, suspension tenant majeur) : confirmation à 2 étapes obligatoire.
- **Tenant supprimé par erreur** : V2 soft delete + restauration 30 j.
- **Tenant inactif 60 j** : alerte ops + relance CSM, pas de suspension auto V1.
- **KB Manager attaché à 0 tenants** (cas erreur) : redirige vers page "Pas de tenant attaché, contactez KB".
- **KB Manager attaché à un tenant suspendu uniquement** : message d'explication + lien vers support, pas d'accès aux fonctions.

## Critères de succès / acceptation

### V1

- [ ] Login + 2FA opérationnel
- [ ] RBAC strict testé : KB Manager A ne peut jamais accéder au tenant de KB Manager B (test automatisé)
- [ ] Switcher tenant fonctionnel pour user multi-tenant (test Walid Thai Street avec 3 tenants)
- [ ] KB Admin peut voir tous tenants + statuts en < 5 sec
- [ ] Pipeline onboarding visuel opérationnel : un nouveau resto trackable A → D depuis 1 seule UI
- [ ] Checklist phase B+ enforced (alerte si tentative bypass)
- [ ] CRM cliquable : 1 click sur carte → page détail
- [ ] Bouton "Générer contrat" produit le HTML attendu en < 5 sec
- [ ] Statut signature contrat visible et à jour
- [ ] Embed Stripe KYC en temps réel dans l'admin
- [ ] Wizard création tenant en < 30 min
- [ ] KB Manager édite son menu et publie sans assistance en < 5 min pour 1 item
- [ ] Latence édition menu → propagation PWA : < 30 sec
- [ ] Configuration d'1 règle pricing en < 3 min
- [ ] Génération QR PDF en < 10 sec
- [ ] Campagne push envoyée en proxy KB, stats remontées
- [ ] 0 fuite cross-tenant testée
- [ ] Alerte Slack < 30 sec après incident webhook
- [ ] Dashboard responsive desktop + tablette + mobile (consultation)

### V2

- [ ] Multi-utilisateur par tenant (Staff cuisine + caisse) + audit log granulaire
- [ ] Import menu CSV opérationnel
- [ ] A/B testing campagnes déployé
- [ ] Intégration API Odoo (signature → webhook → statut `signed` auto)
- [ ] Grafana dashboards par tenant

## Dépendances

| Dépendance                                              | Type    | Bloque quoi                                                    |
| ------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| Tous les sous-PRDs                                      | Interne | Sources de données monitorées                                  |
| [10 PWA Client](10_pwa_client_commande.md)              | Interne | Édition menu propagée                                          |
| [20 KB Orders](20_kb_orders.md)                         | Interne | SSO + cohérence UX cmds                                        |
| [30 Stripe Connect](30_paiement_stripe_connect.md)      | Interne | Refunds + statut Stripe affiché + embed KYC                    |
| [35 Pricing Engine](35_pricing_engine.md)               | Interne | UI configuration règles                                        |
| [40 Uber Direct](40_livraison_uber_direct.md)           | Interne | Statut intégration affichée                                    |
| [50 Multi-tenant SaaS](50_multi_tenant_saas.md)         | Interne | RBAC + `user_tenants` + scope tenant                           |
| [60 Marketplaces](60_integration_marketplaces.md)       | Interne | Activation Hubrise + affichage cmds marketplace                |
| [80 Notifications](80_notifications.md)                 | Interne | Campagnes (push proxy)                                         |
| [90 Customer Data](90_donnees_clients_crm.md)           | Interne | Vue clients (avec restrictions moat) + partage KB → resto      |
| Slack API                                               | Externe | Alertes ops                                                    |
| Sentry                                                  | Externe | Erreurs                                                        |
| UptimeRobot                                             | Externe | Uptime checks                                                  |
| `tools/generate_contract.py` existant                   | Interne | Bouton "Générer contrat" (intégration directe, pas réécriture) |
| `tools/build_crm_html.py` + `crm_prospects.csv` actuels | Interne | Données source migrées en DB au build V1                       |
| Odoo (signature contrat)                                | Externe | Statut `signed`, upload PDF signé                              |
| Stripe API (`account.retrieve`) ou widget               | Externe | Embed vérif KYC en temps réel                                  |
| WhatsApp deep-link (`wa.me/`)                           | Externe | Contact resto en 1 clic depuis CRM                             |

## Open questions

| Q      | Question                                                                                                                                                                                                                                                                                      | Deadline | Owner        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| 70-Q1  | Stack admin : Retool / Forest Admin / build custom Next.js ? Trade-off : Retool rapide à monter mais lock-in, custom = contrôle mais plus long. À trancher tôt vu micro équipe.                                                                                                               | V1 S0    | Dev lead     |
| 70-Q2  | ~~Niveau d'audit trail V1 ?~~ **ACTÉ 2026-05-23 : audit trail repoussé V2.** Alex seul aux commandes V1, ROI nul. Risque RGPD résiduel accepté (en cas de litige, c'est `kb_admin=Alex` de toute façon). Conservation 3 ans imposée par RGPD reste à matérialiser V2.                         | —        | —            |
| 70-Q3  | ~~Multi-utilisateur KB Admin (équipe interne) V1 ou V2 ?~~ **ACTÉ 2026-05-23 : multi-user dès V1.** La table `users` supporte déjà N rôles `kb_admin` techniquement — pas de coût additionnel. UI d'invitation user `kb_admin` inclus V1. Permissions granulaires (Q70-Q4) restent V2.        | —        | —            |
| 70-Q4  | Permissions granulaires V2 (qui peut suspendre tenant, qui peut edit menu) ?                                                                                                                                                                                                                  | V2       | Alex         |
| 70-Q5  | ~~Import menu OCR ou manuel ?~~ **ACTÉ 2026-05-23 : manuel V1, OCR/parser V2.** Saisie manuelle catégories → modifiers → items au wizard tenant.                                                                                                                                              | —        | —            |
| 70-Q6  | Embed Stripe KYC : `account.retrieve` API polling ou Stripe.js Connect Embedded Components ? Si lourd, juste statut DB mis à jour par webhook suffit.                                                                                                                                         | V1 S1    | Dev lead     |
| 70-Q7  | Migration `crm_prospects.csv` → DB : one-shot script au build, ou import à la demande ?                                                                                                                                                                                                       | V1 S0    | Dev lead     |
| 70-Q8  | ~~Webhook Odoo ou check manuel V1 ?~~ **ACTÉ 2026-05-23 : check manuel V1, webhook auto V2.** Bouton "Rafraîchir statut contrat" sur la page tenant qui poll Odoo à la demande. Webhook automatique V2 quand on aura le temps de l'investiguer côté Odoo.                                     | —        | —            |
| 70-Q9  | ~~Stockage PDF signé Odoo vs bucket KB ?~~ **ACTÉ 2026-05-23 : V1 = lien Odoo référencé** sur page tenant (click → ouvre Odoo). **V2 = upload PDF dans storage KB** pour accès offline + archive (Odoo reste source de vérité légale).                                                        | —        | —            |
| 70-Q10 | Pipeline phases : strict (gates obligatoires) ou indicatif (bypass loggé) ? Recommandé indicatif V1.                                                                                                                                                                                          | V1       | Alex         |
| 70-Q11 | Source de vérité pipeline : DB admin ou `project_onboarding_process.md` ? Le doc reste narratif, l'admin reflète l'état opérationnel.                                                                                                                                                         | V1       | Alex         |
| 70-Q12 | ~~URL admin : 1 URL pour tous ou par tenant ?~~ **ACTÉ 2026-05-23 : 1 URL unique `admin.kitchen-boost.fr`.** Le RBAC + JWT déterminent l'affichage selon le user. Cohérent avec "1 seule app". Le branding tenant vit dans la PWA cliente, pas dans l'admin.                                  | —        | —            |
| 70-Q13 | ~~Logique upsell V1 : manuelle ou auto ?~~ **ACTÉ 2026-05-23 : confusion vocabulaire.** Ce que je désignais comme "upsell" = les **personnalisations (modifiers)** d'Uber Manager. Pas un système séparé. Vocab corrigé dans [contexts/kb-admin/CONTEXT.md](../contexts/kb-admin/CONTEXT.md). | —        | —            |
| 70-Q14 | KB Admin peut-il modifier le menu d'un resto sans avertir (assistance) ou OK requis ?                                                                                                                                                                                                         | V1       | Alex + legal |
| 70-Q15 | ~~Statistiques V1 : tableaux ou graphs ?~~ **ACTÉ 2026-05-23 : graphs simples + chiffres** (parité Uber Manager). V1 = 3 graphs basiques (CA/jour line, top items bar, heatmap heures de pointe) + chiffres bruts pour le reste (panier moyen, taux conversion, etc.).                        | —        | —            |
| 70-Q16 | ~~CRM carte = tenant ou user ?~~ **ACTÉ 2026-05-23 : carte = tenant.** 1 carte par boutique dans le Kanban. Walid avec 3 boutiques = 3 cartes. Badge subtil "user +N" sur la carte si user multi-tenant, click → filtre tous les tenants de ce user.                                          | —        | —            |

## Notes / décisions actées

- **1 seule app web, 1 seul nom : `KitchenBoost Admin`**. Pas de "back-office" séparé du "dashboard resto". Le RBAC scope la vue.
- **3 rôles V1** : KB Admin (root) / KB Manager (gérant) / Staff (V2). Cf. [50 Multi-tenant SaaS](50_multi_tenant_saas.md) pour `users` + `user_tenants` data model.
- **Multi-tenant per user dès V1** : un KB Manager attaché à N tenants (cas Walid Thai Street avec 3 restos) via `user_tenants`. Switcher dans header. Cas typique reste 1-tenant (Khan).
- **V1 = streamliné pour micro équipe** : pipeline + CRM + contrats + wizard + édition menu + campagnes, tout dans une seule UI. Pas de réinvention : `generate_contract.py`, `build_crm_html.py` sont **embarqués**, pas réécrits.
- **Signature contrat = toujours Odoo**. Pas de DocuSign-like dans KB. KB génère + tracke, Odoo signe.
- **CRM volontairement minimaliste**. Pas de pipeline opportunités $$, pas d'email tracking, pas de séquences automatisées.
- **Le resto ne peut JAMAIS exporter sa base clients** (Article 2 ter contrat). UI visualisation seule côté KB Manager.
- **KB peut partager des clients de sa base à un resto** (argument commercial). V1 partage manuel par KB Admin, V2 partage auto selon règles.
- **Personnalisations (modifiers)** dans l'édition menu = parité fonctionnelle Uber Manager. Pas de système d'upsell algorithmique en plus V1.
- **KB Admin peut éditer le menu d'un tenant sans préavis** (acté 2026-05-23, Q70-Q14). Pattern Uber Eats. En pratique KB s'auto-discipline, mais aucun garde-fou produit (pas de motif prédéfini, pas de notif obligatoire). Audit log V2 (V1 sans, cf. Q70-Q2). Le mandat KB du contrat (Article 2) suffit juridiquement.

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                                                  |
| ---------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-23 | 1.0     | Alex (via Claude) | **Création par fusion** des anciens `70_admin_backoffice_kb.md` v0.3 + `75_dashboard_resto.md` v0.1. Une seule app `KitchenBoost Admin` avec RBAC à 3 rôles. Multi-tenant per user V1 (cas Walid). Anciens fichiers : [docs/\_archive/](../_archive/). |
