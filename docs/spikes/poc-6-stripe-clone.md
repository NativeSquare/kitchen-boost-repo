# POC #6 — clone Stripe `PaymentMethod` cross-account (carte réutilisable cross-resto) → #59

**Question.** Peut-on **cloner** un `PaymentMethod` enregistré au niveau **plateforme KB** vers le compte
**connecté** d'un resto, pour faire une direct charge avec une carte sauvegardée réutilisable d'un resto
à l'autre (sans re-saisie) ?

**Gate.** Slice saved-card cross-resto **#59** (2.5-D). Si KO → fallback Apple/Google Pay only (#59
abandonné V1, le flux principal #42 n'en dépend pas).

> Exécuté en local (script throwaway) avec `STRIPE_SECRET_KEY` **test** lue depuis `.env.local`.
> Prérequis : **Stripe Connect activé** (profil **« platform »**, pas marketplace) — fait le 2026-05-26.

## Setup confirmé (modèle direct charge)

Profil Stripe Connect = **platform**, **frais Stripe à la charge du compte connecté** → conforme au
modèle KitchenBoost : le **resto (compte connecté) = merchant of record**, paie les frais Stripe ; KB
prélève uniquement `application_fee_amount` (240 TTC). KB n'est jamais merchant of record.

## Exécution (test, 2026-05-26)

```
node stripe-clone.js
{
  "ok": true,
  "platformCustomer": "cus_…",          ← Customer au niveau plateforme KB
  "platformPM":       "pm_…(4242)",      ← carte enregistrée côté plateforme
  "connectedAccount": "acct_…",          ← compte connecté (resto) créé via API
  "clonedPM":         "pm_…",            ← PaymentMethod CLONÉ sur le compte connecté
  "clonedLivesOn":    "acct_…",          ← vit bien sur le compte connecté
  "clonedCardLast4":  "4242",
  "cloneError": null
}
```

Appel clé :

```js
stripe.paymentMethods.create(
  { customer: platformCustomerId, payment_method: platformPmId },
  { stripeAccount: connectedAccountId }, // header Stripe-Account: acct_resto
);
```

## Verdict : ✅ OK

- Le clone cross-account **fonctionne** : la carte plateforme est clonée vers le compte connecté du resto,
  prête pour une direct charge ; l'original côté KB reste intact (re-clonable vers un autre resto).
- **#59 validé** → `ready-for-agent`.

**Implication 2.5 (#59).** `Customer` au niveau plateforme KB ; au paiement chez le resto X, clone du
`PaymentMethod` vers `acct_resto_X` puis direct charge (`Stripe-Account: acct_resto_X`,
`application_fee_amount=240`). Stockage du `Customer`/PM tranché par #16/#27 (Customer Data) vs table
Payment — voir #59. Fuzz cross-tenant obligatoire (un client ne clone/charge que pour sa propre commande).
Risque résiduel prod : client surpris par carte préchargée cross-resto → chargeback ; à monitorer (#63).
