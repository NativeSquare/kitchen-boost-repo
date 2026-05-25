# 35 — Moteur Pricing Dynamique

**Statut** : 🟡 Squelette · **Version** : 0.1 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 4](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

---

## Pourquoi ce sous-PRD existe

Le coût de la livraison Uber Direct (~5,90 € HT) est **structurellement supérieur** à la marge moyenne d'une commande. Sans pricing dynamique, un panier de 12 € où le resto offre la livraison perd de l'argent. Le moteur permet au resto de **piloter qui paie quoi** selon des règles métier (taille panier, jour, items, etc.) — c'est une différenciation forte face à Uber Eats qui impose un modèle uniforme.

## Scope

**Scope : le moteur Pricing ne touche QUE les frais de livraison.** Le prix des items (plats, boissons, sides) est édité manuellement par le resto dans son menu — pas un sous-domaine du moteur Pricing. Pas de règles automatiques sur items V1/V2.

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1**  | Modèle de règles configurables par resto (conditions + action sur **frais livraison uniquement**), évaluation au paiement (latching), transparence prix au client (prix barré + attribution resto), règle par défaut KB pré-installée à l'onboarding (10% panier), UI no-code dans dashboard resto, intégration Stripe (montant total facturé client). |
| **V2**  | A/B testing règles, expiration / scheduling règles (date début / date fin sur une règle livraison), simulateur (prévisualisation de l'impact d'une règle), campagnes notifications adossées à un changement de règle.                                                                                                                                  |
| **V3**  | Pricing optimisé par ML (KB suggère des règles maximisant CA resto), pricing dynamique géolocalisé.                                                                                                                                                                                                                                                    |

## Hors scope

- **Pricing dynamique sur items** : si un resto veut faire varier le prix de ses plats/boissons, il édite son menu manuellement. Pas dans le moteur Pricing V1/V2. (Q35-Q3 acté 2026-05-23.)
- Yield management complexe à la SaaS hôtelier (V3+ si jamais).
- Coupons / codes promo (V2 si besoin, dans un autre PRD).
- Pricing négocié entre 2 restos (V3+ si pertinent).

## Personas concernés

- **Restaurateur** (configure les règles dans dashboard)
- **Client final mangeur** (voit le prix calculé au checkout, doit le comprendre)
- **Admin KB** (peut configurer des règles globales fallback, ou pré-remplir lors du onboarding)

## Surface fonctionnelle (sections à remplir)

### 1. Modèle de règles

Une **règle** est composée de :

- **Conditions V1 (6 — toutes doivent être vraies, AND logique)** :
  - `total_panier` (≥, ≤)
  - `première_cmd_client` (bool)
  - `nombre_cmds_client` (≥, ≤)
  - `plage_horaire` (HH:MM – HH:MM)
  - `jour_semaine` (LU…DI, multi-select)
  - `contient_item` (catégorie ou item spécifique)
- **Retirées V1** :
  - ~~`mode_livraison`~~ — pickup = pas de frais livraison, géré en amont (le moteur n'est appelé qu'en mode delivery).
  - ~~`distance_livraison_km`~~ — géré par Uber Direct : si hors zone, le quote est refusé en amont, la cmd ne peut pas être passée. Pas besoin d'une règle KB.
- **Action** (part que le resto absorbe ; le client paie le delta) :
  - `livraison_offerte_resto` (resto absorbe 100% du coût brut Uber Direct, client paie 0)
  - `frais_livraison_part_resto_fixe = X €` (resto absorbe X €, capé au coût brut, client paie le reste)
  - `frais_livraison_part_resto_pourcentage_panier = X%` (resto absorbe X% du **total panier**, capé au coût brut Uber Direct, client paie le reste). **Note** : le pourcentage se calcule sur le panier (pas sur le coût brut livraison) — s'auto-adapte à la taille du panier.
- **KB ne subventionne jamais la livraison V1.** L'action `livraison_offerte_client` est retirée du moteur (Q35-Q1 acté 2026-05-23). Le client paie toujours `coût_brut - part_resto`. Si Alex veut subventionner une cmd au lancement, c'est hors moteur (avoir Stripe manuel).

**Priorité** : si plusieurs règles matchent, **une seule s'applique** (jamais de cumul). La règle gagnante est celle qui **minimise les frais de livraison facturés au client** (= maximise la part absorbée par le resto). Comportement déterministe, pas de drag & drop d'ordre. Q35-Q2 acté 2026-05-23.

### 2. UI configuration (vue KB Manager dans `KitchenBoost Admin`, cf. [70](70_kb_admin.md))

- Liste des règles actives
- Builder no-code : "Si [condition] et [condition] alors [action]"
- ~~Drag & drop pour réordonner la priorité~~ — **supprimé (Q35-Q2)** : la règle gagnante est déterministe (celle qui **minimise les frais facturés au client**), pas d'ordre manuel resto.
- Activate/Deactivate par règle
- Schedule (date début / date fin) — V2
- Test simulator : "Si un client commande 15€ un mardi à 13h, voilà ce que ça donne"

### 3. Évaluation au checkout (backend)

Input :

- Panier (items + total)
- Adresse client (pour distance)
- Date/heure cmd
- Profil client (1ère cmd ? Nb cmds ?)
- Mode (livraison ou pickup)
- Coût livraison brut Uber Direct (quote API)

Output :

- `frais_livraison_client` (montant à facturer au client final)
- `frais_livraison_resto` (montant à supporter par le resto)
- Vérification cohérence : `frais_livraison_client + frais_livraison_resto = coût brut Uber Direct`

### 4. Affichage transparent client (PWA)

**Q35-Q4 acté 2026-05-23 : prix barré + mention "Offert par [Nom du resto]".**

- Quand une règle réduit les frais livraison, afficher **prix barré (coût brut Uber Direct)** + **montant final** + **mention attribution au resto**.
  - Exemple offerte : `̶5̶,̶9̶0̶ ̶€̶ → 0,00 €  ·  Offert par Buns & Bao` 🎉
  - Exemple partiellement absorbée : `̶5̶,̶9̶0̶ ̶€̶ → 2,90 €  ·  3,00 € offerts par Buns & Bao`
- **Le client ne voit jamais "KitchenBoost"** dans le wording — il est sur la plateforme du resto (sous-domaine `<slug>.kitchen-boost.fr` ou domaine custom). Toute attribution est nominative au resto.
- Au panier : déjà afficher la projection si la règle est satisfaite (« Plus que 3 € pour livraison offerte »).
- Au checkout : récap clair « Sous-total + frais livraison = total ». Pas de surprise.
- **Garde-fous légaux (Code Conso L121-1 sur annonces de réduction)** :
  - Le prix barré DOIT être le coût brut Uber Direct réel (pas un prix gonflé).
  - Le wording dit explicitement que c'est le **resto** qui offre (jamais KB).
  - Si la règle est conditionnelle (`≥ 25 €`), le seuil est visible dès le panier — pas de prix barré qui apparaît mystérieusement au franchissement du seuil.

### 5. Intégration Stripe (cf. [30](30_paiement_stripe_connect.md))

- Le total facturé client (panier + frais livraison à charge client) est l'amount Stripe.
- L'`application_fee_amount` reste la commission KB (2,40 € TTC).
- La répartition resto/livraison est interne au resto (le resto reçoit le total client moins frais Stripe moins commission KB ; il paye Uber Direct séparément sur son compte Uber Direct).
- Pas de split payment Stripe automatique vers Uber Direct (Uber Direct facture séparément le resto sur son compte Uber).

### 6. Audit log

- Chaque évaluation de règles loggée (entrée + output)
- Permet au resto de comprendre pourquoi tel client a payé tel montant
- Conservation 90 jours min

### 7. Règle par défaut KB à l'onboarding + filet de sécurité

**Q35-Q (règle défaut onboarding) acté 2026-05-23.**

À la création d'un tenant (wizard `KitchenBoost Admin`, cf. [70](70_kb_admin.md)), KB **pré-installe automatiquement** une règle par défaut dans le pricing du resto :

- `action = frais_livraison_part_resto_pourcentage_panier = 10%`
- `conditions = []` (s'applique à toute cmd delivery)
- Statut : active

**Validation au kickoff Phase C** : Alex montre au resto l'effet de la règle sur 3 paniers types (ex : panier 12 € → resto absorbe 1,20 €, client paie 4,70 € ; panier 30 € → resto absorbe 3 €, client paie 2,90 € ; panier 60 € → resto absorbe 5,90 € = cap, client paie 0 €). Le resto valide, ajuste le pourcentage, ou bascule sur une autre stratégie. Aucune cmd live n'est traitée avant validation explicite par le resto.

**Filet de sécurité** : si le resto supprime la règle par défaut et ne crée rien → aucune règle ne matche → `frais_livraison_client = coût_brut_uber_direct` (le client paie tout). C'est un filet technique, pas une stratégie commerciale — un resto qui se retrouve dans cet état a un problème de configuration à corriger.

### 8. Edge cases pricing à gérer

- **Latching prix livraison** (Q35-Q5 acté 2026-05-23) : le prix livraison définitif est évalué **au clic "Payer"**, pas au panier. Le panier affiche un montant indicatif. Au paiement, ré-évaluation : si plus avantageux ou identique → silencieux ; si moins avantageux (règle resto désactivée OU surge Uber Direct) → prompt explicite obligatoire avant paiement.
- Click & collect : frais livraison = 0 (pas de question)
- Cmd refusée par resto : refund total (frais livraison inclus)
- Cmd annulée pendant prep : refund frais livraison conditionnel selon état (pas picked up = refund OK ; déjà picked up = pas de refund)

## Flows nominaux

1. **Resto configure sa 1ère règle** : Khan ouvre dashboard resto → "Pricing livraison" → "Nouvelle règle" → conditions : `total_panier >= 25 €` → action : `livraison_offerte_resto` → save. Règle active.
2. **Client commande, règle s'applique** : client met 30€ au panier → checkout → backend évalue les règles → 1ère règle matche → frais livraison = 0 pour le client → display "Livraison offerte par le resto ! (-5,90€)" → paiement Stripe sur 30€.
3. **Client commande, aucune règle ne matche** : client met 12€ au panier → backend → aucune règle ne matche → règle fallback s'applique → frais livraison = 5,90€ au client → display "+5,90€ livraison" → paiement Stripe sur 17,90€.

## Edge cases

- **Règle avec condition contradictoire** : ex `total_panier > 50` ET `total_panier < 30`. Détection au save, refus.
- **Boucle infinie de règles** : pas applicable car règles indépendantes (pas de chainage).
- **Resto crée 100 règles** : performance dégradée à l'évaluation. Soft limit 20 règles, hard limit 50.
- ~~**Règle "livraison offerte client"**~~ : **retirée du moteur V1** (Q35-Q1 acté). KB ne subventionne jamais. Si subvention exceptionnelle, hors moteur (avoir manuel).
- **Distance hors zone Uber Direct** : règle non évaluée, refus livraison au checkout (cf. [40](40_livraison_uber_direct.md)).
- **Cmd cross-tenant exotique** : pas applicable, règles 100% scopées par tenant.

## Critères de succès / acceptation

### V1

- [ ] Chaque resto a configuré au moins 1 règle dans dashboard (mesure)
- [ ] Évaluation règles au checkout en < 100ms
- [ ] Transparence prix client : 0 plainte "j'ai pas compris le prix"
- [ ] UI no-code testée par Khan (Buns & Bao) sans assistance KB
- [ ] Audit log opérationnel

### V2

- [ ] A/B testing règles déployé
- [ ] Simulator opérationnel
- [ ] Scheduling règles (date début / fin) disponible

## Dépendances

| Dépendance                                                     | Type    | Bloque quoi                                             |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md) | Interne | Section 5 intégration Stripe                            |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md)     | Interne | Quote Uber Direct + distance                            |
| [10_pwa_client_commande.md](10_pwa_client_commande.md)         | Interne | Affichage transparent client (section 4)                |
| [70_kb_admin.md](70_kb_admin.md)                               | Interne | UI configuration des règles (section 2, vue KB Manager) |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)             | Interne | Règles scopées par tenant_id                            |

