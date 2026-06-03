---
status: accepted
date: 2026-06-03
context: KB Orders (PRD 20), Payment (PRD 30)
---

# 0016 — Timeout d'acceptation : état `auto_expired` distinct + Stripe auto-capture / refund pour MVP

## Décision

Une cmd `paid` non `acknowledged` dans les **5 minutes** est expirée par le backend, refundée automatiquement via Stripe, et notifiée au client avec un template neutre. L'état terminal `auto_expired` est **distinct** de `refusée` (refus humain avec motif). Pour MVP, on reste sur Stripe **auto-capture** (débit immédiat à la confirmation du Payment Intent côté PWA) + **refund** sur timeout, plutôt que sur manual capture (auth → capture à l'acceptation, cancel auth à l'expiration).

## Pourquoi auto-capture + refund pour MVP, alors que manual capture est globalement préféré ?

Manual capture serait meilleure UX client (le client n'est jamais débité au lieu d'être débité puis remboursé 3-5j plus tard) et c'est la préférence de fond d'Alex. Trois raisons concrètes la repoussent à V2+ :

1. **Apple Pay / Google Pay sur Stripe** ont des restrictions sur les holds étendus selon les card schemes — manual capture peut foirer silencieusement sur ces méthodes (fraction probablement majoritaire des paiements mobiles V1).
2. **Une seule code path Stripe** entre refus humain et timeout système (les deux refundent un Payment Intent déjà capturé). Manual capture introduit 2 chemins (cancel auth si timeout, capture si accept, refund si refus après accept) — plus de surface de bug, plus de cas sandbox à tester.
3. **Carte expirée entre auth et capture** : cmd à 23h50 le 28/02, accept à 00h05 le 01/03, carte expirée → capture refusée alors que le client croit avoir payé. Edge case réel évité par auto-capture.

V2+ : migration vers manual capture envisagée quand le périmètre permettra de tester proprement les edge cases par méthode de paiement. Nécessitera un ADR de remplacement.

## Pourquoi état séparé `auto_expired` vs extension du closed set `Refusal` ?

Refus humain et timeout système sont des **signaux orthogonaux** :

- Un resto qui refuse 5 cmds/jour volontairement (rupture stock chronique) → signal **business** (update menu)
- Un resto qui en rate 5 (tablette HS, push OS-bloqué, Khan AFK) → signal **opérationnel** (intervention ops KB)

Mélangés dans un seul état `refusée` avec motif `timeout_resto`, ces deux populations sont indiscernables dans les métriques. KB Admin perdrait sa capacité à alerter sur chaque cas séparément. Côté client, mélanger les deux template push ("le restaurant a refusé : timeout" vs "votre commande n'a pas pu être traitée") stigmatise inutilement la marque resto.

## Conséquences

- `workflowStatus` inclut `auto_expired` en plus de `refusée` (DB + types)
- Backend : à `paymentSucceeded`, poste `scheduler.runAfter(5min, expireIfNotAcknowledged)` idempotent
- UI KB Orders + KB Admin : historique avec onglet **"Manquées"** distinct de **"Refusées"**
- Métriques côté KB Admin : taux de refus humain ≠ taux de cmds manquées ; alerte ops si manquées > seuil/jour
- Push client : 2 templates distincts (motif explicite vs neutre)
- Migration V2+ vers manual capture nécessitera un ADR de remplacement et une migration des cmds en vol au moment du switch
