# Uber Direct Integration Partner — Programme & Conditions (FR, 2026)

**Date** : 2026-05-21
**Statut** : Référence consolidée
**Sources principales** : `merchants.ubereats.com/fr/fr/integration-partners/direct/`, `developer.uber.com/docs/deliveries`, doc SDK officiel `uber/uber-direct-sdk`

---

## TL;DR

**Integration Partner = plateforme SaaS techniquement certifiée par Uber** qui orchestre Uber Direct pour ses clients restos via API, sans que chaque resto signe seul sur direct.uber.com.

**Pour y entrer** : pas de formulaire public, il faut écrire à `direct-fr@uber.com` puis passer une certification technique.

**Bénéfice clé** : scope `direct.organizations` qui permet de créer des sous-comptes resto via API (`POST /organizations` avec `ONBOARDING_INVITE_TYPE_EMAIL`) + 1 seul webhook centralisé.

**Pour KitchenBoost** : tu n'es **pas obligé** d'être Integration Partner pour démarrer. Self-signup `direct.uber.com` suffit pour 1-5 restos. Candidater quand 10+ restos signés + POC API stable.

---

## 1. Les 3 statuts à ne pas confondre

| Statut | Qui ? | Accès API | Multi-tenant ? |
|---|---|---|---|
| **Self-signup merchant** | N'importe quel commerçant via `direct.uber.com` | Sandbox + prod après validation billing | NON — 1 compte = 1 marchand |
| **Direct API user** (auto-intégrateur) | Marchand qui a son propre site et fait >1000 livraisons/mois | Direct API avec Customer ID, Client ID, Client Secret | NON — limité à ses propres marques |
| **Integration Partner** (= "Channel Partner") | Plateforme SaaS B2B (POS, OMS, online ordering) revendant Uber Direct à ses clients restos | Scope `direct.organizations` + `eats.deliveries` ; gestion de sous-comptes hiérarchiques | **OUI** — création programmatique de child orgs via `parent_organization_id` |

**"Channel Partner"** et **"Integration Partner"** = synonymes chez Uber. Le terme "channel partner" apparaît dans la grille pricing FR, "integration partner" sur la page partners.

**Aggregator** = autre chose : consolide les commandes Uber Eats + Deliveroo + DoorDash dans un seul flux entrant (ex : Deliverect côté inbound). Pas le même sujet.

---

## 2. Bénéfices concrets d'être Integration Partner

- **Scope API `direct.organizations`** (confirmé dans SDK officiel) → `POST /organizations` avec `parent_organization_id` + `onboarding_invite_type: ONBOARDING_INVITE_TYPE_EMAIL` pour créer un sous-compte resto à la volée
- **1 seul webhook partagé** pour tous tes sous-comptes (chaque resto a son Customer ID mais le Client ID/Secret reste celui du parent). Source : doc Redbox Integration Partner
- **Pricing négocié** : doc Uber dit "per-delivery pricing varies based on your channel partner" → les IP obtiennent un tarif sous le 5,90 € HT FR (montant exact non publié)
- **Listing officiel** sur `merchants.ubereats.com/fr/fr/integration-partners/direct/` (visibilité + crédibilité)
- **Account manager dédié** côté Uber FR
- **Certification technique** = badge de confiance

**NON confirmé publiquement** : co-marketing, frais d'entrée, abonnement annuel, % sur courses. Aucun de ces termes n'est publié.

---

## 3. Critères d'éligibilité

### Sourcés
- **Certification technique obligatoire** : "All Uber Direct integration partners go through a technical certification process" (page officielle merchants.ubereats.com)
- **Volume implicite** : la doc dit que l'intégration API directe est pour les marchands faisant **>1000 livraisons/mois**. Pour le statut IP, pas de seuil officiel publié

### Inférés (non confirmés publiquement)
- Pas de coût d'entrée publié
- Pas de minimum de restos signés publié, mais demander la certif avec <5 restos prêts à lancer = refus probable
- Statut juridique : SAS FR OK (LivePepper, Zelty, Sunday, Obypay sont tous SAS FR Integration Partners)
- Contrat : signé avec Uber B.V. (Pays-Bas) pour l'Europe

---

## 4. Process de candidature — Step by Step

