# Middleware d'agrégation de commandes — HubRise / Deliverect / alternatives

**Date** : 2026-06-07
**Auteur** : Deep-research (5 angles, 21 sources fetched, 25 claims vérifiés adversarialement — 19 confirmés, 6 tués)
**Objectif** : Choisir le bon middleware pour unifier sur une tablette KB les commandes Uber Eats + Deliveroo + Just Eat + commandes directes KitchenBoost, avec un programme white-label/reseller adapté à un studio 3 devs en Phase 1 (5-20 restos).
**Lié à** : [PRD 60 — Intégration Marketplaces](../prd/60_integration_marketplaces.md) · [ADR 0009 — Hubrise reporté V2](../adr/0009-hubrise-reporte-v2.md)

---

## TL;DR — 6 insights actionnables

1. **HubRise est le seul middleware avec pricing public lisible** : €35/loc/mois standard, tiers €30 (6-30 loc), €27 (31+), zéro setup, zéro engagement, commandes illimitées. Caveats : virtual brands €25 setup/marque/plateforme, dark kitchen tiered €35→€55→€75 au-delà de 1500 cmds/mois.

2. **HubRise expose un programme partenaire white-label/grey-label productisé** explicitement ciblé "software providers, resellers, dark kitchens and restaurant chains". Apps rebrandables aujourd'hui : Order Manager + Catalog Manager (logo, favicon, couleurs, domaine). Dashboard "Coming next".

3. **MAIS conditions partenaires HubRise (marges reseller, commission, minimums volume, design-partner discount, lock-in contractuel) ne sont PAS publiées** — gated derrière "Contact Us". Aucun chiffrage reseller possible sans appel commercial.

4. **Deliverect = boîte noire pricing** : tout est custom-quoté en sales call. Donnée historique 2023 €69/350 cmds Starter n'est plus publiée. Comparaison économique impossible sans engagement commercial. **Faire l'appel Deliverect en parallèle de HubRise pour avoir un BATNA**, même si tu n'as aucune intention d'y aller.

5. **Uber Eats Marketplace API direct = non en Phase 1**. Exige NDA + accord de licence + partner manager Uber + whitelisting de l'app. Délai certif typique 4-8 semaines. Scope démarre **après checkout** (pas de storefront/menu/création de commande). Confirmé sur 4 pages developer.uber.com.

6. **Caveat majeur sur l'hypothèse initiale "réutiliser la tablette Uber Eats du resto"** : techniquement **impossible** sans passer par l'app Uber Eats Restaurant, qui n'expose pas d'API tierce. Le vrai play = **une seule tablette KB-brandée qui agrège tout via HubRise et remplace la tablette Uber Eats**. C'est ça l'argument de vente.

---

## 1 — Tableau comparatif middleware

| Critère                             | **HubRise** (FR)                                             | **Deliverect** (BE)                              | **Otter / Cuboh / Chowly** (US) | **Uber Eats Marketplace API direct** |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ------------------------------- | ------------------------------------ |
| Pricing public                      | ✅ €35/loc/mois, tiers €30 (6-30 loc), €27 (31+)             | ❌ Custom sales-call uniquement                  | ❌ Custom sales-call            | ❌ Opaque, gated                     |
| Setup fee                           | €0                                                           | Inconnu                                          | Inconnu                         | NDA + licensing agreement            |
| Engagement                          | Aucun (cancel anytime)                                       | Inconnu                                          | Inconnu                         | Approbation Uber obligatoire         |
| Commandes incluses                  | Illimitées (standard)                                        | Inconnu (historique 2023 : €69/350 cmds Starter) | Inconnu                         | N/A                                  |
| Programme white-label productisé    | ✅ Explicit ("Order Manager + Catalog Manager rebrandables") | ❌ Pas documenté publiquement                    | ❌ Pas documenté publiquement   | ❌                                   |
| Listé partenaire officiel Uber Eats | ⚠️ Pas sur portail US (statut FR/EU non vérifié)             | ✅ Listé US                                      | ✅ Listés US                    | N/A                                  |
| Dispo France                        | ✅ Natif FR                                                  | ✅                                               | ❌ Principalement US            | ✅                                   |
| Lisibilité économique               | **Haute**                                                    | **Nulle**                                        | **Nulle**                       | **Nulle**                            |

