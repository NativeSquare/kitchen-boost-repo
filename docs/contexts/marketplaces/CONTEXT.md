# Marketplaces

Le contexte de l'agrégation des commandes externes (Uber Eats + Deliveroo) dans [[KB Orders]] KB, via **Hubrise**. Permet au resto d'avoir 1 seul écran cuisine au lieu de 3.

**Statut V1 : hors scope.** Décision actée 2026-05-24 (cf. [ADR 0009](../../adr/0009-hubrise-reporte-v2.md)) — Hubrise reporté V2. V1 = 3 interfaces cuisine assumées (KB Orders direct + tablette Uber Eats Orders + tablette Deliveroo). Le glossaire ci-dessous reste comme placeholder pour le grilling V2.

PRD : [60_integration_marketplaces.md](../../prd/60_integration_marketplaces.md) (V2)

## Language

**Marketplace** :
Plateforme tierce de commande visible par le client final, avec sa propre marketplace, sa commission (~30 %), son packaging. V1 KB cible : Uber Eats + Deliveroo.
_Avoid_: Aggregator (peut être confondu avec Hubrise), Platform externe

**Hubrise** :
SaaS d'orchestration multi-marketplace FR. Hub central qui reçoit les cmds des marketplaces et les pousse vers les POS / apps cuisine ([[KB Orders]] chez nous). Tarif public 30 €/mois/location + 25 € setup. Q13 master = négo commerciale en cours.
_Avoid_: Middleware (générique), Connector

**Location Hubrise** :
Une "location" Hubrise = un point de vente physique = 1 tenant côté KB. La liaison se fait via OAuth Hubrise (1 fois) puis configuration par tenant. 1 contrat Hubrise par resto (ou KB master, à voir négo Q60-Q1).
_Avoid_: Tenant Hubrise (ambigu avec [[Tenant]] KB), Store

**Source** :
Tag qui indique d'où vient une cmd : `direct` (PWA KB), `uber_eats`, `deliveroo`. Visible sur les cards [[KB Orders]]. Affichage différencié (icône colorée).
_Avoid_: Channel, Origin

**External order** :
Cmd qui arrive via Hubrise depuis une marketplace, **opposée** à une cmd direct. Workflow [[KB Orders]] identique, source taggée. KB ne refund PAS les external orders (Uber/Deliveroo le font côté client).
_Avoid_: Marketplace order (acceptable), Foreign order

**Menu mapping** (Mapping menu) :
Correspondance entre les items du menu KB (édité via [[KB Admin]]) et les items du menu Uber Eats / Deliveroo, via SKU ou nom. V1 = lecture seule (le menu marketplace reste géré chez Uber/Deliveroo). V3 = sync auto KB → marketplace.
_Avoid_: Sync, Catalog mapping

**Bi-directionnel** (V3) :
Capacité de pousser un changement de statut depuis [[KB Orders]] vers Hubrise (et donc vers Uber/Deliveroo). En V1/V2, c'est lecture seule (Hubrise → KB only).
_Avoid_: Two-way sync

**Deliverect** :
Concurrent Hubrise (100-150 €/mois). Q60-Q3 = évalué comme alternative si négo Hubrise bloque.
_Avoid_: Alternative aggregator (générique)

## Example dialogue

**Alex** : Khan reçoit une cmd Uber Eats. Comment elle arrive sur [[KB Orders]] ?

**Dev** : Uber Eats → Hubrise (Khan a connecté sa location Uber Eats à Hubrise via OAuth) → webhook Hubrise → backend KB → push APNs/FCM vers KB Orders. La card apparaît avec icône "Uber Eats" orange. Workflow identique : Accepter → Prête → Remise.

**Alex** : Et le menu ? Khan a édité son menu KB, est-ce qu'Uber Eats voit la modif ?

**Dev** : Non en V1/V2. Le menu Uber Eats reste géré dans Uber Eats Manager. On a juste un **mapping** entre items KB et items Uber Eats pour matcher les cmds entrantes. V3 on pourra pousser KB → marketplace via Hubrise.

**Alex** : Si Khan veut refuser la cmd Uber Eats ?

**Dev** : V2. Pour l'instant, V1, c'est lecture seule. Khan doit refuser via Uber Eats Manager directement (ou via tablette Uber Eats Orders en parallèle). On ne renvoie pas l'état vers Hubrise.

**Alex** : Et si Hubrise est down ?

**Dev** : Cmds Uber Eats arrêtent d'apparaître dans [[KB Orders]]. Khan doit retomber sur la tablette Uber Eats Orders. On le notifie via Slack ops. C'est une dépendance externe critique en V1, qu'on accepte parce que la valeur "1 seul écran" est énorme.
