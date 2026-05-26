# Customer Data

Le **MOAT** KitchenBoost. La base clients finaux est globale (cross-tenant), responsable de traitement RGPD = KB. Le resto consulte, ne possède pas. Verrou triple : juridique (Article 2 ter contrat) + technique (anti-extraction) + process. Toute décision produit qui touche ce contexte se prend avec Alex.

PRD : [90_donnees_clients_crm.md](../../prd/90_donnees_clients_crm.md)

## Language

**Customer** (KB) :
Cf. [CONTEXT-MAP shared types](../../../CONTEXT-MAP.md#shared-types-vocabulaire-transverse). Un client final mangeur, identifié au checkout par email + tel + position géo (lat/lng) + prénom + adresse. Identité **globale cross-tenant** côté schéma DB (table sans `tenant_id`). **Identité unifiée en V1 = device-scopée uniquement** (cf. [[Identité Customer V1]] + [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md)). Liaison aux tenants via `customer_orders_per_tenant`.
_Avoid_: User, Mangeur (FR informel), End-customer

**Identité Customer V1** (matching) :
**Décision actée 2026-05-24** : la fonction d'unification d'identité repose sur **2 layers V1**, dans cet ordre :

1. **Cookie HttpOnly persistent device** (1 an, refresh à chaque visite) — pose un `customer_id` à la première arrivée sur la PWA d'un resto. **Portée intra-resto uniquement** : chaque resto a son propre domaine de marque (ex. `bunsbao.fr`), donc le cookie reconnaît le retour **sur le même resto**, jamais cross-resto (domaines cloisonnés ; cf. [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md) Amendement 2026-05-25).
2. **Liaison [[Wallet pass]]** (cf. [ADR 0003](../../adr/0003-wallet-pass-commun-marque-neutre.md)) — `serial_number` du pass lié au `customer_id` côté backend → **seule surface cross-resto** : suit la personne cross-device ET cross-resto si elle a installé le pass.

**Pas de match serveur sur email/tel cross-device V1** (cf. [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md)) — Sophie qui commande depuis 2 devices distincts sans Wallet pass = 2 `customer_id` distincts. Doublon assumé. **Pas d'OTP V1**.

Raison principale : sécurité [[Stripe Customer (cross-tenant)]] / `clone PaymentMethod` — un match cross-device sur email+tel sans OTP exposerait la CB cross-tenant à quiconque connaît email+tel.
_Avoid_: Cross-device match, Customer dedup, Email-based dedup

**Re-engagement channel** (Canal de recontact) :
Mécanisme par lequel KB peut recontacter un client après une visite. **4 canaux V1** : (1) Email (cross-tenant via `customer_id` global, obligatoire au checkout, consent*marketing bloquant), (2) SMS (cross-tenant, V2 — coût à provisionner), (3) Push Wallet (scopé tenant via pass installé), (4) Push Web PWA (scopé domaine tenant via permission ou A2HS). **Règle d'or V1 acté 2026-05-24** : *tout client qui valide une cmd sur une PWA KB doit avoir au moins UN canal [[Push enrollment]] actif (Wallet pass OU Web Push OU A2HS) + Email + Tel capturés. Sans push enrollment, pas de validation cmd possible (bouton "Payer" bloqué)._ Zero touch = jamais possible côté UX V1.
\_Avoid_: Touchpoint, Channel (acceptable EN)

**Push enrollment** :
Action explicite du client pour autoriser KB à lui pousser des notifs. **3 mécanismes V1** : Add to Wallet (2 taps), Allow notifications browser (1 tap, Android sans A2HS), A2HS install (1-4 taps selon plateforme). Maximiser le push enrollment = objectif V1 prioritaire pour construire le [[Lock-screen reach]]. Pas bloquant techniquement (cohérent UX conversion), mais wording incentif fort + [[Incentive Wallet]] paramétrée par le resto.
_Avoid_: Push opt-in (acceptable), Subscription, Install

**Lock-screen reach** :
Capacité de toucher le client sur l'écran de verrouillage de son device. **Push Wallet (oui), Push Web post-permission (oui), Email/SMS (non, va dans l'inbox)**. C'est le canal le plus efficace en taux d'ouverture (85-99% Wallet, 40-60% Web Push) vs Email (15-20%). V1 KB cherche à maximiser le lock-screen reach via [[Push enrollment]] Wallet+PWA.
_Avoid_: Push reach

