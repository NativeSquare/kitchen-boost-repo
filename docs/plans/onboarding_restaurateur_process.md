# Onboarding Restaurateur — Process step-by-step KitchenBoost

**Statut** : v1 — 2026-05-21
**Auteur** : Alex / Claude
**Objectif** : Process clair et reproductible pour onboarder chaque restaurateur signé. De "OK je signe" à "PWA live + 1ère commande réussie via Uber Direct".

**Modèle économique acté (MVP)** :
- **1 compte Uber Direct par restaurant** (self-signup direct.uber.com au nom du resto)
- **1 compte Stripe Connect Express par restaurant**
- **KitchenBoost orchestre via API** mais **n'est pas dans le flux d'argent de la livraison** (Uber facture le resto direct, KB juste 2€/commande via application_fee Stripe)
- **Avantage risque** : KB pas exposé aux impayés Uber, change devise, ou échec livraison → flux 100% entre resto et Uber

---

## 1. Vue d'ensemble — Timeline et acteurs

### Principe directeur

**KB fait TOUT le travail en backoffice** grâce au mandat Article 2 bis du contrat (création/administration comptes). Le resto fait UNIQUEMENT :
- Signer le contrat + envoyer 3 docs (KBIS, RIB, ID)
- Lors du RDV install sur place : entrer sa CB sur l'interface Uber (KB ne voit pas) + vérifier son identité sur Stripe (CNI + selfie liveness + 2FA + accepter CGU — c'est régulatoire PSD2, KB ne peut pas le faire à sa place)
- Coller les stickers QR sur les sacs

**KB entre lui-même l'IBAN du resto sur Stripe via l'API** (depuis le RIB fourni au closing). Le resto ne tape JAMAIS son RIB.

### Timeline standard par resto

```
J0                J1-J4              J5-J6 (RDV)       J7-J14         J14+
──────────        ──────────         ──────────        ──────────     ──────────
Contrat signé     KB crée tout       RDV INSTALL       Soft launch    Go-live
+ 3 docs reçus    en backoffice      sur place         friends &       public
                                                       family          + QR sacs
- Contrat ok      - Uber Direct      - Resto entre CB
- KBIS            - Uber Eats Mgr    - Resto valide
- RIB pro         - Stripe Connect     identité Stripe
- CNI             - IBAN entré       - Test tablette
                    par KB via API   - 1 commande test
                  - PWA tenant       - Briefing équipe
                  - Domain + SSL     - Stickers livrés
                  - Menu importé
                  - Stickers cmd
```

**Estimé** : 7 jours du contrat signé au soft launch. **14 jours** au go-live public. Compressible à 5 jours une fois rodé.

### Acteurs

