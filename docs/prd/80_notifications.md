# 80 — Notifications (push, email, SMS)

**Statut** : 🟢 Actée · **Version** : 0.3 · **Dernière mise à jour** : 2026-05-24
**Lié au master** : [00_master.md § 5 bloc 11](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)
**ADRs liés** : [0002 push moat dual stack](../adr/0002-push-moat-dual-stack-wallet-a2hs.md), [0003 wallet pass commun marque neutre](../adr/0003-wallet-pass-commun-marque-neutre.md), [0005 re-consentement par achat](../adr/0005-re-consentement-marketing-par-achat.md), [0006 templates pré-validés](../adr/0006-templates-campagnes-pre-valides.md)

> **v0.3** : Propagation complète de la session grilling 2026-05-24. Architecture moteur Notifications comme bounded context isolé. Cascade marketing PWA > Wallet > Email (tenant) et Wallet > Email (cross-tenant). 3 catégories transactionnelles (Archive / Temps-réel / Info statut). Templates pré-validés pour campagnes tenant (ADR 0006). Re-consentement automatique par achat (ADR 0005). Géo-filtrage cross-tenant amont. SMS = extreme fallback uniquement. Désactivation SMS Uber Direct natif au profit du tracking propre KB.

---

## Scope

| Horizon | Inclus |
|---------|--------|
| **V1** | **Push transactionnel client** sur 8 triggers (cmd payée, reçue cuisine, courier pickup, dropoff, livré, refund, Uber refusé, pickup ready C&C) routés par 3 [[Catégorie transactionnelle]] (Archive / Temps-réel / Info statut). **Push marketing client** déclenchable par resto via [[Template campagne]] pré-validés uniquement (5-10 templates V1, variables interpolables) à scope tenant, **et par KB root** à scope cross-tenant (contenu libre KB, géo-filtré amont). **Cascade marketing** PWA > Wallet > Email (tenant), Wallet > Email (cross-tenant). [[Rate limit marketing]] 3/sem/client global. **Re-consentement par achat** (ADR 0005). [[DNT]] marketing 22h-8h Europe/Paris configurable KB root (jamais sur transactionnel). [[Push système]] APNs/FCM pour [[KB Orders]] côté resto (cf. [20](20_kb_orders.md)). **SMS = extreme fallback** uniquement (clients sans Wallet ni Web Push, < 5 %, sur triggers Archive + Temps-réel). **Email transactionnel** sur triggers Archive (confirmation cmd, refund, course Uber refusée). |
| **V2** | Granularité [[Unsubscribe global]] → unsubscribe par scope (tenant / cross-tenant séparés). Segments prédéfinis pour campagnes tenant (actifs / inactifs / VIP). Triggers comportementaux automatisés (panier abandonné, anniversaire, relance inactif auto). A/B testing sur les templates campagnes. Personnalisation visuelle de la carte Wallet par segment (carrousel multi-promos, offers expirables) — **carte reste neutre V1** pour ne pas biaiser UX. Templates personnalisables resto (rich text editor opt-in pour restos validés). Mémorisation cross-tenant des fails livraison (ne pas re-pousser un resto à un client si livraison rejetée). |
| **V3** | Push géolocalisé temps-réel ("tu es près de Buns & Bao, -10% pour les 30 prochaines minutes"). Module loyauté intégré (points, paliers). Recommandations ML pour contenu push. Multi-langue (EN, AR). Email marketing newsletter via outil tiers (Brevo/Mailchimp) intégré au moteur. |

## Hors scope

- **Modération de contenu récurrente** côté KB — résolue par templates pré-validés ([ADR 0006](../adr/0006-templates-campagnes-pre-valides.md)). Pas de file d'attente validation manuelle V1.
- **Éditeur libre côté resto** — Khan choisit uniquement parmi templates pré-validés V1, pas d'éditeur WYSIWYG ([ADR 0006](../adr/0006-templates-campagnes-pre-valides.md)).
- **SMS Uber Direct natif** — désactivé V1 (le `tracking_url` Uber pointe sur `ubereats.com`, casse le moat KB). KB gère son propre tracking transactionnel via webhooks Uber + canaux KB (Wallet + PWA + Email).
- **Personnalisation visuelle de la carte Wallet par campagne** — la carte reste neutre / marque réseau stable V1 pour ne pas biaiser l'UX "always-visible" (un client qui voit une image hot dog imposée sur sa carte alors qu'il avait envie de crêpes = perception négative). Seule la **notification push** (texte + image rich dans le payload) est personnalisée.
- **Push marketing depuis app native resto** — V1 = resto envoie via web KB Admin uniquement (mobile app resto V2).
- **Plage DNT par tenant** — V1 = plage globale unique configurable par KB root. Config par resto reportée V2.
- **Communications téléphone direct (SAV humain)** — pas KB.

