---
status: accepted
date: 2026-05-24
deciders: Alex
supersedes: 0001-consent-marketing-bloquant-checkout-v1.md
---

# Consentement V1 par clic sur "Payer" (pas de checkbox)

## Contexte

KitchenBoost capte email/tel/adresse au checkout PWA client. La base clients globale est le MOAT (cf. [[Customer Data]]). [ADR 0001](0001-consent-marketing-bloquant-checkout-v1.md) actait une checkbox bloquante au checkout (+ DB séparant `consent_marketing` / `consent_transactional`). Depuis, [ADR 0005](0005-re-consentement-marketing-par-achat.md) acte le pattern "re-consentement par achat" avec un wording CGV explicite. Le pattern checkbox bloquante devient incohérent avec ce wording (et redondant). On bascule sur le pattern Uber Eats / Deliveroo / Stripe Checkout : pas de case à cocher, juste une phrase informative sous le bouton "Payer".

## Décision

**V1 = checkout PWA SANS aucune checkbox de consentement.** Le bouton final affiche `Payer <X €>` (ou `Commander`). Sous le bouton, phrase non-cliquable, visible en taille lisible (≥ 12 px) :

> *En cliquant sur Payer, tu acceptes les CGV de **\<Resto\>** et le service de fidélité **\<Marque KB\>** (carte commune + offres réseau). Tu peux te désinscrire à tout moment via le lien dans chaque message ; ta prochaine commande vaut nouvelle acceptation.*

Le clic sur "Payer" enregistre côté DB :
- `cgv_accepted_at` (timestamp UTC)
- `cgv_version_hash` (hash SHA-256 du wording CGV actif au moment du clic)
- `marketing_opt_out_date` reste `NULL` par défaut

**Schéma DB simplifié vs ADR 0001** : plus de séparation `consent_marketing` / `consent_transactional`. La logique `marketing_eligible(customer_id)` reste : `last_checkout_date > marketing_opt_out_date` (cf. [ADR 0005](0005-re-consentement-marketing-par-achat.md)).

**Archivage CGV horodaté** : chaque version du wording CGV est conservée avec son hash + date d'activation. En cas d'audit, on peut prouver quelle version a été acceptée par chaque client.

## Considered options

1. **Phrase informative sous le bouton (choix retenu)** — pattern Uber/Deliveroo/Stripe. Friction nulle, conversion maximale, cohérent ADR 0005.
2. **Checkbox bloquante unique CGV** ([ADR 0001](0001-consent-marketing-bloquant-checkout-v1.md), maintenant supersedé) — friction faible mais visuel "lourd", conflit avec wording ADR 0005.
3. **Double checkbox (transactional bloquant + marketing pré-coché)** — granularité native, mais conflit avec pattern re-consentement par achat + perte reach 30-40 % si décoché.
4. **Modal "J'accepte" intercalé avant paiement** — friction max, abandon checkout +5-10 %, et n'ajoute rien légalement vs phrase informative.

## Pourquoi ce choix

- **Pattern universel B2C 2026** : Uber Eats, Deliveroo, Stripe Checkout, Amazon — tous fonctionnent sans checkbox de consentement. Précédent fort en cas de défense CNIL.
- **Cohérence ADR 0005** : la phrase "ta prochaine commande vaut nouvelle acceptation" suppose une acceptation **par l'acte de finalisation**, pas par une case séparée. La case rendrait l'argumentaire contradictoire.
- **Friction conversion** : -3-5 % d'abandon vs checkbox bloquante (estimation pattern e-com).
- **Risque CNIL résiduel assumé** : déjà arbitré dans [ADR 0005](0005-re-consentement-marketing-par-achat.md) ("problème de riche"). Même argumentation s'applique.
- **DB plus simple** : 1 timestamp + 1 hash + 1 nullable date suffisent. Plus de double colonne `consent_*` à maintenir.
- **Réversibilité partielle conservée** : si CNIL durcit V2, on peut ajouter une checkbox sans casser la base existante (les `cgv_accepted_at` historiques restent valides).

## Conséquences

- **Wording CGV obligatoire au checkout V1** : la phrase complète (incluant "ta prochaine commande vaut nouvelle acceptation") doit apparaître sous chaque bouton "Payer", sans exception. Sans elle, l'argument juridique tombe (cf. [ADR 0005](0005-re-consentement-marketing-par-achat.md) "Hard to reverse pourquoi").
- **CGU KB consumer-side à rédiger avec avocat** (cf. open question 80-Q3 PRD notifications) : 1-2 pages couvrant carte commune + offres réseau + re-consentement par achat + lien unsubscribe. Hash archivé dès activation.
- **Migration ADR 0001** : aucune base captée encore sous régime ADR 0001 (V1 pas live) → migration triviale. Si V1 avait été déployé, il aurait fallu re-onboarder.
- **Suppression du plan B technique ADR 0001** : la séparation DB `consent_marketing` / `consent_transactional` n'est plus pertinente. Schéma final V1 = `cgv_accepted_at` + `cgv_version_hash` + `marketing_opt_out_date`.
- **Risque audit CNIL** : un audit verra "captation marketing sans case à cocher". Argument défensif = wording lisible adjacent + pattern universel B2C + archivage horodaté CGV + lien unsubscribe effectif dans chaque message.
- **Cohérence wording terrain Alex** : pitch resto reste "le client accepte en commandant, comme sur Uber". Plus simple à expliquer qu'une checkbox.

## Hard to reverse pourquoi

Le schéma DB, le wording PWA, et l'archivage CGV reposent sur ce pattern. Bascule vers checkbox V2 demanderait : (a) update PWA checkout, (b) sans toucher à la base déjà captée (les `cgv_accepted_at` historiques restent valides comme preuve d'acceptation au moment de la cmd), (c) update wording terrain.

À l'inverse, basculer **vers plus de friction** (checkbox V2) reste possible sans casser l'existant. Basculer **vers moins de friction** est impossible : on est déjà au minimum (1 clic). C'est l'optimum de friction.

Conditionne aussi :
- Le wording CGV checkout PWA (chaîne complète ADR 0005)
- Le schéma DB customers (`cgv_accepted_at` + `cgv_version_hash`)
- L'archivage RGPD (versioning CGV horodaté)
- Le pitch commercial Alex
- La logique `marketing_eligible(customer_id)` côté [[Notifications]]
