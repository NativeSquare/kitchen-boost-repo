# Uber Direct — Deep Dive Technique, Financier & Concurrentiel

**Date** : 2026-05-20
**Auteur** : Recherche consolidée à partir de 4 agents deep-research (API tech / flow argent / patterns SaaS / concurrence FR)
**Objectif** : Donner à KitchenBoost une visu complète pour construire une intégration Uber Direct compétitive face à Owner.com / Slerp / Flipdish / LivePepper / Lightspeed.

---

## TL;DR — 7 insights actionnables

1. **Pattern multi-tenant officiel** : Uber Direct expose une **Organizations API** (scope `direct.organizations`) qui permet à KitchenBoost d'opérer **un compte parent unique** + **N sub-accounts** (un par resto), avec **1 webhook unique** et `client_id/client_secret` partagés. C'est exactement le pattern utilisé par Slerp, Flipdish, Lunchbox, Incentivio, Redbox, Deliverect.

2. **Recommandation billing** : démarrer en **`BILLING_TYPE_DECENTRALIZED` + `CONTRACT_TYPE_PARENT`** → chaque resto signe son propre contrat Uber avec son KBIS/RIB, KB n'est **pas merchant of record sur la livraison** → pas d'encaissement pour compte de tiers, pas de risque TVA. KB orchestre via API uniquement.

3. **Pricing Uber Direct France** : **à partir de 5,90 € HT/course** (variable selon distance/zone/horaire). Pas de setup, pas de minimum mensuel. Rayon max ~10 km. CB prélevée quotidiennement (self-signup) ou SEPA mensuel (Order Form agrégateur).

4. **Pattern paiement client recommandé** : **Stripe Connect Express** avec **destination charges**. Un compte Connect Express par resto. Client paie en 1 transaction (repas + livraison + tip), Stripe préleve ses frais, KB prend une `application_fee_amount` (2€), reverse le net au resto. Pas besoin d'agrément ACPR — Stripe est le PSP agréé, KB est agent technique.

5. **Auth = OAuth2 Client Credentials** : 1 token Bearer valide **30 jours** pour toute la plateforme. Cache Redis avec refresh proactif.

6. **Concurrence FR** : aucun acteur français ne combine (a) 2€/commande sans abo + (b) prospection terrain + (c) bundle marque virtuelle + (d) QR code dans sacs. **Blue ocean confirmé**. Les concurrents les plus proches (LivePepper 39-99€/mois, Lightspeed 25-33€/mois, Flipdish 49-79€/mois) sont en SaaS fixe + 0% commission, inbound only, sans done-for-you.

7. **Reste à valider en call commercial Uber FR** (ne PAS construire sans ces réponses) :
   - Éligibilité NativeSquare au programme **Integration Partner France**
   - Self-serve onboarding email (`ONBOARDING_INVITE_TYPE_EMAIL`) actif en FR ?
   - Rate limits exacts par endpoint
   - Pricing négocié au volume (au-delà de ~500 courses/mois ?)
   - Le programme `direct.organizations` parent/enfants est-il ouvert à un partenaire FR sans contrat US ?

---

## 1. API Uber Direct — Technique

### 1.1 Authentification

- **OAuth2 Client Credentials Grant** sur `POST https://auth.uber.com/oauth/v2/token`
- Params : `client_id`, `client_secret`, `grant_type=client_credentials`, `scope=eats.deliveries direct.organizations`
- Bearer token valide **30 jours** (2 592 000s) → cacher côté serveur, ne pas régénérer à chaque requête
- Rate limit sur le endpoint auth : **100 req/heure**

**Process credentials** :
1. Self-signup sur `https://direct.uber.com` (compte Uber Business)
2. Accepter Terms + API Terms of Use
3. Onglet **Developer → Management** pour récupérer `customer_id`, `client_id`, `client_secret`
4. Billing/CB requise avant credentials production
5. Pour multi-tenant : passer par un **Account Manager Uber** (recommandé pour KB)

### 1.2 Endpoints principaux

Base URL (sandbox + prod) : `https://api.uber.com/v1/`

| Méthode | Path | Usage |
|---|---|---|
| POST | `/customers/{customer_id}/delivery_quotes` | Quote (prix + faisabilité), valide ~5 min |
| POST | `/customers/{customer_id}/deliveries` | Créer la livraison (avec `quote_id`) |
| GET | `/customers/{customer_id}/deliveries/{delivery_id}` | Status |
| GET | `/customers/{customer_id}/deliveries` | Lister |
| POST | `/customers/{customer_id}/deliveries/{delivery_id}/cancel` | Annuler |

**Workflow standard 2 temps** : Quote → Delivery. Le `quote_id` est passé dans le body de Create Delivery.

### 1.3 Webhooks

4 événements officiels :

- `event.delivery_status` — changements d'état (pending, pickup, pickup_complete, dropoff, delivered, canceled, returned, failed)
- `event.courier_update` — position GPS du livreur (~30s)
- `event.refund_request` — demandes de remboursement
- `event.shopping_progress` — Pick & Pack (pas notre cas)

