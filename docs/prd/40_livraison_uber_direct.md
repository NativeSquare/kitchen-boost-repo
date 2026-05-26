# 40 — Livraison Uber Direct

**Statut** : 🟡 Squelette · **Version** : 0.3 · **Dernière mise à jour** : 2026-05-24
**Lié au master** : [00_master.md § 5 bloc 5](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.3** : Grilling DDD acté 2026-05-24 — flow address-first, tracking client Lottie SVG (pas de map V1), 3 cas distincts d'incident livraison (course refusée Uber / courier annule avant pickup / incident après pickup / client absent), frais d'attente courier à charge resto + notif KDS, pas de tip V1, pas de review V1 (V2 → Google Reviews jamais Uber Eats), horaires KB source de vérité, click & collect activé par défaut, choix client au checkout.
> **v0.2** : Scope V1 étendu suite révision master v2.0. Mode click & collect **dès V1** (modulable par resto). Intégration avec moteur pricing [35](35_pricing_engine.md) (quote Uber Direct → règles → part client / part resto).

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | Self-signup Uber Direct par resto (direct.uber.com), credentials API stockés par tenant, création course au paiement validé, webhooks statut par tenant, **address-first flow PWA** (Google Places autocomplete obligatoire à l'arrivée, quote déclenché avant accès menu), **tracking client = animations Lottie SVG par étape + ETA texte** (pas de map, white-label total), **mode click & collect activé par défaut** pour tout nouveau tenant (choix client au checkout entre livraison/C&C, pas de switch resto V1), **horaires de service KB source de vérité** (configurés Phase C onboarding, modifiables [[KB Admin]] resto, créneau unique partagé livraison + C&C), **hors plage = checkout bloqué** (pas de pré-commande V1), **3 cas distincts d'incident livraison** (course refusée Uber post-paiement → refund auto / courier annule avant pickup → re-dispatch silencieux Uber + push "petit retard" si glisse >10 min / incident après pickup → refund auto + push "incident" / client absent `returned` → pas de refund auto + push "contacte le resto"), **frais d'attente courier à charge resto** (notif KDS T-3 min si cmd pas prête), **pas de tip courier V1**, **pas de review post-livraison V1**, **intégration moteur pricing** [35](35_pricing_engine.md). |
| **V2**  | Integration Partner Uber (candidature post-8 restos), Organizations API parent + sub-accounts (1 webhook central), **fallback Stuart** si Uber Direct refuse ou cher, choix de courier configurable, **review post-livraison vers Google My Business du resto (JAMAIS Uber Eats)** avec smart-routing 4★+→Google / <4★→KB privé, tip courier optionnel au checkout, horaires séparés livraison vs C&C si demande terrain, map embed tracking si demande terrain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **V3**  | Orchestration multi-courier intelligente (Bringg, ou propriétaire), livraison KB propre (flotte coursiers indépendants ou marque propre). Pré-commande (paie maintenant, livraison à 18h30).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Hors scope

- Livraison interne resto (par staff du resto) — pas géré par KB.
- Tracking GPS courier custom temps réel — V1 = Lottie + ETA texte seulement, pas de map live.
- Pré-commande (planifier livraison à un horaire futur) — V3.
- Tip courier (pourboire) — V2 si demande terrain.
- Review post-livraison — V2 (ciblera Google My Business, jamais Uber Eats).

## Personas concernés

- **Restaurateur** (paie la livraison, suit les courses)
- **Client final mangeur** (voit le statut courier sur PWA)
- **Cuisinier** (voit ETA courier sur KDS pour timer la préparation)

## Surface fonctionnelle (sections à remplir)

### 1. Onboarding Uber Direct par resto

- V1 : self-signup `direct.uber.com` (le resto crée son compte avec SIRET, KBIS, RIB)
- KB récupère `customer_id` Uber + `client_id`/`client_secret` OAuth de l'API
- Stockage credentials chiffrés par tenant via **envelope encryption Convex** (brique foundation `lib/crypto` + table `tenantCredentials`, master key `KMS_MASTER_KEY` ; cf. [STACK §2.5](../contexts/_architecture/STACK.md)). Pas de Supabase Vault.
- Webhook URL configurée : `api.kitchenboost.fr/webhooks/uber/<tenant_id>`
- Test course sandbox au RDV install

### 2. Address-first flow + vérif zone livraison

- **À l'arrivée sur la PWA** (avant accès au menu) : Sophie indique son adresse via Google Places autocomplete obligatoire (saisie libre interdite)
- Dès saisie : call API `POST /delivery_quotes` Uber Direct avec adresse client + check plage horaire (source de vérité KB, cf. Section 1bis)
- Si quote OK : mode livraison ouvert, frais livraison affichés pour le reste du parcours, accès au menu
- Si quote refusé (hors zone / hors horaire / surge bloquant) : mode livraison **verrouillé**, seul C&C reste accessible avec message contextualisé :
  - Hors zone → "Cette adresse est trop éloignée du resto. Essaie une autre adresse ou viens chercher (click & collect)."
  - Hors horaire → "Le resto est fermé, ouvre à 18h30."
  - Surge bloquant → "Indisponible à cet horaire, réessaie dans quelques minutes."
- Le client peut modifier son adresse à tout moment → re-déclenche un quote
- Quote re-capturé au paiement pour anti-surge (latching, cf. [35](35_pricing_engine.md))

### 2bis. Horaires de service (KB source de vérité)

- Configuré en Phase C onboarding depuis [[KB Admin]], modifiable par le resto à tout moment
- Créneau unique partagé livraison + click & collect V1 (horaires séparés V2 si demande)
- Hors plage côté client = checkout bloqué, pas de paiement possible (pré-commande V3)
- Uber Direct est backup uniquement (refus quote si Khan oublie de synchro Uber)

### 3. Création course Uber Direct

- Trigger : webhook Stripe `payment_intent.succeeded` reçu
- Backend appelle API `POST /deliveries` avec :
  - Pickup (adresse resto)
  - Dropoff (adresse client)
  - Manifest items (récap commande, juste pour les coursiers)
  - Référence externe (`order_id` KB)
- Stockage de la course dans la table dédiée `deliveries` (`uberDeliveryId`, `status`, FK vers l'order, scopée par tenant) — pas comme colonne sur `orders`
- Notif KDS resto : nouvelle cmd avec ETA courier

### 4. Suivi statut courier — Tracking client PWA

- Webhook reçoit événements Uber Direct (status_changed, courier_assigned, courier_arrived_at_pickup, courier_picked_up, courier_arrived_at_dropoff, delivered, returned, canceled, failed)
- Mise à jour du `status` dans la table dédiée `deliveries`
- Push notif client + KDS sur transitions
- **V1 : animations Lottie SVG par étape + ETA texte** (pas de map, pas de tracking_url Uber, white-label total)
- 6 étapes mode livraison : `Cmd reçue` → `En préparation` → `Courier assigné` (prénom courier + ETA pickup) → `Courier en route vers le resto` → `Courier en route vers toi` → `Livrée` (push "Bon appétit ! 🍽️", pas de demande de review V1)
- 3 étapes mode click & collect : `Cmd reçue` → `En préparation` (ETA prête dans X min) → `Prête à récupérer` (push "ta cmd t'attend chez [resto]")

### 5. Gestion incidents — 4 cas distincts V1

**Cas A — Course refusée par Uber post-paiement** (Q40-Q6 acté) :

- Quote validé en amont mais Uber refuse `POST /deliveries` (zone bloquée last min, surge bloquant, erreur Uber)
- → **Refund auto immédiat** + push client "désolé, livraison non disponible, tu as été remboursé"
- Cuisine non notifiée (cmd jamais transmise au KDS)

**Cas B — Courier annule avant pickup** :

- Uber Direct re-dispatche silencieusement (statut reste `pending`/`pickup`, juste nouveau `courier_update`)
- KB relaie le nouveau courier sur tracking client + KDS, **pas de message d'incident**
- Push client "petit retard ⏰" UNIQUEMENT si glisse d'ETA cumulée > 10 min
- Pas de refund

**Cas C — Incident après pickup** (events `canceled` / `failed` Uber) :

- → **Refund auto total immédiat** + push client "incident livraison, tu as été remboursé, désolé" (animation Lottie incident)
- KB Orders : cmd marquée "incident — non livrée"
- Resto récupère jusqu'à 60 €/cmd via process refund Uber natif (KB n'intervient PAS)

**Cas D — Client absent** (event `returned`) :

- Courier attend ~10 min, ramène la cmd au resto. Le resto paie la course retour.
- → **Pas de refund auto** (client en faute) + push "le coursier ne t'a pas trouvé, contacte le resto au [num] pour récupérer ta cmd"
- KB Orders : cmd marquée "client absent" + bouton refund manuel (decision resto)

**Frais d'attente courier au pickup** :

- Refacturés direct au resto par Uber (`BILLING_TYPE_DECENTRALIZED`), KB n'intervient pas
- KB rend visible KDS : timer pickup ETA sur ticket + push tablette T-3 min si "prête" pas cochée → "⚠️ Courier arrive bientôt, cmd #X pas encore prête"
- Aucune notif client final (coulisses cuisine)

**Fallback courier (V2)** :

- Timeout >20 min sans pickup → escalade auto Stuart V2 (V1 = pas de fallback, juste alerte ops)

### 6. V2 : Integration Partner + Organizations API

- Une fois 8+ restos installés, candidater Uber Integration Partner (`direct-fr@uber.com`)
- Migration vers Organizations API : 1 compte parent KB, sub-accounts par resto
- 1 seul webhook URL `api.kitchenboost.fr/webhooks/uber` pour tous les tenants (vs 1 par tenant en V1)
- Self-serve onboarding par email (si dispo en FR)

### 7. V2 : Fallback Stuart

- Intégration Stuart API
- Logique de routing : Uber Direct si dispo + quote acceptable, sinon Stuart
- Activable par tenant (opt-in resto)

## Flows nominaux

1. **Course livrée nominale** : Sophie arrive sur PWA → indique adresse Google Places → quote OK → accède au menu → compose panier → checkout → paiement validé → KB crée course Uber Direct → courier assigné en 2-5 min → tracking Lottie "Courier assigné" → cmd remise par cuisine → courier collecte → courier livre → push client "Bon appétit ! 🍽️" (pas de demande review V1).
2. **Adresse hors zone à l'entrée** : Sophie indique adresse → quote refusé hors zone → mode livraison verrouillé, message "trop éloignée, essaie une autre adresse ou viens chercher (C&C)". Elle peut basculer en C&C ou changer d'adresse.
3. **Hors horaire** : Sophie indique adresse à 15h → message "Le resto est fermé, ouvre à 18h30." Checkout bloqué.
4. **Course refusée par Uber au paiement** : refund auto + push client + alerte Slack ops + monitoring.
5. **Courier annule avant pickup** : Uber re-dispatche silencieusement, ETA glisse, push "petit retard ⏰" si glisse >10 min.
6. **Incident après pickup** : refund auto total + push "incident, désolé, tu as été remboursé".
7. **Client absent** : courier `returned` → cmd ramenée au resto, pas de refund auto, push "contacte le resto au [num]".

## Edge cases

- **Adresse client erronée** (Google Places confirmation insuffisante) : Uber peut refuser au pickup. Mitigation : confirmer adresse exacte au checkout via Google Places.
- **Resto a oublié de mettre cmd "prête"** : courier arrive et attend → frais d'attente Uber facturés au resto. Mitigation : push notif insistante KDS.
- **Plusieurs cmds simultanées** : créer X courses Uber Direct distinctes. Uber gère le scheduling courier.
- **Cmd modifiée pendant prep** (V3) : Uber Direct ne supporte pas modif après création → annuler course + recréer.
- **Refund après création course** : annulation Uber Direct si pas encore picked up. Si picked up, ne pas refund (cmd en route).
- **Couverture Uber Direct sur une zone non Paris** : tester en S0 via quote API pour chaque resto.
- **Surge pricing** : Uber peut bump le tarif en heures de pointe. Le quote au checkout capture le tarif. Mais si la course est créée 30 min après, peut diff. Mitigation : capture quote au paiement, pas en panier.

## Critères de succès / acceptation

### V1

- [ ] Onboarding Uber Direct par resto en < 24h (validation Uber).
- [ ] Quote au checkout en < 2 sec.
- [ ] Création course après paiement en < 5 sec.
- [ ] 95% des courses Uber Direct livrées sans incident sur 30j.
- [ ] Webhook latence < 5 sec moyenne.
- [ ] 0 cmd payée mais non livrée sans alerte ops.

### V2

- [ ] Stuart fallback testé sur 5+ courses réelles.
- [ ] Migration Organizations API faite (post-IP cert).
- [ ] Webhook centralisé fonctionnel.

## Dépendances

| Dépendance                                                                                          | Type    | Bloque quoi                                        |
| --------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| Uber Direct API                                                                                     | Externe | Tout                                               |
| Couverture Uber Direct zone du resto                                                                | Externe | Onboarding nouveau resto                           |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md)                                      | Interne | Trigger création course (webhook Stripe)           |
| [10_pwa_client_commande.md](10_pwa_client_commande.md)                                              | Interne | Section 2 quote + section 4 suivi                  |
| [20_kb_orders.md](20_kb_orders.md)                                                                  | Interne | Affichage ETA courier + erreurs                    |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)                                                  | Interne | Stockage credentials Uber par tenant + chiffrement |
| [80_notifications.md](80_notifications.md)                                                          | Interne | Section 4 push statut client                       |
| Pré-existant : [docs/research/uber_direct_deep_dive.md](../research/uber_direct_deep_dive.md)       | Interne | Doc technique d'exploration                        |
| Pré-existant : [docs/research/alternatives_uber_direct.md](../research/alternatives_uber_direct.md) | Interne | Stuart V2                                          |
| Pré-existant : [docs/research/uber_integration_partner.md](../research/uber_integration_partner.md) | Interne | IP candidature V2                                  |

