---
status: accepted
date: 2026-05-25
deciders: Alex
---

# Inscription push : l'identité + la joignabilité vivent dans Customer Data, l'envoi dans Notifications

## Contexte

Le push (carte [[Wallet pass]] + web-push PWA) est **double-critique** pour KitchenBoost (cf. [ADR 0002](0002-push-moat-dual-stack-wallet-a2hs.md), [ADR 0003](0003-wallet-pass-commun-marque-neutre.md)) :

1. **Canal de reconquête n°1** — la carte Wallet ouvre l'écran de verrouillage (85-99 % d'ouverture vs 15-20 % email). C'est le mécanisme primaire du MOAT consumer-side.
2. **Pont d'identité cross-device** — le `serial_number` de la carte Wallet est lié au `customer_id` côté backend (cf. [ADR 0008](0008-identite-customer-cookie-device-only-v1.md)). C'est, avec le cookie device, la **seule** façon V1 de reconnaître la même personne quand elle change d'appareil, sans login.

Deux contextes peuvent légitimement revendiquer le stockage de l'inscription push : [[Customer Data]] (PRD 90, qui listait historiquement une table `push_subscriptions`) et [[Notifications]] (PRD 80, qui possède l'envoi). Il fallait trancher qui possède quoi pour éviter une double propriété floue.

## Décision

On **scinde la responsabilité** :

- **[[Customer Data]] (chantier 2.1) possède l'INSCRIPTION + l'IDENTIFIANT + la JOIGNABILITÉ.** Concrètement, rattachés au `customer` : le `serial_number` de la carte Wallet, l'identifiant d'abonnement web-push PWA, et le statut d'inscription par canal (Wallet / web-push / A2HS). C'est ici parce que ces IDs sont d'abord une affaire **d'identité** (le serial Wallet est le pont cross-device de l'ADR 0008) et de **joignabilité** (la base du KPI agrégé « N clients atteignables push » vu par le resto — MOAT).
- **[[Notifications]] (chantier 2.7) possède l'ENVOI.** Le moteur d'expédition, les clés serveur (VAPID web-push, certificats APNs/FCM), les templates et les payloads. Notifications **lit** les IDs/joignabilité de Customer Data et **référence le `customer` par son id** ; il ne les possède pas.

Règle d'une phrase : **2.1 = « qui est joignable et par quel ID » ; 2.7 = « on envoie le message ».**

## Considered options

1. **Scission identité/envoi (choix retenu)** — le stockage de l'ID suit la sémantique (identité → Customer Data), l'envoi suit la plomberie (→ Notifications).
2. **Tout dans Notifications** (table `push_subscriptions` complète côté 2.7, Customer Data ignore le push) — rejeté : casse le pont d'identité cross-device de l'ADR 0008 (le serial Wallet EST une clé d'identité, pas un détail d'envoi) et oblige Customer Data à requêter Notifications pour calculer la joignabilité, qui est un KPI MOAT.
3. **Tout dans Customer Data** (y compris le moteur d'envoi + les clés serveur) — rejeté : pollue le contexte MOAT avec de la plomberie d'expédition multi-canal (email/SMS/APNs) qui est le cœur de Notifications.

## Conséquences

- Le schéma 2.1 porte la table d'inscription push du customer (serial Wallet, ID web-push, statut par canal). 2.7 ne duplique pas ces IDs : il les lit.
- La « joignabilité par canal » (KPI agrégé vue resto, MOAT) se calcule **entièrement dans 2.1**, sans dépendre de Notifications.
- L'anonymisation RGPD (cf. [[Effacement RGPD = anonymisation irréversible]]) nullifie aussi ces IDs côté 2.1, en un seul geste, puisqu'ils y vivent.
- Quand un client se désinscrit du marketing (opt-out) ou que l'inscription web-push expire, Notifications met à jour le statut côté 2.1 (la source de vérité de la joignabilité reste 2.1).
- Le `push_subscriptions` historiquement listé dans le PRD 90 §1 est **clarifié** : sa partie « identité/joignabilité » reste en 2.1 ; sa partie « credential d'envoi » (clés) relève de 2.7.