## Personas concernés

- **Client final mangeur** (push web + Wallet + email + SMS extreme fallback)
- **Restaurateur / cuisinier** ([[Push système]] APNs/FCM côté [[KB Orders]] + email opérationnel)
- **KB root (Alex)** (KB Admin root pour campagnes cross-tenant + monitoring + maintenance bibliothèque templates)

## Architecture moteur Notifications

Le moteur Notifications est un **bounded context isolé** qui expose une **API métier** appelée par les autres contextes :

- `notify_order_event(order_id, event_type)` — appelée par [[KB Orders]] / [[Delivery]] quand un trigger transactionnel arrive
- `send_campaign(campaign_id, scope)` — appelée par KB Admin (tenant ou root) quand Khan ou Alex clique envoyer
- `register_push_enrollment(customer_id, channel, token)` — appelée par PWA après opt-in client
- `marketing_eligible(customer_id) → bool` — appelée par les autres contextes pour savoir si un client est éligible marketing (filtre `marketing_opt_out_date` vs `last_checkout_date` selon [ADR 0005](../adr/0005-re-consentement-marketing-par-achat.md))
- `unsubscribe(customer_id, source_push_id)` — appelée quand le client tape unsubscribe

Les autres contextes **ne savent rien** des canaux (Wallet / Web Push / Email / SMS). Le moteur décide seul de la cascade et des routages en V1, selon des règles **hardcodées** (pas d'override par l'appelant V1).

Conséquence : changer de canal (ajouter In-App messaging V2, retirer SMS, basculer Resend vers Brevo) = modif interne au moteur, **zéro impact** sur Orders, Delivery, KB Admin, Customer Data.

## Surface fonctionnelle

### 1. Triggers transactionnels V1 (matrice complète)

| # | Trigger | Source | Catégorie | Canaux V1 | Deep link tenant |
|---|---|---|---|---|---|
| 1 | Cmd payée (confirmation) | Webhook Stripe `payment_intent.succeeded` | **Archive** | Wallet push + Web Push + Email | Page Tracking PWA T+0 |
| 2 | Cmd reçue cuisine (resto accepte) | KB Orders | **Info statut** | **Wallet update silencieux uniquement** | N/A (pas de push lock-screen) |
| 3 | Courier pickup (cmd partie resto) | Webhook Uber `pickup_complete` | **Info statut → Temps-réel léger** | Wallet update silent + Web Push | Page Tracking "en route" |
| 4 | Courier dropoff (proche client) | Webhook Uber `dropoff` | **Temps-réel** | Wallet push + Web Push | Page Tracking "courier arrive" |
| 5 | Cmd livrée | Webhook Uber `delivered` | **Temps-réel** | Wallet push + Web Push | Page Tracking final + CTA review |
| 6 | Refund émis | KB backend | **Archive** | Wallet push + Web Push + Email | Page Tracking historique + détail |
| 7 | Course Uber refusée (re-quote) | Webhook Uber `failed` | **Archive** | Wallet push + Web Push + Email | Page Tracking + "on cherche un courier" |
| 8 | Pickup ready C&C | KB Orders | **Temps-réel** | Wallet push + Web Push | Page Tracking C&C "viens chercher" |

**SMS extreme fallback** activé uniquement si le client n'a ni Wallet ni Web Push (< 5 % des clients vu le push enrollment bloquant V1) et seulement sur les triggers 1, 4, 6, 7.

### 2. Triggers marketing V1

| # | Trigger | Source | Canaux V1 (cascade) | Deep link |
|---|---|---|---|---|
| 9 | [[Campagne tenant]] Khan | KB Admin tenant | **PWA tenant Web Push > Wallet push > Email** | Catalogue PWA tenant + item promu épinglé en haut |
| 10 | [[Campagne cross-tenant]] KB | KB Admin root | **Wallet push > Email** (PWA tenant exclue par design) | Home/catalogue PWA tenant ciblé (après géo-filtrage amont) |

**Cascade = 1 seul canal effectif par client** (pas multi-canal), avec fallback si canal indisponible.

**Géo-filtrage amont cross-tenant** : KB ne pousse à Sophie une campagne cross-tenant que si (1) on a son adresse en base ET (2) cette adresse est dans la zone de livraison du resto poussé. Sinon skip.

**Edge case fallback** (livraison rejetée malgré géo-filtrage) : message d'erreur clair + suggestion de 3 autres restos KB qui livrent chez le client (cross-sell réseau).