**Sécurité** :
- Header `x-uber-signature` (HMAC-SHA256 du payload brut)
- Webhook Signing Key récupérée dans dashboard → Developer → Webhooks → Edit
- ⚠️ Valider sur le **raw body** (pas le JSON re-sérialisé), sinon les `\uXXXX` cassent la signature

**Retry policy** : 10s → 30s → 60s → 120s, **max 3 retries** → toujours stocker un buffer/queue.

**⚠️ Pas d'API pour enregistrer les webhooks programmatiquement** → enregistrement manuel dans dashboard. En mode multi-tenant : 1 webhook unique au niveau parent suffit, dispatch interne par `customer_id` (à confirmer avec AM Uber).

### 1.4 Paramètres Create Delivery

- **Pickup** : `pickup_address`, `pickup_name`, `pickup_phone_number`, `pickup_business_name`, `pickup_notes`, `pickup_ready_dt`, `pickup_deadline_dt`
- **Dropoff** : symétrique
- **Manifest** : `manifest_items[]` (name, quantity, size, price, weight, dimensions), `manifest_total_value`, `manifest_reference`
- **Options** : `tip`, `deliverable_action` (meet_at_door / leave_at_door), `undeliverable_action`, `requires_dropoff_signature`, `requires_id` (alcool), `external_store_id`, `idempotency_key`

**Pour KB** : envoyer **1 manifest item agrégé** "Commande Resto X" avec size moyen suffit. Pas besoin de détailler chaque plat (sauf alcool, qui est de toute façon interdit par défaut).

### 1.5 Contraintes France

- **Couverture** : **360+ villes** (Paris/IDF, Lyon, Marseille, Bordeaux, Lille, Nice, Toulouse, Strasbourg…)
- **Horaires** : pas 24/7 partout, dépend de la zone → vérifier via `delivery_quotes`
- **Poids max** : ~13,5 kg (~30 lbs)
- **Distance max** : non documentée publiquement. Vélo ~5km, voiture ~15km en pratique. Doc Zapiet cite **7 km pour la France**
- **Valeur max colis** : ~90€ selon doc Connect
- **Interdits** : alcool (sauf accord spécifique + `requires_id`), médicaments, drogues, armes, liquides non scellés
- **Plafond responsabilité Uber** : **60 € max** par commande en cas de perte/casse. Remboursements plafonnés à 3% mensuel ou 0,90 €/commande moyen

### 1.6 Sandbox / test

