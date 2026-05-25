---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Hubrise reporté V2 (vs V1 envisagé)

## Contexte

L'agrégation des cmds Uber Eats + Deliveroo dans [[KB Orders]] passe via [[Hubrise]] (SaaS d'orchestration multi-marketplace, ~30 €/mois/location + 25 € setup). La promesse commerciale est forte : **1 seul écran cuisine** vs 3 interfaces parallèles aujourd'hui (KB Orders + tablette Uber Eats Orders + tablette Deliveroo).

La révision PRD master v2.0 avait remonté Hubrise V2 → V1, "subject to Q13 négo commerciale". À l'arbitrage final 2026-05-24, on bascule V2.

## Décision

**Hubrise est reporté V2.** En V1 :
- Pas d'intégration Hubrise dans [[KB Orders]]
- Le resto continue à gérer ses cmds Uber Eats sur la **tablette Uber Eats Orders** fournie par Uber (et Deliveroo sur sa propre tablette s'il en a)
- [[KB Orders]] ne traite que les cmds [[Direct]] (PWA KB)
- Pas de tag [[Source]] visible côté KDS V1 (toutes les cmds sont direct par construction)

Le pitch commercial V1 mentionne explicitement Hubrise comme **roadmap V2** ("Phase 2 = on agrège tes cmds Uber Eats / Deliveroo dans le même écran KB Orders"), pas comme promesse V1.

## Considered options

1. **Hubrise V1, négo Q13 commerciale en cours (choix initial v2.0 master)** — promesse "1 seul écran" dès V1, mais dépendance critique externe non maîtrisée.
2. **Hubrise V2 (choix retenu)** — V1 = 3 interfaces cuisine acceptées, focus V1 sur le moat (Customer Data + Wallet + Stripe Connect).
3. **Alternative Deliverect V1** (100-150 €/mois) — sortir du blocage Hubrise mais coût 3-5× supérieur, ROI négatif sur 1 resto pilote.
4. **Intégration directe Uber Eats Marketplace API V1** — pas un programme ouvert à tout le monde (certification requise comme Uber Direct IP), donc même blocage commercial.

## Pourquoi ce choix

- **Dépendance externe non maîtrisée** = facteur décisif. Hubrise est une entreprise FR établie (10+ ans, milliers de clients) qui n'a pas d'incentive à prioriser KB (micro-équipe, 1-3 restos pilotes). Négo `Q13` peut traîner 3-6 mois minimum. Bloque la timeline cible 2026-09-30 V1.
- **V1 = soft-launch sur 1 resto (Buns & Bao)** — pas de mutualisation possible avant le 2ᵉ resto. 30 €/mois pour 1 location = ROI Hubrise négatif Phase 1.
- **3 interfaces cuisine V1 = acceptable** — c'est déjà ce qu'a le resto avant KB. KB n'aggrave pas la situation, il l'améliore progressivement (KB Orders gère le direct, Uber Eats Orders gère les cmds Uber Eats). Cohérent avec [feedback_tablette_uber_kiosk_vs_pwa.md](../../.claude/memory/feedback_tablette_uber_kiosk_vs_pwa.md) qui acte déjà 2 interfaces minimum V1 (KB Orders + Uber Eats Orders).
- **Focus dev V1 sur le MOAT** = Customer Data + Notifications + Wallet + Stripe Connect + PWA standalone. L'agrégation Marketplaces est différenciation produit, pas moat — peut attendre.
- **Pitch commercial V1 préservé** : "on te ramène du direct à 2€/cmd" reste le pitch principal. Hubrise V2 devient une "roadmap visible" qui démontre la vision sans engagement immédiat.
- **Risque commercial pivot facile** : annoncer "Hubrise V2 dans 3 mois" est crédible. Annoncer "on prend du retard parce que Hubrise négo bloque" casse la confiance terrain.
- **Path d'évaluation V2 dégagé** : si Hubrise refuse / tarde en V2, plan B Deliverect (100-150 €/mois) reste activable. Ou même intégration directe Uber Eats Marketplace API si volume KB justifie certification.

## Conséquences

- **PRD 60 entièrement V2** : scope V1 vidé, sections V1 reportées V2, open questions Q60-Q1 à Q60-Q5 reportées V2.
- **CONTEXT Marketplaces reste skeleton** : pas de grilling approfondi tant que la négo V2 n'est pas amorcée. Termes clés (Hubrise, Location, External order, Menu mapping, Source, Bi-directionnel) restent comme placeholders.
- **3 interfaces cuisine V1 documentées** : à acter dans le pitch terrain + l'onboarding resto comme "phase intermédiaire". Communiqué clairement aux prospects.
- **Buns & Bao pilote V1** : Khan continue d'utiliser sa tablette Uber Eats Orders en parallèle de [[KB Orders]] sans agrégation. Pas de changement vs aujourd'hui pour les cmds Uber Eats.
- **Q13 master peut être clôturée comme "reportée V2"** : pas besoin de négo Hubrise active Phase 1.
- **Tag [[Source]] V1 simplifié** : pas affiché côté KDS (toutes les cmds = direct par construction). Field DB préservé pour V2 (default `direct`).
- **Pitch terrain Alex** : ajouter une slide "roadmap V2 = agrégation cmds Uber Eats/Deliveroo" dans le kit commercial. Rend la vision visible sans la promettre.

## Hard to reverse pourquoi

- **Sprint planning V1** : la dev d'Hubrise (OAuth flow, webhooks, menu mapping, tag source UI) représente ~2-3 semaines équipe. Sa sortie V1 libère du temps pour finir le moat.
- **Pitch terrain** : annoncer Hubrise V1 puis le repousser V2 mid-roadmap = perte crédibilité. Annoncer V2 dès le départ = engagement tenable.
- **Négo commerciale Hubrise** : amorcer une négo, puis l'abandonner / la repousser, abîme la relation pour la reprise V2. Mieux vaut ne pas commencer prématurément.
- **Tablette Uber Eats Orders chez le resto** : continuer à l'utiliser V1 est trivial (c'est l'état existant). Le retirer puis le remettre serait coûteux UX-side.

À l'inverse, **basculer Hubrise V1 → V2 plus tard si la négo aboutit anticipée** est trivial : reprendre PRD 60, déprécier cette ADR, lancer le sprint. La décision V2 ne ferme aucune porte.

Conditionne aussi :
- Le sprint planning V1 (cf. [roadmap.md](../prd/roadmap.md))
- Le pitch commercial terrain (slide roadmap V2)
- L'onboarding resto V1 (cuisine = 3 interfaces transitoirement)
- La timeline Q13 master (clôturable "reportée")
- Le scope [[KB Orders]] V1 (cmds direct uniquement)
