---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Campagnes marketing tenant = templates pré-validés uniquement (pas d'éditeur libre)

## Contexte

Le restaurateur (Khan) a accès à son [[KB Admin]] tenant pour lancer une [[Campagne tenant]] à ses propres clients (cf. [ADR 0003](0003-wallet-pass-commun-marque-neutre.md) push moat). Question : Khan peut-il écrire un message libre, ou doit-il choisir parmi des templates pré-validés ?

Risques d'un éditeur libre : contenu inapproprié (injures, faux engagement "PROMO!!!", spam markers), erreur involontaire ("-50%" au lieu de "-5%"), incohérence brand réseau (chaque resto avec son ton), charge de modération récurrente KB.

## Décision

**V1 = Khan choisit dans une bibliothèque de templates pré-validés par KB** (~5-10 templates V1 couvrant 90 % des intents CRM resto). Khan remplit des **variables interpolables** (`{prenom_client}`, `{nom_resto}`, `{item_hero}`, `{discount}`, `{nom_plat}`, `{heure_debut}`, `{heure_fin}`, `{jour}`, etc.) + voit un **preview rendu** + clique envoyer. **Aucun éditeur de texte libre côté resto**.

**Demande de nouveau template custom** = ticket support KB → Alex valide ou refuse → ajout permanent à la bibliothèque (visible chez ce resto uniquement, ou rendu disponible à tous selon contenu). SLA support KB ≤ 48 h.

**Garde-fous hardcodés dans tous les templates V1** :
- `{discount}` ≤ 50 % (anti-erreur "-50% au lieu de -5%")
- Longueur finale message < 200 chars (cohérence Wallet push + Web Push)
- Français uniquement
- Pas de mention alcool / produits soumis à autorisation

**[[Campagne cross-tenant]] KB root** = pas de contrainte template V1 (KB se fait confiance sur le tone, contenu libre autorisé pour KB only).

**Modération de contenu récurrente côté KB = zéro** (résolue par les templates pré-validés). Reste un technical guardrail automatique sur les anomalies (> 1 campagne / 48h pour un même resto, bond inattendu de la base destinataires +50% vs précédent).

## Considered options

1. **Templates pré-validés (choix retenu)** — contrôle qualité, cohérence brand, zéro modération récurrente. Friction perçue par Khan moyenne.
2. **Éditeur libre + flag automatique sur mots-clés / fréquence** — Khan envoie librement, KB regarde uniquement les 10 % flaggés. Modération asynchrone par exception. Risque : flags ratent un vrai dérapage, ou produisent des faux positifs frustrants.
3. **Éditeur libre + validation manuelle systématique KB pre-flight** — chaque campagne validée par Alex avant envoi. Délai max 24h. Insoutenable opérationnellement (Alex en terrain, micro-équipe).
4. **Éditeur libre + post-hoc kill switch** — envoi immédiat sans validation, Alex peut stopper en cours via KB Admin root. Inefficace : 99 % du temps Alex ne regarde pas en temps réel, et le webhook push est synchrone (10s = trop tard).

## Pourquoi ce choix

- **Cohérence brand réseau KB** = facteur décisif. La marque consumer-side neutre KB ([ADR 0003](0003-wallet-pass-commun-marque-neutre.md)) demande un ton cohérent sur tous les push reçus, peu importe le resto émetteur. Un Khan qui écrit "VITE!!! 🔥🔥🔥 -90% IMPOSSIBLE !!!" casse la perception "réseau premium" en 1 message.
- **Charge opérationnelle KB nulle** : pas de file d'attente modération à vider tous les jours. Compatible avec Alex en terrain + micro-équipe.
- **Pédagogie resto naturelle** : Khan apprend ce qui marche en voyant les templates KB (preuve : Yanis du Club Virtual Eats utilise des templates standardisés sur ses 10 restos, zéro churn).
- **Risque ban Apple/Google** : un push wallet/web inapproprié peut faire blacklister le `passTypeIdentifier` ou le VAPID origin → KB perd l'accès à TOUTE sa base push. Risque existentiel. Templates pré-validés = mitigation forte.
- **Marketing à grande échelle V2 simplifié** : avec une bibliothèque centralisée, l'A/B testing V2 sera trivial (KB optimise les templates pour tout le réseau, gains compose).

## Conséquences

- **UI KB Admin tenant simplifiée** : pas d'éditeur de texte WYSIWYG, juste un picker + form variables. Coût build V1 ~3-5 jours vs ~10-15 jours pour un éditeur libre + modération.
- **Bibliothèque templates V1 à rédiger out-of-session** : 5-10 templates initiaux couvrant promo weekend, nouveau plat, relance soft, happy hour, ouverture exceptionnelle, événement local. Validation Alex + 1 avocat (vérif legal markers).
- **Workflow support templates custom** : canal contact KB → Alex → validation 48h → ajout DB. Coût récurrent estimé : 0,5h/semaine V1 (volume bas), 2-5h/semaine en scale Phase 2.
- **Risque "Khan demande N templates" = noyer KB en tickets** : mitigation = communiquer clairement les délais SLA (48h) + raisons des refus (anti-spam, longueur). Possible escalade vers un quota template custom par resto et par mois en V2 si abus.
- **Frustration resto possible** : un Khan qui veut écrire son ton perso (humour, dialecte local) est limité. Mitigation = templates de base avec ton volontairement neutre + variables qui permettent de personnaliser sans tomber dans le spam.
- **Internationalisation reportée V2/V3** : ajouter EN/AR demanderait de dupliquer chaque template par langue. V1 = FR uniquement, cohérent avec [[Campagne]] V1 français uniquement.

## Hard to reverse pourquoi

L'architecture UI KB Admin tenant repose sur le template picker (pas un rich text editor). Le schéma DB des campagnes stocke `template_id` + `variables` (pas un blob de texte libre). Le moteur Notifications applique les garde-fous hardcodés au rendu (longueur, discount cap, langue). Le pitch commercial Alex aux restos inclut "tu accèdes à notre bibliothèque de campagnes validées" — bascule vers éditeur libre = renégociation contrat + perte cohérence brand + risque qualité à corriger ex-post.

À l'inverse, ajouter V2 un mode "éditeur libre opt-in pour les restos validés par KB" (après N campagnes successful) est trivial : ajouter un toggle resto + un rich text component. La décision V1 verrouille la qualité initiale du réseau sans bloquer l'évolutivité.

Conditionne aussi :
- L'UI KB Admin tenant (picker vs editor)
- Le schéma DB campagnes (`template_id` + `variables` JSON)
- Le moteur Notifications (rendu = template + variables, jamais texte libre)
- Le pitch commercial Phase 1+
- La cohérence push moat réseau ([ADR 0003](0003-wallet-pass-commun-marque-neutre.md))
