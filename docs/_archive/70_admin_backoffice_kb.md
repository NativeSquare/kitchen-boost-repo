# 70 — Admin Back-office KitchenBoost

**Statut** : 🟡 Squelette · **Version** : 0.3 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 8](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.3** : Ajout V1 des **opérations streamlinées** — pipeline onboarding visuel par phase (A→D), CRM prospects/clients cliquable (consolide `crm_view.html` actuel), gestion contrats (script `generate_contract.py` existant + signature Odoo + tracking statut). Principe directeur : **outillage minimal pour micro équipe, pas de réinvention de l'existant**.

> **v0.2** : Scope V1 étendu suite révision master v2.0. **Wizard onboarding outillé dès V1** (vs CLI seulement en v0.1). Admin KB est désormais conceptuellement **distinct du dashboard resto** (cf. [75](75_dashboard_resto.md)) — admin KB = supervision globale tous tenants, dashboard resto = gestion par tenant par le resto.

---

## Scope

| Horizon | Inclus |
|---------|--------|
| **V1** | **Wizard création tenant** en < 30 min (form Stripe Connect, génération domain, import menu basique, génération QR sticker PDF, activation). Lister tenants + statuts intégrations. Voir cmds globales temps réel par tenant. Monitoring incidents (Slack alerts). Audit log basique. RBAC admin_kb. **Possibilité d'éditer menu d'un tenant pour assistance** (audit log obligatoire). **Partage manuel KB → resto de clients** depuis la base globale. **Pipeline onboarding visuel** (vue Kanban / liste par phase A→D, checklist par phase, liens externes pré-remplis, embed vérif Stripe KYC). **CRM prospects + clients** (cartes cliquables → page détail, search + filtres, consolidation `crm_prospects.csv` actuel). **Contrats** (génération HTML via script `generate_contract.py` existant déjà au bouton dans l'admin, lien Odoo pour signature, statut signé/en attente stocké au tenant). |
| **V2** | Multi-utilisateur KB (rôles : admin, support, dev), permissions granulaires, modération reviews, support tickets intégrés, audit log RGPD complet, dashboards Grafana par tenant, impersonation tenant pour debug. |
| **V3** | A/B testing produit, feature flags, automation onboarding (validation auto Stripe + Uber après KYC), analytics produit cross-tenant. |

## Hors scope

- CRM client (les clients sont propriété KB mais l'exploitation marketing se fait via les outils du resto — cf. [90](90_donnees_clients_crm.md)).
- Facturation back-office (V1 = facture mensuelle Uber Eats Prestation A manuelle ; V2 = facturation auto).
- Outils marketing internes KB (pubs, SEO) — ce sont d'autres outils.

## Personas concernés

- **Admin KB interne** (Alex en V1, équipe ops/support en V2+)
- **Dev / SRE KB** (debugging, monitoring)

## Surface fonctionnelle (sections à remplir)

### 1. Auth admin
- Login email + password + 2FA (V1)
- Audit log de chaque action admin (V2)

### 2. Liste tenants (V1)
- Table : slug, nom, status (active/pending/suspended), statut Stripe, statut Uber, dernière cmd, CA mensuel
- Filtres : par status, par mois actif
- Recherche par nom / slug
- Lien vers détail tenant

### 3. Détail tenant (V1)
- Infos : nom, SIRET, adresse, contact
- Statuts intégrations : Stripe (account_id, KYC, soldes), Uber Direct (customer_id, dernière course), Hubrise (V2)
- Liste cmds récentes
- Bouton "suspendre" / "réactiver"
- Logs / audit trail

### 4. Wizard création tenant (V1)
- Step 1 : infos resto (nom, SIRET, adresse, contact)
- Step 2 : générer slug, vérifier dispo
- Step 3 : config domain (sous-domaine KB ou custom CNAME)
- Step 4 : générer lien Stripe Connect et envoyer (email/WhatsApp)
- Step 5 : upload logo + couleur primaire
- Step 6 : import menu (CSV ou parse Uber Eats Manager screenshot — V2)
- Step 7 : générer QR sticker PDF imprimable (template)
- Step 8 : activer tenant
- Total < 30 min

### 4 bis. Pipeline onboarding visuel (V1) — opérations streamlinées

Le pipeline matérialise les phases du process onboarding ([reference_onboarding_resto.md](../../.claude/memory/reference_onboarding_resto.md) + `project_onboarding_process.md`) : **A Approche → B Closing → B+ Préparation menu offline → C Kickoff → D Opérationnel**. Chaque resto (prospect ou tenant signé) a une position dans le pipeline.

- **Vue Kanban** : 5 colonnes (A / B / B+ / C / D), cartes drag & droppable, compteurs par phase
- **Vue liste** alternative avec filtre par phase + recherche
- **Détail par resto** : checklist par phase avec items cochables. Ex Phase B+ :
  - [ ] Contrat signé physique récupéré
  - [ ] 3 docs Uber récoltés (KBIS + pièce d'identité + RIB)
  - [ ] Canal de comm direct testé (WhatsApp)
  - [ ] Liste articles initiale obtenue
  - [ ] Prix net cible validé sur items hero
  - [ ] Photos emballages existants récupérées
- **Liens externes pré-remplis** (un-click selon contexte) :
  - Stripe Connect onboarding link (généré + envoyé via copy-paste)
  - Lien Odoo signature contrat
  - Direct.uber.com (avec instructions copy-paste pour le resto)
  - WhatsApp deep-link `wa.me/<num>` vers le numéro du resto
- **Embed Stripe vérif KYC** (si simple via Stripe Dashboard widget ou API `account.retrieve`) : statut en temps réel (`pending` / `verified` / `rejected`) directement dans la card, pas besoin d'ouvrir Stripe Dashboard
- **Gate B → B+ enforcement** : si tentative de passage phase B → B+ sans checklist complète, prompt de confirmation (peut être bypassé mais loggé)

Principe : **réduire les opérations à 1 page**, pas de navigation entre 5 outils différents pour chaque resto.

### 4 ter. CRM prospects + clients (V1)

Consolide l'actuel `crm_prospects.csv` + `crm_view.html` en une UI persistante (vs HTML statique régénéré).

- **Vue cartes** (équivalent visuel de `crm_view.html` actuel) : chaque resto = une carte (nom, statut, phase, dernière interaction, score)
- **Click sur carte → page détail resto** (cf. § 3 Détail tenant)
- **Search** par nom / slug / SIRET / téléphone
- **Filtres** : phase pipeline, source (cold call / referral / inbound), statut (prospect / signé / actif / churned)
- **Onglets** : Prospects (pas encore signé) | Clients (tenant signé actif) | Tous
- **CRUD léger** : ajouter prospect manuellement, log interaction (note + date + canal), changer de phase
- **Pas de CRM full-featured** (pas de pipeline opportunities $$, pas d'email tracking auto, pas de séquences automatisées) — c'est intentionnel V1

### 4 quater. Gestion contrats (V1)

S'appuie sur l'outillage existant — **pas de réimplémentation**.

- **Bouton "Générer contrat"** sur la page détail resto (depuis phase A ou B)
- **Inputs pré-remplis** depuis la fiche resto : raison sociale, SIRET, adresse, email, représentant
- **Sélecteur prestation** : A seul / B seul / A&B (cf. [contrat_template.md](../legal/contrat_template.md))
- **Backend appelle `tools/generate_contract.py`** avec les bons params CLI, output HTML stocké
- **Bouton "Envoyer pour signature"** → upload sur Odoo (manuel V1, intégration API V2), génère le lien de signature
- **Statut stocké** au tenant : `draft` / `sent` / `signed` / `expired`, daté
- **Webhook Odoo** (si dispo) ou check manuel pour passer en `signed`
- **Fichier PDF signé** stocké lié au tenant (Odoo storage ou bucket KB, à voir Q70-Q9)
- Pas de signature dans KB direct (toujours Odoo, qui sait le faire)

### 5. Édition menu tenant (V2)
- Catégories, items, modifiers, prix
- Upload photos items
- Disponibilité (out of stock toggle)
- Versioning (rollback possible)

### 6. Modération reviews (V2)
- Reviews négatives flaggées par PWA (cf. [10_pwa_client_commande.md](10_pwa_client_commande.md) reviews gating)
- Workflow : assigner support, contacter client, résoudre, archiver
- SLA : < 24h

### 7. Gestion utilisateurs tenant (V2)
- Inviter utilisateur (gérant, cuisinier) par email
- Rôles : owner / staff (KDS only)
- Reset password

### 8. Statistiques opérationnelles (V2 basique, V3 avancé)
- KPIs KB global : nb tenants, nb cmds/jour, CA total, taux incidents
- Par tenant : CA / mois, panier moyen, top items, heures de pointe
- Comparatif direct vs Uber Eats (avec Hubrise V2)

### 9. Audit log (V2)
- Qui a fait quoi quand (qui a modifié menu, suspendu tenant, refund manuel, etc.)
- Conservation 3 ans (RGPD)
- Recherche / filtre

### 10. Monitoring incidents (V1 basique)
- Dashboard : statut Stripe / Uber / Vercel / DB
- Alertes Slack ops sur :
  - Webhook Stripe latence > 30s
  - Webhook Uber latence > 30s
  - Erreur 5xx récurrente (3+ en 5 min)
  - Tenant en KYC pending > 48h
  - Cmd payée sans course Uber créée

## Flows nominaux

1. **V1 : Alex onboarde un nouveau resto, end-to-end depuis l'admin** : Alex ajoute un prospect dans le CRM (nom, tel, source = "cold call Malakoff") → phase A → relance / RDV physique → phase B (closing physique) → bouton "Générer contrat" → preview HTML → "Envoyer Odoo" → lien signature envoyé au resto → resto signe → webhook Odoo → statut `signed` → phase B+ (checklist préparation menu : photos emballages, docs Uber, etc.) → quand checklist OK, "Lancer Wizard tenant" → 8 steps → tenant actif → phase C (kickoff install physique) → phase D (opérationnel). **Une seule UI**, tout tracké, ~30 min de saisie cumulée sur les semaines.
2. **V1 : Alex vérifie le KYC Stripe d'un resto en pending** : ouvre admin → carte du resto (CRM) → click → page détail → bloc Stripe affiche statut KYC en temps réel via embed → si pending depuis 48h, badge alerte rouge, action "Relancer le resto via WhatsApp" en un clic.
3. **V1 : incident webhook Stripe** : alerte Slack → Alex ouvre admin → voit tenant impacté → vérifie logs Sentry → identifie cause → fix manuel.
4. **V2 : edit menu** : resto demande à Alex de modifier un prix → Alex ouvre admin → edit item → save → propagé en PWA en < 30 sec.

## Edge cases

- **Tenant suspendu** : PWA affiche "service indisponible", KDS inaccessible.
- **Action admin = drop données** : confirmation à 2 étapes (V1 : pas autorisé, contacter dev).
- **Multi-utilisateur en édition concurrente** (V2) : optimistic locking, message si conflit.
- **Tenant supprimé par erreur** : V2 soft delete + restauration 30j.

## Critères de succès / acceptation

### V1
- [ ] Alex peut voir tous les tenants et leurs statuts en < 5 sec.
- [ ] Alerte Slack < 30 sec après un incident webhook.
- [ ] Audit log de base (qui s'est connecté, qui a suspendu un tenant).
- [ ] Pipeline onboarding visuel opérationnel : un nouveau resto est trackable de A à D depuis 1 seule UI.
- [ ] Checklist phase B+ enforced (alerte si tentative passage sans complétude).
- [ ] CRM cliquable : 1 click sur une carte → page détail resto.
- [ ] Bouton "Générer contrat" produit le HTML attendu (équivalent CLI `generate_contract.py`) en < 5 sec.
- [ ] Statut signature contrat (`draft`/`sent`/`signed`/`expired`) visible et à jour sur la page détail.
- [ ] Embed Stripe KYC affiche le statut en temps réel sans quitter l'admin.
- [ ] Wizard création tenant en < 30 min (déplacé de V2).

### V2
- [ ] Import menu CSV opérationnel.
- [ ] Edit menu propagé en PWA en < 30 sec.
- [ ] Intégration API Odoo (envoi contrat + webhook signature) sans étape manuelle.

## Dépendances

| Dépendance | Type | Bloque quoi |
|------------|------|-------------|
| Tous les sous-PRDs | Interne | Sources de données monitorées |
| Slack API | Externe | Alertes |
| Sentry | Externe | Erreurs |
| UptimeRobot | Externe | Uptime checks |
| `tools/generate_contract.py` existant | Interne | Bouton "Générer contrat" (intégration directe, pas réécriture) |
| `tools/build_crm_html.py` + `crm_prospects.csv` actuels | Interne | Données source migrées en DB lors du build V1 |
| Odoo (signature contrat) | Externe | Statut `signed`, upload PDF signé |
| Stripe API (`account.retrieve`) ou widget | Externe | Embed vérif KYC en temps réel |
| WhatsApp deep-link (`wa.me/`) | Externe | Contact resto en 1 clic depuis CRM |

## Open questions

| Q | Question | Deadline | Owner |
|---|----------|----------|-------|
| 70-Q1 | Stack admin : Retool / Forest Admin / build custom Next.js ? Impact : Retool = très rapide à monter (jours) mais lock-in, custom = plus de contrôle mais plus long. À trancher tôt vu micro équipe. | V1 S0 | Dev lead |
| 70-Q2 | Niveau d'audit trail V1 : juste actions critiques ou tout ? | V1 | Alex (RGPD) |
| 70-Q3 | Multi-utilisateur KB admin : V1 ou V2 (Alex seul OK V1) ? | V1 | Alex |
| 70-Q4 | Permissions granulaires (qui peut suspendre tenant, qui peut edit menu) ? | V2 | Alex |
| 70-Q5 | Import menu Uber Eats Manager : screenshot parser OCR ou manual ? | V2 | Produit |
| 70-Q6 | Embed Stripe KYC : via `account.retrieve` API polling, ou via Stripe.js Connect Embedded Components (officiel mais peut être lourd) ? Si lourd, juste un statut en DB mis à jour par webhook suffit. | V1 S1 | Dev lead |
| 70-Q7 | Migration `crm_prospects.csv` → DB : one-shot script au build admin, ou import à la demande ? | V1 S0 | Dev lead |
| 70-Q8 | Webhook Odoo dispo pour mettre à jour `signed` automatiquement, ou check manuel/script V1 ? | V1 | Alex (call Odoo support) |
| 70-Q9 | Stockage PDF signé : Odoo (référence URL stockée KB) ou bucket KB (upload depuis Odoo) ? Trade-off : Odoo source de vérité vs accès rapide. | V1 | Alex |
| 70-Q10 | Pipeline phases : strict (gates obligatoires) ou indicatif (bypass loggé) ? Recommandé : indicatif V1 (la rigidité ralentit la micro équipe). | V1 | Alex |
| 70-Q11 | Source de vérité pipeline : CRM admin (DB) ou `project_onboarding_process.md` ? Le doc Markdown reste process narratif, l'admin reflète l'état opérationnel par resto. | V1 | Alex |

## Notes / décisions actées

- **V1 = streamliné pour micro équipe** : pipeline onboarding visuel + CRM + contrats + wizard tenant, le tout dans une seule UI. Pas de réinvention — les outils existants (`generate_contract.py`, `build_crm_html.py`) sont **embarqués**, pas réécrits.
- **Signature contrat = toujours Odoo**. Pas de DocuSign-like dans KB. Odoo fait ce job, on ne le refait pas.
- **CRM volontairement minimaliste**. Pas de pipeline opportunités $$, pas d'email tracking, pas de séquences automatisées. Si besoin scale → V2 ou outil tiers (HubSpot, Pipedrive).
- **V2 = enrichissement** (multi-utilisateur, edit menu, support reviews, Odoo API automatique).
- **V3 = équipe scale** (permissions granulaires, feature flags).

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 0.1 | Alex (via Claude) | Création squelette. |
| 2026-05-23 | 0.2 | Alex (via Claude) | Extension V1 : wizard onboarding outillé V1, partage clients KB→resto V1. Séparation conceptuelle vs [75 Dashboard Resto](75_dashboard_resto.md). |
| 2026-05-23 | 0.3 | Alex (via Claude) | Ajout V1 : pipeline onboarding visuel par phase A→D, CRM prospects/clients cliquable, gestion contrats (script existant + Odoo signature). Principe : pas de réinvention, outillage minimal pour micro équipe. |