**Pas de formulaire de candidature web public.** Vérifié sur 3 portails (US, UK, FR). C'est un process commercial-only.

1. **Étape 1 — Email à Uber FR** : `direct-fr@uber.com` avec :
   - Pitch deck KitchenBoost
   - KBIS NativeSquare SAS
   - Liste restos signés / pipeline
   - Démo technique (collection Postman avec appels API Direct)
   - Volume cible 12 mois

2. **Étape 2 — Call commercial** avec Partnerships Manager FR Uber Direct
   - Cycle typique : 2-4 semaines pour décrocher le call

3. **Étape 3 — Call technique** : revue de ton intégration
   - Gestion webhooks
   - Retry logic
   - Gestion cancellation
   - Refunds

4. **Étape 4 — Certification** : Uber file un sandbox dédié + checklist scénarios
   - Delivery happy path
   - Delivery cancel
   - Delivery failed
   - Cycle 4-8 semaines selon retours

5. **Étape 5 — Signature contrat IP** (Uber B.V. Pays-Bas) + activation scope `direct.organizations` sur app prod

6. **Étape 6 — Listing public** sur la page Integration Partners

**Durée totale estimée : 3-6 mois** (déduit des cycles SaaS B2B Uber, non sourcé officiellement).

---

## 5. Self-serve onboarding — Flow technique (post-certification IP)

Une fois IP avec le scope `direct.organizations`, le flow technique sourcé dans le SDK officiel :

```javascript
// Appel API pour créer un sous-compte resto
POST /organizations
{
  info: {
    name: "Pizza Mario",
    billing_type: "BILLING_TYPE_CENTRALIZED"
  },
  hierarchy_info: {
    parent_organization_id: "<ton-org-id-KB>"
  },
  options: {
    onboarding_invite_type: "ONBOARDING_INVITE_TYPE_EMAIL"
  }
}
```

**Ce qui se passe ensuite** (inféré du SDK + comportements connus Uber) :
1. Uber crée une child org rattachée à KitchenBoost
2. Uber envoie un email au resto (adresse fournie dans le payload) avec un lien de validation
3. Le resto accepte les CGU Uber Direct + ajoute RIB/CB pour facturation
4. La child org passe en statut ACTIF
5. Tes appels `POST /deliveries` avec ce Customer ID sont billés au resto (ou à KB selon `billing_type`)

**Disponibilité en France 2026** : la doc dit "Create Account process is currently available only in select regions" — la **France EST listée** comme région supportée (page FR existe, email `direct-fr@uber.com` actif, LivePepper et Zelty l'utilisent). **Confirmé opérationnel.**

**Onboarding "manuel" alternatif** (pas self-serve) : KB envoie KBIS + RIB + identité du resto par email à l'AM Uber, qui crée le sous-compte manuellement. C'est ce que font les IP en début de partenariat avant que le scope `direct.organizations` soit accordé.

---

## 6. Integration Partners Uber Direct en France/Europe 2026

**Confirmés sur la page FR** (`merchants.ubereats.com/fr/fr/integration-partners/direct/`) :

### Français
- **LivePepper** — online ordering + Uber Direct intégré
- **Zelty** — POS, en cours de déploiement Uber Direct (testing public)
- **Sunday** — paiement à table + delivery
- **Obypay** — paiement
- **Sauce** — restaurant ops

### Européens / Globaux présents en France
- **Deliverect** (Belgique) — partenariat global Uber Direct annoncé sept 2023
- **Flipdish** (Irlande) — online ordering + POS
- **Slerp** (UK) — partenariat UK hospitality annoncé oct 2023
- **Lightspeed**, **Square**, **Toast**, **Olo** — POS globaux

### Pas vu sur la page IP mais utilisateurs Uber Direct via autre mode
- **Innovorder** (à confirmer)

---

## 7. Recommandation pour KitchenBoost

### Phase 1 actuelle (1-5 restos signés, région parisienne)

**NE PAS candidater Integration Partner.**

Utilise le **self-signup `direct.uber.com`** au nom de chaque resto :
- Le resto s'inscrit lui-même (KB l'accompagne)
- Tu récupères ses identifiants API pour orchestrer les `POST /deliveries`
- **Zéro friction, zéro certif**

### Phase 2 (10-20 restos, ~mois 4-6)

