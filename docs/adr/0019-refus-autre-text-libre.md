---
status: accepted
date: 2026-06-05
context: KB Orders (PRD 20), Notifications (PRD 80)
---

# 0019 — Le motif de refus `autre` requiert un texte libre 1-280 chars propagé au push client

## Décision

Quand le restaurateur refuse une commande avec le motif `autre` (le 4ᵉ catch-all du closed set `rupture | fermeture | surcharge | autre`), il **doit** saisir un texte libre **1-280 chars** (trimmé). Ce texte est stocké sur le `orderEvents` row `refusée` (`customReason`) et propagé verbatim dans le push client : `"Désolé, votre commande a été refusée. Motif : ${customReason}"`. Les **3 autres motifs restent enum-only** — leur label suffit au push, un éventuel `customReason` est silencieusement ignoré côté backend.

UI : une étape supplémentaire `customReasonInput` est insérée dans la state machine du dialog (entre `pickReason` et `confirm` en 2-step, entre `pickReason` et `warnInflight` en 3-step). Le bouton « Continuer » est disabled tant que `decideCanSubmitCustomReason(typed)` est faux (trim vide ou > 280).

Backend : la mutation `refuse` ajoute `customReason: v.optional(v.string())` à son validator. Un guard runtime (`validateCustomReason`) throws `INVALID_CUSTOM_REASON` AVANT toute transition si `reason === "autre"` et que le trim est vide ou > 280 (atomique : pas de demi-refus).

## Pourquoi un texte libre obligatoire plutôt que catch-all enum-only ou motifs enum supplémentaires ?

Trois options ont été évaluées :

1. **Garder `autre` enum-only** (statu quo) : le client reçoit un push neutre `"Désolé, votre commande a été refusée."` sans précision. Problème terrain : un client qui ne sait pas pourquoi recommence l'expérience négative ailleurs (perte de confiance hors signal exploitable côté resto). Le restaurateur sait pourquoi, mais l'information meurt dans l'audit.

2. **Étendre l'enum avec d'autres motifs documentés** (ex: `incident_hygiene`, `livraison_impossible`, `materiel_panne`) : repousse le problème — quoi qu'on ajoute, `autre` restera nécessaire pour le long-tail. Multiplie les libellés UI sans gain net. Le besoin opérationnel est de **narrer un incident**, pas de classer 12 catégories.

3. **Texte libre obligatoire sur `autre`** (décidé) : force le restaurateur à formuler une raison concrète au client. Coût UX : une étape supplémentaire dans la dialog ; bénéfice : le push est actionnable côté client (`"panne frigo"`, `"livreur introuvable"`, `"ratatouille brûlée"`) et le resto possède une trace audit-grade pour le SAV. Le 280-chars Twitter-like force la concision (pas un essai, une phrase).

## Trade-offs assumés

- **Une étape de dialog en plus uniquement pour `autre`** : asymétrie volontaire — les 3 motifs enum portent déjà l'information côté push, ajouter un input à tous serait du travail mort.
- **Format push `Motif : ${customReason}` (PAS `Motif : Autre — ${customReason}`)** : le label "Autre" est jargon interne, le client lit directement la précision. Décision A documentée dans le PRD source de la feature.
- **Backend validateur runtime conditionnel** (pas au boundary du `v.optional`) : la règle croise `reason` + `customReason`, donc pas exprimable au validator Convex seul. Un guard `validateCustomReason` dans la mutation s'en charge AVANT `transitionTenantOrder` (rejet atomique, rien d'écrit).
- **Front gate symétrique au backend** : `decideCanSubmitCustomReason` (trim + 280) dispense le bouton ; le backend re-valide en defence-in-depth (même règle, dupliquée par design pour rester pure et testable des deux côtés).

## Conséquences

- **Schema** : `orderEvents.customReason: v.optional(v.string())` ajouté (additif, compatible ascendant — les rows historiques l'ont à `undefined`).
- **Mutation `refuse`** : `customReason: v.optional(v.string())` ajouté aux args ; guard runtime ; stocké sur l'event row uniquement quand `reason === "autre"`.
- **State machine front** (`refuseFlowReducer`) : nouvelle étape `customReasonInput` + actions `setCustomReason` / `submitCustomReason` ; `customReason` traverse `warnInflight` → `typeWord` → `confirm` jusqu'à la mutation.
- **Push template** : `decideRefundIssuedPushBody({reason, customReason})` (pure, vitest) définit le wording exact. Le dispatcher web-push V1 hardcode encore `{title: "KitchenBoost"}` (chantier 2.7 — templating à venir) ; cette fonction est la source de vérité du wording côté domain, prête à être branchée.
- **Tests E2E** : la grille `KBO-RJ` (PRD 20 §6a) ajoute au moins un parcours `autre + customReason` pour pinner le cross-layer (UI saisie → mutation → event row → push body source de vérité).

## Rejet

- ❌ **Texte libre sur tous les motifs** : coût UX inutile sur les 3 motifs déjà couverts par leur label enum.
- ❌ **Customreason optionnel sur `autre`** : un push `"Motif : Autre"` est pire qu'un push neutre — il signale au client qu'il y a une raison mais la cache. Casser le silence ou rien.
- ❌ **Sanitisation côté push uniquement (sans bornes UI)** : laisser le restaurateur écrire 500 chars puis tronquer côté template = source de bugs d'affichage cross-OS. La borne 280 vit côté UI ET backend.