## Open questions

| Q      | Question                                                                                                                                                                                                                                                                                                                                                          | Deadline | Owner                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| 40-Q1  | Tarif Uber Direct exact zone IDF (5,90€ HT public ou négociable au volume) ?                                                                                                                                                                                                                                                                                      | V1 S0    | Alex — call AM (Q1 master) |
| 40-Q2  | Self-serve onboarding par email actif en FR 2026 ?                                                                                                                                                                                                                                                                                                                | V2       | Alex — call AM (Q2 master) |
| 40-Q3  | Organizations API parent + sub-accounts accessible en FR sans contrat US ?                                                                                                                                                                                                                                                                                        | V2       | Alex — call AM (Q3 master) |
| 40-Q4  | Webhook centralisé (1 URL multi-tenant) ou par tenant ?                                                                                                                                                                                                                                                                                                           | V1/V2    | Alex — call AM (Q4 master) |
| 40-Q5  | Couverture Buns & Bao 75019 — quote test OK ?                                                                                                                                                                                                                                                                                                                     | V1 S0    | Dev lead                   |
| 40-Q6  | ~~En cas de course refusée par Uber post-paiement, refund client immédiat ou différé ?~~ **ACTÉ 2026-05-24** : V1 = refund auto immédiat dès échec API/webhook. Push client "désolé, livraison non disponible, tu as été remboursé". Pas de proposition alternative (cross-resto / C&C) V1.                                                                       | —        | —                          |
| 40-Q7  | ~~Tracking GPS courier visible client (map embed) ou texte simple ?~~ **ACTÉ 2026-05-24** : V1 = animations Lottie SVG par étape + ETA texte live, pas de map, white-label total côté client (aucun branding Uber visible). V2 envisagera map si demande terrain.                                                                                                 | —        | —                          |
| 40-Q8  | ~~Click & collect activé par défaut ou opt-in resto ?~~ **ACTÉ 2026-05-24** : V1 = livraison + C&C tous deux activés par défaut, choix laissé au client final au checkout PWA. Pas de switch resto V1 (V2 si demande).                                                                                                                                            | —        | —                          |
| 40-Q9  | ~~Horaires de service : source de vérité KB ou Uber Direct ?~~ **ACTÉ 2026-05-24** : KB = source de vérité, configuré Phase C onboarding, modifiable [[KB Admin]] resto. Créneau unique partagé livraison + C&C V1 (séparés V2 si demande). Hors plage = checkout bloqué (pas de pré-commande V1).                                                                | —        | —                          |
| 40-Q10 | ~~Tip courier au checkout ?~~ **ACTÉ 2026-05-24** : hors scope V1. V2 = encart optionnel (1€/2€/5€/Autre, défaut Aucun) si demande terrain.                                                                                                                                                                                                                       | —        | —                          |
| 40-Q11 | ~~Review post-livraison cible Uber Eats ou autre ?~~ **ACTÉ 2026-05-24** : V1 = pas de review du tout. **V2 = cible EXCLUSIVEMENT Google My Business du resto, JAMAIS Uber Eats** (principe : KB capte off-platform, ne réalimente pas le moat Uber, construit le moat Google qui survit même si Uber suspend). Smart-routing 4★+ → Google / <4★ → form privé KB. | —        | —                          |
| 40-Q12 | ~~Frais d'attente courier au pickup : qui assume ?~~ **ACTÉ 2026-05-24** : à charge resto (cohérent `BILLING_TYPE_DECENTRALIZED`). KB rend visible KDS : timer pickup ETA + push T-3 min si "prête" pas cochée. Pas de notif client.                                                                                                                              | —        | —                          |
| 40-Q13 | ~~Gestion incidents post-création course : un seul flow ou différencié ?~~ **ACTÉ 2026-05-24** : 4 cas distincts V1 (course refusée Uber / courier annule avant pickup → re-dispatch silencieux / incident après pickup → refund auto / client absent → pas de refund auto, le resto décide via bouton manuel KB Orders).                                         | —        | —                          |
| 40-Q14 | ~~Address-first flow ou menu-first ?~~ **ACTÉ 2026-05-24** : address-first comme Uber Eats. Adresse Google Places obligatoire à l'arrivée PWA avant accès menu. Quote déclenché immédiatement. Si refus → mode livraison verrouillé, seul C&C accessible.                                                                                                         | —        | —                          |

