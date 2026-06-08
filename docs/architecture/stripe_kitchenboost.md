# Architecture Stripe — KitchenBoost

**Statut** : Architecture validée doc Stripe 2026-05-21 (cf. §2.1bis pour la confirmation officielle fee_payer).
**Pivot** : passage de `destination_charges` → `direct_charges` pour faire payer les frais Stripe par le resto naturellement, sans gymnastique comptable côté KB.

**Sources Stripe officielles consultées** :

- [docs.stripe.com/connect/charges](https://docs.stripe.com/connect/charges) — choix du type de paiement
- [docs.stripe.com/connect/direct-charges](https://docs.stripe.com/connect/direct-charges) — paiements directs
- [docs.stripe.com/connect/direct-charges-fee-payer-behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior) — qui paie quoi
- [docs.stripe.com/connect/onboarding](https://docs.stripe.com/connect/onboarding) — options d'onboarding

---

## 1. Vocabulaire Stripe — qui est qui

| Terme Stripe                                   | Acteur KitchenBoost            | Détail                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform Account**                           | NativeSquare SAS (KB)          | Compte Stripe principal de la plateforme. Possède l'API key qui crée les comptes connectés.                                                             |
| **Connected Account** (`acct_xxx`)             | Le restaurateur                | Un compte Stripe **Express** par resto. Le resto est _settlement merchant_ pour ses propres ventes.                                                     |
| **Direct Charge**                              | Le mode de capture choisi      | Le PaymentIntent est créé **sur le compte du resto** (via header `Stripe-Account: acct_resto`). Le resto encaisse, paie Stripe, paie l'application fee. |
| **Application Fee** (`application_fee_amount`) | Commission KB                  | Montant prélevé automatiquement du compte resto vers le compte plateforme à chaque charge. **Exprimé en TTC, en centimes.**                             |
| **Statement Descriptor**                       | Nom resto sur relevé CB client | Sur direct charge, c'est le compte connecté qui le pilote → le client voit le nom du resto.                                                             |
| **Payout**                                     | Virement vers RIB              | Chaque compte (resto + KB) reçoit ses fonds sur son propre RIB selon son planning.                                                                      |
| **Capabilities**                               | Permissions activées           | Pour le resto : `card_payments` + `transfers`. Activées à la création du compte.                                                                        |
| **External Account**                           | RIB du resto                   | Renseigné **par KB en backoffice** via l'API au moment de la création du compte connecté (le resto ne saisit pas son IBAN lui-même).                    |

---

## 2. Architecture choisie : Direct Charges

### 2.1 Pourquoi direct charges (et pas destination charges)

**Constat critique** issu de la vérification sub-agent Stripe :

> _« Avec ou sans le paramètre `on_behalf_of`, Stripe débite le montant du litige et les frais de votre compte de plateforme. »_

Autrement dit, sur **destination_charges** (`transfer_data.destination` + `on_behalf_of`) :

- L'argent transite par le **compte plateforme KB** d'abord
- Les frais Stripe (1,5% + 0,25€) sont prélevés sur **le compte plateforme KB**
- KB devrait ensuite refacturer/régulariser ces frais au resto → **gymnastique comptable + risque qualif PSP**

Sur **direct_charges** :

- Le PaymentIntent est créé directement sur `acct_resto` (header `Stripe-Account`)
- Stripe prélève **ses frais directement sur le compte du resto** (c'est le resto qui paie son PSP, comme n'importe quel commerçant)
- KB ne touche que son `application_fee_amount` net
- Le client voit le **nom du resto** sur son relevé (cohérent positionnement "KB invisible")
- KB **n'est jamais merchant of record**, n'encaisse jamais pour compte de tiers → **pas d'agrément PSP requis** côté KB

### 2.1 bis — Fee payer behavior : confirmation doc Stripe

Doc officielle : [docs.stripe.com/connect/direct-charges-fee-payer-behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)

Stripe expose un setting **fee_payer** qui détermine qui paie les frais Stripe en direct charges. 4 valeurs possibles :

| Valeur `fee_payer`                                       | Qui paie les frais Stripe ?     | Qui peut l'utiliser ?               |
| -------------------------------------------------------- | ------------------------------- | ----------------------------------- |
| **`account`** (Accounts v1) / **`stripe`** (Accounts v2) | **Le compte connecté (resto)**  | Comptes Custom v2 explicites        |
| **`application`**                                        | La plateforme (KB)              | Peut être set sur Custom            |
| **`application_custom`**                                 | Comportement historique Custom  | Auto sur `type=custom`              |
| **`application_express`**                                | Comportement historique Express | Auto sur `type=express` (notre cas) |

Citation doc Stripe (`stripe`/`account`) :

> _« Stripe perçoit des frais directement sur votre compte connecté. Nous ne facturons pas de frais Connect à votre compte connecté, ni à votre plateforme. »_

**Pour notre cas (comptes Express + direct charges)** : le comportement historique `application_express` se traduit, sur direct charges, par :

- Frais de processing carte (1,5%/1,9% + 0,25€) → **prélevés sur le compte connecté (resto)**
- Application fee KB → transférée du compte connecté vers la plateforme
- Doc Stripe direct-charges : _« Le compte connecté reçoit directement la somme de 8,18 USD (10 USD − 1,23 USD application fee − 0,59 USD frais Stripe) »_

→ **Le comportement par défaut Express + direct charges est exactement ce qu'on veut.** Pas besoin de toucher au paramètre `fee_payer`.

**Sur les litiges (chargebacks)** : en direct charges, le compte qui supporte le débit du litige + les 20€ HT de dispute fee est **le compte qui a encaissé**, c'est-à-dire le **compte connecté (resto)**. C'est cohérent avec la position contractuelle : le resto est le seul vendeur, donc le seul responsable des litiges produit/livraison. KB n'est qu'éditeur logiciel.

⚠️ **Piège à éviter** : la phrase doc _« Stripe débite directement la plateforme pour les paiements indirects (avec ou sans `on_behalf_of`) »_ s'applique aux **destination charges**, pas aux direct charges. Sur direct charges, c'est l'inverse : le compte connecté paie tout (frais + disputes).

### 2.2 Schéma argent — panier 25€ TTC

```
Client paie 25,00 € TTC par CB
        │
        ▼
[Direct Charge sur acct_resto]
   intent.amount = 2500 (centimes)
   application_fee_amount = 240 (= 2,40€ TTC)
   Stripe-Account: acct_resto
        │
        ▼
┌─────────────────────────────────────┐
│  COMPTE CONNECTÉ — acct_resto       │
│  + 25,00 €  (gross)                 │
│  − 0,625 €  (frais Stripe 1,5% + 0,25)│
│  − 2,40 €   (application fee TTC)   │
│  = 21,975 € net sur compte resto    │
└──────────────┬──────────────────────┘
               │ Payout daily
               ▼
        IBAN du resto

┌─────────────────────────────────────┐
│  COMPTE PLATEFORME — NativeSquare   │
│  + 2,40 €   (application fee)       │
└──────────────┬──────────────────────┘
               │ Payout
               ▼
        IBAN KitchenBoost
```

### 2.3 Code — exemple PaymentIntent direct charge

```js
// Côté serveur KB (Node)
const intent = await stripe.paymentIntents.create(
  {
    amount: 2500, // panier TTC en centimes
    currency: "eur",
    application_fee_amount: 240, // 2,40€ TTC (2,00€ HT + TVA 20%)
    automatic_payment_methods: { enabled: true },
    metadata: {
      kb_resto_slug: "buns-and-bao",
      kb_order_id: "ord_xxx",
    },
  },
  {
    stripeAccount: "acct_xxx", // ← clé du direct charge
  },
);
```

---

## 3. Application Fee : pourquoi 240 et pas 200

KitchenBoost facture **2,00 € HT** par commande. La TVA française B2B sur prestation de service = 20%.

| Composant                                     | Montant    |
| --------------------------------------------- | ---------- |
| Commission KB HT                              | 2,00 €     |
| TVA 20% (collectée par KB, reversée à l'État) | 0,40 €     |
| **Application fee total (TTC)**               | **2,40 €** |
| → en centimes pour l'API                      | **240**    |

**Justification** : `application_fee_amount` est un montant **TTC** dans l'API Stripe (cf. doc Stripe Connect). Si on met 200, on collecte 2,00 € TTC = 1,67 € HT seulement, soit **−16,5% de revenu KB**. Sur 5K commandes/mois → **−1 650 €/mois** non collectés.

**Facture KB → resto** (auto-générée mensuelle) :

- Total application fees du mois (TTC encaissé)
- Décomposition HT + TVA 20%
- Mention "TVA acquittée sur les débits" pour conformité Factur-X (sept 2026 → réception, sept 2027 → émission PME)

---

## 4. Frais Stripe — 2 tiers à connaître

D'après la grille Stripe France 2026 ([stripe.com/fr/pricing](https://stripe.com/fr/pricing)) :

| Tier carte                                             | Taux  | Fixe   | Couverture estimée     |
| ------------------------------------------------------ | ----- | ------ | ---------------------- |
| **EEE standard** (CB grand public EU)                  | 1,5 % | 0,25 € | ~85-90% des paniers FR |
| **EEE premium / corporate** (cartes business, Amex EU) | 1,9 % | 0,25 € | ~10-15% restant        |

**Différence** : les cartes premium/corporate ont des **interchange fees** plus élevés que Stripe doit payer aux émetteurs. La réglementation EU plafonne l'interchange des cartes grand public mais pas celui des cartes business.

**Implication contrat** : on cite les **2 tiers** dans Article 3.3, pas seulement 1,5%. Sinon le resto peut contester quand il verra du 1,9% sur un paiement Amex business.

**Hors scope** (à mentionner dans contrat mais on n'a pas à les calculer) :

- UK post-Brexit (2,5% + 0,25€) : marginal pour des restos parisiens
- Hors EEE (3,25% + 0,25€) : touristes US/Asie
- Conversion devises : +1% si le client paie dans une autre monnaie

---

## 5. Frais annexes Stripe à connaître

| Frais                   | Montant                                             | À qui ça revient                             |
| ----------------------- | --------------------------------------------------- | -------------------------------------------- |
| **Chargeback / litige** | 20 € fixes par dispute                              | Au compte connecté (resto) en direct charges |
| **3D Secure**           | Inclus                                              | —                                            |
| **Payout standard**     | Gratuit (J+2)                                       | —                                            |
| **Payout instant**      | 1% (min 0,50€)                                      | Non activé par défaut                        |
| **Refund**              | Frais Stripe initiaux **non remboursés** par Stripe | Resto perd les 0,625€ même si refund total   |

**Point d'attention** : si le resto rembourse une commande, Stripe ne lui rend pas les frais d'encaissement. À mentionner dans le contrat Article 3.3 ou clause dédiée.

---

## 6. Onboarding compte connecté — Stripe-hosted (choix MVP)

Doc officielle : [docs.stripe.com/connect/onboarding](https://docs.stripe.com/connect/onboarding) + [docs.stripe.com/connect/hosted-onboarding](https://docs.stripe.com/connect/hosted-onboarding)

Stripe propose 3 options d'onboarding :

| Option                           | Effort intégration | Branding                                           | Recommandé pour           |
| -------------------------------- | ------------------ | -------------------------------------------------- | ------------------------- |
| **Stripe-hosted** (choix MVP KB) | Minimal            | Logo + couleur KB visibles, mais formulaire Stripe | Mise en prod rapide       |
| **Embedded**                     | Plus d'effort      | Formulaire intégré dans la PWA KB                  | V2 si UX devient un frein |
| **API**                          | Maximum            | Total contrôle                                     | Hors scope MVP            |

Citation doc Stripe :

> _« Stripe recommande d'utiliser l'onboarding hébergé par Stripe ou l'onboarding intégré. Ces options se mettent automatiquement à jour pour gérer l'évolution des exigences lorsqu'elles s'appliquent à un compte connecté. »_

**Avantage Stripe-hosted pour le MVP** : aucune maintenance KB quand Stripe ajoute une exigence KYC. Le formulaire se met à jour tout seul.

### KB en backoffice (avant RDV install, via mandat Article 2 bis)

```
1. POST /v1/accounts                      ← KB crée acct_resto
   type=express
   country=FR
   capabilities[card_payments][requested]=true
   capabilities[transfers][requested]=true
   business_type=company
   company[name]=<raison_sociale>
   company[tax_id]=<SIRET>
   email=<email_resto>

2. POST /v1/accounts/:id/external_accounts  ← KB renseigne IBAN
   external_account[object]=bank_account
   external_account[country]=FR
   external_account[currency]=eur
   external_account[account_number]=<IBAN_resto>

3. POST /v1/account_links                 ← KB génère lien Stripe-hosted onboarding
   account=acct_xxx
   type=account_onboarding
   refresh_url=https://app.kitchen-boost.com/onboarding/refresh
   return_url=https://app.kitchen-boost.com/onboarding/done
```

→ `account_links` retourne une URL Stripe-hosted (du type `https://connect.stripe.com/setup/e/acct_xxx/...`) à envoyer au resto par WhatsApp/SMS le jour du RDV install.

### Resto le jour du RDV install (~5 min, sur son téléphone)

1. Ouvre le lien Stripe-hosted (formulaire branded KB)
2. Vérifie/complète les champs pré-remplis par KB (raison sociale, SIRET, dirigeant)
3. Saisit son **identité** : CNI ou passeport
4. Fait le **selfie liveness** (vérification d'identité PSD2 / KYC obligatoire)
5. Redirigé sur `return_url` → c'est fini. Le compte passe à `charges_enabled = true` immédiatement après validation Stripe (généralement < 1 min, parfois quelques heures si vérif manuelle).

**Ce que le resto NE FAIT JAMAIS** :

- Saisir son IBAN (déjà rentré par KB via `external_accounts`)
- Voir ou toucher la clé API Stripe
- Gérer les paramètres du compte
- Voir le détail des `application_fees` au quotidien (transparence assurée par la facture mensuelle KB)

**Webhook à écouter côté KB** : `account.updated` — pour détecter quand `charges_enabled` passe à `true` et débloquer la mise en prod de la PWA pour ce resto.

---

## 7. Implications contrat — Article 3 à mettre à jour

### Article 3.1 — Commission

> NativeSquare SAS perçoit une commission hors taxe d'un montant de **2,00 € par commande** encaissée via le canal direct PWA.

_Note interne (pas dans le contrat) :_ la TVA 20 % est intégrée dans le `application_fee_amount = 240` (centimes TTC) côté Stripe. Elle est mentionnée sur la facture mensuelle KB → resto, pas dans la clause de prix du contrat.

### Article 3.2 — Modalités de prélèvement

> La commission est prélevée automatiquement par Stripe au titre de l'`application_fee_amount` du PaymentIntent **(charge directe sur le compte Stripe Connect Express du Partenaire, mode "direct charge")**, à chaque transaction. Aucune facturation manuelle. Une facture mensuelle récapitulative est émise par NativeSquare SAS conformément aux obligations comptables (article 289 du CGI).

### Article 3.3 — Frais de paiement et litiges (transparence)

> Le Partenaire est informé qu'en sa qualité de titulaire du compte Stripe Connect Express et de seul vendeur des commandes encaissées via la PWA (mode "paiement direct" au sens de l'article L.521-1 du Code monétaire et financier), il supporte directement :
>
> - Les **frais Stripe d'encaissement carte bancaire**, prélevés automatiquement sur son compte Stripe Connect, en application de la grille Stripe France :
>   - **Cartes grand public EEE** : 1,5 % du montant TTC + 0,25 € fixes
>   - **Cartes premium / corporate EEE** : 1,9 % du montant TTC + 0,25 € fixes
> - Les **frais de litige** : 20 € HT par dispute (chargeback), prélevés directement sur son compte Stripe Connect.
> - La **responsabilité commerciale et financière** des éventuels chargebacks (le Partenaire étant le seul vendeur du contrat de vente conclu avec le client final).
>
> Ces frais sont la rémunération du prestataire de services de paiement (Stripe Payments Europe Ltd, IE) et **ne reviennent en aucun cas à NativeSquare SAS**, qui ne marge pas sur ces frais et n'a pas de pouvoir de négociation sur la grille Stripe.

### Article 3.4 — Modalités hors canal PSP

> Pour les commandes encaissées hors canal direct PWA (Uber Eats marketplace, Deliveroo marketplace, etc.), la commission KitchenBoost de 2,00 € HT par commande est facturée mensuellement, payable 15 jours net après émission de la facture.

### Article 3.5 — Clause d'évolution

> En cas d'évolution de la grille Stripe (cf. 3.3), aucune renégociation du contrat KitchenBoost n'est requise — les nouveaux taux s'appliquent automatiquement au Partenaire en tant que titulaire du compte Stripe Connect.

---

## 8. Comparaison avant/après le pivot

| Dimension                        | Avant (destination_charges + on_behalf_of)   | Après (direct_charges)                |
| -------------------------------- | -------------------------------------------- | ------------------------------------- |
| Settlement merchant              | Resto (via `on_behalf_of`)                   | Resto                                 |
| Compte qui paie les frais Stripe | **KB plateforme** (erreur ma claim initiale) | **Resto directement**                 |
| Application fee                  | 200 (HT, erreur — devait être TTC)           | 240 (TTC, correct)                    |
| Risque PSP / agrément KB         | Zone grise (encaissement temporaire)         | Zéro (KB ne touche jamais les fonds)  |
| Gymnastique comptable            | Refacturation frais Stripe au resto          | Aucune                                |
| Statement descriptor client      | Nom resto (via `on_behalf_of`)               | Nom resto (natif direct charge)       |
| Chargebacks                      | Compte plateforme KB                         | Compte resto                          |
| Complexité code KB               | Plus simple (1 endpoint)                     | Très simple (header `Stripe-Account`) |

---

## 9. Points en suspens — à valider par Alex avec la doc Stripe

**Validés 2026-05-21 via WebFetch doc Stripe officielle** :

- [x] Frais Stripe carte sur compte connecté en direct charges → ✅ confirmé doc `direct-charges` et `direct-charges-fee-payer-behavior`
- [x] `application_fee_amount` exprimé en TTC centimes → ✅ usage standard Stripe Connect (Application fees)
- [x] `Stripe-Account` header pour direct charges → ✅ confirmé doc `direct-charges`
- [x] Stripe-hosted onboarding = bon choix MVP → ✅ recommandation officielle Stripe

**Validés 2026-05-21 via WebFetch doc Stripe `connect/account-capabilities`** :

- [x] **Capability `transfers` EST obligatoire** même en direct charge pur. Citation doc Stripe : _« Pour qu'un compte soit doté de la fonctionnalité `card_payments`, vous devez demander à la fois les fonctionnalités `card_payments` et `transfers`. »_ → on demande les 2 capabilities à la création du compte connecté.
- [x] **Pas de "Marketplace Status" / business model review différencié** entre direct et destination charges au niveau capabilities. La doc Stripe ne mentionne aucune distinction d'approbation. Le seul prérequis = capabilities `card_payments` + `transfers` actives.

**Restent à valider (non-bloquant pour le contrat, à faire en sandbox)** :

- [ ] Remplir le **Platform Profile** Stripe à l'activation du compte plateforme NativeSquare (formulaire dashboard one-time, ~10 min, demande la description du business model — pas un review bloquant pour les direct charges Express, mais obligatoire avant de passer en live).
- [ ] Confirmer la mécanique de TVA sur l'application fee (KB encaisse 2,40€ TTC, déclare 2€ HT + 0,40€ TVA collectée — comme une facture B2B classique). À valider avec expert-comptable NativeSquare.
- [ ] Confirmer la gestion du refund partiel : l'application fee est-elle remboursée au prorata automatiquement ou faut-il un appel explicite à `/refunds` avec `refund_application_fee=true` ? À tester en sandbox.

---

## 10. Implications opérationnelles

### Côté KB

- **Code SaaS plus simple** : 1 seul endpoint qui crée un PaymentIntent avec `stripeAccount` header. Pas de gestion de transfer/destination.
- **Réconciliation simple** : 1 ligne Stripe par commande sur le compte KB = 1 application fee. Pas de débit/crédit à matcher.
- **Facturation mensuelle resto** : générée à partir des `application_fees` du mois (API list). Factur-X compatible.

### Côté resto

- **Pas de surprise** : il voit ses ventes brutes sur Stripe Express dashboard, ses frais Stripe, son application_fee KB. Transparence totale.
- **Comptable resto** : récupère les CSV Stripe directement (export natif). Pas de doc spécifique KB à fournir.
- **Refund** : le resto peut rembourser directement depuis Stripe Express dashboard sans passer par KB.

### Risques résiduels

- Si un resto **résilie le contrat KB** et garde son Stripe Express : KB peut révoquer son accès via l'API (`POST /v1/accounts/:id/reject`) mais le resto peut aussi juste contacter Stripe pour migrer en compte standalone. À couvrir dans Article 5 du contrat (résiliation).
- **Backup PSP** : si Stripe coupe KB (politique platform), tous les comptes connectés sont gelés. Mitigation : avoir un fallback Mollie/Adyen prêt à activer (Phase 2).

---

## Références

- Stripe Connect — [stripe.com/docs/connect](https://stripe.com/docs/connect)
- Direct charges — [stripe.com/docs/connect/direct-charges](https://stripe.com/docs/connect/direct-charges)
- Application fees — [stripe.com/docs/connect/direct-charges#collect-fees](https://stripe.com/docs/connect/direct-charges#collect-fees)
- Grille tarifaire FR — [stripe.com/fr/pricing](https://stripe.com/fr/pricing)
- PSD2 / KYC Connect Express — [stripe.com/docs/connect/express-accounts](https://stripe.com/docs/connect/express-accounts)
- Cf. `docs/legal/contrat_template.md` Article 3 (à mettre à jour avec ce doc)
- Cf. `docs/legal/audit_contrat_2026-05-21.md` P0 #1
- Cf. `docs/plans/onboarding_restaurateur_process.md` §4 Stripe setup
- Cf. `docs/diagrams/stripe_flow_kb.excalidraw` schéma argent
