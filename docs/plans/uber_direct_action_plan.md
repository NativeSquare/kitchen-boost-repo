# Uber Direct — Plan d'action 2 semaines KitchenBoost

**Statut** : v2 (deadline serrée) — 2026-05-21
**Deadline** : SaaS V1 live d'ici **2026-06-04** (J+14)
**Pilote choisi** : Buns & Bao (Khan's Street Kebab, 51 rue Danton, 92300 Levallois-Perret)

## Contacts Uber Direct France

- **Email partenaire FR** : `direct-fr@uber.com` ← contact principal pour toute question + demande Integration Partner
- **Portail merchant** : [merchants.ubereats.com/fr/fr/services/uber-direct/](https://merchants.ubereats.com/fr/fr/services/uber-direct/) (landing page FR, signup, contact général)
- **Portail développeur** : [direct.uber.com](https://direct.uber.com) (signup compte dev, génération credentials)
- **Doc API** : [developer.uber.com/docs/deliveries/overview](https://developer.uber.com/docs/deliveries/overview)
- **Formulaire contact général** : [merchants.ubereats.com/fr/fr/contact-us/](https://merchants.ubereats.com/fr/fr/contact-us/)

---

## 0. Inventaire des docs existants (cross-refs)

Avant de plonger dans le plan, voici ce qui est déjà écrit et qu'il **NE FAUT PAS** réécrire :

| Doc | Statut | À utiliser pour |
|---|---|---|
| [docs/specs/mvp_pwa_review_push.md](../specs/mvp_pwa_review_push.md) | Spec figée | Comprendre le V0 PWA (review gating + push) — passerelle KB |
| [docs/specs/kitchenboost_saas_full_spec.md](../specs/kitchenboost_saas_full_spec.md) | Spec figée | Architecture multi-tenant, schéma DB, endpoints, roadmap V1-V4 |
| [docs/research/uber_direct_deep_dive.md](../research/uber_direct_deep_dive.md) | Référence | API tech, flow $ Stripe Connect, patterns multi-tenant, 8 open questions Uber |
| [docs/research/alternatives_uber_direct.md](../research/alternatives_uber_direct.md) | Référence | Plan B fallback (Stuart, Deliveroo Signature, Bringg) |
| [docs/research/web_push_pwa.md](../research/web_push_pwa.md) | Référence | Faisabilité push iOS+Android, stack `web-push` npm |
| [docs/legal/contrat_template.md](../legal/contrat_template.md) | Production | Contrat resto (Article 3 bis Uber Direct OK) |

**Règle d'or pour ce plan** : si l'info est dans un de ces docs, on **link**, on ne duplique pas.

---

## 1. Self-serve onboarding — qu'est-ce que c'est ?

**Concept clé pour comprendre tout le reste du plan.** Self-serve onboarding = automatisation de la création de compte Uber Direct pour chaque resto qu'on signe.

**❌ SANS self-serve (= onboarding manuel)** :
1. KB envoie email à l'AM Uber avec KBIS + RIB + identité du resto
2. AM crée le compte côté Uber (1-5 jours ouvrés)
3. Uber envoie email au resto → resto signe CGU + ajoute RIB
4. Activation → KB peut créer des deliveries pour ce resto
→ **5-10 jours par resto**, dépendance à l'AM.

**✅ AVEC self-serve onboarding** :
1. KB fait 1 appel API : `POST /organizations { email: khan@bunsbao.fr, ... }`
2. Uber envoie auto un email au resto : "Votre partenaire KB a créé un compte Uber Direct pour vous, cliquez pour valider"
3. Resto clique → valide CGU + RIB sur portail Uber → activation auto
4. KB peut créer des deliveries dans la minute
→ **<1 jour par resto**, scalable à 100+ restos sans toucher à un email Uber.

**Pourquoi critique pour KB** : la différence entre "petit prestataire 5 restos" et "vraie plateforme tech scalable". À valider en call AM Uber : est-ce que ce mode est disponible en France via le scope `direct.organizations` + paramètre `ONBOARDING_INVITE_TYPE_EMAIL` ?

---

## 2. Vue d'ensemble — 4 phases sur 14 jours

```
WEEK 1                                          WEEK 2
═══════════════════════════════════════════════════════════════════════════════
PHASE A (J0-J3)        PHASE B (J3-J7)         PHASE C (J7-J11)        PHASE D (J11-J14)
─────────────────────  ──────────────────────  ──────────────────────  ──────────────────────
Contact Uber + call    POC technique           Setup prod Khan         Soft launch
AM FR + decisions      e2e en sandbox          + PWA Buns & Bao        friends & family
                                                                       
- Email direct-fr      - Self-signup           - Onboarding Uber       - 5-10 cmd test
- Booker call urgent   - POC API Uber          - Onboarding Stripe     - Mesure metrics
- Setup compte dev     - POC Stripe Connect    - PWA buns-bao live     - Itérations critique
- 8 questions          - POC Web Push          - QR sticker livré       - Go/No-Go J+14
- Decisions arch       - Gate validation       - Test e2e prod          
```

**Hypothèses critiques de cette deadline** :
- ✅ Khan accepte de tester (déjà engagé, signé 03/05)
- ✅ AM Uber répond en 2 jours max (sinon J0 dérape)
- ✅ Stripe Connect Khan : KYC OK en 24-48h (KBIS + RIB déjà collectés)
- ⚠️ Si Integration Partner refusé → fallback "1 compte par resto" en self-signup → ajoute 2-3 jours
- ⚠️ Si self-serve onboarding pas dispo FR → onboarding manuel Khan (acceptable pour 1 pilote, bloquant pour scale)

---

## 3. PHASE A — Contact Uber + call AM + décisions (J0 → J3)

### Objectif

Établir le contact Uber, booker un call AM, obtenir les 8 réponses qui débloquent l'architecture. Pas y aller à froid.

### Tâches

| # | Tâche | Owner | Quand | Statut |
|---|---|---|---|---|
| A.1 | **Envoyer email à `direct-fr@uber.com`** demandant call AM Integration Partner program | Alex | J0 (matin) | ⬜ |
| A.2 | Self-signup parallèle sur `direct.uber.com` (NativeSquare SAS) — ne pas attendre Uber | Alex + Dev | J0 (après-midi) | ⬜ |
| A.3 | Préparer dossier NativeSquare SAS (KBIS, pitch 2min, 3 scénarios volume 10/50/200 restos M12) | Alex | J0-J1 | ⬜ |
| A.4 | Imprimer les 8 questions critiques + 3 arbres décisionnels (cf §4 ci-dessous) | Alex | J1 | ⬜ |
| A.5 | Si pas de réponse Uber sous 24h → relance email + appel formulaire `merchants.ubereats.com/fr/fr/contact-us/` | Alex | J1 | ⬜ |
| A.6 | **Call AM Uber** (idéalement J2-J3) | Alex | J2-J3 | ⬜ |
| A.7 | Mémo post-call dans `docs/notes/call_uber_am_2026-05-XX.md` (1 page) | Alex | Immédiat post-call | ⬜ |

### Email-type à envoyer J0 à `direct-fr@uber.com`

```
Objet : Demande de call — Integration Partner Uber Direct France

Bonjour,

Je suis Alexandre Pelloux, fondateur de NativeSquare SAS (SIRET 995 089 851 00019),
une société de développement logiciel basée à Paris. Nous exploitons KitchenBoost,
un SaaS multi-tenant pour restaurants qui propose un site/PWA de commande directe
avec livraison Uber Direct.

Nous avons aujourd'hui 4 restaurants signés en région parisienne et projetons
20 restaurants actifs d'ici 12 mois. Nous souhaitons rejoindre votre programme
Integration Partner Uber Direct France pour pouvoir scaler proprement, avec :
- Accès au scope direct.organizations (architecture parent + sub-accounts)
- Self-serve onboarding par email pour chaque resto client
- Webhook unique centralisé
- Pricing négocié en fonction du volume

Pouvez-vous me caler un call de 30 min avec un Account Manager cette semaine
ou la semaine prochaine ?

Cordialement,
Alexandre Pelloux
office@nativesquare.fr
+33 6 XX XX XX XX
```

### Gate de validation Phase A → Phase B

✅ Call effectué + 8 questions répondues + 3 arbres décisionnels tranchés + mémo post-call 1 page.

---

## 4. Les 9 questions à poser au call AM Uber (formulation prête)

**Cf. [docs/research/uber_direct_deep_dive.md §5.2](../research/uber_direct_deep_dive.md) pour le contexte de chacune.**

### Question 0 — Pricing réel des livraisons (critique pour notre modèle économique)

"Le prix affiché publiquement est 'à partir de 5,90 € HT par livraison'. Pouvez-vous nous donner **la grille exacte** ?
- Tarif minimum par course en zone urbaine dense (Paris IDF) ?
- Coefficient distance (€ par km au-delà du minimum) ?
- Coefficient surge en heures pointe (soir 19h-22h, week-end) ?
- Tarif moyen constaté sur les restos comparables (panier moyen 25€, distance moyenne 3-5 km) ?
- Surcoût scheduled vs instant delivery ?
- Tarif différent pour Levallois / Vanves / Malakoff / 14e Paris ?

C'est critique pour notre modèle économique : nous facturons 2€/commande au resto, et il faut savoir s'il reste positif vs Uber Eats marketplace selon le panier moyen."



1. **Programme Integration Partner FR** : "Quels sont les critères d'éligibilité pour qu'une SAS française (NativeSquare SAS, 3 ans, CA 200K€/an, expertise tech) rejoigne votre programme Integration Partner Uber Direct France ? Certification technique requise ? Délai d'activation ?"

2. **Self-serve onboarding `ONBOARDING_INVITE_TYPE_EMAIL`** : "Le scope `direct.organizations` + le flux self-serve onboarding par email (création de sub-account → email au resto → resto valide CGU + RIB → activation) est-il disponible et stable en France en 2026 ? Ou seulement US/UK ?"

3. **Rate limits exacts par endpoint Uber Direct France** : "Quels sont les rate limits actuels (`/delivery_quotes`, `/deliveries`, `/courier_update`...) pour un Integration Partner avec sub-accounts ? Burst protection ?"

4. **Pricing négocié au volume** : "À partir de quel seuil de courses/mois (500, 1K, 5K) Uber Direct France propose-t-il une grille tarifaire dégressive sur le tarif de base 5,90€ HT ? Pouvez-vous nous communiquer la grille théorique ?"

5. **Scope `direct.organizations` FR sans contrat US** : "Le pattern Parent Org + N sub-accounts (Organizations API) est-il ouvert à un partenaire français signataire FR uniquement, ou faut-il un contrat parent US ?"

6. **Webhook unique multi-resto** : "Pouvons-nous enregistrer **un seul webhook URL** (`api.kitchenboost.fr/webhooks/uber`) au niveau du compte parent, qui recevra les events de tous les sub-accounts enfants ? Ou un webhook par sub-account ?"

7. **Signataire facture FR vs NL BV** : "Pour un partenariat agrégateur France, la facture Uber Direct est-elle émise par **Uber Eats France SAS** (TVA 20% applicable) ou par **Uber Portier B.V.** Pays-Bas (reverse charge intra-UE) ? Et la facture est-elle adressée au sub-account (resto) ou au parent (KB) ?"

8. **Alcool override `requires_id`** : "Pour les restos qui vendent du vin avec leurs plats, le flag `requires_id=true` + accord local est-il automatique, ou demande-t-il une certif spécifique par sub-account ?"

### Bonus questions (si temps + bonne ambiance)

- Roadmap Uber Direct France 12 mois (nouvelles features, expansion couverture)
- Possibilité d'un account manager dédié KB une fois >20 restos actifs
- Co-marketing / case study Uber publié si KB scale

### Décisions à prendre en sortie de call

Selon les réponses, voici les arbres décisionnels :

#### Arbre 1 — Modèle de compte

```
Q5 (Organizations API en FR) : OUI ?
  ├─ OUI → Modèle parent + sub-accounts (architecture cible)
  │        Q2 (self-serve email) : OUI ?
  │          ├─ OUI → Onboarding 100% API, scalable
  │          └─ NON → Onboarding manuel par sub-account (KBIS, RIB envoyés à Uber par KB)
  │
  └─ NON → Modèle 1 compte Uber Direct par resto (chaque resto signe direct)
           KB orchestre via API avec credentials du resto
           Pas de webhook centralisé → 1 webhook par resto
```

#### Arbre 2 — Billing

```
Q7 (signataire facture) : SAS FR ?
  ├─ SAS FR → TVA 20% sur facture Uber → resto déduit
  │           Mode BILLING_TYPE_DECENTRALIZED simple
  │
  └─ NL BV  → Reverse charge intra-UE → KB doit gérer si centralisé
              Privilégier DECENTRALIZED (resto FR direct avec NL BV, sans KB intermédiaire TVA)
```

#### Arbre 3 — Webhook architecture

```
Q6 (webhook unique multi-resto) : OUI ?
  ├─ OUI → 1 endpoint api.kitchenboost.fr/webhooks/uber, dispatch par customer_id
  └─ NON → N webhooks (overhead config) OU polling fallback
```

## 5. PHASE B — POC technique e2e en sandbox (J3 → J7)

### Objectif

Prouver techniquement que la stack fonctionne en sandbox avant de toucher au resto réel.

**Stack** : Next.js 15 App Router + TypeScript + Supabase + Stripe Connect Express + `web-push` npm (cf [kitchenboost_saas_full_spec.md](../specs/kitchenboost_saas_full_spec.md)).

### B.1 Compte développeur Uber Direct

| # | Tâche | Owner | Statut |
|---|---|---|---|
| B.1.1 | Récupérer `customer_id`, `client_id`, `client_secret` dans `direct.uber.com` → Developer → Management | Alex | ⬜ |
| B.1.2 | Stocker credentials dans Vercel env vars (`UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, etc.) | Dev | ⬜ |
| B.1.3 | Si Org API dispo → créer 1 sub-account test "Buns & Bao Sandbox" via `POST /organizations` | Dev | ⬜ |

### B.2 POC API Uber Direct (sandbox)

| # | Tâche | Owner | Statut |
|---|---|---|---|
| B.2.1 | Endpoint `POST /api/uber/quote` → wrapper `/delivery_quotes` | Dev | ⬜ |
| B.2.2 | Endpoint `POST /api/uber/delivery` → wrapper `/deliveries` (avec `quote_id`) | Dev | ⬜ |
| B.2.3 | Webhook handler `POST /api/webhooks/uber` avec validation HMAC-SHA256 + dispatch par `customer_id` | Dev | ⬜ |
| B.2.4 | Table Supabase `uber_deliveries` (id, customer_id, status, tracking_url, payload JSON, created_at) | Dev | ⬜ |
| B.2.5 | UI test `/dashboard/deliveries` : liste deliveries + status temps réel | Dev | ⬜ |
| B.2.6 | E2E test : quote → delivery → wait webhook `delivered` (sandbox) | Dev | ⬜ |

### B.3 POC Stripe Connect

| # | Tâche | Owner | Statut |
|---|---|---|---|
| B.3.1 | Créer compte Stripe Connect Express test au nom de KB | Alex | ⬜ |
| B.3.2 | Onboarder 1 compte Connect Express resto test (mode test) | Dev | ⬜ |
| B.3.3 | Endpoint `POST /api/checkout` qui crée PaymentIntent destination_charge + `application_fee_amount = 200` (2€ flat KB) + `on_behalf_of = acct_resto` (resto = settlement merchant, paie les frais Stripe directement) | Dev | ⬜ |
| B.3.4 | E2E test : checkout test card 4242 → split OK (resto reçoit net, KB encaisse 2€) | Dev | ⬜ |

### B.4 POC Web Push

**Code minimal cf [docs/research/web_push_pwa.md §3](../research/web_push_pwa.md).**

| # | Tâche | Owner | Statut |
|---|---|---|---|
| B.4.1 | Générer VAPID keys, stocker dans Vercel env | Dev | ⬜ |
| B.4.2 | Service Worker `sw.js` (push + notificationclick) | Dev | ⬜ |
| B.4.3 | Endpoint `POST /api/push/subscribe` stocke subscription en DB | Dev | ⬜ |
| B.4.4 | Endpoint `POST /api/push/send` envoie via `web-push` npm | Dev | ⬜ |
| B.4.5 | Test : opt-in Chrome Android + iOS Safari (après A2HS) → recevoir push | Dev | ⬜ |

### Gate Phase B → Phase C

✅ 4 POC fonctionnent en sandbox bout-en-bout :
- Uber : quote → delivery → webhook reçu
- Stripe : checkout → destination charge → split correct
- Push : envoyée + reçue sur Android et iOS
- Tout tracé en Supabase

---

## 6. PHASE C — Setup prod Khan + PWA Buns & Bao (J7 → J11)

### Objectif

Passer du sandbox au mode production réel avec Khan comme tenant pilote. PWA Buns & Bao live mais pas encore promue.

### C.1 Uber Direct production pour Khan

| # | Tâche | Owner | Statut |
|---|---|---|---|
| C.1.1 | Si Org API : `POST /organizations` pour créer sub-account "Khan's Street Kebab — Buns & Bao" en prod | Dev | ⬜ |
| C.1.2 | Si self-serve email actif : Khan reçoit email Uber → valide CGU + RIB | Alex + Khan | ⬜ |
| C.1.3 | Sinon onboarding manuel : KB envoie KBIS + RIB + identité Khan à `direct-fr@uber.com` | Alex | ⬜ |
| C.1.4 | Activation prod confirmée (email Uber AM) | Alex | ⬜ |
| C.1.5 | Smoke test : quote prod → delivery réelle pickup chez Khan → livreur arrive → annule | Alex + Dev | ⬜ |

### C.2 Stripe Connect Express prod pour Khan

| # | Tâche | Owner | Statut |
|---|---|---|---|
| C.2.1 | Khan complète onboarding Stripe Connect Express (RIB pro, KBIS, identité) | Khan | ⬜ |
| C.2.2 | Validation Stripe `charges_enabled` + `payouts_enabled = true` | Khan | ⬜ |
| C.2.3 | Lier compte Connect au tenant Khan dans Supabase (`stripe_account_id`) | Dev | ⬜ |

### C.3 PWA Buns & Bao production

| # | Tâche | Owner | Statut |
|---|---|---|---|
| C.3.1 | Configurer custom domain `buns-bao.kitchen-boost.fr` sur Vercel | Dev | ⬜ |
| C.3.2 | Charger menu depuis `clients/street-kebab/suivi/menu.json` existant | Dev | ⬜ |
| C.3.3 | Appliquer DA V2 Pop Pink Hard Flash (hero, palette, fonts) | Dev | ⬜ |
| C.3.4 | E2E test prod : checkout (carte réelle) → Stripe Connect prod → Uber Direct prod → push reçue | Alex + Dev | ⬜ |

### C.4 QR sticker Buns & Bao

| # | Tâche | Owner | Statut |
|---|---|---|---|
| C.4.1 | Designer sticker QR (vinyle laminé mat, 50mm rond, URL `buns-bao.kitchen-boost.fr/r/`) | Alex | ⬜ |
| C.4.2 | Commander 500 stickers (Stickermule ou Vistaprint, ~30-50€) | Alex | ⬜ |
| C.4.3 | Briefer Khan + livrer stickers (à coller sur chaque sac livraison Uber Eats) | Alex | ⬜ |

### Gate Phase C → Phase D

✅ PWA Buns & Bao accessible publiquement + Uber Direct prod activé + Stripe Connect prod actif + au moins 1 commande test réelle réussie e2e avec carte réelle.

---

## 7. PHASE D — Soft launch friends & family + Go/No-Go (J11 → J14)

### Objectif

Premier vrai test grandeur nature sur 5-10 commandes friends & family avant de promouvoir publiquement.

### D.1 Commandes test friends & family

| # | Tâche | Owner | Statut |
|---|---|---|---|
| D.1.1 | Recruter 5-10 testeurs (équipe NS + amis + famille à Levallois/Neuilly/Paris 17e) | Alex | ⬜ |
| D.1.2 | Chaque testeur passe 1 commande réelle sur la PWA (payée par carte) | Testeurs | ⬜ |
| D.1.3 | Vérifier pour chaque commande : checkout OK, livraison < 45 min, push reçue, Khan reçu net correct | Alex | ⬜ |
| D.1.4 | Logger les bugs / friction UX dans un fichier `docs/feedback/buns_bao_soft_launch.md` | Alex | ⬜ |
| D.1.5 | Itérer 2-3 fois (fix bugs critiques uniquement, pas de nouvelle feature) | Dev | ⬜ |

### D.2 Mesures sur les 14 premiers jours (Go/No-Go J+14)

| Critère | Seuil minimum | Mesure |
|---|---|---|
| Commandes test réussies bout en bout | ≥ 8/10 | Compteur DB Supabase |
| Aucun incident bloquant non corrigé | 0 | Liste bugs |
| Taux livraison Uber Direct OK | ≥ 90% | Webhooks `delivered / total` |
| Push reçues (testeurs Android + iOS A2HS) | ≥ 80% | Subscribers / sends |
| Khan satisfait du flow | Score ≥ 7/10 | Call Khan vendredi J+14 |

### D.3 Décision Go/No-Go J+14

- **GO** → on bascule en lancement public (QR stickers en sac sur toutes les commandes Uber Eats Buns & Bao) + on commence Phase E (multi-resto)
- **No-Go partiel** → on prolonge soft launch 1 semaine, on fix les blocants
- **No-Go total** → post-mortem, on identifie pivot (Stuart fallback ? abandonner ordering direct ?)

---

## 8. PHASE E — Multi-resto post J+14 (si Go)

### Objectif

Si soft launch validé J+14, dérouler sur les autres restos KB existants + nouveaux signés. Process accéléré grâce au pattern Buns & Bao éprouvé.

### Ordre de déploiement proposé

1. **Buns & Bao live publiquement** (J+15 → J+30) — QR stickers sur toutes les commandes Uber Eats, métriques 30j (cf winner criteria `feedback_winner_criteria.md`)
2. **Caverne à Pizza** (J+30 → J+45) — Client 1, déjà rodé Uber Eats. Risque : moral V1 CRUNCH KINGS flop, à valider avec patron
3. **Crêperie Sucrée Salée** (J+45 → J+60) — Client 2, à débloquer KBIS Uber Eats d'abord
4. **Walid / Amir / Yanis** — au fil des signatures, intégrer Uber Direct dès l'onboarding

### Tâches par nouveau resto (~3-5 jours par resto une fois pattern rodé)

1. Onboarding Stripe Connect Express resto
2. Onboarding Uber Direct (self-signup au nom du resto, KB accompagne)
3. Configuration PWA tenant (custom domain + menu)
4. QR sticker production + livraison
5. Soft launch 3 jours friends & family
6. Live + suivi métriques 7 premiers jours

### Quand candidater Integration Partner Uber

**Cf [docs/research/uber_integration_partner.md §7](../research/uber_integration_partner.md) pour le détail.**

- Trigger : **8 restos signés** OU un resto refuse de filer ses clés API
- Process : email `direct-fr@uber.com` avec pitch + KBIS + liste restos → call commercial → call technique → certification → contrat IP → activation scope `direct.organizations`
- Durée : **3-6 mois** (faire en parallèle de la croissance, pas en blocant)

### Quand activer le fallback Stuart

Cf [docs/research/alternatives_uber_direct.md §4](../research/alternatives_uber_direct.md) :
- 10+ restos live OU
- Uber annonce une hausse tarif unilatérale OU
- Un resto dans une zone Uber Direct non couverte mais Stuart oui

---

## 9. Risques + Plan B

### Risques identifiés

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Uber FR ne répond pas en 48h au mail `direct-fr@uber.com` | Moyenne | Bloque le call AM | Relance J+2, appel formulaire `merchants.ubereats.com/fr/fr/contact-us/`, ou démarrer Phase B en self-signup direct.uber.com en parallèle |
| Self-signup direct.uber.com refusé (KYC) | Faible | Bloquant pour pilote | Onboarding manuel via direct-fr@uber.com avec KBIS Khan |
| Khan refuse pilote (cold feet, peur cannibalisation Uber Eats) | Faible | Important | Briefing préalable : 0 impact négatif Uber Eats, on garde sa marketplace en parallèle |
| Stripe Connect refus compte Khan | Faible | Bloquant pour Khan | Plan B : Mangopay ou Lemonway, refactor sur 1 semaine |
| Pricing 5,90€ HT livraison trop cher pour client final | Élevée | UX impactée | Stratégie : facturer 5€ TTC livraison, resto absorbe 2€ sur sa marge (cf math conversation 21/05) |
| Tablette Uber refusée par Khan | Faible | Non bloquant | Article 3 bis contrat OK, tablette = entre resto et Uber, pas notre problème |
| Apple casse Web Push iOS | Très faible | Important | `event.waitUntil(showNotification())` systématique cf [web_push_pwa.md §6](../research/web_push_pwa.md) |
| Deadline J+14 trop serrée (POC + setup prod + soft launch) | Élevée | Glissement timeline | Prioriser le go-live sur le polish UI, accepter une PWA brute mais fonctionnelle au J+14 |

### Plans B activables

- **Fallback courier** : Stuart (cf [alternatives_uber_direct.md](../research/alternatives_uber_direct.md)) — intégration en 2-3 semaines une fois compte ouvert
- **Fallback paiement** : Mangopay ou Lemonway — refactor 1-2 semaines
- **Fallback push** : email transactionnel via Resend (déjà spec'd dans kitchenboost_saas_full_spec.md)
- **Fallback onboarding** : si self-serve API pas accessible, onboarding manuel resto par resto (acceptable jusqu'à 10 restos)

---

## 10. Suivi opérationnel — Rituels

- **Daily standup Alex + Dev** (15 min) pendant Phase B, C, D — toute la durée des 2 semaines
- **Call check-in Alex → Khan** : J+7 (mid-point) + J+14 (Go/No-Go)
- **Mémo post-call Uber AM** dans `docs/notes/call_uber_am_2026-05-XX.md`
- **Mise à jour de ce plan** à chaque fin de phase dans §11 Journal ci-dessous

---

## 11. Journal — Updates post-validation phase

> À remplir à chaque transition de phase. Format : `### YYYY-MM-DD — Phase X → Phase Y`

### En attente première update (J0 = 2026-05-21)

---

## 12. Référence rapide

**Liens directs vers les docs sources** :
- Integration Partner (process, bénéfices, recommandation) → [uber_integration_partner.md](../research/uber_integration_partner.md)
- API technique Uber Direct → [uber_direct_deep_dive.md §1](../research/uber_direct_deep_dive.md)
- Flow $ Stripe Connect → [uber_direct_deep_dive.md §2](../research/uber_direct_deep_dive.md)
- Patterns multi-tenant → [uber_direct_deep_dive.md §3](../research/uber_direct_deep_dive.md)
- Alternatives (Stuart, Deliveroo Signature, Yper) → [alternatives_uber_direct.md](../research/alternatives_uber_direct.md)
- Web Push code minimal → [web_push_pwa.md §3](../research/web_push_pwa.md)
- Architecture multi-tenant KB → [kitchenboost_saas_full_spec.md §2](../specs/kitchenboost_saas_full_spec.md)
- Schéma DB Supabase → [kitchenboost_saas_full_spec.md §7](../specs/kitchenboost_saas_full_spec.md)
- MVP V0 PWA review+push → [mvp_pwa_review_push.md](../specs/mvp_pwa_review_push.md)
- Contrat (Article 3 bis Uber Direct) → [contrat_template.md](../legal/contrat_template.md)