### 3. Canaux disponibles V1

- **Push web (PWA)** — Service Worker + VAPID self-host. Subscription scoped au tenant (1 origin = 1 channel). Utilisé pour transactionnel + campagne tenant. **Jamais cross-tenant.** Rich notification supportée (titre + corps + image + action). iOS 16.4+ requiert A2HS.
- **Wallet push** — Apple PassKit Web Service (APNs) + Google Wallet API. Channel commun KB (carte sous marque neutre, [ADR 0003](../adr/0003-wallet-pass-commun-marque-neutre.md)). **Seul canal cross-tenant.** Lock-screen reach ~99 %. Format texte court (~150 chars), `thumbnailUrl` dans payload pour [[Image rich notification]].
- **Wallet update silencieux** — mise à jour du contenu visible de la carte sans push lock-screen. Utilisé pour la catégorie Info statut.
- **Email transactionnel + marketing** — Resend (free tier 100/jour, scaling cheap). Templates MJML ou React Email. Branding header KB + couleur primaire tenant.
- **SMS fallback extreme** — Twilio ou OVH SMS. Activé uniquement si client sans Wallet ni Web Push. Coût estimé : 0,5-1 €/mois/resto.
- **Push système APNs/FCM** côté resto — App native resto (cf. [20_kb_orders.md](20_kb_orders.md)).

### 4. Templates campagnes ([ADR 0006](../adr/0006-templates-campagnes-pre-valides.md))

- Bibliothèque V1 ~5-10 templates couvrant 90 % intents CRM resto (promo weekend, nouveau plat, relance soft, happy hour, ouverture exceptionnelle, événement local).
- Variables interpolables : `{prenom_client}`, `{nom_resto}`, `{item_hero}`, `{discount}`, `{nom_plat}`, `{heure_debut}`, `{heure_fin}`, `{jour}`, etc.
- Garde-fous hardcodés : `{discount}` ≤ 50 %, longueur finale < 200 chars, français uniquement, pas alcool.
- Nouveau template custom = ticket support KB (SLA 48h).
- KB root = pas de contrainte template (contenu libre cross-tenant).

### 5. Consentement et opt-in

- **Soft opt-in tenant L34-5 CPCE** : aucune case à cocher au checkout. Wording CGV footer obligatoire : *"En finalisant ta commande, tu acceptes les CGV de \<Resto\> et le service de fidélité \<Marque KB\> (carte commune + offres réseau). Tu peux te désinscrire à tout moment via le lien dans chaque message ; ta prochaine commande vaut nouvelle acceptation."*
- **Opt-in cross-tenant** matérialisé par l'**acte d'ajout de la carte Wallet KB** (étape Push enrollment). Pas de case séparée. Mention claire au-dessus du bouton : *"Ajoute la carte \<Marque KB\> : suivi de tes cmds + offres exclusives du réseau de restos partenaires."*
- **Re-consentement par achat** ([ADR 0005](../adr/0005-re-consentement-marketing-par-achat.md)) : un client unsubscribed qui recommande réactive automatiquement son consentement marketing à la finalisation.
- **Unsubscribe global** : 1 click depuis n'importe quel push/email marketing = sortie totale (tenant + cross-tenant). Granularité V2.
- **Transactionnel** : jamais désactivable (base contractuelle).

### 6. Rate limiting et DNT

- **Rate limit marketing global** : 3 push marketing / semaine / client tous restos + KB cross-tenant confondus.
- **DNT** : 22h-8h Europe/Paris pour marketing, **configurable par KB root** (pas par tenant V1). Transactionnel jamais bloqué.
- **Comportement campagne lancée pendant DNT** : queue automatique, envoi à 8h le lendemain matin (pas perdu, juste shifté). Preview KB Admin affiche "ton envoi partira à \<heure\>".

### 7. Garde-fous techniques

- **Anomalie de fréquence resto** : > 1 campagne / 48h ou > 3 / semaine pour un même resto → blocage auto + alerte KB.
- **Anomalie de scope** : bond inattendu de la base destinataires (+50 % vs précédent envoi du même resto) → blocage auto.
- **Endpoint expiré** : marker `inactive` en DB, ne plus envoyer.
- **Email bounce** : webhook Resend → DB. Si bounce rate > 5 % sur 7 jours → alerte ops KB.
- **SMS échoué** : retry 2× puis abandon, pas de log spécifique V1.

## Flows nominaux

1. **Push transactionnel V1 (cmd payée)** : Stripe `payment_intent.succeeded` → backend → moteur Notifications → trigger trigger #1 (Archive) → push Wallet + Web Push + Email parallèles en < 5 sec → client tap → ouvre PWA sur Page Tracking T+0.