| Acteur | Rôle |
|---|---|
| **Alex (KB)** | Collecte docs, crée comptes Uber au nom du resto (via mandat Article 2 bis), RDV install sur place, briefing équipe resto |
| **Dev (KB)** | Configure PWA tenant, importe menu, applique branding, génère lien Stripe Connect onboarding |
| **Restaurateur** | Signe contrat + envoie 3 docs. Au RDV install : entre lui-même sa CB sur Uber (KYC paiement) + valide son identité sur Stripe (scan CNI + selfie + 2FA + CGU, régulatoire PSD2). **Ne touche pas au RIB** (KB l'entre via API). Colle les stickers. |

### Modèle "1 login KB, N comptes resto"

- **Côté Uber** : chaque resto a son propre compte (KBIS différent = entité juridique différente, contrainte légale Uber). MAIS Alex est ajouté comme **admin user** sur les N comptes → un seul login KB pour gérer tous les restos
- **Côté Stripe** : chaque resto a son propre compte Stripe Connect Express. KB a un dashboard plateforme qui voit les N comptes connectés
- **Email organisationnel KB** : `restos@kitchen-boost.fr` (Google Workspace) avec aliases `restos+bunsbao@kitchen-boost.fr`, `restos+caverne@kitchen-boost.fr`, etc. pour différencier les comptes Uber tout en centralisant dans une seule boîte mail

---

## 2. Inputs nécessaires du restaurateur (checklist closing)

Le client est **closed** quand on a réuni les 4 éléments suivants. PAS AVANT.

### 2.1 Documents OBLIGATOIRES à J0 (closing)

- [ ] **Contrat KB signé** (cf [docs/legal/contrat_template.md](../legal/contrat_template.md))
- [ ] **KBIS** < 3 mois (PDF ou photo claire) — requis Uber Direct + Stripe Connect KYC
- [ ] **RIB pro** au nom de la société du resto (PDF ou photo) — pour Stripe payouts + Uber Direct billing
- [ ] **CNI ou passeport** du représentant légal (recto-verso) — requis KYC Stripe + Uber

**Si un de ces 4 items manque, le client n'est PAS closed.** On ne lance pas le setup.

### 2.2 Ce qu'on ne demande PAS au J0

| Item | Pourquoi pas |
|---|---|
| ❌ **Attestation RC pro** | Article 11.1 contrat KB dit "à première demande" → on demande SI réclamation. Pas requis Uber/Stripe. Bloquer le closing pour ça serait stupide |
| ❌ **Carte bancaire pro** | KB n'a JAMAIS le droit de collecter / stocker / transmettre une CB (PCI-DSS, risque réglementaire). Le resto entre sa CB **lui-même** sur l'interface Uber lors du RDV install sur place. KB ne voit que les 4 derniers chiffres dans le dashboard |
| ✅ **RIB tapé par KB sur Stripe via API** | KB entre l'IBAN du resto dans le payload `POST /accounts` Stripe avec le paramètre `external_account` (cf §4.2). Le resto ne touche jamais à son RIB. Le resto ne fait que valider son identité (KYC) sur l'UI Stripe au RDV install. |

### 2.3 Infos opérationnelles (à récupérer en parallèle, pas bloquant pour closing)

- [ ] **Email business du resto** si existant (sinon KB crée alias `restos+<slug>@kitchen-boost.fr`)
- [ ] **Téléphone portable du patron** — pour Uber notifs + WhatsApp KB
- [ ] **Adresse + horaires d'ouverture** par jour
- [ ] **Type de cuisine** + signature en 1 phrase
- [ ] **Compte Uber Eats Manager existant** (si déjà sur marketplace) : KB demande à être ajouté comme admin user

### 2.4 Assets marque

- [ ] **Logo** (PNG transparent HD si existant — sinon KB en crée un basique)
- [ ] **Photos plats** (existantes ou KB shoot)
- [ ] **Couleurs marque** (hex si existant)
- [ ] **Domaine web existant** (si oui → `commandes.restoX.fr`, sinon KB attribue `restoX.kitchen-boost.fr`)

### 2.5 Menu

- [ ] **Export Uber Eats Manager** (méthode préférée — KB y accède via admin user, plus besoin de demander)
- [ ] Sinon photo carte resto ou saisie KB après visite

### 2.6 Canal de comm direct

- [ ] **WhatsApp testé** (message envoyé + réponse OK reçue)
- [ ] Contact "Patron [Resto]" sauvegardé dans tel d'Alex

---

## 3. Setup comptes Uber (J1-J4) — KB fait TOUT en backoffice

**Principe** : grâce au mandat Article 2 bis du contrat, KB peut créer les comptes au nom du resto sans qu'il intervienne (sauf signature CGU et CB qu'il fera au RDV install §5).

### 3.1 Pourquoi 2 comptes (Uber Eats Manager + Uber Direct)

