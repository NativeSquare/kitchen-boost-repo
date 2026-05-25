---
status: accepted
date: 2026-05-25
deciders: Alex
---

# Moteur Pricing exécuté côté backend uniquement (pas de partage front)

## Contexte

[STACK.md §5.3](../contexts/_architecture/STACK.md) prévoyait initialement un moteur pricing **partagé client/serveur** (`packages/shared/pricing`, importé à la fois par Convex pour l'évaluation autoritaire et par `apps/web` pour la projection de prix indicatif au panier). STACK impose : « toute déviation = ADR dédié » — d'où cet ADR.

Décision Alex (2026-05-25, grilling chantier 2.4) : exposer les règles de prix et la formule au client est **trop sensible** (triche possible, règles confidentielles révélées).

## Décision

**Le moteur Pricing s'exécute UNIQUEMENT côté backend.** Le front n'a **jamais** les règles ni la formule. Il envoie sa demande (panier + contexte) à l'API ; le backend exécute le moteur (+ récupère le quote Uber Direct) et **renvoie le prix calculé** :

- prix **indicatif** au panier (appel backend),
- prix **définitif** au clic « Payer » (ré-évaluation backend = [[Latching]]).

Le moteur reste un **module pur testable en isolation** (entrée → sortie, sans dépendance Convex), mais il est **consommé exclusivement par le serveur**.

## Considered options

1. **Backend-only (choix retenu)** — règles + logique confidentielles, aucune triche client possible, le front ne fait qu'afficher un prix reçu.
2. **Partagé client/serveur (STACK §5.3 initial)** — rejeté : expose les règles de pricing et la formule d'évaluation au navigateur, permet de comprendre / contourner la tarification, et n'apporte qu'un gain de latence marginal sur la projection panier.

## Conséquences

- **Supersede [STACK.md §5.3](../contexts/_architecture/STACK.md)** (« engine partagé client/serveur ») et la ligne Pricing du mapping §3.
- `apps/web` n'importe **pas** le moteur ; la projection de prix au panier = un appel backend (query/action) qui renvoie le prix.
- Le module pur peut vivre dans `packages/shared/pricing` (testabilité hors Convex) **mais n'est importé que par le backend** ; il n'est plus "partagé" avec le front au sens exécution.
- La décision pricing (règle gagnante + coût brut + part client/resto) est **figée sur la commande** au paiement (chantier 2.3) — sert de trace "pourquoi ce client a payé X", sans journal d'évaluation haute fréquence.
- La sélection de la règle gagnante reste **déterministe = celle qui minimise les frais facturés au client** (Q35-Q2), sans ordre manuel.