- Sandbox = **même URL** `api.uber.com/v1/` avec credentials test (avant validation billing)
- Pas de robosimulator publié pour Uber Direct → status transitions déclenchées via dashboard `direct.uber.com`
- Doc publique : [developer.uber.com/docs/deliveries](https://developer.uber.com/docs/deliveries)
- SDK JS officiel : [github.com/uber/uber-direct-sdk](https://github.com/uber/uber-direct-sdk) (beta, Apache-2.0, Node 18+)
- Collection Postman : [postman.com/uber/uber-direct](https://www.postman.com/uber/uber-direct)

### 1.7 Rate limits

- Global Uber API : **500 req / 5s par app** (burst protection). 429 si dépassement
- Per-endpoint Direct : **non publié** → à demander à l'AM
- SLA contractuel : non publié, réservé aux managed accounts
- Idempotency : header `Idempotency-Key` supporté sur Create Delivery → à utiliser systématiquement pour éviter doubles dispatches

---

## 2. Flow financier — Qui paie qui

### 2.1 Qui paie Uber Direct ?

**Sourcé** : Le **marchand paie Uber directement** par défaut. Uber Eats France SAS + Uber Portier B.V. (Pays-Bas) facturent le marchand qui est traité comme "retailer/seller" et reste responsable de la TVA finale.

**Sourcé (modèle agrégateur)** : Des "Aggregator Terms" séparés existent — un SaaS peut négocier un contrat où **lui-même** devient le contractant payeur (cas Lunchbox, Flipdish, Slerp, CloudWaitress). Dans ce cas la plateforme paie Uber et refacture au resto.

**3 architectures possibles pour KitchenBoost** :

| Modèle | Qui paie Uber | KB est merchant of record ? | Complexité juridique |
|---|---|---|---|
| **A — Direct resto** | Resto (CB perso) | Non | ✅ Simple, recommandé MVP |
| **B — Agrégateur KB** | KB → refacture | Oui | ⚠️ Aggregator Agreement Uber requis |
| **C — Client final** | Client (frais livraison à part) | Non (livraison) | ⚠️ Toujours signataire = resto ou KB |

### 2.2 Tarification Uber Direct France

| Item | Détail |
|---|---|
| **Prix de base** | **À partir de 5,90 € HT / livraison** (page officielle merchants) |
| Variable | Distance (km routés), vitesse (express/scheduled), région, type d'intégration |
| Rayon max | **~10 km** (7 km en France selon doc Zapiet) |
| Devise | EUR exclusivement |
| Frais setup | **Aucun** |
| Minimum mensuel | **Aucun** |
| Commission % | **Aucune** (fixed-rate par course) |
| Délai paiement | **30 jours net**, intérêts retard 1,5%/mois |
| Méthode self-signup | **CB**, prélevée **quotidiennement** |
| Méthode Order Form | **SEPA direct debit** |
| Entités contractantes | Uber Eats France SAS (Paris) + Uber Portier B.V. (Pays-Bas) |
| TVA | Fees stipulés **HT** ("net of any VAT"). TVA 20% s'ajoute. Reverse charge intra-UE possible |

**Inféré** : pricing "agrégateur négocié" (Order Form) probablement **plus bas que 5,90 €** au-delà d'un volume seuil → call AM nécessaire.

### 2.3 Encaissement client final — Architecture recommandée

**Cadre juridique FR** : encaisser pour reverser au resto = **encaissement pour compte de tiers** (DSP2/ACPR). Voie standard = **agent d'un PSP agréé** (Stripe, Mangopay, Lemonway).

**Pattern recommandé : Stripe Connect Express avec destination charges**

```
                  CLIENT FINAL
                       │
                       │ CB (Stripe PaymentIntent : repas + livraison + tip)
                       ▼
              ┌─────────────────────┐
              │ Plateforme KB       │
              │ Stripe Connect      │  application_fee_amount = 2€ (commission KB)
              │ destination_charge  │
              └────────┬────────────┘
                       │
        ┌──────────────┼──────────────────────────┐
        ▼              ▼                          ▼
   Stripe fees     Compte Connect Express     Compte plateforme KB
   (~1.4%+0.25€)   du RESTO (reçoit le net    (commission 2€ + refac
                   repas + livraison)          Uber Direct si modèle B)

  En parallèle, Uber Direct facture :
   - Modèle A : Uber → CB du resto (direct, 5,90€ HT/course)
   - Modèle B : Uber → CB de KB → KB déduit du virement Stripe
```

**Détails** :
- 1 compte Stripe Connect Express **par resto** (KYC propre, RIB resto)
- KB et resto en FR = même région → `on_behalf_of` non requis
- Pourboire : inclus dans la transaction Stripe, à reverser au resto OU à Uber Direct (champ `tip` API Uber, à confirmer fiscalement)
- Refunds : si livraison échoue, **Uber crédite le compte payeur** (resto en A, KB en B). Le remboursement au client final = à la charge de KB/resto, pas d'Uber → **provisionner**

### 2.4 Voie marchand vs voie agrégateur

| Aspect | Voie marchand (self-signup) | Voie agrégateur (Order Form) |
|---|---|---|
| Pricing | 5,90 € HT (sourcé) | Négocié, non public |
| Billing | CB quotidienne | SEPA mensuel |
| Contrat | API Terms standard | Aggregator Terms + Order Form |
| KYC | Marchand uniquement | KB + chaque marchand |
| API | Identique | Identique |
| Time to setup | < 2h | Plusieurs semaines (RDV AM Uber) |

### 2.5 TVA et Factur-X

- Marchand = "seller" responsable de toute la TVA collectée
- Uber facture HT → TVA 20% s'ajoute sur la facture Uber Direct
- Uber Portier B.V. (NL) → reverse charge intra-UE possible si KB est l'agrégateur signataire SIREN FR
- **Factur-X obligatoire sept 2026** : impacte facture KB → resto (commission + refac livraison). À intégrer dans le module billing dès maintenant

---

## 3. Patterns d'intégration multi-tenant SaaS

### 3.1 Organizations API — Pattern parent + sub-accounts

Uber Direct expose une **Organizations API** (scope `direct.organizations`) qui permet à un partenaire de créer une hiérarchie d'organisations programmatiquement :

```javascript
// Exemple SDK officiel uber/uber-direct-sdk
{
  info: { name: 'Resto X', billing_type: 'BILLING_TYPE_CENTRALIZED' },
  hierarchy_info: { parent_organization_id: '<KB_parent_uuid>' },
  options: { onboarding_invite_type: 'ONBOARDING_INVITE_TYPE_EMAIL' }
}
```

**Architecture** :

```
KitchenBoost Parent Org (1 client_id, 1 client_secret, 1 webhook URL)
  ├── Resto A (customer_id_A) ── PWA caverne-pizza.kitchenboost.fr
  ├── Resto B (customer_id_B) ── PWA creperie-malakoff.kitchenboost.fr
  ├── Resto C (customer_id_C) ── PWA buns-bao.kitchenboost.fr
  └── ...
```

**Concepts clés** :
- **Client ID / Client Secret** : générés au niveau du **compte parent** KitchenBoost, partagés pour tous les enfants
- **Customer ID** : un par sub-account (resto), passé dans chaque appel `/customers/{customer_id}/deliveries`
- **Billing types** :
  - `BILLING_TYPE_CENTRALIZED` (KB facturé, refacture le resto)
  - `BILLING_TYPE_DECENTRALIZED` (resto facturé direct par Uber, KB orchestre)
- **Contract types** :
  - `CONTRACT_TYPE_PARENT` active le **self-serve onboarding** (Uber gère le KYC/contrat directement avec chaque resto)

**Recommandation KitchenBoost** : **`BILLING_TYPE_DECENTRALIZED` + `CONTRACT_TYPE_PARENT`** → chaque resto signe son propre contrat Uber, KB n'est pas merchant of record (pas de TVA, pas de chargeback, pas besoin de KBIS NativeSquare adossé aux livraisons).

### 3.2 Branded tracking

- **À la création** : l'API retourne `tracking_url` (format `https://www.ubereats.com/{country}/orders/{order-id}?ptr={partner-identifier}`)
- **Customisation** : logo + 2 couleurs hex pour la tracking bar via `partner-identifier`
- **Iframe possible** mais Uber recommande pop-out ou nouvelle fenêtre
- **SMS client** : option configurable (Uber envoie OU KB envoie via webhook `courier_update` + Twilio)
- ⚠️ **Pas de domaine custom** sur la tracking page (toujours `ubereats.com/...`). Pour un white-label 100% kitchenboost.fr / restoX.fr → builder sa propre UI à partir des webhooks (lat/lng courier toutes les 30s)

### 3.3 Onboarding d'un nouveau resto

- **Documents** : KBIS < 3 mois, RIB, identité gérant (idem Uber Eats Marketplace)
- **Délai self-serve** : "quelques jours à 2 semaines" selon Slerp/Flipdish/Incentivio
- **Self-serve API** : en théorie via `CONTRACT_TYPE_PARENT` + `ONBOARDING_INVITE_TYPE_EMAIL` → Uber envoie email au resto qui accepte CGU + ajoute RIB → activation
- ⚠️ À valider en call : (a) éligibilité NativeSquare au programme Integration Partner FR (certif technique requise), (b) self-serve email actif en FR

### 3.4 Patterns API courants

- **Quotes temps réel** : `POST /customers/{customer_id}/delivery_quotes` → fee + ETA, à afficher dans le panier avant validation
- **Quote valide ~5 min** → si user reste > 5 min, refaire un quote
- **Status updates** : **webhook push uniquement** (pas de polling)
- **Échecs livraison** : si client absent → livreur attend 10 min puis annule → webhook `delivery_status: returned` → resto récupère le colis ou refund. **Le resto paie quand même la course retour.** UI dashboard resto : modal "livraison échouée, action requise"

### 3.5 Benchmarks concurrents (intégration technique)

| Plateforme | Modèle compte | Tracking | À retenir |
|---|---|---|---|
| **Slerp (UK)** | Compte plateforme parent + sub-accounts, billing centralisé | UI custom Slerp | Modèle le plus proche de KB. **KB devient merchant of record** → friction TVA |
| **Flipdish (IRL)** | Hybride : compte Flipdish OR compte resto | URL partagée client | Confirme que les 2 modèles coexistent |
| **Owner.com (US)** | Integration partner officiel | First-party orders white-label | Pas de doc tech publique |
| **Incentivio / Redbox / Lunchbox** | Pattern parent + sub-accounts documenté | Standard | **Le pattern est le standard de facto** |
| **Deliverect** | Aggregator POS → Uber Direct, sub-accounts par location | Standard | Confirme la scalabilité |

### 3.6 Pièges à éviter

1. **Ne pas confondre Client ID et Customer ID** — Client ID = parent (auth), Customer ID = enfant (routing). Erreur la plus fréquente
2. **Signing key partagée** : copier la **même** signing key sur chaque sub-account, sinon HMAC fail silencieusement
3. **Webhook delivery > 5s** : Uber retry agressif, retourner 200 immédiatement puis processer en queue
4. **Quote expiry 5 min** : refaire un quote si user > 5 min checkout, sinon erreur création
5. **Decentralized billing en FR** : non confirmé publiquement comme dispo en FR (docs US/UK majoritaires) → **à valider impérativement**
6. **Sandbox != Production** : credentials différents, switch manuel via Developer dashboard après approbation Uber
7. **Pas de domaine custom sur tracking** : si KB veut 100% white-label, builder UI custom à partir des webhooks
8. **Fallback delivery cost** : configurer un prix fallback affiché au client si quote API timeout, sinon UX cassée

### 3.7 Hardware tablette — Uber Eats marketplace + Uber Direct sur le même device ?

**Question critique opérationnelle** : sur la tablette d'un resto qui prend les 2 prestations (marque virtuelle Uber Eats marketplace + canal direct PWA via Uber Direct), l'app **Uber Eats Orders** affiche-t-elle aussi les cmds Uber Direct, ou faut-il une 2e interface ?

**Réponse définitive** : **NON, Uber Eats Orders n'affiche pas les cmds Uber Direct.** Et ce n'est pas une question de tablette — c'est **architectural**.

#### Pourquoi c'est impossible nativement

Uber Direct est un service de **livraison white-label uniquement**. Son API ne connaît que les infos de *delivery* :
- Adresse pickup / adresse dropoff
- Valeur du colis, dimensions
- Coordonnées contact (nom, tel client)
- Statut de la livraison

Elle ne reçoit **jamais** les détails de la cmd cuisine (items, modifiers, instructions, allergènes). Ces données restent **uniquement** dans le système du marchand — pour KB, c'est notre PWA KitchenBoost.

→ Uber Eats Orders **ne peut pas techniquement** afficher un ticket cuisine pour une cmd Direct : Uber n'a pas les infos.

#### POS Integration API ne résout PAS le problème non plus

Vérifié sur la doc Uber Developer : *« Your integration begins after checkout. Once the customer confirms their cart, an order is created and enters the Orders API lifecycle. »* L'intégration est **unidirectionnelle** : Uber Eats marketplace → POS du marchand. Aucun mécanisme pour injecter une cmd externe (notre PWA) dans Uber Eats Orders.

Même en devenant Integration Partner Uber, KB ne peut pas faire converger les 2 flux dans l'app native Uber Eats Orders.

#### Conséquence : 2 interfaces obligatoires

| Source de la cmd | Interface où le ticket cuisine apparaît |
|---|---|
| Uber Eats marketplace | App native **Uber Eats Orders** (Android/iOS) — beep + flash vert + tap pour accepter |
| Uber Direct (via PWA KB) | **Notre PWA KitchenBoost** — Web Push + son custom (chime court ≠ buzzer Uber) |

Indépendamment du type de tablette (kiosque Uber ou device perso), il y aura **toujours 2 sources d'interface** pour les cmds.

#### Couche supplémentaire — kiosque sur tablette Uber Premium

Les tablettes physiques fournies par Uber (offre Premium notamment, modèles Lenovo Tab type TB-8505f) tournent sous **Android Enterprise en mode kiosque** : whitelist d'apps autorisées, pas d'accès au Play Store, pas de navigateur web disponible pour le restaurateur.

Conséquence : sur ce device, on **ne peut même pas ouvrir la PWA KB** dans un navigateur. La tablette Uber est mono-app : Uber Eats Orders only. Il faut donc forcément un 2e device pour Uber Direct.

#### Les 3 setups possibles

| Setup | Détail | Coût | UX cuisine |
|---|---|---|---|
| **A. BYOD 1 device** (recommandé MVP) | Tablette générique (iPad / Samsung Tab) : app Uber Eats Orders **+** PWA KB en raccourci. Cohabitation OK | 0€ si tablette existe, ~100€ Samsung Tab A9 sinon | 2 apps surveillées, 1 device physique |
| **B. Tablette Uber kiosque + 2e device** | Tablette Uber pour marketplace + smartphone/tablette dédié pour la PWA KB | ~100€ device additionnel | 2 devices à surveiller |
| **C. KDS tiers unifié** (Phase 2) | Solution **Deliverect / Otter / Checkmate / Olo** qui ingest Uber Eats marketplace ET notre PWA via API, affichage unifié sur écran cuisine | ~50-150 €/mois/store | 1 écran KDS, vraie single inbox |

#### Recommandation KB

**Setup A pour le MVP** : tablette générique BYOD, 2 apps qui cohabitent. La cohabitation est gérable jusqu'à ~50 cmds/jour. Argument à intégrer au pitch commercial : *« vous gardez votre tablette actuelle, on ajoute juste la PWA en raccourci écran d'accueil »*.

**Setup C à explorer Phase 2** quand on aura 5-10 restos signés. Deliverect (leader FR) est l'option la plus crédible. Devient aussi un argument commercial fort : *« on vous fournit un seul écran cuisine qui regroupe Uber Eats + vos cmds directes »*.

**Implication onboarding KB** : ajouter dans le Gate B → B+ la question *« Quel device le resto utilise actuellement pour ses cmds Uber Eats ? »* :
- Si **tablette Uber Premium kiosque** → prévoir le 2e device (smartphone perso du resto suffit le temps de valider la traction, sinon Samsung Tab A9 ~100€)
- Si **tablette générique** ou téléphone → 1 device unifié, vérifier installation PWA en raccourci écran d'accueil le jour du RDV install

**Notification audio PWA KB** : choisir un **son distinct** du buzzer Uber Eats Orders (chime court ~1s), sinon le resto confond les flux et rate des cmds. Idéalement le son change selon le canal (cmd PWA vs cmd Uber Direct depuis un site partenaire).

**Points à valider avec l'AM Uber FR** :
- [ ] La tablette Uber Premium peut-elle être débridée pour autoriser un navigateur ? (probablement non, mais à demander)
- [ ] Le resto peut-il refuser la tablette Uber Premium (en gardant l'offre Premium) et utiliser son propre device ? (= moyen propre de garantir setup A)
- [ ] Existe-t-il une feature Uber Direct roadmap pour intégrer les cmds Direct dans Uber Eats Orders ? (peu probable car Uber Direct = white-label volontairement séparé, mais à check)

---

## 4. Paysage concurrentiel France

### 4.1 Acteurs FR — Tableau récap

| Acteur | Pricing | Uber Direct ? | Livraison ? | Target |
|---|---|---|---|---|
| **Sunday** | Custom % paiements | Non (pay-at-table) | Non | Table service |
| **Zelty** | Devis | "Soon" annoncé, **Stuart white-label** | Oui | Multi-sites |
| **Innovorder** | Devis | Non publique, **Stuart natif** | Oui | Chaînes (Quick, Big Fernand, Bagelstein, Sodexo) |
| **Zenchef** | Abo (non public) | Non | **NON** (C&C only) | Bistrots, gastronomie |
| **LivePepper** | **39€** C&C / **59€** +livraison / **99€** +app | **OUI intégration native** | Oui Uber Direct + Stuart | TPE/PME indé |
| **Lightspeed Order Anywhere** | **25-33€/mois** | **OUI** (partenariat 2024) | Oui Uber Direct | TPE/PME Lightspeed POS |
| **LUNDI MATIN / TastyCloud** | Devis | **OUI** | Oui Uber Direct | Chaînes, multi-sites |
| **Resto Drive** | **29,90-99€/mois** + 2-5%/cmd + 0,25€/tx | Non explicite | Limité | TPE indé |
| **Commandeici** | **19-29,99€/mois, 0% commission** | Non publique | Limité | TPE indé |
| **Deliverect Dispatch** | Devis | **OUI** (partenariat global) | Middleware | Multi-sites POS existant |

### 4.2 Acteurs internationaux (entrée FR)

- **Owner.com (US, $1B Series C 2025, $499/mois)** : pas d'offre France en 2026. **Gap massif inexploité.**
- **Flipdish (Irlande, 49-79€/mois)** : Uber Direct active (3-5j setup), présent en FR via SDR mais sans terrain
- **Slerp (UK, Just Eat group)** : pas opérationnel en FR
- **Bolt Food** : pas de module direct order white-label
- **Square Online** : intégration Uber Eats annoncée avril 2026, Uber Direct via Square encore US-only

### 4.3 Pricing comparatif

| Tier | Acteur | Coût mensuel | Commission | Setup |
|---|---|---|---|---|
| Low TPE | Commandeici, Resto Drive | 19-30€ | 0% ou 2-5% | Faible |
| Mid TPE | LivePepper, Lightspeed | 25-99€ | 0% | Faible |
| Mid chain | Flipdish | 50-79€ | 0% | 3-5j |
| Premium / multi-site | Innovorder, Zelty, LUNDI MATIN, Deliverect | Devis 200-500€+ | 0% | Lourd |
| US benchmark | Owner.com | $499 ou $249 + 5% | 0% / 5% | Inclus |

### 4.4 Modèles de monétisation

- **SaaS abo fixe (0% commission)** : LivePepper, Lightspeed, Owner.com, Flipdish, Commandeici
- **Hybride abo + commission** : Resto Drive, Owner.com Flex
- **Devis sur mesure** : Innovorder, Zelty, LUNDI MATIN, Deliverect (opacité = chaînes)
- **2€/commande flat sans abo (KB)** : **AUCUN acteur identifié en France** → gap réel
- **% paiement (pay-at-table)** : Sunday, Choice QR — segment différent
- **Setup fee upfront** : non publié sauf Uber Eats (~600€ activation, hors scope)

### 4.5 Stuart vs Uber Direct

| Critère | Stuart | Uber Direct |
|---|---|---|
| Couverture FR | **13 villes** (urbain dense, 100% La Poste) | **360+ villes FR** |
| Tarif | Dès **4,50€** pour <1,75km, fixed-rate distance | Fixed-rate distance, ~5,90€ base, plus cher petits paniers <20€, **moins cher au-dessus de 20€** |
| Intégrations SaaS | Zelty natif, Innovorder natif, Lightspeed | Lightspeed, LivePepper, LUNDI MATIN, Flipdish, Deliverect, Zelty (annoncé) |
| Limitations | Couverture urbaine seulement | Tarification opaque côté merchant |

**Reading** : Uber Direct gagne le mass market FR par défaut grâce à la couverture 360 villes. Stuart pertinent uniquement si focus Paris/Lyon urbain dense + image "éthique" La Poste.

### 4.6 Positionnement marketing observé

- **Argument dominant** : "réduisez la commission 30% Uber Eats / récupérez vos clients / votre marge" (quasi tous)
- **Acquisition** : **100% inbound/SEO/SEA + salons** (Sirha, Equip'Hotel). **Aucun acteur identifié ne fait de prospection terrain physique à la KitchenBoost**
- **Case studies** :
  - Innovorder : Quick, Big Fernand, Bagelstein, Amorino, Sodexo (chaînes)
  - Zelty : Matsuri (test Uber Direct)
  - Sunday : Big Mamma, Girafe, premium Paris
- **Profil cible** :
  - TPE indé : LivePepper, Resto Drive, Commandeici (~30K€/mois CA, 1 site)
  - Multi-sites/chaînes : Innovorder, Zelty, LUNDI MATIN, Deliverect (>100K€/mois)
  - Premium table service : Sunday, Zenchef

### 4.7 Gaps marché exploitables pour KitchenBoost

1. **Aucun "Owner.com français"** : LivePepper et Lightspeed s'en rapprochent mais (a) pricing en cents pas en outcome, (b) aucun ne fait QR-in-bag, (c) aucun ne fait done-for-you avec prospection terrain. **Créneau vide.**
2. **Modèle 2€/commande flat = unique** : tout le monde en SaaS fixe ou hybride abo+%. Notre "no win no fee" est aligné resto. Argument pitch fort vs un abo 99€/mois "que tu paies même si ça marche pas".
3. **QR code dans les sacs Uber Eats = zero acteur** : aucun ne capitalise sur le sac comme canal d'acquisition off-platform. Sunday fait QR à table, pas QR en sac livré. **Blue ocean.**
4. **Prospection terrain = 100% inbound chez les concurrents** : Yanis (Virtual Eats) confirme — il vend une formation 1500€ pas le produit. **Distribution = moat.**
5. **Marque virtuelle intégrée** : aucun SaaS commande directe ne propose en bundle "on te lance aussi une marque virtuelle Uber Eats". Taster/Guigny le font mais sans le SaaS direct order. **Bundle unique.**
6. **Pricing accessible TPE** : Innovorder/Zelty/Deliverect 200-500€/mois sur devis = inaccessible aux restos 25-40K€ CA. LivePepper/Lightspeed couvrent ce segment mais sans done-for-you. **Notre 0€ abo + 2€/cmd casse la barrière à l'entrée.**
7. **Documentation française Owner-style manquante** : Owner.com US-only. Personne en FR ne packagise "site + app + SEO + CRM + email/SMS automation + marque" comme Owner. **Opportunité d'être l'agrégateur référent FR.**
8. **Premium Uber Eats (33%) vs Uber Direct (~5,90€)** : break-even à **80-100€ panier**. Pitch ROI massif. Aucun concurrent ne le calcule live face au resto en physique.

---

## 5. Synthèse KitchenBoost — Décisions & Next Steps

### 5.1 Décisions d'architecture proposées

| Décision | Choix recommandé | Pourquoi |
|---|---|---|
| **Compte Uber Direct** | 1 parent KitchenBoost + N sub-accounts (1 par resto) | Pattern officiel, utilisé par Slerp/Flipdish/Lunchbox |
| **Billing Uber Direct** | `BILLING_TYPE_DECENTRALIZED` + `CONTRACT_TYPE_PARENT` | Resto signe direct avec Uber → KB pas merchant of record → pas de TVA livraison à gérer |
| **Auth API** | OAuth2 Client Credentials, token 30j cache Redis | Standard, refresh proactif |
| **Webhooks** | 1 endpoint unique `api.kitchenboost.fr/webhooks/uber`, dispatch par `customer_id` | Multi-tenant centralisé |
| **Tracking** | MVP = `tracking_url` Uber avec partner-identifier branded (logo + 2 couleurs). V2 = UI custom KB | Time to market vs pixel-perfect brand |
| **Quotes** | API quote à chaque update panier (debounce 500ms), cache 4 min | Quote valide 5min, refresh pour éviter expiration |
| **Encaissement client** | Stripe Connect Express, 1 compte par resto, destination charges | Standard marketplace FR, pas d'agrément ACPR requis |
| **Pourboire** | Inclus dans transaction Stripe, reversé au resto | Plus simple fiscalement |
| **Refunds livraison** | Provisionner sur le compte plateforme (~3% commande), Uber crédite max 0,90€/cmd moyen | Couvrir les pertes non couvertes par Uber |
| **Factur-X** | Module billing prêt sept 2026 dès maintenant | Obligation légale |

### 5.2 Open questions critiques — Call commercial Uber FR à booker

1. ✅ **Éligibilité NativeSquare au programme Integration Partner France** — certif technique requise ?
2. ✅ **Self-serve onboarding `ONBOARDING_INVITE_TYPE_EMAIL` actif en FR** ou uniquement US/UK ?
3. ✅ **Rate limits exacts** par endpoint Uber Direct
4. ✅ **Pricing négocié au volume** (au-delà de 500/1000/5000 courses/mois ?)
5. ✅ **`direct.organizations` scope** disponible pour partenaire FR sans contrat US ?
6. ✅ **Webhook unique multi-resto** : autorisation Uber pour 1 webhook URL recevant les events de N sub-accounts ?
7. ✅ **TVA facture Uber** : Uber Eats France SAS ou Uber Portier B.V. en signataire ? Implications reverse charge.
8. ✅ **Alcool override** `requires_id` : process pour les restos qui vendent du vin ?

### 5.3 Pitch competitif — Arguments à utiliser face aux concurrents

- **vs LivePepper 99€/mois** : "Tu paies 0€/mois chez nous. Tu paies 2€ uniquement quand on te ramène un client. Si on te ramène rien, tu paies rien."
- **vs Lightspeed 33€/mois** : "Lightspeed te file un site. Nous on te file un site + on prospecte tes clients + on te crée une marque virtuelle + on installe les QR code dans tes sacs. Bundle complet."
- **vs Innovorder 300-500€/mois** : "C'est pour les chaînes. Toi t'as 2 restos, tu mérites pas un devis sur mesure à 5000€ d'install. 2€/commande, point."
- **vs Owner.com (si arrive en FR)** : "On est français, on parle français, on est sur place, on signe à la table. Owner c'est du SaaS US par email."
- **vs Sunday** : "Sunday c'est pour quand le client est déjà dans le resto. Nous on récupère le client qui ne revient jamais après une commande Uber Eats."

### 5.4 Next concrete steps

1. **Cette semaine** : booker un RDV téléphonique avec un account manager Uber Direct France (formulaire sur merchants.ubereats.com/fr/fr/services/uber-direct/) → poser les 8 open questions
2. **D'ici 2 semaines** : créer un compte Uber Direct self-signup test avec NativeSquare SAS → tester l'API en sandbox, vérifier que le scope `direct.organizations` est accessible
3. **D'ici 1 mois** : compte Stripe Connect Express test + flow paiement end-to-end avec un compte resto test (Caverne à Pizza par exemple, en mode test)
4. **D'ici 2 mois** : POC technique complet — créer une commande sur PWA test → Stripe charge → Uber Direct delivery → webhook handling → UI tracking custom
5. **Lancement Phase 2** : déployer chez 1-2 restos clients KB existants (Caverne, Crêperie, Buns & Bao) en bêta fermée

---

## Sources consolidées

### API technique
- [Uber Direct API Overview](https://developer.uber.com/docs/deliveries/overview)
- [Authentication guide](https://developer.uber.com/docs/deliveries/guides/authentication)
- [Webhooks guide](https://developer.uber.com/docs/deliveries/guides/webhooks)
- [Create Delivery endpoint](https://developer.uber.com/docs/deliveries/direct/api/v1/post-eats-deliveries-orders)
- [Uber Direct SDK officiel](https://github.com/uber/uber-direct-sdk)
- [Postman collection](https://www.postman.com/uber/uber-direct)
- [Couverture France 360+ villes](https://www.uber.com/fr/en/b/courier-services/paris-idf-fr/)
- [Articles interdits Uber Direct FR](https://help.uber.com/en/merchants-and-restaurants/article/quels-articles-sont-soumis-%C3%A0-des-restrictions-avec-uber%C2%A0direct)

### Flow financier
- [Uber Direct France merchants](https://merchants.ubereats.com/fr/fr/services/uber-direct/)
- [Uber Direct API Terms FR](https://www.uber.com/legal/en/document/?country=france&lang=en-gb&name=uber-direct-api-terms-and-conditions)
- [Uber Direct Refund Policies](https://help.uber.com/en/merchants-and-restaurants/article/uber-direct-refund-policies)
- [Stripe Connect destination charges](https://docs.stripe.com/connect/destination-charges)
- [Stripe Connect end-to-end marketplace](https://docs.stripe.com/connect/end-to-end-marketplace)
- [ACPR encaissement compte de tiers](https://acpr.banque-france.fr/fr/professionnels/lacpr-vous-accompagne/parcours-fintech/contenus-pedagogiques/de-quel-statut-releve-mon-activite/jencaisse-des-fonds-et-les-reverse-une-tierce-personne)

### Patterns SaaS
- [Create Direct Organization API](https://developer.uber.com/docs/identity/api/create_organization)
- [Uber Direct Integration Partners](https://merchants.ubereats.com/us/en/integration-partners/direct/)
- [Postman Uber Organizations API](https://www.postman.com/uber/uber-direct/documentation/l5pural/uber-organizations-api)
- [Redbox Uber Direct Setup (sub-accounts)](https://support.redbox.systems/docs/uber-direct-set-up)
- [Slerp Uber Direct partnership](https://www.slerp.com/uberdirect/)
- [Flipdish Uber Direct integration](https://help.flipdish.com/en/articles/9585467-flipdish-uber-direct-integration-overview)

### Concurrence FR
- [LivePepper Uber Direct](https://www.livepepper.com/uber-direct/)
- [Lightspeed Order Anywhere FR](https://www.lightspeedhq.fr/caisse/restaurant/order-anywhere/)
- [Lightspeed partenariat Uber Direct](https://fr.lightspeedhq.com/actualites/lightspeed-annonce-un-partenariat-avec-uber-direct-et-le-marche-en-ligne-uber-eats/)
- [Innovorder commande en ligne](https://www.innovorder.com/en/online-ordering-for-restaurant)
- [LUNDI MATIN module Uber Direct](https://www.lundimatin.fr/module/uber-direct)
- [Flipdish pricing](https://www.flipdish.com/pricing)
- [Owner.com pricing](https://www.owner.com/pricing)
- [Owner.com $1B raise](https://en.wikipedia.org/wiki/Owner.com)
- [Square + Uber expansion FR 2026](https://restauranttechnologynews.com/2026/04/square-and-uber-eats-expand-global-partnership-to-streamline-restaurant-operations-and-payments/)
- [Stuart tarifs FR / comparatif coursiers](https://lescoursiersfrancais.fr/comparatif/)
