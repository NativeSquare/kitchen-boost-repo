# 30 — Paiement Stripe Connect

**Statut** : 🟡 Squelette · **Version** : 0.2 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 3](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.2** : Scope V1 étendu suite révision master v2.0. Apple Pay/Google Pay V1, Stripe Customer cross-tenant V1 (subject to PoC), intégration moteur pricing [35](35_pricing_engine.md) V1.

---

## Scope

| Horizon | Inclus |
|---------|--------|
| **V1** | Onboarding Stripe Connect Express via lien magique. Direct charges. **Apple Pay / Google Pay** via Stripe Payment Element. `application_fee_amount` TTC. **Stripe Customer cross-tenant ACTÉ V1** (carte sauvegardée réutilisable cross-resto via API `clone PaymentMethod` Stripe — Q14/Q30-Q acté 2026-05-23). Webhooks paiement OK/échoué. **Refund total uniquement** (Q30-Q acté — partiel = V2). **Cmd avortée** (échec Uber Direct post-paiement) → refund auto + push client (Q30-Q acté). **Contact cmd active** : num + prénom client visibles dans KB Orders sur cmd en cours (workaround rupture partielle). KYC standard FR. **Intégration moteur pricing** [35](35_pricing_engine.md) pour calculer le total facturé client (panier + part livraison à charge client selon règles resto). |
| **V2** | Refund partiel, gestion chargebacks outillée, factures auto resto (mensuel), exports CSV transactions, suivi soldes Stripe par tenant, gestion disputes assistée KB. |
| **V3** | Plan B Mangopay si Stripe bloque un secteur. Multi-devise (si scale EU hors FR). |

## Hors scope

- KB n'est PAS merchant of record. KB ne tient pas la trésorerie, ne refacture pas Stripe au resto, n'intervient pas dans les disputes.
- Pas de gestion de TVA côté client (le resto gère sa TVA dans ses obligations légales).
- Pas de paiement en plusieurs fois (BNPL) en V1.

## Personas concernés

- **Restaurateur** (onboarding initial + suivi paiements)
- **Client final mangeur** (UX checkout)

## Surface fonctionnelle (sections à remplir)

### 1. Onboarding Stripe Connect Express (resto)
- **Onboarding fait en Phase C kickoff sur place** (Alex présent physiquement avec le resto, cf. process 5 phases A/B/B+/C/D)
- Alex génère un `account_link` Stripe Connect Express avec pré-fill (SIRET, email, prénom, nom du resto) **en live depuis [[KB Admin]]**
- Resto complète Stripe onboarding (IBAN, KYC) **avec Alex à côté** en ~10-15 min
- Webhook `account.updated` → KB met à jour statut tenant ("Stripe ready" / "KYC pending" / "KYC rejected")
- Si KYC pending au sortir du RDV (Stripe demande complément doc) → alerte Slack ops + suivi pipeline [[KB Admin]]
- **Pas de timeout auto-suspend V1** (Q30-Q5 sans objet — le process garantit complétion en Phase C ; si Phase C n'aboutit pas, traité dans le pipeline onboarding, pas côté payment)

### 2. Configuration tenant
- Stockage `stripe_account_id` (acct_xxx) dans table tenants
- **V1 : `application_fee_amount` immutable = 240 (2,40 € TTC) pour tous les tenants** (Q30-Q1 acté). Pas d'écran de config. Gestes commerciaux V1 = avoir manuel hors-système.
- **V2 : `application_fee_amount` rendu configurable par tenant** depuis [[KB Admin]] root (paliers commerciaux scaling)
- Statut Stripe : `pending` / `ready` / `disabled`

### 3. Checkout client final (PWA)
- Stripe Elements embed (PaymentIntent côté backend)
- Direct charge sur compte resto avec `on_behalf_of = acct_resto` + `application_fee_amount`
- Resto reçoit montant TTC client moins frais d'acceptation (commission monétique ~1,5% + 0,25€) moins application_fee KB (2,40€ TTC)
- Webhook `payment_intent.succeeded` → trigger création order + Uber Direct

### 4. Échec paiement
- Webhook `payment_intent.payment_failed` → notif client + lien retry
- 3 retries max, puis abandon (order non créé)
- Stripe Radar activé pour anti-fraude

### 5. Refund (V1 manuel via KDS)
- Refus cmd resto → trigger refund Stripe API
- Refund total uniquement (V1) ; partiel V2
- Notif client de remboursement (push + email)
- Audit trail (cf. [70](70_kb_admin.md))

### 6. Chargebacks (V1 monitoring uniquement)
- Webhook `charge.dispute.created` → notif Slack ops
- Resto reçoit notif Stripe directement (KB pas merchant of record)
- KB n'intervient pas en V1 — V2 outillage support

### 7. Reporting financier
- **V1 : pas de vue paiements [[KB Admin]]**. Le resto consulte son [Stripe Dashboard natif](https://dashboard.stripe.com) (transactions, soldes pending/available, `application_fee_amount` perçu par KB, frais d'acceptation) pour le détail transactionnel. Q30-Q9 acté 2026-05-23.
- **V1 — facture mensuelle KB envoyée par mail fin de mois** : Alex génère manuellement (template Word/Excel) une facture PDF nominative par resto (N cmds × 2 € HT + TVA), envoyée par mail. CGI compliant pour déduction TVA côté resto. Pas d'auto-génération système. ~30 min/mois × N restos = soutenable V1 (<5 restos). Q30-Q acté 2026-05-23.
- **V2 : Dashboard paiements [[KB Admin]]** (vue resto) — transactions du mois, soldes Stripe pending/available, export CSV. **Facture mensuelle auto PDF** avec envoi automatisé + archivage [[KB Admin]].

## Flows nominaux

1. **Onboarding nouveau resto** : Phase C kickoff sur place → Alex génère lien Stripe en live depuis [[KB Admin]] → resto complète KYC + IBAN avec Alex à côté (~10-15 min) → webhook `account.updated` → KB active tenant.
2. **Paiement réussi client** : client checkout → Stripe Elements → PaymentIntent confirm → webhook `payment_intent.succeeded` → KB crée order + trigger Uber Direct + push KDS resto.
3. **Refund après refus resto** : cuisinier refuse cmd → KB call Stripe Refund API → webhook `charge.refunded` → push client "remboursé".

## Edge cases

- **KYC resto refusé** : alerte Alex, contacte resto, plan B = soumettre via Mangopay (V3).
- **Carte client refusée 3 fois** : abandon, pas d'order créé, cmd jamais passée.
- **Webhook Stripe retardé / perdu** : implémenter idempotency + polling de fallback (toutes les 60s, vérifier les PaymentIntents en `processing`).
- **Resto change d'IBAN** : se gère dans Stripe Dashboard du resto, KB n'a pas à intervenir.
- **Chargeback gagné par resto** : Stripe restitue. KB monitoring seulement.
- **Chargeback perdu** : resto perd l'argent + 20€ frais Stripe. KB notifie. Pas de remboursement KB de la commission (Article 3.3 contrat).
- **Frais Stripe modifient (Stripe change tarif)** : déclenche notif Slack ops, mise à jour `docs/architecture/stripe_kitchenboost.md` (à créer si manque).

## Critères de succès / acceptation

### V1
- [ ] Onboarding resto Stripe Connect Express en < 15 min.
- [ ] Paiement validé → order créé en < 5 sec (incl. webhook latence).
- [ ] 0 double-charge sur retry paiement.
- [ ] Refund refus cmd traité en < 30 sec.
- [ ] Webhook Stripe rate limit respecté (pas de 429).
- [ ] Sandbox tests : 50 commandes test sans incident.

### V2
- [ ] Dashboard resto montre soldes Stripe pending/available.
- [ ] Export CSV transactions par tenant disponible.

## Dépendances

| Dépendance | Type | Bloque quoi |
|------------|------|-------------|
| Stripe Connect Express FR | Externe | Tout l'article |
| Stripe.js (frontend Elements) | Externe | Section 3 |
| [10_pwa_client_commande.md](10_pwa_client_commande.md) | Interne | Section 3 UI checkout |
| [20_kb_orders.md](20_kb_orders.md) | Interne | Section 5 refund manuel via KB Orders |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md) | Interne | Stockage `stripe_account_id` par tenant |
| Pré-existant : [docs/architecture/stripe_kitchenboost.md](../architecture/stripe_kitchenboost.md) | Interne (à créer) | Documentation technique détaillée |

## Open questions

| Q | Question | Deadline | Owner |
|---|----------|----------|-------|
| 30-Q1 | ~~`application_fee_amount` : 240 fixe ou variable par tenant ?~~ **ACTÉ 2026-05-23** : V1 = 240 immutable pour tous, V2 = configurable par tenant depuis [[KB Admin]]. | — | — |
| 30-Q2 | ~~Cartes hors UE : on les accepte ou on refuse ?~~ **ACTÉ 2026-05-23** : V1 = acceptées silencieusement (3,25% + 0,25€ hors UE), resto absorbe le surcoût via pass-through (Article 3.3 contrat — tarifs PSP s'appliquent). V2 envisagera reporting transparent. | — | — |
| 30-Q3 | Apple Pay / Google Pay activés dès V1 ou V2 ? | V1 | Alex (impact UX mobile) |
| 30-Q4 | Stripe Radar fraud rules : config par défaut Stripe ou rules custom KB ? **HORS SCOPE GRILLING** (HOW technique anti-fraude). V1 = défaut Stripe, ajustement V2 si fraude observée. | V2 | Dev lead |
| 30-Q5 | ~~Cas resto onboardé Stripe mais qui n'active pas son menu : timeout 14j ?~~ **SANS OBJET acté 2026-05-23** : onboarding fait en Phase C sur place, complétion garantie. Si Phase C n'aboutit pas → process pipeline [[KB Admin]], pas payment. | — | — |
| 30-Q6 | ~~Premier resto soumis à un chargeback : process support ?~~ **ACTÉ 2026-05-23** : V1 = Alex notifie manuellement via WhatsApp suite alerte Slack, resto répond via son Stripe Dashboard natif. V2 = email auto resto + alerte [[KB Admin]]. V3 = outillage complet KB Admin. | — | — |
| 30-Q7 | ~~TVA `application_fee_amount` : auto-calc ou stocké TTC ?~~ **ACTÉ 2026-05-23** : V1 = 240 centimes TTC (2,40 €) dans Stripe, stocké HT en DB (200 cts) pour reporting. Pas de facture KB nominative V1 — justificatif = rapports Stripe natifs. Auto-génération PDF V2. | — | — |

## Notes / décisions actées

- **KB pas merchant of record** : Direct charges Stripe Connect Express → resto est seul vendeur. Pas d'agrément ACPR. Pas de risque TVA litigieux.
- **Pass-through frais Stripe** : Le resto paie les frais Stripe (1,5% + 0,25€) via `on_behalf_of=<acct_resto>` (cf. [feedback_kb_commission_model.md](../../.claude/memory/feedback_kb_commission_model.md)).
- **Commission KB en TTC** : `application_fee_amount` est en centimes TTC. 2,00€ HT × 1,20 TVA = 2,40€ TTC = 240 centimes. Stocké en DB en HT pour reporting.
- **Article 3.2 contrat** : "le Partenaire perçoit (...) diminué des frais d'acceptation des paiements (commission monétique) dus à Stripe (...) et de la commission de NativeSquare SAS définie à l'Article 3.1".
- **Stripe agit comme PSP** au sens articles L.521-1 et suivants du Code monétaire et financier.

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 0.1 | Alex (via Claude) | Création squelette. |
| 2026-05-23 | 0.2 | Alex (via Claude) | Extension scope V1 : Apple Pay/Google Pay, Stripe Customer cross-tenant, intégration moteur pricing [35](35_pricing_engine.md). |