## Open questions

| Q         | Question                                                                                                                                                                                                      | Deadline | Owner   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| ~~35-Q1~~ | ~~Action "livraison offerte client" (=promo KB) : autorisé V1 ou V2 ?~~ **ACTÉ 2026-05-23 : retirée du moteur V1, KB ne subventionne jamais.**                                                                | —        | —       |
| ~~35-Q2~~ | ~~Priorité règles multiples : 1ère qui matche OU plus avantageuse client ?~~ **ACTÉ 2026-05-23 : la règle qui minimise les frais facturés au client gagne. Jamais 2 règles cumulées.**                        | —        | —       |
| ~~35-Q3~~ | ~~Pricing dynamique sur items~~ **ACTÉ 2026-05-23 : hors scope du moteur Pricing V1/V2. Le resto édite ses prix items manuellement dans son menu.**                                                           | —        | —       |
| ~~35-Q4~~ | ~~Affichage prix barré "5,90€" si offert~~ **ACTÉ 2026-05-23 : prix barré + "Offert par [Nom resto]", jamais "KitchenBoost" côté client.**                                                                    | —        | —       |
| ~~35-Q5~~ | ~~Resto modifie une règle alors qu'une cmd est en cours de checkout~~ **ACTÉ 2026-05-23 : latching au clic "Payer", prompt obligatoire si prix livraison devient moins avantageux entre panier et paiement.** | —        | —       |
| 35-Q6     | Limite max règles par resto : 20 / 50 / illimité ?                                                                                                                                                            | V1       | Produit |