**Cross-tenant reach** :
Capacité de pousser à un client d'un tenant via un autre tenant. **V1 = scopé canal** (révision 2026-05-24 suite décision carte Wallet commune) :

- **Email / SMS = cross-tenant possible** (scopé `customer_id` global, couvert par consent_marketing KB = responsable de traitement RGPD Article 2 ter)
- **Push Wallet commun = cross-tenant possible** (1 pass = N restos KB, channel unique géré par KB côté serveur — c'est le mécanisme primaire du moat consumer-side)
- **Push Web PWA = scopé domaine tenant** (permission web push attachée à origin = le domaine du resto, ex. `bunsbao.fr`, pas de bypass possible — sécurité navigateur). Reach limité au tenant correspondant.

Conséquence stratégique : **l'effet réseau cross-tenant V1 est ancré sur la carte Wallet** (cf. [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md) Amendement 2026-05-25). Une fois le client porteur du pass commun : identité unifiée cross-resto + push lock-screen cross-tenant + (CB partagée via Stripe Customer cross-tenant, chantier 2.5). KB peut alors pousser "Nouveau resto à 5 min de chez toi" à ses porteurs de pass du quartier dès l'onboarding d'un nouveau resto. **Pour les clients sans pass, chaque resto reste une île** (cookie intra-resto, domaines distincts) → maximiser l'enrôlement Wallet est LE levier du moat consumer-side.
_Avoid_: Cross-resto push, Network push

**Anonymous account (V1)** :
Pattern type Firebase Anonymous Auth / Spotify : à la première arrivée sur la PWA, on crée silencieusement un `customer_id` et un **token persistant côté device** (cookie HttpOnly long-lived 1 an) — pas de password, pas d'écran "créer un compte", pas de friction. Reconnaissance silencieuse à la session suivante **sur le même device**. **Cross-device V1 = uniquement via [[Wallet pass]] installé** (cf. [[Identité Customer V1]] + [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md)) ; sans pass installé, un nouveau device = un nouveau `customer_id`. **Canaux push V1 dual** (cf. [[Wallet pass]] dans [[Client Ordering]]) : (1) Apple/Google Wallet pass = primary moat, 2 taps install, push lock-screen 85-99% open rate, sert AUSSI de bridge cross-device pour l'identité ; (2) A2HS PWA = bonus, requis pour push web iOS 16.4+, scopé device. Le client n'a pas conscience d'avoir un compte — il est techniquement identifié sur son device (et cross-device s'il a le pass).
_Avoid_: Login, Sign-up, Authentification client (pas avant V2/V3)

**Table customers (GLOBAL)** :
Table `customers` SANS `tenant_id`. Exception explicite au principe [[Multi-Tenant]]. La GLOBALITÉ est le MOAT — un client qui commande chez 2 restos KB est le **même** record customer. Liaison via `customer_orders_per_tenant` (customer*id × tenant_id × stats).
\_Avoid*: Customers global, Shared customers

**customer_orders_per_tenant** :
Table de liaison N-N entre `customers` et `tenants`. Colonnes : customer*id, tenant_id, total_orders, last_order_at, ltv. C'est par cette table que [[KB Admin]] filtre "mes clients" via RLS.
\_Avoid*: Customer-tenant, Membership

**Position géo** (lat/lng) :
Latitude + longitude captées **dès l'entrée sur la PWA (avant accès au menu, cf. [[Address-first flow]] côté [[Delivery]])**, **obligatoirement** via Google Places autocomplete (saisie libre interdite V1, cf. décision actée 2026-05-23, parcours d'entrée acté 2026-05-24). Garantit format normalisé + fiabilité Uber Direct + déclenchement immédiat du [[Quote]] de livraison. Utilisées pour : (a) [[Pricing]] condition de distance (V2 — retirée V1), (b) partage KB → resto V2 selon proximité, (c) segmentation géo future, (d) déclenchement quote Uber Direct dès l'entrée PWA.
_Avoid_: Coordinates (acceptable), GPS (technique), Adresse libre

**Consentement par clic sur Payer** :
**Décision actée 2026-05-24** : V1 = pas de checkbox de consentement au checkout PWA. Le bouton final affiche `Payer <X €>` (ou `Commander`). Sous le bouton, phrase non-cliquable lisible (≥ 12 px) : _"En cliquant sur Payer, tu acceptes les CGV de **\<Resto\>** et le service de fidélité **\<Marque KB\>** (carte commune + offres réseau). Tu peux te désinscrire à tout moment via le lien dans chaque message ; ta prochaine commande vaut nouvelle acceptation."_ Le clic sur "Payer" enregistre `cgv_accepted_at` (timestamp) + `cgv_version_hash` (hash SHA-256 du wording CGV actif). Plus de séparation DB `consent_marketing` / `consent_transactional` (supersedé par [ADR 0007](../../adr/0007-consentement-clic-payer-v1.md)). Pattern Uber Eats / Deliveroo / Stripe Checkout. Logique [[marketing_eligible]] : `last_checkout_date > marketing_opt_out_date` (cf. [ADR 0005](../../adr/0005-re-consentement-marketing-par-achat.md)).
_Avoid_: Checkbox consent, Opt-in (terme [[Notifications]] séparé), Consent (anglicisme), Case à cocher

**Archivage CGV horodaté** :
Chaque version du wording CGV est conservée en archive avec son hash SHA-256 + date d'activation + date de fin éventuelle. Permet de prouver en cas d'audit CNIL **quelle version exacte** a été acceptée par chaque client (via le `cgv_version_hash` stocké sur la row customer). Conservation minimale : durée de vie du customer + 10 ans (alignement obligation comptable, cf. [[Effacement RGPD = anonymisation irréversible]]).
_Avoid_: Versioning CGV (acceptable), CGU archive, Terms history

**marketing_eligible(customer_id)** :
Fonction métier utilisée par le [[Moteur Notifications]] (cf. [[Notifications]]) pour décider si un client peut recevoir une [[Campagne]] marketing. **Règle V1** : `cgv_accepted_at IS NOT NULL AND (marketing_opt_out_date IS NULL OR last_checkout_date > marketing_opt_out_date)`. Couvre le pattern "re-consentement par achat" acté [ADR 0005](../../adr/0005-re-consentement-marketing-par-achat.md) : un client qui unsubscribe puis recommande est automatiquement re-éligible. Les [[Push transactionnel]] ignorent cette fonction (base contractuelle, toujours actifs).
_Avoid_: Can_send_marketing, Is_opted_in

**Anti-extraction** :
Couche technique qui empêche le resto d'aspirer la base : pas d'export CSV (V1 sans exception JAMAIS), pas d'API publique bulk, pagination max 20/page, `user-select: none` sur cellules sensibles, watermark visuel par session, rate limit + audit log, RLS DB.
_Avoid_: Lock-in (terme business), Anti-scraping

**KPI clients (vue resto V1)** :
La vue "Mes clients" côté [[KB Admin]] (rôle KB Manager) en V1 n'expose **AUCUNE liste individuelle** — uniquement des KPI globaux par segment + le nombre de clients atteignables par canal (push / email / SMS). Le resto voit p.ex. : "120 clients VIP · 85 atteignables push · 110 atteignables email · 70 atteignables SMS". Pas de table, pas de prénom, pas de coordonnées (même masquées). Décision MOAT-first actée Q90-Q2 : la table individuelle relève V2 (et probablement jamais en clair sur coords). Les campagnes (V2) tapent les segments par référence, le resto ne voit jamais les destinataires nominativement.
_Avoid_: Mes clients, Liste clients, Customer list, Table clients

**Watermark** :
Marquage visuel léger semi-transparent sur la vue "Mes clients" côté resto, contenant email du gérant + session ID. Dissuasion screenshot. Q90-Q5 = suffit-il vs solution DRM-like.
_Avoid_: Branding, Logo overlay

**Audit log consultations** :
Trace de chaque consultation du resto sur ses clients (qui = owner, quoi = page vue + filtres, quand). Détecte tentatives de scraping massif. Conservation 3 ans (RGPD).
_Avoid_: Access log, Telemetry

**Effacement RGPD = anonymisation irréversible** :
Quand un client exerce son droit à l'effacement, on **nullifie** email/tel/prénom/adresse/lat-lng + IDs d'inscription push sur la row `customers` (le schéma V1 n'a ni `nom`/`lastName` ni `IP` — rien à effacer côté ces champs). Les rows `orders` historiques restent rattachées au `customer_id` devenu fantôme — montants et items préservés. Justification : obligation comptable conservation factures 10 ans (Code de Commerce L123-22), statistiques resto préservées (LTV historique), CNIL valide l'anonymisation si irréversible. **Pas de hard delete V1.** Process traité à `privacy@kitchenboost.fr`, SLA 30j max.
_Avoid_: Effacement complet, Hard delete, Suppression

**Segment** :
Cf. [[KB Admin]] CONTEXT.md. V1 — 3 segments calculés automatiquement, seuils figés (paramétrable resto en V2) :

- **Actif** : ≥1 cmd dans les 30 derniers jours
- **Inactif** : 0 cmd dans les 90 derniers jours
- **VIP** : ≥5 cmds total OU LTV cumulé ≥ 150€ (peu importe récence)
  V2 : critères fins (montant moyen, période, géo, custom resto).

**Profil client PWA = absent V1** :
**Décision actée 2026-05-23** : pas d'écran "Mon profil" / "Mes cmds" / "Mes préférences" en V1 côté PWA client. Les droits RGPD (rectification, opposition, effacement) s'exercent via un lien footer "Vos droits RGPD" qui ouvre un form contact → email à `privacy@kitchenboost.fr`. SLA 30j (RGPD). Pas de back-office RGPD V1 — Alex traite manuellement. Friction client assumée. Risque aggravant CNIL en cas de plainte (Art 12 + 21 RGPD = droits "facilement exerçables") — à arbitrer si volume de plaintes ou seuil base atteint.
_Avoid_: Page profil, Compte client, Login

**Article 2 ter** (du contrat resto) :
Article du contrat KB qui verrouille juridiquement la propriété de la base : (1) KB responsable de traitement RGPD, (2) resto pas de propriété, pas d'accès acquis, pas d'exploitation autonome, (3) titularité inchangée post-résiliation. Couplé avec 5.4 (pas de droit copie/extraction à la résil).
_Avoid_: Data clause, Contract clause (utiliser le numéro exact)

**Communication via KB** :
Pattern V1 où le resto choisit un segment + un [[Template campagne]] pré-validé dans [[KB Admin]] (cf. [ADR 0006](../../adr/0006-templates-campagnes-pre-valides.md)) et **KB envoie en proxy** via [[Moteur Notifications]] aux clients du segment. Le resto voit les stats agrégées (envoyés / ouverts / cliqués / convertis) sans accès aux coordonnées brutes des destinataires. Cohérent avec Article 2 ter.2. **V1 = 3 segments figés** (Actif / Inactif / VIP) + ~5-10 templates pré-validés ; **V2 = segments fins paramétrables resto + bibliothèque templates étendue**.
_Avoid_: Proxy send, KB-mediated

**Effet réseau** (V1 cross-resto compte unifié) :
Capacité d'un client de commander chez plusieurs restos KB avec **un seul profil** (même `customer_id`). Conséquence du caractère global de la table customers. **V1 = unification cross-resto par carte Wallet uniquement + carte CB partagée** (révision 2026-05-25 / [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md) Amendement) :

- Chaque resto étant sur son **propre domaine de marque**, le cookie device ne traverse PAS les restos. À la 1ʳᵉ cmd chez un 2ᵉ resto, **un nouveau `customer_id` est créé par défaut** (pas d'auto-fill cross-resto, pas de prompt "tu es déjà client ?"). L'auto-fill cross-resto n'existe **que** si le client a installé la carte Wallet (le pass bridge son identité).
- La **carte CB sauvegardée** est réutilisable cross-resto KB via [[Stripe Customer (cross-tenant)]] côté [[Payment]] — pattern `clone PaymentMethod` Stripe Connect — **pour les clients dont l'identité est bridgée par le pass** ; scopée au `customer_id` pour des raisons de sécurité.
- **La [[Wallet pass]] est commune à tous les restos KB** sous marque neutre (cf. [ADR 0003](../../adr/0003-wallet-pass-commun-marque-neutre.md)) → push lock-screen cross-tenant activé dès le premier client + **bridge cross-device** pour l'identité (le pass suit la personne entre devices).
- **Pas de matching cross-device sur email/tel V1** (cf. [[Identité Customer V1]]). Un client multi-device sans Wallet pass installé = 2+ `customer_id`. Doublons cross-device assumés (~10% estimés).
- **Aucun message "KitchenBoost" littéral brandé** au client (PWA + emails transactionnels = branded resto à 100%) — mais **l'effet réseau devient visible côté Wallet** (carte commune avec logo du resto principal + mention "Membre [Nom carte]" en bas). C'est l'embryon de la marque consumer-side KB nécessaire à la vision long terme "Uber Eats à 2€". **White-label intégral resto-side** sur l'ordering, **marque consumer-side neutre** sur le wallet et marketing cross-tenant.
  _Avoid_: Network effect (acceptable), Cross-resto identity, Account linking

## Example dialogue

**Alex** : Si Khan demande explicitement de pouvoir exporter sa base clients ?

**Dev** : Refus systématique. Article 2 ter contrat. Pas de bouton "Export CSV" qui existe dans le code. Si tentative scraping détectée → rate limit → alerte ops → escalade legal possible. Q90-Q6 prévoit même un script de refus + process escalade.

**Alex** : Un client commande chez Buns & Bao puis chez un autre resto KB du 19e. Qu'est-ce qui se passe ?

**Dev** : Les deux restos sont sur des domaines de marque distincts → par défaut, **2 `customer_id` séparés** (le cookie ne traverse pas les domaines, et on ne matche PAS sur email/tel — [ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md)). **Compte unifié cross-resto uniquement si le client a installé la carte Wallet** : son `serial → customer_id` le rattache au même record global, et `customer_orders_per_tenant` lie alors ce `customer_id` aux 2 tenants. Sinon, doublon cross-resto assumé (réconciliable en V2).

**Alex** : Si KB suspend Khan parce qu'il a pas payé ?

**Dev** : Tenant Buns & Bao passe en `suspended`. Mais les customers qui ont commandé chez lui restent dans la base KB. Article 2 ter.3 : "titularité inchangée post-résiliation". Si Khan ré-ouvre ailleurs (sans KB), il n'emporte rien.

**Alex** : Et si Khan veut envoyer une promo à ses clients VIP ?

**Dev** : Pattern "Communication via KB". Depuis [[KB Admin]] → Campagne → segment VIP → template → send. KB envoie en proxy via [[Notifications]]. Khan voit stats : envoyés / ouverts / cliqués / convertis. Jamais les coordonnées brutes.