**Démarrer le process IP en parallèle de la croissance.**
- Email à `direct-fr@uber.com` avec pitch + KBIS NativeSquare + liste des 10 restos signés
- Certif obtenue probablement quand tu atteins 20-30 restos
- Matche bien le moment où le multi-tenant devient ingérable en manuel

### Pourquoi pas tout de suite ?

1. **Uber FR ne te répondra pas avec 2 restos** — pas assez de pipeline pour justifier leur effort de certif
2. **Maintenir une certif demande du dev backend stable** que tu n'as pas encore intérêt à figer
3. **Tu apprends plus en faisant tourner du self-signup** pour comprendre les vrais points de friction resto

### Trigger pour candidater

- Quand tu signes ton **8e resto**
- OU quand un resto signé **refuse de te donner ses clés API** parce que c'est trop intrusif → là, IP devient critique

---

## 8. Décision arch KB validée 2026-05-21

**Pour la deadline 2 semaines actuelle** (V1 SaaS live d'ici 2026-06-04) :

- ✅ Self-signup `direct.uber.com` au nom de **Khan** (NativeSquare gère la création avec lui)
- ✅ KB orchestre les `POST /deliveries` via les credentials du compte de Khan
- ✅ Webhook handler côté KB qui reçoit les events du compte Khan (pas multi-tenant pour l'instant)
- ✅ Stripe Connect Express pour le paiement client → resto direct
- ⏳ Email parallèle à `direct-fr@uber.com` pour démarrer la conversation IP (long terme)

**Pas de blocker** : on peut sortir le pilote Buns & Bao en 2 semaines sans certif IP.

---

## 9. Sources (vérifiées vivantes mai 2026)

- [Uber Direct Integration Partners (FR)](https://merchants.ubereats.com/fr/fr/integration-partners/direct/)
- [Uber Direct Integration Partners (US)](https://merchants.ubereats.com/us/en/integration-partners/direct/)
- [Uber Direct service page FR](https://merchants.ubereats.com/fr/fr/services/uber-direct/)
- [Uber Direct signup FR direct](https://merchants.ubereats.com/fr/fr/s/signup/direct/)
- [Uber Direct API overview](https://developer.uber.com/docs/deliveries/overview)
- [Uber Direct Get Started](https://developer.uber.com/docs/deliveries/get-started)
- [Uber Direct API reference org](https://developer.uber.com/docs/deliveries/api-reference/org)
- [Uber Direct signup FAQ FR (direct-fr@uber.com)](https://help.uber.com/en/merchants-and-restaurants/article/signup-for-uber-direct?nodeId=87889d57-b941-4307-bd00-29a7b970b447)
- [Uber Direct SDK officiel (GitHub)](https://github.com/uber/uber-direct-sdk)
- [Uber Direct SDK npm](https://www.npmjs.com/package/uber-direct)
- [Accord tarification Uber Direct FR (5,90 € HT)](https://www.uber.com/legal/ku/document/?country=france&lang=fr&name=uber-direct-standard-pricing-contract)
- [Conditions Uber Direct API FR](https://www.uber.com/legal/en/document/?name=uber-direct-api-terms-and-conditions&country=france&lang=fr)
- [Redbox Uber Direct setup (sub-accounts doc)](https://support.redbox.systems/docs/uber-direct-set-up)
- [Deliverect x Uber Direct partnership](https://www.deliverect.com/en/press/deliverect-partners-with-uber-direct)
- [Slerp x Uber Direct partnership UK](https://retailtechinnovationhub.com/home/2023/10/26/slerp-teams-with-uber-direct-to-power-on-demand-delivery-service-for-uk-hospitality-sector)
- [LivePepper Uber Direct intégration FR](https://www.livepepper.com/uber-direct/)
- [Flipdish Uber Direct overview](https://help.flipdish.com/en/articles/9585467-flipdish-uber-direct-integration-overview)
- [Postman collection Uber Direct API](https://www.postman.com/uber/uber-direct/documentation/avopunf/uber-direct-api)

**Note honnête sur les zones d'ombre** : Uber ne publie aucun chiffre sur (a) rabais négocié IP vs 5,90 € HT FR, (b) durée moyenne de certif, (c) minimums de volume IP, (d) coûts éventuels. Toutes ces infos passent par le call commercial avec `direct-fr@uber.com`.
