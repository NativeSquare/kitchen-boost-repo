# 90 — Base de données clients (MOAT KitchenBoost)

**Statut** : 🟡 Squelette · **Version** : 0.2 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 12](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.2** : Scope V1 étendu suite révision master v2.0. **Position géo dès V1**. **Partage manuel KB → resto dès V1** (argument commercial "on te ramène des clients"). **Multi-resto effet réseau (compte client unifié)** déplacé de V3 vers V1 (subject to PoC Stripe Customer cross-tenant Q14).

---

## ⚠️ Critique stratégique

**La base de données clients est LE MOAT de KitchenBoost.** Tout le modèle économique long terme dépend de la capacité de KB à :
1. Capter le client final dès sa première commande directe (PWA)
2. Le conserver propriété KB (verrouillé contractuellement Article 2 ter)
3. Empêcher techniquement le resto d'extraire/copier la base
4. Exploiter la base pour faire revenir le client (push marketing V2)

Toute décision produit qui touche à ce bloc doit être prise avec Alex.

---

## Scope

| Horizon | Inclus |
|---------|--------|
| **V1** | Modèle données customers global (cross-tenant), captation à chaque cmd (email + tel + prénom + adresse + **position géo lat/lng**), consentement RGPD explicite, lien customer ↔ tenant via `customer_orders_per_tenant`. **Segmentation simple V1** (actifs/inactifs/VIP). **Vue resto = KPI globaux uniquement** (PAS de liste individuelle, PAS de coordonnées, PAS d'export — décision Q90-Q2). **Anti-extraction technique stricte V1**. **Compte client unifié cross-resto** via Stripe Customer cross-tenant (subject to PoC Q14). |
| **V2** | **Campagnes via KB** (push/email/SMS — segment + template, KB envoie en proxy). **Partage manuel KB → resto** (utile uniquement quand les campagnes existent — repoussé ici). Partage auto selon règles (proximité géo, segment). Preferences opt-in granulaires avancées, droits RGPD complets opérationnels (accès/rectification/effacement/portabilité), DPO KB déclaré CNIL. |
| **V3** | Analytics LTV cross-resto, recommandations cross-resto pour le client (effet réseau), profil unifié type "Yelp privé" (sans aspect public). |

## Hors scope

- Compte unifié public type "Yelp" (pas de profil public, pas de reviews communautaires).
- Recommandations algorithmiques de plats / restos en V1.
- Marketing automation avancée (V3).
- Export brut clients pour le resto (JAMAIS — c'est le moat).

## Personas concernés

- **Client final mangeur** (sujet des données, droits RGPD)
- **Restaurateur** (visualise SES clients mais ne possède pas la data)
- **KB (responsable de traitement)** (cf. Article 2 ter contrat)

## Surface fonctionnelle (sections à remplir)

### 1. Modèle de données customers (GLOBAL, pas scopé tenant)
- Table `customers` : id, email, phone, **first_name** (V1 — `last_name` reporté V2 si besoin facturation nominative), address, **lat, lng**, created_at, **consent_marketing** (bool, V1 toujours true vu opt-in bloquant — cf. ADR 0001), **consent_transactional** (bool), **deleted_anonymized_at** (timestamp, nullable — pour droit à l'effacement Q90-Q3)
- Table `customer_orders_per_tenant` : customer_id, tenant_id, total_orders, last_order_at, ltv
- Table `push_subscriptions` : customer_id, tenant_id, endpoint, keys, created_at, active
- Table `customer_sessions` (V1) : customer_id, device_token, created_at, last_seen_at, ip (anonymisée 24h) — support **anonymous account** côté device (cf. CONTEXT customer-data)

### 2. Captation à chaque commande
- Form checkout PWA capture obligatoire : email + tel + prénom + adresse (cf. [10_pwa_client_commande.md § 6](10_pwa_client_commande.md))
- Consentement RGPD : checkbox **BLOQUANTE** au checkout V1 (cmd impossible sans cocher — cf. [ADR 0001](../adr/0001-consent-marketing-bloquant-checkout-v1.md), risque RGPD assumé). Texte précis à valider legal (Q90-Q1).
- DB sépare `consent_marketing` et `consent_transactional` (bool) — même si V1 toujours liés via UI, bascule technique préservée.
- Anti-doublon : si email/tel matche, link à customer existant ; sinon create

### 3. Vue resto : "KPI clients" (V1 — KPI globaux uniquement, pas de table)
**Décision Q90-Q2** : V1 = AUCUNE liste individuelle. Le resto voit uniquement des KPI globaux par segment + atteignabilité par canal.

- Compteurs par segment (seuils V1 figés, paramétrable resto V2) :
  - **Actif** : ≥1 cmd dans les 30 derniers jours
  - **Inactif** : 0 cmd dans les 90 derniers jours
  - **VIP** : ≥5 cmds total OU LTV ≥ 150€ (peu importe récence)
- Atteignabilité par canal : `# clients atteignables push`, `# email`, `# SMS` (cad opt-in OK et donnée présente)
- KPI macro : total clients tenant, nouveaux ce mois, taux de retour (% clients ayant ≥2 cmds)
- **PAS de prénom, PAS de coordonnées (même masquées), PAS de table individuelle, PAS d'export CSV (JAMAIS), PAS d'API publique en bulk**
- La V2 introduit les campagnes via segment (cf. § 5) — le resto sélectionne un segment + template, KB envoie en proxy. Jamais de destinataires nominatifs visibles.

### 4. Anti-extraction technique (V1 priorité critique)
- Côté front PWA admin resto :
  - Affichage paginé limité (20 clients par page max)
  - Pas de copy massive (CSS `user-select: none` sur cellules sensibles)
  - Anti-clickbot / rate limit API
  - Watermark visuel par session (dissuasion screenshot)
- Côté API :
  - Pas d'endpoint `/api/customers?tenant_id=X` retournant tout
  - Endpoint paginé avec rate limit
  - Audit log toutes les requêtes consultation
- Côté DB :
  - RLS Postgres : resto ne peut requêter QUE les clients ayant commandé chez lui via `customer_orders_per_tenant`
  - Pas de jointure cross-tenant possible

### 5. Communication client (V2 — via KB, pas direct par resto)
- Resto choisit un segment depuis l'admin ("mes clients VIP") + un template push/email
- KB envoie la campagne au nom du resto
- Resto voit les stats (envoyés / ouverts / cliqués) mais ne récupère JAMAIS les coordonnées brutes
- Cohérent avec Article 2 ter.2 : "moyens de" mais pas d'extraction

### 6. Droits RGPD (V1 partial, V2 complet)
- Droit d'accès : client peut demander ses données via lien dans email/push ou form privacy
- Droit de rectification : éditable par client dans profil PWA
- Droit d'effacement : sur demande à `privacy@kitchenboost.fr`, traité en 30j max. **Décision Q90-Q3 actée 2026-05-23 : anonymisation irréversible** (nullification email/tel/nom/adresse/lat-lng/IP sur `customers`, `orders` historiques préservées pour compta 10 ans + KPI resto). Pas de hard delete V1.
- Droit de portabilité : export JSON de ses propres données (V2)
- Droit d'opposition : opt-out marketing (V1), opt-out transactionnel impossible (besoin légal pour gérer cmds)

### 7. Sécurité & protection
- Chiffrement at-rest : DB Supabase Postgres natif (AES-256)
- Chiffrement in-transit : HTTPS partout
- Backups chiffrés
- Accès admin KB : 2FA obligatoire, audit log

### 8. Effet réseau V1 (compte multi-resto silencieux)

**Décision actée 2026-05-23** : V1 = match silencieux par email/tel. Pas de message branded "compte KB" côté client.

- Client commande chez 1er resto → captation `customer_id`.
- Client commande chez 2e resto KB → SI email/tel matche → link au même `customer_id` automatiquement. Auto-fill prénom + adresse (modifiable). PAS de consentement re-demandé (pas de bandeau "vous êtes déjà client KB").
- La **carte sauvegardée cross-resto** est découplée : V2 ou subject to PoC Stripe Customer cross-tenant (Q14 master).
- V3 = exploitation visible (recommandations, profil unifié type "Yelp privé").

## Flows nominaux

1. **Captation V1 nominal** : client commande pour la 1ère fois sur Buns & Bao → checkout → form captation → consentement RGPD coché → cmd validée → customer créé en DB + link à tenant Buns & Bao via `customer_orders_per_tenant`.
2. **Resto consulte ses KPI clients V1** : Khan se connecte à KB Admin Buns & Bao → "Mes clients" → voit uniquement des KPI globaux ("120 clients · 45 VIP · 85 atteignables push · 110 email · 70 SMS · +18 ce mois") → AUCUNE liste individuelle, AUCUNE coordonnée. Pour contacter, il devra attendre les campagnes V2 (segment → KB envoie en proxy).
3. **Campagne push V2** : Khan ouvre admin → "Campagnes" → segment "VIP Buns & Bao" → template "merci de votre fidélité, -20% sur la prochaine cmd" → preview → envoyer → KB push envoyés → Khan voit stats (CTR, conversions) mais pas les contacts bruts.

## Edge cases

- **Client demande effacement RGPD pendant cmd en cours** : on conserve les données nécessaires à la cmd (legal basis = contractuel), puis on anonymise post-livraison.
- **Client crée un 2e compte sur 2e resto KB avec email différent** : pas de lien possible automatique. V3 = matching via tel.
- **Resto résilie son contrat KB** : tenant suspended, MAIS data clients reste KB (Article 2 ter.3 contrat). Resto perd l'accès UI à "ses" clients (qui étaient en fait KB depuis le début).
- **Tentative d'extraction massive par resto** (script qui scrape l'UI) : rate limit détecte, alerte ops, possible suspension tenant + action légale (Article 2 ter contrat).
- **Bug fuite cross-tenant** : un resto voit les clients d'un autre. Critique : incident RGPD majeur + breach de la promesse moat. Tests automatisés obligatoires.
- **Push subscription après opt-out marketing** : doit être supprimée de la table push_subs.

## Critères de succès / acceptation

### V1
- [ ] 100% des commandes captent email + tel + consentement RGPD.
- [ ] 0 fuite cross-tenant (test automatisé : créer 2 tenants, customer commande chez tenant A, accès admin tenant B ne le voit pas).
- [ ] Aucune fonctionnalité d'export CSV/Excel des clients côté admin resto.
- [ ] Anti-scraping front (pas de sélection en bloc, paginé) en place.
- [ ] Audit log des consultations admin resto sur les clients.

### V2
- [ ] Push marketing campaign envoyée par resto via KB UI.
- [ ] Stats campagne visibles resto sans accès aux coordonnées brutes.
- [ ] Droits RGPD opérationnels (accès, rectification, effacement, portabilité).

### V3
- [ ] Compte multi-resto effet réseau opérationnel.

## Dépendances

| Dépendance | Type | Bloque quoi |
|------------|------|-------------|
| [10_pwa_client_commande.md](10_pwa_client_commande.md) | Interne | Captation au checkout |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md) | Interne | Modèle multi-tenant, RLS |
| [70_kb_admin.md](70_kb_admin.md) | Interne | UI consultation par KB Manager V1 + campagne V2 |
| [80_notifications.md](80_notifications.md) | Interne | Push marketing V2 |
| Article 2 ter contrat | Legal | Base juridique du moat |
| RGPD compliance | Legal | Tout |

## Open questions

| Q | Question | Deadline | Owner |
|---|----------|----------|-------|
| 90-Q1 | Texte exact consentement RGPD au checkout : à valider avec avocat ? | V1 | Alex + legal |
| ~~90-Q2~~ | ~~Tel et email visibles ou masqués en V1 dans admin resto ?~~ **ACTÉ 2026-05-23** : V1 = AUCUNE table individuelle. Vue resto = KPI globaux par segment + atteignabilité par canal (push/email/SMS). MOAT-first. Voir [[KPI clients (vue resto V1)]]. | — | — |
| ~~90-Q3~~ | ~~Effacement RGPD : full delete ou anonymisation ?~~ **ACTÉ 2026-05-23** : anonymisation irréversible (nullification perso, orders gardés). Cf. § 6 et CONTEXT customer-data. | — | — |
| 90-Q4 | Multi-resto V3 : matching auto par email/tel ou consentement explicite à chaque resto ? | V3 | Alex + legal |
| 90-Q5 | Watermark visuel anti-screenshot : suffit-il pour dissuader ou besoin de DRM-like ? | V2 | Alex |
| 90-Q6 | Resto qui demande explicitement "donnez-moi ma base clients sur USB" : process refus + escalade legal ? | V1 | Alex |
| 90-Q7 | DPO KB déclaré CNIL ? Statut. | V1 | Alex + legal |

## Notes / décisions actées

- **MOAT KB = base clients** verrouillée par Article 2 ter contrat (cf. [feedback_db_clients_moat.md](../../.claude/memory/feedback_db_clients_moat.md)).
- **Verrouillage à 3 couches** :
  1. **Juridique** : Articles 2 ter.1 (KB responsable de traitement RGPD), 2 ter.2 (resto pas de propriété, pas d'accès acquis, pas d'exploitation autonome), 2 ter.3 (titularité inchangée post-résiliation), 5.4 (pas de droit copie/extraction à la résil).
  2. **Technique** : pas d'export CSV/Excel, pas d'API publique en bulk, anti-scraping côté front, audit log, RLS DB.
  3. **Process** : si concession faite à un gros resto, c'est trade-off business majeur à discuter avec Alex avant.
- **Pitch resto** : "tu vois tes clients dans le dashboard comme si c'était ta base — mais le voir ≠ la posséder". Storytelling resto focus sur bénéfice (tu fidélises) sans dévoiler le lock-in.

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 0.1 | Alex (via Claude) | Création squelette — emphase sur le moat. |
| 2026-05-23 | 0.2 | Alex (via Claude) | Extension scope V1 : position géo, segmentation, anti-extraction, compte unifié cross-resto, partage manuel KB→resto. |
