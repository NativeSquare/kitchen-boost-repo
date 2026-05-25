# Specs — Outil interne KitchenBoost (wishlist)

**Statut :** Brouillon / Wishlist
**Phase cible :** Phase 2/3 (après validation terrain Phase 1)
**Pas de code pour l'instant** — on capture les besoins au fur et à mesure qu'ils émergent.

---

## Vision globale

Un outil interne unique qui centralise tout le cycle de vie d'un restaurateur KitchenBoost : de la première visite terrain à la facturation mensuelle. Il remplace le patchwork actuel (CSV CRM, dossiers `clients/`, contrats PDF générés manuellement, emails Resend, etc.) et se connecte au SaaS côté client (landing page, app de commande directe) quand il existera.

**Principe :** une source de vérité unique. Un prospect ajouté au CRM devient un client en un clic, avec tous ses docs, son contrat signé, sa marque virtuelle, ses commandes et sa facturation au même endroit.

---

## Architecture cible (à valider)

```
┌──────────────────────────────────────────────────────┐
│  Outil interne KitchenBoost (dashboard)              │
│  ┌──────────┬──────────┬──────────┬──────────┐       │
│  │ CRM      │ Clients  │ Contrats │ Facturation│     │
│  ├──────────┼──────────┼──────────┼──────────┤       │
│  │ Marketing│ Analytics│ Docs     │ Settings │       │
│  └──────────┴──────────┴──────────┴──────────┘       │
└──────────────┬───────────────────┬───────────────────┘
               │                   │
               ▼                   ▼
    ┌──────────────────┐  ┌────────────────────┐
    │ Landing publique │  │ Uber Eats Manager  │
    │ + Webapp client  │  │ (API ou scraping)  │
    └──────────────────┘  └────────────────────┘
```

---

## Modules

### 1. CRM — Prospects & Pipeline

Remplace le CSV actuel.

