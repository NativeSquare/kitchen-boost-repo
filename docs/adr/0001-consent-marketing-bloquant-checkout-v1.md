---
status: superseded
date: 2026-05-23
superseded_by: 0007-consentement-clic-payer-v1.md
superseded_date: 2026-05-24
deciders: Alex
---

# [SUPERSEDED] Consentement marketing bloquant au checkout V1 (risque RGPD assumé)

> **Note 2026-05-24** : cet ADR est superseded par [ADR 0007](0007-consentement-clic-payer-v1.md). La V1 abandonne le pattern "checkbox bloquante" au profit du pattern "phrase informative sous le bouton Payer" (Uber/Deliveroo/Stripe). La séparation DB `consent_marketing` / `consent_transactional` envisagée ici est également abandonnée — schéma final = `cgv_accepted_at` + `cgv_version_hash` + `marketing_opt_out_date` (cf. [ADR 0005](0005-re-consentement-marketing-par-achat.md)).

## Contexte

KitchenBoost capte email/tel/adresse au checkout PWA client. La base clients globale est le MOAT (cf. [[Customer Data]]). L'enjeu : maximiser à la fois le volume capté ET l'atteignabilité marketing (push/email/SMS) au plus tôt, sans alourdir la PWA.

## Décision

**V1, la commande PWA ne peut pas être validée tant que la checkbox de consentement marketing n'est pas cochée.** Pas d'opt-in séparé décoché. Pas de double track transactionnel/marketing distincts au checkout.

## Considered options

1. **Opt-in séparé, décoché par défaut (RGPD-strict)** — case marketing distincte, cmd validable même si décochée. Recommandation par défaut.
2. **Opt-in bloquant** — case unique, cmd impossible sans cocher. **Choix retenu.**
3. **Opt-in pré-coché (gris)** — case marketing pré-cochée, le client doit décocher activement.
4. **Pas de captation marketing V1, transactionnel only** — pas de checkbox marketing au checkout du tout.

## Pourquoi ce choix

- Maximise l'atteignabilité marketing dès V1 (100% des clients captés = 100% atteignables, modulo opt-out post-onboarding).
- Évite de présenter au resto un KPI "atteignables push" très en-dessous du "total clients" → meilleure démonstration commerciale.
- Le risque CNIL court terme est jugé faible : la CNIL cible historiquement les grands comptes et le e-commerce visible, pas les SaaS B2B verticaux à <1000 clients finaux.
- KitchenBoost se réserve le droit de re-arbitrer si l'un de ces signaux apparaît : sanction publique d'un acteur comparable, plainte d'un client, dépassement d'un seuil de base captée jugé visible.

## Conséquences

- **Risque juridique** : non-conformité probable à RGPD Art. 7-4 (consentement libre) et à la jurisprudence CJUE Planet49 (2019). Sanction CNIL possible jusqu'à 4% du CA annuel mondial KitchenBoost. Référence : Carrefour 2,25 M€ (2020), Brico Privé 500 k€ (2021) sanctionnés sur des patterns proches.
- **Risque MOAT paradox** : si la CNIL ordonne re-onboarding ou suppression, c'est la base = MOAT qui est attaquée directement. Le verrou contractuel Article 2 ter (côté resto) ne protège pas de cet axe.
- **Plan B technique à préparer dès V1** : schéma DB séparant `consent_marketing` (booléen) et `consent_transactional` (booléen) même si la cmd ne valide que les deux ensemble en V1. Permet de basculer sur opt-in séparé sans migration douloureuse si la décision est revue.
- **Veille active** : monitor CNIL délibérations + jurisprudence consentement marketing trimestriellement. Re-arbitrer dès qu'un signal apparaît.

## Hard to reverse pourquoi

Une fois N clients captés sous ce régime, si CNIL ou audit interne décide que le consentement n'était pas libre, deux issues coûteuses :
1. Re-onboarder toute la base (taux de re-opt-in attendu : 30-50%, perte sèche de moitié du MOAT).
2. Supprimer la base et repartir.

Aucune des deux n'est compatible avec la promesse MOAT du produit. D'où l'ADR.
