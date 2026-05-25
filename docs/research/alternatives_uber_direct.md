# Alternatives à Uber Direct — Livraison à la demande restaurant France

**Date** : 2026-05-20
**Source** : Deep research consolidée
**Complément à** : [docs/research/uber_direct_deep_dive.md](uber_direct_deep_dive.md)
**Objectif** : Identifier les fournisseurs de livraison à la demande disponibles en France pouvant remplacer ou compléter Uber Direct, pour éviter la dépendance à un seul acteur, négocier les tarifs, et offrir un fallback technique.

---

## TL;DR

En France, **3 alternatives crédibles** existent à côté d'Uber Direct :

1. **Stuart** (Geopost/La Poste) — alternative #2 FR, ~80 villes, API REST mature, leader hors Uber
2. **Deliveroo Express / Signature** — white-label avec API mais onboarding ~8 semaines, pas open self-serve
3. **Yper** (ex-You2You) — ~20 villes FR, modèle dual collaboratif + coursiers hub, API publique documentée

**Acteurs disqualifiés en France** : DoorDash Drive, Wolt Drive (groupe DoorDash), Lalamove, Just Eat / Scoober (retrait FR acté), Glovo (présence FR marginale), Bolt Food (pas d'API courier publique).

**Pour l'orchestration multi-couriers** : **Bringg** est partenaire officiel d'Uber Direct France et orchestre 250+ carriers. **Onfleet** est plus tech-first. À ne pas adopter en Phase 1 — implémenter d'abord un simple fallback interne `try Uber Direct → catch → try Stuart`.

---

## 1. Tableau récap

| Acteur | Dispo FR | Pricing sourcé | API publique | Couverture FR | Cas d'usage |
|---|---|---|---|---|---|
| **Uber Direct** *(référence)* | ✅ | ~5,90€ HT/course | ✅ | **360+ villes** | Restaurant, retail |
| **Stuart** | ✅ | ~7,50€ vélo entrée gamme (sources tierces) | ✅ REST + webhooks 10-30s | **~80 villes** | Restaurant + retail urbain |
| **Deliveroo Express / Signature** | ✅ | Sur devis, non publié | ✅ Signature API | Zones Deliveroo FR | White-label restaurant |
| **Yper** (ex-You2You) | ✅ | Sur devis | ✅ documentée | ~20 villes (Paris, Bordeaux, Lille, Nantes, Marseille…) | Courses, retail, parfois resto |
| **DoorDash Drive** | ❌ | $4-9 US | ✅ accès restreint | 0 (US, CA, AU, NZ) | N/A FR |
| **Wolt Drive** | ❌ | Non publié | ✅ | 0 en FR (DE, AT, Nordics…) | N/A FR |
| **Glovo LaaS** | ⚠️ marginal | Non publié | ✅ | Présence FR limitée | Multi-secteurs |
| **Just Eat Logistics (Scoober)** | ❌ | N/A | ✅ | **Retrait FR acté** | N/A FR |
| **Bolt Food** | ⚠️ partiel | Non publié | ❌ (scraping uniquement) | Quelques villes (Lyon, Lille…) | Marketplace, pas Direct |
| **Lalamove** | ❌ | Sur demande | ✅ | 0 en FR | N/A FR |
| **CoopCycle / Olvo** | ✅ | Devis (CDI coursiers) | Open-source Coopyleft | Paris, Bordeaux, Nantes, Grenoble, Strasbourg | Éthique, courses |
| **Chronopost Sameday** | ✅ | Chrono13 ~36€ HT | ✅ EDI La Poste | National + IDF 2h slot | Colis, **pas chaud-resto** |

---

## 2. Section détaillée par acteur

### Stuart (Geopost / La Poste) — Alternative #1

Filiale 100% Geopost depuis 2017, exploitant ~80 villes FR. Modèle 100% usage-based, pas de commission sur les repas. Trois tiers tarifaires : **SMB** (jusqu'à 500 livraisons/mois), **Mid-Market**, **Enterprise** (5000+/mois, accès API complet selon page UK — à challenger pour FR).

- **API** : REST publique sur `api-docs.stuart.com`, clients PHP/C# officiels, webhooks 10-30s avec géoloc courier
- **Forces** : couverture FR la plus large hors Uber, multi-véhicule (vélo→VL), pas de commission produit, intégrations Shopify natives
- **Faiblesses** : pricing FR pas publiquement comparable, full API access potentiellement réservé au tier Enterprise (à confirmer en négo)
- **Intégrations restau connues** : Shopify, OrderTiger, Voila, HubRise

### Deliveroo Express / Signature

Solution white-label de Deliveroo : "Signature API" pour requérir un coursier Deliveroo sur une commande gérée par le SI du restaurant. Disponible en France. Setup ~8 semaines, donc plus lourd qu'Uber Direct ou Stuart.

- **API** : Partner Platform Suite + Signature Suite sur `developers.deliveroo.com`
- **Forces** : densité rider sur les zones urbaines déjà couvertes par la marketplace Deliveroo
- **Faiblesses** : pas de pricing publié, onboarding long, partenariat sur sélection (pas open self-serve)

### Yper (ex-You2You)

Plateforme française, acquisition You2You en 2019, partenariat DHL Express. Modèle dual : livraison collaborative (clients qui font le détour) + coursiers hub salariés. Présent dans ~20 villes FR.

- **API** : page `yper.fr/integration-api` documentée
- **Forces** : alternative locale FR, positionnement éco-responsable, couverture villes secondaires
- **Faiblesses** : positionnement courses/retail dominant, restau pas son cœur de cible, volume rider en heure pointe non garanti vs Uber/Stuart

### CoopCycle / Olvo — Niche éthique

Fédération de coopératives de cyclo-logistique, logiciel open-source sous licence **Coopyleft** (réservée coops/non-profit). Olvo (Paris) salarie ses coursiers en CDI.

- **Pas une API SaaS classique** — intégration via software open-source, modèle B2B ad-hoc
- **Forces** : argument éthique fort, peut être différenciant côté marque resto
- **Faiblesses** : volume rider faible, pas d'engagement de couverture 7j/7 à la minute, pas adapté à un fallback automatique

### Chronopost Sameday — Hors-sujet repas chaud

Existe mais cible colis, pas isothermie restaurant chaud. Chrono Precise = créneau 2h IDF, pas du "30 min express". À écarter sauf pour produits resto non-chauds (épicerie, traiteur événementiel à J+0).

### Acteurs disqualifiés

- **DoorDash Drive, Wolt Drive, Lalamove** : pas en FR. À monitorer pour expansion internationale future.
- **Just Eat / Scoober** : retrait FR acté ("Au Revoir Just Eat"). En FR, ils opéraient déjà via partenariat Stuart depuis 2022 → courier réel = Stuart.
- **Glovo** : présence FR marginale (cœur ES/IT/PT/LATAM).
- **Bolt Food** : pas d'API "Bolt Drive" white-label publique FR. Les "API Bolt Food" trouvées sont du scraping tiers.
- **Shippo, EasyPost, Shipfusion** : aggregators colis/e-commerce, pas adaptés au last-mile restaurant chaud temps réel.
- **Pony Mobility** : trottinettes/mobilité personnelle, pas un courier B2B.

---

## 3. Orchestrateurs multi-courriers

### Bringg — Le plus crédible pour KB

**Partenaire officiel d'Uber Direct en France** (PR newswire). Plateforme d'orchestration avec 250+ carriers intégrés (FedEx, UPS, DHL, **Uber**, **DoorDash**, **Deliveroo**…). Règles configurables coût/capacité/SLA, fallback automatique entre courriers.

- **Pertinent KitchenBoost** : si on veut un overlay "smart routing" qui choisit Uber Direct → Stuart → Deliveroo selon dispo, Bringg est le candidat naturel
- **Faiblesse** : tarification entreprise, complexité d'intégration vs un appel API direct par fournisseur

### Onfleet

Évolue en 2026 vers "delivery orchestration platform powered by AI". Plus tech-first, plus simple d'intégration, programme partenaires/intégrations actif. Moins de carriers natifs que Bringg.

### Nash, Shipday, Olo Dispatch — US-centric

Orchestrateurs solides mais centrés US, pas de signal explicite d'intégration native Stuart/Uber Direct FR. À écarter pour KB FR.

---

## 4. Recommandation KitchenBoost — Stack courier

### Phase 1 (MVP)

**1 fournisseur unique** : **Uber Direct**. Pas de complexité multi-courrier dès le départ. Couverture 360+ villes FR couvre 100% de notre besoin terrain (Vanves, Malakoff, Levallois, 14e/15e Paris, Nanterre, etc.).

### Phase 2 (10+ restos actifs)

**Ajouter Stuart en fallback** :
- Ouvrir un compte Stuart Aggregator/Enterprise — négocier la grille
- Implémenter en interne une logique simple `try Uber Direct → catch → try Stuart`
- Pas besoin de Bringg encore (overkill pour 10-20 restos)

**Action commerciale immédiate à valider** : demander à Stuart une grille tarifaire France 2026 par tier de volume et confirmer si l'accès API complet est réellement bloqué au tier Enterprise (page UK le suggère) ou ouvert en Mid-Market FR — **c'est le risque #1 sur l'option Stuart**.

### Phase 3 (50+ restos actifs ou changement contractuel Uber)

**Évaluer Bringg ou Onfleet** comme orchestrateur :
- Si Uber annonce un changement défavorable (hausse tarif, restrictions API) → Bringg permet de pivoter
- Sinon, rester sur un fallback interne simple suffit

### Acteurs ciblés cas par cas

- **Deliveroo Signature** : uniquement si on a un resto sur zone Deliveroo très dense où Uber + Stuart manquent de capacité. Onboarding 8 semaines → à anticiper
- **Yper** : option de complément sur villes moyennes où Uber/Stuart sont faibles (à tester resto par resto)
- **Olvo / CoopCycle** : argument marketing éthique si un resto le demande explicitement, pas en fallback automatique

### Acteurs à ne pas perdre de temps à creuser

DoorDash Drive, Wolt Drive, Lalamove, Just Eat, Chronopost (mauvais cas d'usage), Bolt Food (pas d'API), Glovo (présence FR marginale).

---

## 5. Comparaison rapide vs Uber Direct

| Critère | Uber Direct | Stuart | Deliveroo Express |
|---|---|---|---|
| Couverture FR | **360+ villes** | ~80 villes | Zones Deliveroo |
| Pricing entrée | **~5,90€ HT** | ~7,50€ (sources tiers) | Sur devis |
| API publique | ✅ doc complète | ✅ doc complète | ✅ partenaires sélectionnés |
| Multi-tenant officiel | ✅ Organizations API | ✅ Aggregator tier | ⚠️ à valider |
| Onboarding self-serve | ✅ < 2h | ✅ inscription web | ❌ 8 semaines |
| Webhooks | ✅ HMAC SHA-256 | ✅ 10-30s polling | ✅ |
| Sandbox | ✅ | ✅ | ✅ |

**Reading** : Uber Direct gagne sur couverture + pricing entrée + onboarding rapide. Stuart est un fallback solide avec une couverture plus restreinte mais une qualité API équivalente et une image "éthique" La Poste exploitable côté marketing.

---

## 6. Sources

- [Stuart — Delivery for restaurants](https://stuart.com/delivery-restaurant-food/)
- [Stuart — Pricing](https://stuart.com/pricing/)
- [Stuart API docs](https://api-docs.stuart.com/)
- [Stuart — Order Tracking API best practices](https://stuart.com/developers/best-practices/order-tracking/)
- [Stuart tarifs coursier FR](https://info.stuart.com/fr/coursier-tarifs)
- [Deliveroo Express white-label](https://merchants.deliveroo.com/what-we-offer/deliveroo-express)
- [Deliveroo Developer Portal](https://developers.deliveroo.com/)
- [Deliveroo Partner Platform API intro](https://api-docs.deliveroo.com/docs/introduction)
- [Yper — page intégration API](https://www.yper.fr/integration-api)
- [Yper — site officiel](https://www.yper.fr/)
- [DoorDash Drive — Build for Restaurants](https://developer.doordash.com/en-US/docs/drive/how_to/build_for_restaurants/)
- [Wolt Drive overview — Developers](https://developer.wolt.com/docs/wolt-drive)
- [Glovo LaaS Partners API](https://logistics-docs.glovoapp.com/laas-partners/index.html)
- [Just Eat Takeaway Developer Portal](https://developers.just-eat.com/)
- [Modern Delivery — Just Eat leaves France](https://moderndelivery.substack.com/p/au-revoir-just-eat-takeaway-leaves)
- [Lalamove Developers](https://developers.lalamove.com/)
- [Bringg ↔ Uber Direct France partnership](https://www.prnewswire.com/news-releases/bringg-partners-with-uber-direct-in-france-enabling-retailers-to-improve-customer-experience-301621900.html)
- [Bringg vs Onfleet](https://www.bringg.com/resources/bringg-vs-onfleet)
- [Onfleet 2025 recap → orchestration platform](https://onfleet.com/blog/2025-onfleet-recap/)
- [Olo Dispatch](https://www.olo.com/dispatch)
- [Shipday — Restaurant Delivery](https://www.shipday.com/use-cases/restaurants)
- [CoopCycle](https://coopcycle.org/)
- [Olvo — Ville de Paris](https://www.paris.fr/pages/olvo-les-velos-cargos-au-service-de-la-livraison-6956)
- [Chronopost Sameday](https://www.chronopost.fr/en/delivery/our-offers/chrono-sameday)