2. **Push transactionnel V1 (courier dropoff)** : Webhook Uber `dropoff` → moteur Notifications → trigger #4 (Temps-réel) → Wallet push + Web Push lock-screen en < 10 sec → client tap → Page Tracking "courier arrive" avec Lottie courier qui approche.

3. **Push marketing tenant (Khan)** : Khan KB Admin tenant → choisit template "promo weekend" → remplit variables (item, discount, date_fin) → preview → envoyer → moteur Notifications → check DNT + rate limit + opt-in → cascade : Web Push tenant → si fail → Wallet push → si fail → Email → client tap → catalogue PWA Buns & Bao avec item épinglé.

4. **Push marketing cross-tenant (KB root)** : Alex KB Admin root → "nouveau resto Crêperie 5 min" → géo-filtrage amont sur adresses connues → 850 clients filtrés → cascade : Wallet push → fallback Email → client tap → PWA Crêperie + address-first flow. Si Crêperie ne livre pas chez ce client → erreur + suggestion 3 autres restos KB.

5. **Re-consentement par achat** : Sophie unsubscribe le 2026-04-15 → `marketing_opt_out_date = 2026-04-15` → 30j sans push marketing → Sophie recommande chez Buns & Bao le 2026-05-15 → `last_checkout_date = 2026-05-15` → moteur Notifications `marketing_eligible(sophie) = true` → push marketing repartent dès la prochaine campagne tenant Buns & Bao ou cross-tenant KB.

6. **Wallet update silencieux (cmd en cuisine)** : Khan accepte la cmd → KB Orders → moteur Notifications → trigger #2 (Info statut) → update API PassKit / Google Wallet → la carte de Sophie affiche désormais "Cmd en préparation" en arrière-plan → pas de push lock-screen → Sophie ouvre Wallet manuellement et voit l'update.

## Edge cases

- **Push refused / endpoint invalide** : marqueur DB `inactive`, ne plus envoyer sur ce canal. Fallback automatique sur le canal suivant de la cascade.
- **iOS user sans A2HS** : pas de Web Push possible. Wallet push reste actif (channel commun KB). Si pas Wallet non plus → SMS fallback extreme (Cat. Archive et Temps-réel uniquement).
- **Client passé en C&C uniquement (pas d'adresse en base)** : skip des campagnes cross-tenant "près de chez toi" V1.
- **Client opt-out marketing global** : continue à recevoir transactionnel. Aucun push marketing tenant ni cross-tenant. Auto-réactivé à la prochaine cmd ([ADR 0005](../adr/0005-re-consentement-marketing-par-achat.md)).
- **Campagne lancée 23h pendant DNT 22h-8h** : queue, envoi à 8h00 le lendemain. Preview avertit Khan.
- **Anomalie de fréquence resto** : Khan envoie 2 campagnes en 24h → 2e bloquée + alerte KB Admin root + email Alex.
- **Bibliothèque de templates vide pour un nouveau resto** : tous les restos partagent la bibliothèque KB centrale + leurs templates custom validés par KB. Pas de "vide" possible.
- **Double notification Uber Direct + KB** : risque résiduel < 5 % (client avec compte Uber actif et même numéro de tel). Acceptable V1, monitoring via feedback resto Phase 1.

## Critères de succès / acceptation V1

- [ ] Push transactionnel envoyé en < 5 sec après trigger backend.
- [ ] Email confirmation envoyé en < 10 sec.
- [ ] Taux de delivery push > 90 % (excluant endpoints invalides).
- [ ] Cascade marketing tenant fonctionnelle : Web Push → Wallet → Email avec fallback automatique.
- [ ] Géo-filtrage cross-tenant testé sur 3 zones distinctes.
- [ ] Re-consentement par achat actif et tracé en DB (`last_checkout_date` vs `marketing_opt_out_date`).
- [ ] Bibliothèque V1 de 5-10 templates campagnes en place et validée legal.
- [ ] DNT 22h-8h appliqué sur marketing, jamais sur transactionnel.
- [ ] Rate limit 3/sem/client global respecté.
- [ ] Unsubscribe global accessible depuis chaque push/email marketing.
- [ ] PWA installable A2HS iOS 16.4+ et Android (cf. [10](10_pwa_client_commande.md)).
- [ ] SMS Uber Direct natif désactivé (API param `auto_send_customer_sms = false`).

## Dépendances

| Dépendance | Type | Bloque quoi |
|------------|------|-------------|
| Service Worker PWA + VAPID self-host | Interne | Web Push (cascade marketing tenant + transactionnel) |
| Apple PassKit Web Service + APNs | Externe | Wallet push iOS |
| Google Wallet API | Externe | Wallet push Android |
| Resend API (ou équivalent) | Externe | Email transactionnel + marketing |
| Twilio / OVH SMS | Externe | SMS fallback extreme |
| [10_pwa_client_commande.md](10_pwa_client_commande.md) | Interne | Push enrollment + Page Tracking + Catalogue PWA tenant |
| [20_kb_orders.md](20_kb_orders.md) | Interne | Triggers cuisine + Push système resto |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md) | Interne | Webhooks Uber pour triggers livraison |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md) | Interne | Scoping subscriptions par tenant |
| [70_kb_admin.md](70_kb_admin.md) | Interne | UI Khan picker templates + KB Admin root |
| [90_donnees_clients_crm.md](90_donnees_clients_crm.md) | Interne | Stockage opt-in / push subs / adresses connues / `last_checkout_date` |
| Pré-existant : [docs/research/web_push_pwa.md](../research/web_push_pwa.md) | Doc | Exploration web push |
| Pré-existant : [docs/research/wallet_pass_vs_pwa_a2hs.md](../research/wallet_pass_vs_pwa_a2hs.md) | Doc | Exploration dual stack |
| Pré-existant : [docs/research/uber_direct_deep_dive.md](../research/uber_direct_deep_dive.md) | Doc | Webhooks Uber + désactivation SMS natif |

