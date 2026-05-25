# PRD KitchenBoost — Index

Ce dossier contient la documentation produit canonique de KitchenBoost. Il est organisé en **un PRD master** + **N sous-PRDs par sous-domaine fonctionnel** + **une roadmap d'exécution**.

Tout autre dossier (`docs/specs/`, `docs/research/`, `docs/plans/`) est désormais considéré soit comme **archive** (specs préliminaires), soit comme **matériel exploratoire** (research / plans), et n'est plus source de vérité produit.

## Architecture documentaire (compatible skill `/grill-with-docs`)

Trois types d'artefacts coexistent, chacun avec son rôle :

| Artefact           | Emplacement                            | Rôle                                                                             | Source de vérité ? |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| **PRDs**           | `docs/prd/` (ici)                      | **Quoi build** — surface, flows, edge cases, critères d'acceptation, dépendances | ✅ Spec            |
| **CONTEXT.md**     | [`docs/contexts/<nom>/`](../contexts/) | **Vocabulaire** — glossaire ubiquitous language par bounded context              | ✅ Langage         |
| **ADR**            | [`docs/adr/`](../adr/)                 | **Pourquoi ce choix** — décisions hard-to-reverse + trade-offs explicites        | ✅ Décisions       |
| **CONTEXT-MAP.md** | [Racine repo](../../CONTEXT-MAP.md)    | **Carte des contextes** + relations + shared types                               | ✅ Index           |

Les PRDs documentent **ce qu'il faut faire**, les CONTEXT.md documentent **comment on en parle**, les ADRs documentent **pourquoi tel choix vs tel autre**. Aucun chevauchement — chaque info a une seule maison canonique.

## Convention

- Le **master** (`00_master.md`) définit la vision, les personas, le business model, l'architecture fonctionnelle macro, et le scope V1/V2/V3.
- Les **sous-PRDs** (`10_*` à `90_*`) détaillent un sous-domaine fonctionnel : surface, flows, edge cases, critères d'acceptation, dépendances, open questions.
- La **roadmap** (`roadmap.md`) séquence l'exécution dans le temps avec jalons, dépendances et critères de release.
- Les sous-PRDs sont numérotés par tranches de ~10 pour permettre l'insertion future de nouveaux PRDs sans renuméroter.
- Un sous-PRD se concentre sur **quoi faire**, pas **comment**. Les choix d'implémentation (stack, libs, patterns de code) sont validés au moment du dev et documentés en ADR (`docs/adr/` à créer si besoin).

## Table des matières

| #   | Document                                                         | Statut                     | Scope V1 ?                                                                                                                                                |
| --- | ---------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | [00_master.md](00_master.md)                                     | ✅ Complet v2.0            | — (transverse)                                                                                                                                            |
| —   | [roadmap.md](roadmap.md)                                         | ✅ Complet v2.0            | — (transverse)                                                                                                                                            |
| 10  | [10_pwa_client_commande.md](10_pwa_client_commande.md)           | 🟡 Squelette v0.2          | **OUI** — chemin critique V1 (étendu : Apple Pay, position géo, click & collect, push marketing)                                                          |
| 20  | [20_kb_orders.md](20_kb_orders.md)                               | 🟡 Squelette v1.0 (fusion) | **OUI** — App native iOS + Android (équivalent Uber Eats Orders). Fusion ex-20 KDS + ex-76 app native. PWA tablette abolie.                               |
| 30  | [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md)   | 🟡 Squelette v0.2          | **OUI** — étendu : Apple Pay/Google Pay, Stripe Customer cross-tenant, intégration moteur pricing                                                         |
| 35  | [35_pricing_engine.md](35_pricing_engine.md)                     | 🟡 Squelette v0.1          | **OUI** — moteur règles configurables par tenant (qui paie quoi sur la livraison)                                                                         |
| 40  | [40_livraison_uber_direct.md](40_livraison_uber_direct.md)       | 🟡 Squelette v0.2          | **OUI** — étendu : click & collect modulable, intégration moteur pricing                                                                                  |
| 50  | [50_multi_tenant_saas.md](50_multi_tenant_saas.md)               | 🟡 Squelette v0.3          | **OUI** — RBAC 3 rôles V1, users + user_tenants (N-N), multi-tenant per user (cas Walid), Stripe partagé si même SIRET                                    |
| 60  | [60_integration_marketplaces.md](60_integration_marketplaces.md) | 🟡 Squelette v0.2          | **V2** — ⚠️ Hubrise **reporté V2** ([ADR 0009](../adr/0009-hubrise-reporte-v2.md)) ; V1 = commandes directes uniquement                                   |
| 70  | [70_kb_admin.md](70_kb_admin.md)                                 | 🟡 Squelette v1.0 (fusion) | **OUI** — App web unique `KitchenBoost Admin` avec RBAC. Fusion ex-70 admin + ex-75 dashboard resto. Pipeline + CRM + contrats + édition menu + campagnes |
| 80  | [80_notifications.md](80_notifications.md)                       | 🟡 Squelette v0.2          | **OUI** — ⚠️ push marketing désormais V1, push native APNs/FCM pour KB Orders                                                                             |
| 90  | [90_donnees_clients_crm.md](90_donnees_clients_crm.md)           | 🟡 Squelette v0.2          | **OUI** — étendu : position géo, segmentation, anti-extraction, compte unifié cross-resto, partage KB→resto                                               |

