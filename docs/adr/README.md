# Architecture Decision Records (ADRs)

Ce dossier contient les ADRs KitchenBoost — traces des décisions d'architecture **hard-to-reverse, surprenantes sans contexte, et résultat d'un vrai trade-off**.

Format : conforme au skill [`grill-with-docs`](../../../.claude/skills/grill-with-docs/SKILL.md). Cf. [ADR-FORMAT.md](../../../.claude/skills/grill-with-docs/ADR-FORMAT.md) pour le template.

## ADRs publiés

| N° | Titre | Statut | Date |
|---|---|---|---|
| [0001](0001-consent-marketing-bloquant-checkout-v1.md) | Consentement marketing bloquant au checkout V1 | superseded by [0007](0007-consentement-clic-payer-v1.md) | 2026-05-23 |
| [0002](0002-push-moat-dual-stack-wallet-a2hs.md) | Push moat V1 = dual stack Wallet pass + A2HS PWA | accepted | 2026-05-24 |
| [0003](0003-wallet-pass-commun-marque-neutre.md) | Wallet pass V1 = carte commune sous marque neutre | accepted | 2026-05-24 |
| [0004](0004-pwa-standalone-pas-widget-embed.md) | Surface client final V1 = PWA standalone | accepted | 2026-05-24 |
| [0005](0005-re-consentement-marketing-par-achat.md) | Re-consentement marketing par achat (réactivation au re-checkout) | accepted | 2026-05-24 |
| [0006](0006-templates-campagnes-pre-valides.md) | Campagnes marketing tenant = templates pré-validés uniquement | accepted | 2026-05-24 |
| [0007](0007-consentement-clic-payer-v1.md) | Consentement V1 par clic sur "Payer" (pas de checkbox) | accepted | 2026-05-24 |
| [0008](0008-identite-customer-cookie-device-only-v1.md) | Identité Customer V1 = cookie device only (pas de matching cross-device email/tel) | accepted | 2026-05-24 |
| [0009](0009-hubrise-reporte-v2.md) | Hubrise reporté V2 (vs V1 envisagé) | accepted | 2026-05-24 |

## Quand créer un ADR

Les 3 conditions doivent être vraies :

1. **Hard to reverse** — coût de changement non trivial plus tard.
2. **Surprising without context** — un lecteur futur se demandera "pourquoi ce choix ?".
3. **Result of a real trade-off** — des alternatives concrètes existaient.

Si une seule condition manque, skip. Tout le reste est documenté soit dans les PRDs (`docs/prd/`) soit dans les CONTEXT.md (`docs/contexts/`).

## Numérotation

Fichiers `0001-slug.md`, `0002-slug.md`, etc. Incrémenter par 1 — scanner le numéro le plus haut existant.

## Format

```md
# {Titre court de la décision}

{1-3 phrases : contexte, ce qu'on a décidé, pourquoi.}
```

Sections optionnelles uniquement si elles ajoutent de la valeur : `Status` (frontmatter), `Considered Options`, `Consequences`.

## Décisions actées candidates à formaliser

Liste indicative de décisions structurantes **déjà prises** dans les PRDs/contrats. Elles peuvent être formalisées en ADRs au fur et à mesure des grilling sessions, pas en bloc :

- Stripe Connect Express + direct charges + KB pas merchant of record (cf. [Payment](../contexts/payment/CONTEXT.md), Article 3.2/3.3 contrat)
- Base clients KB cross-tenant = MOAT verrouillé contractuellement (cf. [Customer Data](../contexts/customer-data/CONTEXT.md), Article 2 ter)
- PWA + app native cohabitent (cf. [Kitchen Display](../contexts/kitchen-display/CONTEXT.md) + [Merchant Mobile](../contexts/merchant-mobile/CONTEXT.md))
- ~~Hubrise dans le scope V1 (vs V2 initial)~~ — **formalisé en [ADR 0009](0009-hubrise-reporte-v2.md) : Hubrise reporté V2** (négo réaliste avec entreprise établie pas envisageable Phase 1)
- Push marketing V1 (vs V2 initial)
- Soft-launch progressif V1 (vs V1.A/V1.B gates rigides)
- 2€ HT flat KB + pass-through frais Stripe via `on_behalf_of`
- Uber Direct self-signup par tenant V1, Integration Partner V2
- Multi-tenant `tenant_id` partout + RLS Postgres
- KB pas KDS tiers V1 (BYOD seulement)
- Items distincts par parfum (jamais modifier "parfum_X")
- Stack admin / mobile / backend = décisions dev lead, hors scope PRD