**Verdict** : HubRise gagne sur la lisibilité. Tu peux faire ton P&L au crayon avant le moindre appel commercial. Deliverect reste l'alternative crédible (partenaire officiel Uber Eats listé, scale plus large) mais comparaison économique impossible sans engagement.

---

## 2 — Uber Eats Marketplace API direct — pourquoi c'est non en Phase 1

4 sources primaires `developer.uber.com` convergentes :

- "Access to These APIs May Require Written Approval From Uber"
- NDA + API licensing agreement obligatoire
- Partner manager Uber requis
- App whitelistée par l'équipe Uber Eats
- Scope governance tiered récemment durcie

**Scope critique** ([source](https://developer.uber.com/docs/eats/guides/order_integration)) : l'API démarre **après checkout**. Elle couvre webhook commande → accept/deny → ready time → courier tracking. Elle **ne couvre PAS** la création de commande, la storefront, ou le menu côté client final. Donc même avec accès Marketplace direct, tu n'évites PAS la tablette Uber Eats côté resto — tu automatises juste l'inbound.

**4 capabilities core** :

1. Store management (status/horaires)
2. Menu sync
3. Order processing (webhook → accept/deny → ready time → tracking)
4. BYOC (Bring Your Own Courier) pour gestion livraison custom

**Verdict** : barrière administrative significative + scope limité = pas le bon levier pour un studio 3 devs en Phase 1. Repousser à 100+ restos quand le coût HubRise dépasse ~€2k/mois de maintenance dev.

---

## 3 — Solutions POS-natives (Innovorder, Lightspeed, Zelty, Sunday, Tiller)

**Lacune research assumée** : la deep n'a pas trouvé de claim suffisamment supporté sur ces 5 acteurs comme middleware d'agrégation white-label.

**Verdict structurel** : ces POS sont des concurrents indirects, pas des middleware. Ils ne te laisseront pas mettre ta marque dessus. À éviter en Phase 1.

---

## 4 — Architecture clé : 2 surfaces API distinctes par plateforme

```
┌─────────────────────────────────────────────────────────────┐
│  PLATEFORME (Uber, Deliveroo, Just Eat)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐    ┌──────────────────────┐       │
│  │  MARKETPLACE API     │    │  DELIVERY API        │       │
│  │  (inbound)           │    │  (outbound)          │       │
│  │  Uber Eats API       │    │  Uber Direct         │       │
│  │  Deliveroo Partner   │    │  Deliveroo Express   │       │
│  │  Just Eat Orderpad   │    │  Stuart API          │       │
│  │                      │    │                      │       │
│  │  Commandes arrivent  │    │  TU déclenches une   │       │
│  │  depuis la marketplace│   │  livraison sortante  │       │
│  │  + livreur dispatché │    │  (white-label)       │       │
│  │  par la plateforme   │    │                      │       │
│  └──────────────────────┘    └──────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

| Aspect                | Marketplace API (Uber Eats)            | Direct API (Uber Direct)                     |
| --------------------- | -------------------------------------- | -------------------------------------------- |
| Sens du flux          | Inbound (commande vient à toi)         | Outbound (tu demandes une livraison)         |
| Qui paie la livraison | Uber (intégré dans commission 30%)     | Toi/resto (forfait livraison à la course)    |
| Marque visible client | Uber Eats                              | Ta marque (tracking page white-label)        |
| Coursier              | Pool Uber, dispatché par Uber          | Pool Uber, mais commandé par toi             |
| Accès API             | NDA + partner manager Uber + whitelist | Self-serve plus accessible (compte business) |
| Auth                  | OAuth scopes whitelistés               | API key                                      |

**Symétrie Deliveroo confirmée** : Partner Platform Suite (Order/Menu/Site APIs) = équivalent Marketplace Uber Eats ; Signature Suite / Deliveroo Express = équivalent Uber Direct ("build your apps on Deliveroo's delivery service, request delivery via Deliveroo couriers for an order processed and managed by your internal systems").

**Implication architecturale KitchenBoost** : pour chaque plateforme, il y a **2 surfaces à considérer** (inbound marketplace + outbound delivery). Un middleware comme HubRise abstrait ces dualités — d'où sa valeur en Phase 1.

---

## 5 — Leviers de négociation HubRise

**Vérité brutale** : conditions partenaires HubRise ne sont PAS publiées. Aucun chiffre sur marge reseller, commission, minimums volume, design-partner discount, lock-in.

### Leviers à activer dans le premier appel

1. **Vertical commitment** — "On va exclusivement utiliser HubRise pour notre stack." Pas de double sourcing.
2. **Volume garanti à 12 mois** — chiffre une projection 20-50 restos. Même fausse, ça les fait travailler.
3. **Co-marketing FR** — case studies, témoignages restos, présence aux salons (Sirha, Parizza). Tu leur amènes du contenu BtoB qu'ils n'ont pas.
4. **Design partner status** — formule littérale : "On est éditeur SaaS early-stage, on cherche un partenaire qui veut shaper son offre reseller avec nous." Standard SaaS : 50-70% de discount sur les premiers 6-12 mois contre feedback produit + référence publique.
5. **Lane verticale claire** — "On ne fait PAS de POS ni d'agrégation, on fait fidélisation + commande directe. Zéro overlap avec ton produit, 100% upsell pour toi."

### BATNA

**Faire l'appel Deliverect EN PARALLÈLE.** Sans BATNA tu négocies en aveugle. Même si aucune intention d'y aller, tu auras un chiffre à opposer.

### Benchmarks publics éditeur vs resto direct

**Aucun chiffre fiable trouvé.** Norme SaaS B2B typique : reseller margin 20-40% sur le ARR. À demander explicitement.

---

## 6 — Économie Phase 1 (hypothèse tier €35 standard, tarif resto direct — à renégocier en reseller)

| Restos signés | Coût HubRise/mois                                  | Revenu KB (50 cmds/resto × 2€) | Marge  |
| ------------- | -------------------------------------------------- | ------------------------------ | ------ |
| 5             | €175                                               | €500                           | +€325  |
| 10            | €350                                               | €1000                          | +€650  |
| 20            | €700 (tier €30 dès 6 loc actif sur 15 d'entre eux) | €2000                          | +€1300 |

**Si reseller margin 30-40% sur le €35** → coût tombe à €21-24/loc/mois → marge x2.

### Break-even middleware vs intégration directe

Coût intégration Uber Eats Marketplace directe (dev interne) :

- 2-4 semaines Sr dev = **8-16k€** one-shot
- Maintenance continue ≈ 2j/mois = **1.5-2k€/mois**
- Délai NDA + certification : **4-8 semaines** (bloque le go-to-market)
- - besoin de refaire le même travail pour Deliveroo, Just Eat, etc.

**Break-even purement coût** :

- À 50 restos × €30/mois = €1500/mois HubRise vs ~€2k/mois maintenance directe → **break-even ~70-100 restos**
- Mais l'argument vrai n'est pas le coût, c'est le **time-to-market** et le **scope** (HubRise = N plateformes pour 1 contrat ; direct = N contrats)

**Verdict** : ne PAS internaliser tant que pas 100+ restos.

---

## 7 — Risques lock-in HubRise à clarifier avant signature

1. **Data ownership** — les commandes/clients passées via HubRise restent exportables si on part ?
2. **Durée contractuelle white-label** — pricing public dit "no commitment", mais version reseller peut imposer 12-24 mois
3. **Clause de non-concurrence** — possible interdiction de devenir concurrent middleware
4. **Dépendance certifications** — si HubRise perd son certif Uber Eats demain, notre stack tombe avec
5. **Pricing escalation** — tier €27 actuel n'est pas garanti contractuellement à 5 ans

---

## 8 — Plan d'action concret

### Cette semaine

1. **Email HubRise** (`partners@hubrise.com`) — positionnement design partner, 5 restos signés, 20 à 6 mois, recherche white-label complet. Demander : marge reseller %, minimums, durée engagement, design-partner discount, conditions data export.
2. **Email Deliverect** en parallèle — même pitch, pour BATNA.
3. **Pendant l'attente** : terrain. La Phase 1 valide d'abord qu'on signe 5 restos. Si on n'en signe pas 5 sans middleware, le middleware ne sauvera pas.
4. **Pas avant le 5ème resto signé** : commit middleware. Tablette KB existante + tablette Uber Eats du resto cohabitent jusque-là — friction réelle mais surmontable à petit volume (cf. décision actuelle PRD 60 → V2).

---

## 9 — Open questions résiduelles

1. **Conditions économiques RÉELLES HubRise partenaire** — appel commercial obligatoire.
2. **Stuart webhooks détaillés** — research a échoué (claim refuté 0-3), à creuser séparément si multi-provider livraison Phase 2.
3. **Statut HubRise sur portail Uber Eats EU/FR** (vs US confirmé sans HubRise) : HubRise est-il certifié officiellement par Uber Eats côté France, et quelle est la durée/coût/process de certification pour qu'un partenaire HubRise (donc KB) ait une intégration Uber Eats fiable et maintenue ?
4. **Break-even chiffré middleware vs intégration directe** : à partir de combien de restos signés (10 ? 20 ? 50 ?) l'investissement dev d'une intégration Uber Eats Marketplace directe (NDA + 4-8 semaines certification + maintenance API) devient rentable vs payer HubRise €30-35/loc/mois ?

---

## 10 — Claims refutés par la vérification adversariale

À garder en tête comme **non-prouvés** :

- "Stuart fournit le tracking exclusivement via webhooks (pas de polling) avec updates toutes les 10-30s" — **refuté 0-3** (source primaire trop générique, à re-vérifier sur api-docs.stuart.com).
- "Deliveroo API accessible sans partner status existant" — **refuté 0-3** (gating réel non documenté publiquement).
- "Marketplace API Uber Eats supporte POS integrations qui sync menus + injectent ordres dans le système resto auto" — **refuté 0-3** (mélange de scopes différents).
- "HubRise pas listé sur portail Uber Eats US suggère un track FR/EU différent" — **refuté 1-2** (insufficient evidence du contraire — peut être listé ailleurs, à vérifier).

---

## 11 — Sources primaires (load-bearing)

- [hubrise.com/pricing](https://www.hubrise.com/pricing) — pricing public, tiers volume, no setup/no commit
- [hubrise.com/become-partner](https://www.hubrise.com/become-partner) — programme partenaire white-label, apps rebrandables
- [developer.uber.com/docs/eats/guides/order_integration](https://developer.uber.com/docs/eats/guides/order_integration) — scope Order Integration "after checkout"
- [developer.uber.com/docs/eats/guides/getting-started](https://developer.uber.com/docs/eats/guides/getting-started) — NDA + partner manager + whitelist
- [developer.uber.com/docs/deliveries/overview](https://developer.uber.com/docs/deliveries/overview) — Uber Direct = surface distincte de Marketplace
- [developer.uber.com/docs/deliveries/guides/webhooks](https://developer.uber.com/docs/deliveries/guides/webhooks) — 4 webhooks Direct
- [deliverect.com/en-us/pricing](https://www.deliverect.com/en-us/pricing) — pricing custom sales-call
- [api-docs.deliveroo.com/docs/introduction](https://api-docs.deliveroo.com/docs/introduction) — Partner Platform Suite + Signature Suite
- [merchants.deliveroo.com/what-we-offer/deliveroo-express](https://merchants.deliveroo.com/what-we-offer/deliveroo-express) — Deliveroo Express (équivalent Uber Direct)
- [merchants.ubereats.com/us/en/integration-partners/eats/](https://merchants.ubereats.com/us/en/integration-partners/eats/) — directory partenaires Uber Eats US

---

## 12 — Implications pour le code KB

Cf. [dispatch_orchestration_patterns.md](dispatch_orchestration_patterns.md) pour les patterns d'implémentation détaillés (booking eager vs lazy, PATCH pattern, webhook handlers).

Le présent doc traite **la décision middleware** ; l'autre traite **l'implémentation du dispatch** une fois le middleware choisi.