## Notes / décisions actées

- **Le resto pilote la prise en charge de la livraison**, pas KB.
- **Transparence client obligatoire** : pas de prix caché.
- **Article 3.2 contrat** : le total facturé client (panier + part livraison client) passe via Stripe → resto. Le resto paie Uber Direct séparément sur son compte Uber Direct.
- **L'`application_fee_amount` KB ne dépend PAS** des règles pricing (toujours 2€ HT par cmd).
- **Moteur backend-only (acté 2026-05-25, [ADR 0013](../adr/0013-pricing-engine-backend-only.md))** : le front n'a jamais les règles ni la formule ; il envoie sa demande à l'API et reçoit le prix calculé (indicatif au panier, définitif au paiement). Module pur testable en isolation, importé uniquement par le backend.
- **Pas de limite produit de règles** (acté 2026-05-25) : 1 à 5 règles en pratique ; plafond technique généreux only.
- **Trace pricing figée sur la commande** (acté 2026-05-25) : la règle gagnante + coût brut + part client/resto sont enregistrés sur la commande au paiement (chantier 2.3), pas dans un journal d'évaluation haute fréquence.

## Changelog

| Date       | Version | Auteur            | Notes                                                                         |
| ---------- | ------- | ----------------- | ----------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création — nouveau sous-PRD pour acter le moteur pricing dynamique requis V1. |