- **Uber Eats Manager** : dashboard pour le marketplace Uber Eats (le resto est sur l'app Uber Eats, les clients commandent depuis là)
- **Uber Direct** : service de livraison white-label (le client commande sur la PWA KB, Uber livre)

Les 2 services sont **gérés depuis le même compte Uber** mais ce sont des activations distinctes. Si le resto est déjà sur Uber Eats marketplace, on active juste Uber Direct en plus. Si pas, on crée les 2.

### 3.2 Création compte Uber Direct (J1-J2)

**Côté KB, en backoffice** :

| # | Étape | Détail |
|---|---|---|
| 3.2.1 | Créer un alias email Google Workspace : `restos+<slug>@kitchen-boost.fr` | Ex: `restos+bunsbao@kitchen-boost.fr` |
| 3.2.2 | Aller sur `https://direct.uber.com` → Sign up | |
| 3.2.3 | Email = alias KB ci-dessus | Permet à KB de gérer + admin user resto ajouté ensuite |
| 3.2.4 | Remplir infos société : raison sociale (depuis KBIS), SIRET, adresse | KB avec KBIS resto sous les yeux |
| 3.2.5 | Upload KBIS + RIB + CNI du représentant légal | Les 3 docs collectés au closing |
| 3.2.6 | Accepter Terms + API Terms of Use **au nom du resto** | Justifié par mandat Article 2 bis du contrat KB |
| 3.2.7 | **NE PAS renseigner CB encore** — Uber permet finaliser ça plus tard | La CB sera entrée par le resto en personne au RDV install §5 |
| 3.2.8 | Soumettre la demande | Uber valide en 24-72h |
| 3.2.9 | À réception email validation : ajouter le resto comme user secondaire (Settings → Users → Add) | Email perso du patron, role "Owner" ou "Admin" |

### 3.3 Récupération credentials API (J2-J3, post-validation Uber)

| # | Étape | Note |
|---|---|---|
| 3.3.1 | Login sur `direct.uber.com` avec alias KB | |
| 3.3.2 | Developer → Management | |
| 3.3.3 | Noter `customer_id`, `client_id`, `client_secret` | Stocker dans 1Password "Tenant [Resto]" |
| 3.3.4 | Test auth : `POST https://auth.uber.com/oauth/v2/token` (Postman) | Doit renvoyer access_token valide |
| 3.3.5 | Sauvegarder en Supabase : `tenants.uber_customer_id`, `uber_client_id`, `uber_client_secret` (chiffré) | |

### 3.4 Configuration webhook (J2-J3)

| # | Étape | Note |
|---|---|---|
| 3.4.1 | Developer → Webhooks → Create Webhook | |
| 3.4.2 | URL : `https://api.kitchenboost.fr/webhooks/uber/<tenant_id>` | `tenant_id` unique pour dispatch |
| 3.4.3 | Events : `event.delivery_status`, `event.courier_update`, `event.refund_request` | |
| 3.4.4 | Copier Webhook Signing Key | Stocker en Supabase chiffré |
| 3.4.5 | Test delivery sandbox → webhook reçu | Validation tech setup |

### 3.5 Compte Uber Eats Manager (cas 1 : resto déjà sur marketplace)

Si le resto est déjà live sur Uber Eats (cas Khan / Caverne / Crêperie / Buns & Bao) :

| # | Étape | Note |
|---|---|---|
| 3.5.1 | Demander au resto de nous ajouter comme **admin user** sur son Uber Eats Manager | Le resto va dans Settings → Users → Invite |
| 3.5.2 | Email à ajouter : `restos+<slug>@kitchen-boost.fr` | Même alias que pour Uber Direct → 1 login KB pour les 2 services |
| 3.5.3 | Activer Uber Direct depuis Uber Eats Manager (option "Add Uber Direct service") | KB clique depuis son admin access |

### 3.6 Compte Uber Eats Manager (cas 2 : resto PAS encore sur marketplace)

Si le resto n'est pas encore sur Uber Eats (cas Walid / Amir / Yanis si nouveaux) :

| # | Étape | Note |
|---|---|---|
| 3.6.1 | Aller sur `https://merchants.ubereats.com/fr/fr/manager/signup/` | |
| 3.6.2 | Sign up avec alias `restos+<slug>@kitchen-boost.fr` | KB crée le compte au nom du resto (mandat Article 2 bis) |
| 3.6.3 | Upload KBIS + RIB + CNI | Mêmes docs |
| 3.6.4 | Configurer fiche resto (adresse, horaires, photos) | KB depuis backoffice |
| 3.6.5 | Activer Uber Direct comme service additionnel | |
| 3.6.6 | Ajouter le resto comme owner/admin user | Email perso du patron |
| 3.6.7 | Attendre validation Uber (3-7 jours en général pour marketplace) | Plus long que Direct seul |

### 3.7 Synthèse — Login KB centralisé

À la fin de l'étape 3, voici comment KB gère N restos :

```
1 boîte mail KB : restos@kitchen-boost.fr
   ├─ alias restos+bunsbao@kitchen-boost.fr     → compte Uber Khan
   ├─ alias restos+caverne@kitchen-boost.fr     → compte Uber Caverne
   ├─ alias restos+creperie@kitchen-boost.fr    → compte Uber Crêperie
   ├─ alias restos+walid@kitchen-boost.fr       → compte Uber Walid (si signé)
   └─ ...

1 login KB Uber Direct par alias → 1 dashboard par resto
1 login KB Uber Eats Manager → vue agrégée de tous les restos où KB est admin

Resto (owner légal du compte) :
   - Reçoit emails importants (validation, payments) sur son email perso
   - Peut se connecter avec son email perso quand il veut
   - Mais ne touche jamais au compte au quotidien (KB gère)
```

---

## 4. Setup Stripe Connect Express (J3-J4 backoffice, KB pré-remplit 95%)

### 4.1 Principe — KB pré-remplit tout sauf ce qui est régulatoirement obligatoire

**Stripe Connect Express = KB peut pré-remplir 95% du compte via API.** Le resto fait uniquement les étapes que **Stripe exige légalement** (KYC / PSD2 / lutte anti-blanchiment) :

- Vérification d'identité (selfie + scan CNI)
- 2FA téléphone
- Acceptation CGU Stripe

Ces 3 actions sont **incontournables** — c'est régulatoire, pas une limitation produit Stripe. Aucun PSP agréé en Europe ne te permettra de les contourner.

**Bonne nouvelle** : avec un bon pré-remplissage API, le resto passe **5 min sur l'écran Stripe**, pas 15 min.

### 4.2 Création du compte Stripe Connect avec pré-remplissage MAX (J3, KB Dev backoffice)

| # | Étape | Note |
|---|---|---|
| 4.2.1 | `POST /accounts` Stripe avec **tous** les champs possibles pré-remplis | Cf payload complet ci-dessous |
| 4.2.2 | Inclure `external_account` avec **IBAN du resto** (depuis RIB fourni au closing) | Plus de saisie RIB à faire pour le resto |
| 4.2.3 | Stocker `stripe_account_id` retourné dans Supabase `tenants` | KB Dev |
| 4.2.4 | Générer lien onboarding via `POST /account_links` (`type=account_onboarding`) | URL valide 5 min |
| 4.2.5 | Régénérer le lien **juste avant le RDV install** | Sinon expiré |

#### Payload `POST /accounts` complet (pré-remplissage max)

```json
{
  "type": "express",
  "country": "FR",
  "email": "<email_perso_patron>",
  "business_type": "company",
  "company": {
    "name": "<raison sociale depuis KBIS>",
    "tax_id": "<SIRET>",
    "address": {
      "line1": "<adresse depuis KBIS>",
      "postal_code": "<CP>",
      "city": "<ville>",
      "country": "FR"
    },
    "phone": "<tel resto>",
    "structure": "<sa/sas/sarl etc depuis KBIS>"
  },
  "business_profile": {
    "mcc": "5812",
    "name": "<nom commercial>",
    "product_description": "Service de restauration et livraison",
    "support_email": "<email resto>",
    "support_phone": "<tel resto>",
    "url": "https://<slug>.kitchen-boost.fr"
  },
  "external_account": {
    "object": "bank_account",
    "country": "FR",
    "currency": "eur",
    "account_holder_name": "<raison sociale>",
    "account_holder_type": "company",
    "iban": "<IBAN depuis RIB resto>"
  },
  "capabilities": {
    "card_payments": { "requested": true },
    "transfers": { "requested": true }
  },
  "settings": {
    "payouts": { "schedule": { "interval": "daily" } }
  },
  "metadata": {
    "tenant_id": "<uuid_tenant_KB>",
    "resto_slug": "<slug>"
  }
}
```

**Résultat** : à l'ouverture du lien Stripe par le resto, **99% des champs sont déjà remplis**. Reste à faire pour le resto :

1. Confirmer/uploader la **CNI du représentant légal** (scan webcam + selfie liveness) — 2 min
2. Recevoir le **code 2FA SMS** sur son tel + le taper — 30 sec
3. **Accepter les CGU Stripe Connect** (clic) — 30 sec

**Total resto : ~3-5 min sur le RDV install.** Pas de saisie RIB (déjà passé par API), pas de saisie SIRET/adresse (idem), pas de re-confirmation horaires/business (idem).

### 4.3 Validation post-onboarding (J5-J6, côté KB)

| # | Étape | Note |
|---|---|---|
| 4.3.1 | KB monitor via webhook `account.updated` | |
| 4.3.2 | Attendre `charges_enabled: true` ET `payouts_enabled: true` | Habituellement instantané post-KYC |
| 4.3.3 | Si `requirements.currently_due` non vide → relance WhatsApp avec lien spécifique | Rare |
| 4.3.4 | Test PaymentIntent destination_charge 1€ → split OK → refund | Étape suivante au RDV install |

### 4.4 Pourquoi Express et pas Custom

| Type | Charge KB | Charge Resto | Pertinent ? |
|---|---|---|---|
| **Standard** | Très faible (resto fait tout) | Élevée (compte Stripe complet) | ❌ Trop de friction resto |
| **Express** (choix KB) | Modérée (pré-remplissage API) | Minimale (3 actions obligatoires) | ✅ |
| **Custom** | Élevée (KB devient responsable KYC) | Quasi-nulle | ❌ Charge réglementaire KB trop lourde pour Phase 1 |

Express = bon équilibre. Plus tard (à 50+ restos), on pourra migrer vers Custom si on veut absorber encore plus de friction côté resto.

---

## 5. Setup PWA tenant (côté KB uniquement)

### 5.1 Configuration DB Supabase

| # | Tâche | Owner |
|---|---|---|
| 5.1.1 | Créer row `tenants` avec : slug, name, address, hours, cuisine_type, brand_color, logo_url, domain | KB Dev |
| 5.1.2 | Lier `uber_customer_id` + `uber_client_id` (chiffré) + `uber_webhook_signing_key` (chiffré) | KB Dev |
| 5.1.3 | Lier `stripe_account_id` | KB Dev |
| 5.1.4 | Configurer Row Level Security pour isolation tenant | KB Dev |

### 5.2 Configuration custom domain (Vercel)

**Si resto a son domaine** (`restoX.fr`) :
1. Dans Vercel Project → Settings → Domains → Add → `commandes.restoX.fr`
2. KB envoie au resto par WhatsApp les instructions DNS :
   > Va chez ton registrar (OVH/Gandi/etc.), ajoute un CNAME : `commandes` → `cname.vercel-dns.com`
3. Vercel provisionne SSL Let's Encrypt automatiquement (15-60 min)
4. Une fois SSL OK, toggle `domain_status: live` en DB

**Si pas de domaine** (par défaut) :
1. Vercel ajoute automatiquement `restoX.kitchen-boost.fr` (sous-domaine KB)
2. Pas d'action DNS resto

### 5.3 Import du menu

3 options par ordre de préférence :

**Option A — Export Uber Eats Manager (recommandé)**
1. KB demande au resto un export menu CSV/JSON depuis son Uber Eats Manager (Menu → Export)
2. Script `tools/import_menu_ubereats.py` → convertit en format KB (cf `menu.json` schema existant)
3. Insertion DB Supabase

**Option B — Saisie manuelle** depuis photos de carte
1. Si pas d'export possible, KB saisit le menu depuis photos
2. Validation par le resto avant go-live

**Option C — Visite kickoff Phase C** (cf `project_onboarding_process.md` Phase C)
1. Si on est aussi en train de créer une marque virtuelle pour ce resto, le menu est déjà collecté à la Phase C du process onboarding global
2. Réutiliser ce menu pour la PWA

### 5.4 Application branding

| # | Tâche | Owner |
|---|---|---|
| 5.4.1 | Si logo fourni → upload Cloudinary ou Supabase Storage | KB Dev |
| 5.4.2 | Si pas de logo → KB génère un logo basic (Canva ou Figma en 1h) | KB |
| 5.4.3 | Hero photo : utiliser meilleur photo plat existante (cf `feedback_hero_food_50pct.md`) | KB Dev |
| 5.4.4 | Palette couleurs : appliquer depuis brand_color en DB | KB Dev |

---

## 6. RDV INSTALL SUR PLACE (J5-J6) — Le moment clé

**Le seul moment où KB physiquement interagit avec le resto pour finaliser.** Durée 60-90 min.

### 6.1 Préparation KB avant le RDV

À avoir prêt sur l'ordi/tablette KB :

- [ ] Login Uber Direct du resto (alias `restos+<slug>@kitchen-boost.fr` + mot de passe) — déjà testé
- [ ] Dashboard Uber Eats Manager du resto (si applicable) — déjà admin user
- [ ] **Lien Stripe Connect onboarding** fraîchement régénéré (URL valide 5 min — régénérer juste avant le RDV via API)
- [ ] PWA tenant déjà configurée, menu importé, branding appliqué, custom domain SSL actif
- [ ] 500 QR stickers commandés et livrés au bureau KB (cf §7)
- [ ] Carte bancaire perso d'Alex pour le test de commande prod

### 6.2 Déroulé du RDV (60-90 min)

**Étape 1 — Entrée CB resto sur Uber Direct (5 min)**

| # | Action | Qui |
|---|---|---|
| 6.2.1 | Ouvrir Uber Direct dashboard sur ordi de KB, le tendre au resto | Alex |
| 6.2.2 | Resto va dans Billing → Add payment method | **Resto** (pas Alex) |
| 6.2.3 | Resto tape sa CB pro lui-même | **Resto** (Alex se détourne, ne regarde pas) |
| 6.2.4 | Confirmation : seuls les 4 derniers chiffres visibles dans le dashboard | Vérifié ensemble |
| 6.2.5 | Status Uber Direct passe à "Active" | Vérifier après quelques minutes |

**Étape 2 — Vérification d'identité Stripe Connect (5 min — KB a pré-rempli tout le reste)**

KB a déjà passé l'IBAN + SIRET + raison sociale + adresse + business profile via API en backoffice (cf §4.2). Le resto fait UNIQUEMENT les 3 actions obligatoires régulatoirement :

| # | Action | Qui |
|---|---|---|
| 6.2.6 | KB régénère le lien Stripe onboarding (URL valide 5 min) | Alex |
| 6.2.7 | KB envoie le lien par WhatsApp au resto | Alex |
| 6.2.8 | Resto ouvre le lien sur SON téléphone | **Resto** |
| 6.2.9 | Resto upload CNI (recto-verso) + selfie liveness | **Resto** (KYC obligatoire PSD2) |
| 6.2.10 | Resto reçoit SMS code 2FA + le tape | **Resto** |
| 6.2.11 | Resto accepte CGU Stripe Connect | **Resto** |
| 6.2.12 | KB voit dashboard Stripe → `charges_enabled` + `payouts_enabled = true` | Alex (~30 sec post-validation) |

**Étape 3 — Vérification tablette Uber (si offre Premium)**

Cf [feedback_uber_pricing_tiers_fr.md](mémoire) — la tablette est entre le resto et Uber, KB ne gère pas (Article 3 bis contrat).

| # | Action | Qui |
|---|---|---|
| 6.2.11 | Vérifier que la tablette est branchée + chargée + connectée Wi-Fi | Resto + Alex |
| 6.2.12 | Tester réception d'une fausse commande sur la tablette | Resto |
| 6.2.13 | Si problème tablette → support Uber direct (numéro dans la tablette) | Resto |

**Étape 4 — Test 1 commande prod réelle bout-en-bout (15-20 min)**

| # | Action | Qui |
|---|---|---|
| 6.2.14 | Alex passe 1 commande réelle sur la PWA du resto avec sa CB perso | Alex |
| 6.2.15 | Vérifier que la commande arrive sur la tablette du resto + dashboard KB | Vérifier ensemble |
| 6.2.16 | Resto prépare le plat (~5-10 min) | Resto |
| 6.2.17 | Livreur Uber Direct arrive, prend le plat, livre à Alex (qui attend dehors) | Livreur Uber |
| 6.2.18 | Alex reçoit la commande → checks : QR sticker présent, temps total <45 min, push notif reçue | Alex |
| 6.2.19 | Vérifier dans Stripe : Alex débité X€, resto crédité net, KB encaissé 2€ | KB Dev (Stripe dashboard) |

**Étape 5 — Briefing équipe + livraison stickers (15 min)**

| # | Action | Qui |
|---|---|---|
| 6.2.20 | Remettre les 500 stickers en main propre | Alex |
| 6.2.21 | Briefing équipe (cuisine + salle) : "1 sticker sur chaque sac livraison Uber Eats, côté visible client" | Alex |
| 6.2.22 | Démonstration : 1 sticker collé sur 1 sac type | Alex + équipe |
| 6.2.23 | Photo de validation envoyée à Alex par WhatsApp | Resto |
| 6.2.24 | Briefing dashboard KB : où voir les commandes, les push notifs envoyées, les métriques | Alex + Resto |

**Étape 6 — Check final**

- [ ] Uber Direct : Active + CB entrée + tablette OK
- [ ] Stripe Connect : `charges_enabled` + `payouts_enabled` = true
- [ ] PWA accessible publiquement avec SSL OK
- [ ] 1 commande prod réelle réussie e2e (KB encaissé 2€)
- [ ] Stickers livrés + équipe briefée + 1 photo validation reçue

**Si tous OK → on peut démarrer soft launch §7.**

---

## 7. QR stickers — Préparation amont du RDV install

### 7.1 Design + commande

- **Format** : rond vinyle laminé mat, 50mm de diamètre
- **Contenu** : QR code (URL `commandes.restoX.fr/r/<slug>` ou `<slug>.kitchen-boost.fr/r/<slug>`) + accroche "Commande directe sans commission"
- **Fournisseur** : Stickermule ou Vistaprint
- **Quantité initiale** : 500 stickers (~30-50€)
- **Délai prod** : 5-7 jours ouvrés → **commander dès J1** pour être livré au bureau KB avant le RDV install J5-J6
- **Facturation** : inclus dans le setup initial 354-444€ refacturé au resto (cf CLAUDE.md "Couts outils")

---

## 8. Soft launch friends & family (3-7 jours)

### 8.1 Recrutement testeurs

- Cibler 5-10 personnes dans la zone de livraison du resto (équipe NS + amis/famille proches)
- Brief : "Tu commandes sur cette PWA, tu paies normal, je te rembourse via Lydia si problème"

### 8.2 Métriques pendant le soft launch

| Critère | Seuil minimum |
|---|---|
| Commandes test réussies bout-en-bout | ≥ 8/10 |
| Aucun incident bloquant non corrigé | 0 |
| Taux livraison Uber Direct OK | ≥ 90% |
| Push reçues (testeurs Android + iOS A2HS) | ≥ 80% |
| Satisfaction resto sur le flow | Score ≥ 7/10 |

### 8.3 Itérations bugs

- Logger chaque bug détecté dans `docs/feedback/<resto-slug>_soft_launch.md`
- Fix critique uniquement, pas de nouvelle feature
- Boucler en 2-3 itérations max

---

## 9. Go-live public

### 9.1 Décision Go/No-Go

À la fin du soft launch (J+7 typique) :

- **GO** → on déploie les QR stickers sur **toutes** les commandes Uber Eats du resto
- **No-Go partiel** → prolonger soft launch 1 semaine, fix blocants
- **No-Go total** → post-mortem, on évalue (pivot Stuart fallback ? abandonner la PWA pour ce resto ?)

### 9.2 Communication resto post go-live

- WhatsApp groupe `Resto X — Suivi KB` avec Alex + représentant resto + Dev KB
- Check-in hebdo vendredi 18h : nb commandes PWA / nb scans QR / taux conversion / incidents
- Métriques `feedback_winner_criteria.md` mesurées sur 30 jours après go-live

---

## 10. Annexes — Templates copy-paste

### 10.1 Email-type collecte docs (J0 closing)

```
Sujet : KitchenBoost — 3 docs pour démarrer (5 min)

Bonjour [Prénom],

Super, content qu'on lance KitchenBoost pour [Resto] ! Pour que je puisse
m'occuper de TOUT le setup à votre place, j'ai besoin de 3 documents :

  1. Votre KBIS (moins de 3 mois)
  2. Votre RIB pro (au nom du resto)
  3. Une copie de votre CNI (recto-verso)

C'est tout pour cette phase. Je ne vous demande PAS votre CB ni rien d'autre.

Une fois reçus, je crée vos comptes Uber Direct et Stripe en backoffice (3-4
jours) — j'entre moi-même votre IBAN sur Stripe à partir du RIB que vous
m'aurez envoyé. Puis je passe vous voir 1h au resto pour finaliser :
  - vous entrerez votre CB sur Uber Direct (je ne vois rien, 5 min)
  - vous validerez votre identité sur Stripe via une photo de votre CNI
    et un selfie (5 min, obligatoire par la régulation européenne)
  - on fera 1 commande test ensemble
  - je vous livre les QR stickers à coller sur les sacs

Comptez 7 jours entre maintenant et la première commande test, 14 jours pour
le go-live public avec stickers sur tous les sacs.

À très vite,
Alexandre
KitchenBoost
```

### 10.2 WhatsApp confirmation RDV install (J4 — fin du backoffice)

```
Hello [Prénom], j'ai fini tout le setup en backoffice. Vos comptes Uber Direct
et Stripe sont pré-remplis avec vos infos. Il nous reste 1h ensemble au resto :

  • Vous tapez votre CB sur Uber Direct (vous tapez, je vois rien — 5 min)
  • Vous validez votre identité sur Stripe (CNI + selfie + SMS, 5 min)
  • On vérifie votre tablette Uber
  • On fait 1 commande test ensemble pour valider que tout marche
  • Je vous livre les 500 QR stickers + briefing équipe (5 min)

Aucun RIB à retaper, tout est déjà fait pour vous. Je vous propose [JOUR]
à [HEURE] au resto, ça vous va ?
```

### 10.3 Checklist imprimable (1 page A4)

```
ONBOARDING [RESTO X] — Checklist KitchenBoost

═══ J0 — CLOSING ═══
[ ] Contrat KB signé
[ ] KBIS < 3 mois reçu
[ ] RIB pro reçu
[ ] CNI représentant légal reçu
[ ] Canal WhatsApp testé

═══ J1-J4 — BACKOFFICE KB ═══
[ ] Alias email créé (restos+<slug>@kitchen-boost.fr)
[ ] Compte Uber Direct créé (KB via mandat Article 2 bis)
[ ] Compte Uber Eats Manager : KB ajouté admin user OU créé from scratch
[ ] Credentials API récupérés (customer_id, client_id, client_secret) → 1Password
[ ] Webhook configuré + signing key stockée
[ ] Compte Stripe Connect Express créé via POST /accounts
[ ] Lien Stripe onboarding pré-généré
[ ] PWA tenant configuré en DB Supabase
[ ] Custom domain ou sous-domaine actif (SSL OK)
[ ] Menu importé + validé visuellement par KB
[ ] Branding appliqué (logo, couleurs, hero)
[ ] 500 QR stickers commandés (Stickermule)

═══ J5-J6 — RDV INSTALL SUR PLACE (1h chrono) ═══
[ ] Resto entre sa CB pro sur Uber Direct (KB ne regarde pas) — 5 min
[ ] Status Uber Direct = Active
[ ] Lien Stripe onboarding régénéré + envoyé au resto par WhatsApp
[ ] Resto upload CNI + selfie + 2FA + accepte CGU Stripe (sur son tel) — 5 min
[ ] charges_enabled + payouts_enabled = true côté Stripe
[ ] Tablette Uber branchée + connectée Wi-Fi + test commande factice OK
[ ] 1 commande prod RÉELLE bout-en-bout réussie (Alex paie sa CB)
[ ] Stripe vérifié : Alex débité X€ / Resto crédité net / KB encaissé 2€
[ ] 500 stickers remis au resto + briefing équipe
[ ] Photo validation collage envoyée par WhatsApp

═══ J7-J14 — SOFT LAUNCH ═══
[ ] 5-10 commandes friends & family passées
[ ] Métriques OK (≥90% livraison, ≥80% push reçues, satisfaction ≥7/10)
[ ] 0 incident bloquant non corrigé

═══ J14 — GO-LIVE PUBLIC ═══
[ ] Décision Go validée Alex + resto
[ ] QR stickers actifs sur TOUS les sacs Uber Eats
[ ] Suivi métriques 30j activé (winner criteria)
```

---

## 11. Pourquoi ce modèle MVP est OK pour KB

**Décision actée 2026-05-21** : on démarre en **modèle "1 contrat Uber Direct par resto"** sans candidater Integration Partner.

### Avantages

1. **KB pas dans le flux d'argent de la livraison** → Uber facture directement la CB du resto, KB n'est pas exposé aux impayés, échecs de prélèvement, change devise, refunds en cascade
2. **Pas de blocker certification IP** (3-6 mois) → on peut sortir le pilote en 14 jours
3. **Modèle propre fiscalement** : le resto reçoit ses propres factures Uber HT (déduit la TVA), KB facture juste 2€/cmd HT au resto en B2B (déduit la TVA)
4. **Simple à expliquer au resto** : "tu signes ton propre contrat Uber Direct, t'es maître chez toi, on t'orchestre le truc via API"
5. **Pivot facile** : si on candidate Integration Partner plus tard (à 8+ restos), on peut migrer les comptes existants vers une org parent KB

### Inconvénients (à accepter pour MVP)

1. **Onboarding plus lent par resto** (30 min screen share self-signup vs 1 appel API si on était IP)
2. **N webhooks** à configurer (1 par resto) vs 1 unique multi-tenant
3. **Pas de pricing négocié** : on paie 5,90€ HT publique au lieu d'un tarif IP (~4-5€ négocié)
4. **Risque crédentiels** : KB stocke les credentials API de chaque resto → coffre sécurisé obligatoire (1Password ou Vault)

**Conclusion** : on accepte ces inconvénients pour Phase 1 (1-8 restos). On migre vers IP quand on a 8+ restos et un POC stable.
