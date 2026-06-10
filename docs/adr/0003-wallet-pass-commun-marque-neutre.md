---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Wallet pass V1 = carte commune sous marque neutre (vs carte par resto)

## Contexte

Le [Wallet pass V1](0002-push-moat-dual-stack-wallet-a2hs.md) est le canal push primary du moat KitchenBoost. Deux architectures possibles :

- **Carte par resto** (N cartes visuelles, 1 par tenant — branding intégral resto, white-label total côté client)
- **Carte commune** (1 carte multi-resto sous marque consumer-side neutre — agrège N restos KB sur 1 même channel push)

Le choix initial (2026-05-23) penchait vers carte par resto pour préserver l'Article 2 ter contrat ("aucun message KB brandé au client"). Révision actée 2026-05-24 vers carte commune.

## Décision

**V1 = 1 carte Wallet commune sous marque neutre** (pas "KitchenBoost" littéral) **pour tous les restos KB participants**. Sur chaque pass, le **logo du resto principal commandé est mis en avant visuellement** (header = logo du dernier resto commandé), avec mention "Membre [Nom carte]" en bas.

**Naming définitif acté 2026-06-10 : « Mes Restos »** (Q80-Q1 / Q10-Q11 résolus). Aligné Apple PassKit `organizationName` (constante `WALLET_CARD_NAME`) + Google Wallet Issuer name. Concret, FR, user-friendly, scalable hors IDF (l'ancien placeholder "Resto Paris" limitait l'extension hors région parisienne — invalidant le pitch national).

**Carte premium par resto = option V2** pour restos sensibles à leur autonomie de marque (paient un supplément X €/mois).

**Article 2 ter contrat reformulé** pour autoriser la carte commune sous marque neutre (KB reste propriétaire des données, mais accepte une marque consumer-side visible).

**Naming évolutif** : le nom de la carte est updatable via push update Wallet sans action client requise (Apple PassKit Web Service / Google Wallet API). Possibilité de démarrer "Resto Paris" Phase 1 → migrer "Resto France" Phase scale sans casser les installs. Le `passTypeIdentifier` technique reste fixe (invisible client), seul le branding visible évolue.

## Considered options

1. **Carte par resto V1** (initial 2026-05-23) — branding white-label intégral, cohérent Article 2 ter, mais cross-tenant push impossible et enfermement stratégique pour la vision long terme "Uber Eats à 2€".
2. **Carte commune sous marque "KitchenBoost" littérale** — moat marque consumer-side mais romp directement l'Article 2 ter ("aucun message compte KB brandé").
3. **Carte commune sous marque neutre** **(choix retenu)** — moat marque consumer-side via marque distincte de "KitchenBoost", cohérent avec article 2 ter reformulé (le nom "KitchenBoost" n'apparaît pas).

## Pourquoi ce choix

- **Asymétrie de migration** = point décisif : carte commune → carte premium par resto V2 est trivial (opt-in resto, ajout pass parallèle), inverse est un casse-tête (migration forcée, perte engagement par client). Démarrer en commun préserve l'optionalité.
- **Vision long terme "Uber Eats à 2€"** exige une marque consumer-side activable dès V1. Sans ça, KB reste un fournisseur SaaS comme Owner.com — moins défensible qu'un marketplace network-effect comme Uber Eats. La carte commune est l'embryon de la marque consumer.
- **Cross-tenant push trivialisé** : 1 channel push commun → KB peut pousser "Nouveau resto à 5 min de chez toi" à tous les clients du quartier dès l'onboarding d'un nouveau resto. Network effect immédiatement activable. Argument décisif pour l'acquisition resto.
- **Onboarding nouveau resto crée trafic immédiat** : c'est exactement ce qui fait la valeur d'Uber Eats côté resto. Sans carte commune, le resto démarre à 0 client connu.
- **Pitch commercial évolutif** : "Tu rejoins notre réseau de restos qui se partagent les clients qualifiés à 2€/cmd" devient plus puissant que "On te crée ta vitrine perso". Différentiation unique vs Uber Eats 30%.

## Conséquences

- **Article 2 ter contrat à reformuler** : "aucun message KB brandé" → "aucun message 'KitchenBoost' littéral brandé, marque consumer-side neutre acceptée". À coordonner avec avocat avant V1 launch. Avenant ou nouveau contrat pour les 3 restos déjà signés.
- **Pitch commercial à retravailler** : Alex doit muter le pitch terrain de "ton moat ta marque" vers "rejoins notre réseau" pour les prochains restos signés.
- **Risque churn resto** : un resto qui se sent "marque sous KB" peut churn. Mitigation = mise en avant systématique du logo resto principal sur la carte + option premium V2 carte propre par resto.
- ~~**Naming consumer-side à finaliser**~~ → **acté 2026-06-10 : « Mes Restos »** (cf décision ci-dessus). Reste updatable plus tard via Wallet push update sans casser les installs si on veut évoluer (ADR 0003 prévoit le naming évolutif).
- **Customer Data CONTEXT** : la formulation "white-label intégral" devient "white-label intégral resto-side (ordering) + marque consumer-side neutre (wallet + marketing cross-tenant V2)". Cohérent avec la stratégie produit révisée.

## Hard to reverse pourquoi

Une fois N clients enrôlés sur la carte commune, basculer vers cartes par resto = migration forcée (chaque client doit installer une nouvelle carte par resto) avec perte massive d'engagement (taux ré-install ~30-50%, comme la base RGPD ré-opt-in). À l'inverse, ajouter des cartes premium par resto en parallèle de la carte commune V2 est trivial. La décision contraint donc l'architecture push moat de manière asymétrique : facile à enrichir, douloureux à revenir.

Conditionne aussi :

- Le schéma DB `wallet_passes` (pas de `tenant_id` sur la carte elle-même, juste sur les usages)
- Le contrat resto Article 2 ter
- La marque consumer-side KB long terme
- Le pitch commercial Phase 1+

Doc de référence : [docs/research/wallet_pass_vs_pwa_a2hs.md](../research/wallet_pass_vs_pwa_a2hs.md).