**Fonctionnalités souhaitées :**
- Fiche prospect complète (nom resto, adresse, tel, type cuisine, note Uber Eats, etc.)
- Pipeline kanban (pas contacté → contacté → RDV → chaud → signé / perdu)
- Timeline des interactions (visites physiques, appels, SMS, emails)
- Note libre + tags (ex: "pressé", "méfiant", "a déjà un site")
- Rappels automatiques (prochaine action planifiée → notif)
- Import depuis sources (Google Maps, Uber Eats scraping, fichier CSV)
- Filtres avancés (par ville, type cuisine, statut, score d'intérêt, note UE)
- Score de priorité automatique (basé sur note UE basse, volume estimé, proximité)
- Vue carte pour planifier une tournée physique

**Intégrations :**
- Calendrier (Google Calendar) pour les RDVs
- SMS / WhatsApp pour les relances
- Vapi (agent vocal IA) pour la Phase 2 prospection automatisée

---

### 2. Gestion clients onboardés

Remplace le dossier `clients/` actuel avec ses sous-dossiers.

**Fonctionnalités souhaitées :**
- Fiche client complète (reprend la fiche prospect + nouvelles infos post-signature)
- Upload et stockage des documents administratifs (KBIS, pièce ID, RIB, assurance RC, contrat signé)
- Gestion de la marque virtuelle (stratégie + assets + marketing regroupés) :
  - Brief (positionnement, cible, ton)
  - Logo et assets (drag & drop, versions multiples)
  - Menu complet (plats, prix, descriptions, photos)
  - Palette couleurs / typo
  - Campagnes Sponsored Listings, promos, A/B testing
  - Configuration Uber Eats Manager
- Gestion des QR codes :
  - Génération automatique, unique par client
  - Tracking (nombre de scans, conversions en commandes directes)
  - Export imprimable (PDF formats multiples : sticker, flyer A6, carte)
- Checklist de lancement automatique (suit les étapes du `README.md` template)
- Historique complet des modifications (qui a changé quoi, quand)

**Intégrations :**
- Stockage cloud (S3 / GCS)
- Signature électronique (DocuSign / YouSign) pour les contrats

---

### 3. Contrats

Remplace le `scripts/generate-contrat.tsx`.

**Fonctionnalités souhaitées :**
- Templates de contrats versionnés (pas que le contrat principal : NDA, avenants, tablette en prêt)
- Auto-remplissage depuis la fiche client (une fois signé, tout est pré-rempli)
- Génération PDF instantanée
- Signature électronique intégrée
- Historique des versions signées
- Alerte si un contrat doit être renouvelé / modifié

---

### 4. Facturation & rémunération

Critique, car c'est notre modèle économique (2€/commande).

**Fonctionnalités souhaitées :**
- Récupération automatique du nombre de commandes depuis Uber Eats Manager (API ou scraping)
- Calcul automatique de la rémunération (2€ × commandes)
- Génération de la facture hebdo (chaque lundi, comme prévu par le contrat)
- Envoi automatique au restaurateur par email
- Suivi des paiements (reçu / en attente / retard)
- Alerte à J+7 si non-payé, J+15 (suspension possible), J+30 (résiliation plein droit)
- Export comptable pour le comptable NativeSquare

**Intégrations :**
- Uber Eats Manager (lecture commandes)
- Stripe / GoCardless (prélèvement SEPA)
- Qonto / Shine (rapprochement bancaire)

---

### 5. Landing page & leads

Connexion avec la landing page publique actuelle.

**Fonctionnalités souhaitées :**
- Les formulaires "Nous contacter" arrivent directement dans le CRM comme prospects entrants
- Source tracking (où vient le lead : site direct, pub Google, social, recommandation)
- Notification en temps réel (nouveau lead → push sur mobile)
- Auto-réponse au prospect (email de confirmation)

---

### 6. SaaS client (futur)

Quand on construira l'app de commande directe pour les restaurateurs.

**Fonctionnalités souhaitées :**
- Portail restaurateur (login) pour voir :
  - Ses stats (commandes, CA, clients récupérés)
  - Ses factures KitchenBoost
  - Son QR code à télécharger / imprimer
  - Son menu / ses tarifs
- App de commande directe pour les clients finaux (landing capture + menu)
- Programme fidélité (points, offres)
- Push notifications clients

---

### 7. Analytics & reporting

Le tableau de bord qui prouve que le modèle marche.

**Fonctionnalités souhaitées :**
- Dashboard global KitchenBoost :
  - MRR / ARR
  - Nombre de clients actifs
  - Clients récupérés cumul
  - Taux de conversion prospection (visites → signatures)
  - Taux de churn
  - Cohorts (performance par mois de signature)
- Dashboard par client :
  - Commandes / mois (Uber vs direct)
  - Marge économisée (commission Uber évitée)
  - Scans QR / conversions
  - Historique des campagnes
- Rapports automatiques mensuels envoyés aux clients (preuve de valeur)
- Export Excel / PDF

---

### 8. Team & permissions

Quand Alex ne sera plus seul.

**Fonctionnalités souhaitées :**
- Multi-utilisateurs (commerciaux terrain, dev, ops)
- Rôles (admin, commercial, support)
- Attribution des prospects / clients à un commercial
- Activity feed (qui a fait quoi)

---

## Priorisation (proposition)

### MVP (Phase 2 — après 5 clients signés)
1. CRM (remplacer le CSV)
2. Gestion clients onboardés (remplacer les dossiers)
3. Génération contrats
4. Facturation basique

### V2 (Phase 3 — 20+ clients)
5. Intégration Uber Eats Manager (facturation auto)
6. Landing & leads inbound
7. Analytics de base

### V3 (scale)
7. SaaS client
8. Team & permissions

---

## Stack envisagée (à valider)

- **Frontend :** Next.js + shadcn + Tailwind (cohérent avec l'existant)
- **Backend :** Convex (temps réel, facile à scaler, parfait pour multi-modules)
- **Auth :** Clerk ou Better-Auth
- **Email :** Resend (déjà utilisé pour la landing)
- **Signature :** YouSign ou DocuSign
- **Paiement :** Stripe + GoCardless (SEPA)
- **Stockage fichiers :** Convex file storage ou S3
- **Hébergement :** Vercel

---

## Questions ouvertes à résoudre

- [ ] Uber Eats Manager a-t-il une API publique, ou faut-il scraper ?
- [ ] Est-ce qu'on fait un outil **purement interne** ou **SaaS vendu à d'autres agences** (Virtual Eats par ex.) ?
- [ ] Gestion RGPD : les données clients finaux appartiennent aux restaurateurs (contrat), comment on héberge ça proprement ?
- [ ] Facturation automatique hebdo : comment gérer le prélèvement SEPA sans friction pour le resto ?
- [ ] Est-ce qu'on intègre la prospection IA (Vapi + SMS auto) dès la V1 ou plus tard ?

---

## Log des idées qui arrivent en cours de route

_Ajouter ici toute idée qui émerge du terrain ou de conversations._

- `[2026-04-15]` Besoin d'un système de briefing rapide pour chaque client avant une visite (CRM doit pouvoir sortir une fiche "antisèche" imprimable)
- `[2026-04-15]` Idée : un QR code différent par période (changer mensuellement pour mesurer l'impact d'une nouvelle campagne)
- `[2026-04-15]` Vue "prochaine action" par date, triée, pour savoir qui rappeler aujourd'hui
