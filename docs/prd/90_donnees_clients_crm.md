# 90 — Base de données clients (MOAT KitchenBoost)

**Statut** : 🟡 Squelette · **Version** : 0.3 · **Dernière mise à jour** : 2026-05-25
**Lié au master** : [00_master.md § 5 bloc 12](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.3 (réconciliation 2026-05-25, grilling chantier 2.1)** : aligné sur les décisions actées plus récentes — consentement par **clic Payer** ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md), supersede la checkbox [ADR 0001](../adr/0001-consent-marketing-bloquant-checkout-v1.md)), identité **cookie device only** sans match email/tel ([ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md)), isolation **applicative Convex** sans RLS Postgres ([ADR 0010](../adr/0010-isolation-multi-tenant-convex-applicative.md)), inscription push stockée ici ([ADR 0012](../adr/0012-push-enrollment-identite-customer-data-envoi-notifications.md)). Les mentions périmées « checkbox / consent_marketing bool / match email-tel / RLS Postgres / Supabase » ci-dessous sont corrigées dans le corps.
>
> **v0.2** : Scope V1 étendu suite révision master v2.0. **Position géo dès V1**. **Partage manuel KB → resto** repoussé V2. **Multi-resto effet réseau** = cookie device + carte Wallet (cf. v0.3).

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

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | Modèle données customers global (cross-tenant), captation à chaque cmd (email + tel + prénom + adresse + **position géo lat/lng**), consentement RGPD explicite, lien customer ↔ tenant via `customer_orders_per_tenant`. **Segmentation simple V1** (actifs/inactifs/VIP). **Vue resto = KPI globaux uniquement** (PAS de liste individuelle, PAS de coordonnées, PAS d'export — décision Q90-Q2). **Anti-extraction technique stricte V1**. **Compte client unifié cross-resto** via Stripe Customer cross-tenant (subject to PoC Q14). |
| **V2**  | **Campagnes via KB** (push/email/SMS — segment + template, KB envoie en proxy). **Partage manuel KB → resto** (utile uniquement quand les campagnes existent — repoussé ici). Partage auto selon règles (proximité géo, segment). Preferences opt-in granulaires avancées, droits RGPD complets opérationnels (accès/rectification/effacement/portabilité), DPO KB déclaré CNIL.                                                                                                                                                          |
| **V3**  | Analytics LTV cross-resto, recommandations cross-resto pour le client (effet réseau), profil unifié type "Yelp privé" (sans aspect public).                                                                                                                                                                                                                                                                                                                                                                                               |

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

> Noms de champs indicatifs (schéma Convex réel en camelCase). **Le customer = un user anonyme Convex Auth** (`users`, `isAnonymous=true`, rôle global `customer`) + une fiche `customers` (FK `userId`). Le cookie de session Convex EST le « cookie device » de l'[ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md).

- Table `customers` (GLOBALE, sans `tenantId`, FK `userId → users`) : `email`, `phone`, **`firstName`** (V1 ; nom de famille reporté V2), `address`, **`lat`, `lng`**, `cgvAcceptedAt`, `cgvVersionHash` ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md)), `marketingOptOutDate?`, `anonymizedAt?` (droit à l'effacement), `createdAt`, `lastCheckoutAt?`. **Pas de contrainte unique email/phone** (doublons cross-device assumés, [ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md)). **Pas de booléens `consent_marketing`/`consent_transactional`** (supersedé par [ADR 0007](../adr/0007-consentement-clic-payer-v1.md)). Pas de date d'anniversaire V1.
- Table `cgvVersions` : `wording`, `hash` (SHA-256), `activatedAt`, `endedAt?` — archive horodatée pour prouver à la CNIL quelle version a été acceptée.
- Table de lien `customerOrdersPerTenant` : `customerId`, `tenantId`, `totalOrders`, `lastOrderAt`, `ltv` — **écrite par le chantier 2.3 (commandes)**, lue ici pour segments/KPI.
- **Inscription push** rattachée au customer ([ADR 0012](../adr/0012-push-enrollment-identite-customer-data-envoi-notifications.md)) : n° série carte Wallet (= pont d'identité cross-device), id abonnement web-push, statut d'inscription par canal. Le _credential d'envoi_ web-push (clés) relève des Notifications (2.7).
- Table `customerSessions` **conditionnelle** (POC #4, [STACK §2.9](../contexts/_architecture/STACK.md)) : uniquement si l'adapter Convex Auth Anonymous ne supporte pas le cookie `Domain=.kitchen-boost.fr` ; sinon on réutilise la session Convex native.

### 2. Captation à chaque commande

- Form checkout PWA capture obligatoire : email + tel + prénom + adresse + position géo (cf. [10_pwa_client_commande.md § 6](10_pwa_client_commande.md)).
- **Consentement par clic sur « Payer »** ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md), supersede l'ancienne checkbox bloquante [ADR 0001](../adr/0001-consent-marketing-bloquant-checkout-v1.md)) : pas de case à cocher ; phrase lisible sous le bouton « Payer » ; le clic enregistre `cgvAcceptedAt` + `cgvVersionHash`. **Un seul texte CGV standard KB** en V1 (sur-mesure resto = V2). Texte juridique exact = Q90-Q1 (legal).
- **Pas de booléens `consent_marketing`/`consent_transactional` séparés** ; l'éligibilité marketing se calcule via `marketing_eligible(customerId)` + re-consentement par achat ([ADR 0005](../adr/0005-re-consentement-marketing-par-achat.md)).
- **Pas d'anti-doublon par email/tel** ([ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md)) : reconnaissance via cookie device (même device) + carte Wallet (cross-device). Nouveau device sans pass = nouvelle fiche (doublon assumé).

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
- Côté backend (isolation **applicative** Convex, [ADR 0010](../adr/0010-isolation-multi-tenant-convex-applicative.md) — **pas de RLS Postgres**) :
  - Aucune query exposée ne renvoie d'objet `customer` brut au rôle `kb_manager` — uniquement des **KPI agrégés** (cf. § 3). Seules `customerQuery` (self) et `kbAdminQuery` (root) renvoient une fiche.
  - La table `customers` est globale ; atteignable uniquement via ces wrappers sanctionnés (jamais `ctx.db.query` brut en code métier). Test fuzz cross-tenant de garde obligatoire.

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

- Chiffrement at-rest : **Convex** (chiffrement plateforme). Secrets per-tenant (Uber Direct) = envelope encryption maison (brique foundation `lib/crypto`). Pas de Postgres/Supabase.
- Chiffrement in-transit : HTTPS partout
- Backups chiffrés
- Accès admin KB : 2FA obligatoire, audit log

### 8. Effet réseau V1 (compte multi-resto)

**Révisé 2026-05-24 ([ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md))** : V1 = reconnaissance par **cookie device** (PAS de match email/tel). Pas de message brandé « compte KB » côté client.

- Client commande chez 1er resto → création `customer` (user anonyme).
- Client revient chez un 2e resto KB **depuis le même device** → le cookie device (partagé sur le domaine parent) reconnaît le même `customer` → auto-fill prénom + adresse. Pas de prompt « tu es déjà client ? ».
- Client sur un **autre device** → reconnu **uniquement** s'il a installé la carte Wallet (pont `serial → customer`) ; sinon nouvelle fiche (doublon cross-device assumé ~10 %).
- **Pas de match serveur email/tel V1, pas d'OTP** (sécurité CB cross-tenant). Carte CB réutilisable cross-resto via Stripe Customer cross-tenant (chantier 2.5, subject to PoC).
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

| Dépendance                                             | Type    | Bloque quoi                                     |
| ------------------------------------------------------ | ------- | ----------------------------------------------- |
| [10_pwa_client_commande.md](10_pwa_client_commande.md) | Interne | Captation au checkout                           |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)     | Interne | Modèle multi-tenant, RLS                        |
| [70_kb_admin.md](70_kb_admin.md)                       | Interne | UI consultation par KB Manager V1 + campagne V2 |
| [80_notifications.md](80_notifications.md)             | Interne | Push marketing V2                               |
| Article 2 ter contrat                                  | Legal   | Base juridique du moat                          |
| RGPD compliance                                        | Legal   | Tout                                            |

## Open questions

| Q         | Question                                                                                                                                                                                                                                              | Deadline | Owner        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| 90-Q1     | Texte exact consentement RGPD au checkout : à valider avec avocat ?                                                                                                                                                                                   | V1       | Alex + legal |
| ~~90-Q2~~ | ~~Tel et email visibles ou masqués en V1 dans admin resto ?~~ **ACTÉ 2026-05-23** : V1 = AUCUNE table individuelle. Vue resto = KPI globaux par segment + atteignabilité par canal (push/email/SMS). MOAT-first. Voir [[KPI clients (vue resto V1)]]. | —        | —            |
| ~~90-Q3~~ | ~~Effacement RGPD : full delete ou anonymisation ?~~ **ACTÉ 2026-05-23** : anonymisation irréversible (nullification perso, orders gardés). Cf. § 6 et CONTEXT customer-data.                                                                         | —        | —            |
| 90-Q4     | Multi-resto V3 : matching auto par email/tel ou consentement explicite à chaque resto ?                                                                                                                                                               | V3       | Alex + legal |
| 90-Q5     | Watermark visuel anti-screenshot : suffit-il pour dissuader ou besoin de DRM-like ?                                                                                                                                                                   | V2       | Alex         |
| 90-Q6     | Resto qui demande explicitement "donnez-moi ma base clients sur USB" : process refus + escalade legal ?                                                                                                                                               | V1       | Alex         |
| 90-Q7     | DPO KB déclaré CNIL ? Statut.                                                                                                                                                                                                                         | V1       | Alex + legal |

## Notes / décisions actées

- **MOAT KB = base clients** verrouillée par Article 2 ter contrat (cf. [feedback_db_clients_moat.md](../../.claude/memory/feedback_db_clients_moat.md)).
- **Verrouillage à 3 couches** :
  1. **Juridique** : Articles 2 ter.1 (KB responsable de traitement RGPD), 2 ter.2 (resto pas de propriété, pas d'accès acquis, pas d'exploitation autonome), 2 ter.3 (titularité inchangée post-résiliation), 5.4 (pas de droit copie/extraction à la résil).
  2. **Technique** : pas d'export CSV/Excel, pas d'API publique en bulk, anti-scraping côté front, audit log, RLS DB.
  3. **Process** : si concession faite à un gros resto, c'est trade-off business majeur à discuter avec Alex avant.
- **Pitch resto** : "tu vois tes clients dans le dashboard comme si c'était ta base — mais le voir ≠ la posséder". Storytelling resto focus sur bénéfice (tu fidélises) sans dévoiler le lock-in.

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création squelette — emphase sur le moat.                                                                                                                                                                                                                                                                                                                           |
| 2026-05-23 | 0.2     | Alex (via Claude) | Extension scope V1 : position géo, segmentation, anti-extraction, compte unifié cross-resto, partage manuel KB→resto.                                                                                                                                                                                                                                               |
| 2026-05-25 | 0.3     | Alex (via Claude) | Réconciliation grilling 2.1 : consentement clic-Payer (ADR 0007), identité cookie-device sans match email/tel (ADR 0008), isolation applicative Convex sans RLS (ADR 0010), inscription push stockée ici (ADR 0012), customer = user anonyme Convex + cgvVersions. Suppression des mentions périmées (checkbox, bools consent, Supabase Postgres, match email/tel). |
