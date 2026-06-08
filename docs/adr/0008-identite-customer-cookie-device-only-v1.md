---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Identité Customer V1 = cookie device only (pas de matching cross-device email/tel)

## ⚠️ Amendement 2026-05-25 — la reconnaissance cross-resto ne passe PAS par le cookie

Précision d'architecture confirmée le 2026-05-25 : **chaque resto est servi sur son PROPRE domaine de marque** (ex. `bunsbao.fr`), jamais sur un sous-domaine `*.kitchen-boost.com` côté public (modèle Owner.com). Conséquences directes sur cet ADR :

- **Le cookie device est INTRA-resto uniquement.** Deux restos = deux domaines distincts → un cookie n'est jamais partagé entre eux (cloisonnement navigateur ; aucune techno propre n'y change rien). Le « cookie partagé sur domaine parent » envisagé plus bas est **caduc**. Vérifié techniquement le 2026-05-25 : Convex Auth (intégration Next.js) pose de toute façon un cookie `__Host-` _host-only_, non élargissable à un domaine parent.
- **La reconnaissance / unification cross-resto en V1 repose donc EXCLUSIVEMENT sur la [[Wallet pass]] commune** (surface #2 ci-dessous : `serial_number` → `customer_id`, indépendant du domaine et du device). Sans pass installé, un même device sur un autre resto = **nouveau `customer_id`** (doublon cross-resto assumé, au même titre que les doublons cross-device).
- Inchangé : pas de match email/tel V1 (sécurité CB), pas d'OTP V1, table `customers` globale.

Les mentions « cookie partagé sur domaine parent » des lignes ci-dessous sont corrigées en ce sens.

## Contexte

KitchenBoost capte email/tel/adresse au checkout PWA client. Le MOAT cross-tenant repose sur l'unification de l'identité [[Customer]] entre tenants (cf. [[Customer Data]] CONTEXT). Question : quand un client revient — même device ou autre device, même tenant ou autre tenant — à quoi reconnaît-on que c'est le même `customer_id` ?

3 layers possibles :

1. **Cookie persistent device** (anonymous sign-in pattern, Firebase Auth / Spotify)
2. **Match serveur sur email OU tel** (Shopify Shop Pay pattern)
3. **OTP email/SMS** au checkout pour confirmer propriété

## Décision

**V1 = Layer 1 uniquement.** Cookie HttpOnly long-lived (1 an, refresh à chaque visite) avec `customer_id` posé à la première arrivée sur la PWA d'un tenant. **Pas de match serveur sur email/tel cross-device V1. Pas d'OTP V1.**

Conséquences :

- Si Sophie commande chez Buns & Bao depuis son iPhone (Tenant A), puis chez Buns & Bao depuis son MacBook (même Tenant A) → **2 `customer_id` distincts**. Doublon assumé.
- Si Sophie commande chez Tenant A puis Tenant B depuis le même device → **2 `customer_id` distincts** (domaines de marque différents = cookies cloisonnés ; cf. Amendement 2026-05-25). Unification cross-resto **uniquement si elle a installé la [[Wallet pass]]** (serial → `customer_id`).
- Pas de prompt "Cette adresse existe déjà — c'est toi ?" au checkout. Pas de tentative de fusion.

**Reconnaissance V1 = 2 surfaces, à 2 portées distinctes** (cf. Amendement 2026-05-25) :

1. **Cookie device** — portée **intra-resto uniquement** (retour sur le même domaine de marque). Couvre les retours mono-device chez un resto donné. **Ne traverse PAS les restos.**
2. **[[Wallet pass]] commune** (cf. [ADR 0003](0003-wallet-pass-commun-marque-neutre.md)) — **seule surface cross-resto** : suit la personne cross-device ET cross-resto si elle l'a installée. Le `serial_number` du pass est lié au `customer_id` côté backend → reconnaissable peu importe le device ou le resto qui scanne.

Si Sophie n'a ni cookie reconnu ni Wallet pass installé → nouveau `customer_id`. Acceptable V1.

## Considered options

1. **Cookie device only (choix retenu)** — sécurité max, complexité min, MOAT cross-tenant via Wallet+cookie.
2. **Cookie + match serveur email OU tel** — MOAT cross-tenant plus dense (5-10% de doublons en moins) mais expose le [[clone PaymentMethod]] Stripe à quiconque connaît email+tel d'un client existant.
3. **Cookie + match email/tel + OTP sur match** — sécurité OK, mais friction checkout +5-10s + complexité produit V1 inutile.
4. **OTP systématique au checkout** — pattern Uber Eats. Sécurité max. Friction max. Pas compatible avec la promesse "fast checkout pattern Uber sur Stripe".

## Pourquoi ce choix

- **Sécurité CB cross-tenant** = facteur décisif. Le pattern `clone PaymentMethod` Stripe Connect (cf. [[Payment]] CONTEXT) permet à un `customer_id` global de réutiliser une CB enregistrée chez un autre tenant. Si on matche cross-device sur email+tel sans OTP, n'importe qui connaissant ces 2 infos peut potentiellement charger la CB d'un autre client. Inacceptable.
- **Doublons cross-device acceptables V1** : estimation 5-10% des clients (multi-device sans Wallet pass installé). Le MOAT reste largement supérieur à zéro (cookie + Wallet couvrent 90%+).
- **Pas de friction OTP V1** : préserve la promesse "checkout instant à la Uber" et le KPI conversion checkout cible (>80%).
- **Anonymous sign-in pattern natif** dans les stacks d'auth modernes (WorkOS guest checkout, Convex Auth anonymous adapter) : pas de complexité tech.
- **MOAT cross-tenant suffisant via Wallet** : la [[Wallet pass]] commune (ADR 0003) crée le bridge cross-device pour les clients engagés (= ceux qui valent le plus pour le MOAT). Les clients one-shot qui ne reviennent pas n'ont de toute façon pas de valeur MOAT.
- **Veille V2** : si le ratio doublons / clients devient un problème mesurable (>15%), introduire Layer 2 + OTP en V2 sans casser la base existante (les doublons restent indépendants, on n'essaie pas de re-fusionner rétroactivement).

## Conséquences

- **Schéma DB customers** : pas de contrainte unique sur `email` ni `phone`. Plusieurs rows peuvent partager le même email/tel sans conflit.
- **UX checkout** : aucun prompt "tu es déjà client ?", aucun branchement "Te connecter avec email", aucun lien "récupérer mon historique". Le checkout est strictement linéaire = adresse → menu → panier → checkout → Payer.
- **Auto-fill cross-device impossible V1** : Sophie change de device → re-saisit prénom/adresse. Friction acceptable (auto-fill navigateur natif compense partiellement).
- **KPI "clients dans la base"** légèrement gonflé (10% doublons cross-device). À communiquer en interne comme "clients-devices", pas "clients-personnes". Pas exposé tel quel au resto.
- **Marketing reach cross-tenant** = scopé aux `customer_id` qui ont un canal push actif. Un client doublonné (2 rows) peut recevoir 2 push pour la même campagne. Acceptable V1 (rare + bénéfice marketing > nuisance).
- **Géo-filtering cross-tenant** (cf. [[Notifications]] PRD 80) basé sur historique adresse du `customer_id` → un client doublonné aura 2 historiques séparés. Acceptable.
- **Effacement RGPD** : si Sophie exerce son droit à l'effacement, elle doit fournir email+tel — KB anonymise **tous** les rows avec ces email/tel. Pas de "un seul row anonymisé, les doublons restent".
- **V2 backlog** : OTP email/SMS sur match d'un row existant avec historique (≥ 2 cmds), pour permettre la fusion sécurisée des doublons cross-device qui s'authentifient explicitement. Pas un MUST V1.

## Hard to reverse pourquoi

- Schéma DB sans contrainte unique = autorise les doublons natifs. Si V2 décide de matcher cross-device → migration nécessaire pour soit fusionner les doublons, soit décider quel row "gagne".
- UX checkout linéaire sans branchement "tu es déjà client ?" = pattern intégré dans la PWA. Bascule vers prompt = re-design + re-test conversion.
- Pitch terrain Alex inclut "checkout instant comme Uber" + "carte Wallet pour fidéliser" — bascule vers OTP V2 = renégociation pitch + risque conversion.
- Sécurité CB acquise V1 = un standard de promesse implicite. Lever cette garantie V2 (en permettant match sur email+tel) = perte de confiance si communiqué.

À l'inverse, **ajouter** Layer 2 + OTP en V2 est trivial sans casser V1 :

- Nouveaux clients V2 → option "Te connecter avec email" affichée (Layer 2 + OTP)
- Anciens clients V1 → restent sur leur cookie (Layer 1), avec migration douce s'ils s'authentifient

Conditionne aussi :

- Le schéma DB customers (pas de unique constraint email/phone)
- L'UX checkout PWA (linéaire, pas de prompt identité)
- La stratégie MOAT cross-tenant (Wallet + Cookie, pas email/tel)
- La sécurité CB cross-tenant (Stripe clone PaymentMethod scopé `customer_id` device-verified)
- Le pitch commercial Alex (promesse "checkout instant + sécurité CB")