## Open questions (V1 acté · reste à valider out-of-session)

| Q | Question | Deadline | Owner |
|---|----------|----------|-------|
| 80-Q1 | Naming exact de la "Marque consumer KB" pour le wording CGV checkout + acte d'ajout Wallet (en lien Q10-Q11 PRD 10) | V1 launch | Alex |
| 80-Q2 | Rédaction des 5-10 templates V1 (texte + variables) + validation legal markers | V1 launch | Alex + avocat |
| 80-Q3 | Rédaction CGU KB consumer-side (carte commune + offres réseau + re-consentement par achat + unsubscribe) | V1 launch | Avocat |
| 80-Q4 | Choix provider SMS extreme fallback : Twilio vs OVH | V1 S1 | Dev lead |
| 80-Q5 | Provider email transactionnel + marketing : Resend confirmé ou switch vers Brevo (cohérence pour V3 newsletter) | V1 S1 | Dev lead |
| 80-Q6 | Granularité unsubscribe V2 (tenant/cross-tenant séparés) : critères de bascule depuis V1 global | V2 | Alex + analytics |

## Notes / décisions actées

- **Bounded context isolé** : moteur Notifications expose une API métier (events + campaigns + enrollment), pas de logique canal exposée aux appelants. Cascade et routages hardcodés V1.
- **3 catégories transactionnelles** : Archive (multi-canal + email) / Temps-réel (Wallet + Web Push) / Info statut (Wallet update silent).
- **2 cascades marketing distinctes** : tenant PWA > Wallet > Email · cross-tenant Wallet > Email (PWA tenant exclue).
- **SMS exclu du marketing**, extreme fallback transactionnel uniquement.
- **Templates pré-validés** uniquement pour campagnes tenant ([ADR 0006](../adr/0006-templates-campagnes-pre-valides.md)).
- **Re-consentement par achat** ([ADR 0005](../adr/0005-re-consentement-marketing-par-achat.md)), risque CNIL assumé Phase 1.
- **Géo-filtrage cross-tenant amont**, skip clients sans adresse, fallback cross-sell réseau si livraison rejetée.
- **Carte Wallet reste neutre V1**, personnalisation visuelle uniquement dans le payload des notifications push (jamais sur la carte elle-même).
- **SMS Uber Direct natif désactivé** pour préserver le moat consumer-side (tracking URL Uber pointe sur `ubereats.com`).
- **DNT marketing 22h-8h Europe/Paris** configurable par KB root, pas par tenant V1. Transactionnel jamais bloqué.
- **Article 2 ter contrat** : la base clients (incluant push subs + opt-in marketing + adresses connues) reste propriété KB.

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 0.1 | Alex (via Claude) | Création squelette. |
| 2026-05-23 | 0.2 | Alex (via Claude) | Push marketing passe V1 (vs V2). Push natif APNs/FCM pour app native resto V1. |
| 2026-05-24 | 0.3 | Alex (via Claude) | Propagation complète grilling session. Architecture moteur isolé + 3 catégories transactionnelles + 2 cascades marketing + templates pré-validés + re-consentement par achat + géo-filtrage cross-tenant + désactivation SMS Uber natif. ADRs 0005 et 0006 ajoutés. |