**Note** : Les sous-PRDs sont au statut "Squelette" — structure complète (scope, surface, flows, edge cases, critères de succès, dépendances, open questions, notes/décisions actées) mais le contenu peut être enrichi sur les sections qui en ont besoin au fur et à mesure de l'avancement V1.

## Légende statuts

- ✅ **Complet** : PRD rédigé, peut être utilisé pour démarrer le dev.
- 🟡 **Squelette** : titre + scope + sections définies, contenu à enrichir.
- ⛔ **À écrire** : pas démarré.

## Scope V1 — Vue d'ensemble

V1 = **10 blocs fonctionnels en production sur 3+ restos** (cible : 2026-09-30, ~4 mois dev, soft-launch progressif sur Buns & Bao depuis ~juin). Réduit de 12 à 10 suite à la fusion KDS+App native → KB Orders et Dashboard Resto → KB Admin (RBAC).

Cf. [00_master.md § 7](00_master.md#7-scope-v1--v2--v3-décisions) pour le détail et [roadmap.md](roadmap.md) pour le séquencement.

## Comment contribuer

- Pour modifier la **vision/business model/scope**, modifier `00_master.md` et propager dans les sous-PRDs impactés.
- Pour ajouter une **feature détaillée**, modifier le sous-PRD concerné (ou en créer un nouveau si nouveau sous-domaine).
- Pour modifier la **timeline/séquencement**, modifier `roadmap.md`.
- Toute modification structurante doit également mettre à jour le **changelog** du document concerné (en bas de chaque doc).

## Liens rapides vers le contexte préalable

- [CONTEXT-MAP.md](../../CONTEXT-MAP.md) — carte des 12 bounded contexts + shared types transverses
- [docs/contexts/](../contexts/) — glossaires par contexte
- [docs/adr/](../adr/) — Architecture Decision Records (vide pour l'instant, à enrichir via grilling sessions)
- [CLAUDE.md](../../CLAUDE.md) — contexte business KitchenBoost
- [docs/legal/contrat_template.md](../legal/contrat_template.md) — contrat restaurateur
- [docs/research/uber_direct_deep_dive.md](../research/uber_direct_deep_dive.md) — exploration Uber Direct
- [docs/research/alternatives_uber_direct.md](../research/alternatives_uber_direct.md) — alternatives livraison
- [docs/research/web_push_pwa.md](../research/web_push_pwa.md) — exploration push notifications
- [docs/research/kitchen_notification_solutions.md](../research/kitchen_notification_solutions.md) — exploration notif cuisine
- [docs/plans/onboarding_restaurateur_process.md](../plans/onboarding_restaurateur_process.md) — process onboarding resto par resto