## Notes / décisions actées

- **V1 = self-signup par tenant**, pas Integration Partner (cf. [docs/research/uber_integration_partner.md](../research/uber_integration_partner.md)).
- **Webhook par tenant en V1** (`api.kitchenboost.fr/webhooks/uber/<tenant_id>`). Migration vers webhook centralisé post-IP cert.
- **Pas de fallback courier V1** : si Uber Direct refuse, on annule. Stuart en V2.
- **Article 1.1 contrat** désigne Uber Portier B.V. comme exploitant Uber Direct (livraison à la demande pour le compte du restaurateur).
- **Article 2 contrat** : la livraison physique est opérée par les coursiers Uber et n'incombe pas au Partenaire. KB n'intervient pas dans le flux logistique.

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création squelette.                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-23 | 0.2     | Alex (via Claude) | Extension scope V1 : click & collect modulable, intégration moteur pricing [35](35_pricing_engine.md).                                                                                                                                                                                                                                                     |
| 2026-05-24 | 0.3     | Alex (via Claude) | Grilling DDD acté : address-first flow, tracking client Lottie SVG (pas de map V1), 4 cas distincts d'incident livraison, frais d'attente resto + notif KDS, pas de tip V1, pas de review V1 (V2 → Google jamais Uber Eats), horaires KB source de vérité créneau unique, click & collect activé par défaut choix client checkout. Q40-Q6 à Q40-Q14 actés. |
