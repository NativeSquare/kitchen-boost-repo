# Memories essentielles — Export pour session fresh

> **Date** : 2026-05-25
> **Pourquoi** : les memories Claude Code sont attachées à un project-id local (chemin de la conversation), pas au repo. Quand une session est spawnée dans un autre dossier, elle démarre sans memory. Ce fichier consolide les memories **techniques et produit** pertinentes pour le coding, dans un format versionnable.
> **Source** : `C:\Users\alexp\.claude\projects\c--Users-alexp-OneDrive-Bureau-projects-KitchenBoost\memory\` (machine Alex, au 2026-05-25)

⚠️ **Ce fichier ne contient PAS les memories marketing/sales/menu-creation** (terrain, BOGO, prompts photos, création de marques virtuelles, DA Pop Pink, SEO Uber Eats, etc.) qui sont sans impact sur le code de la plateforme KitchenBoost SaaS.

---

## 1. Modèle économique acté

**Source memory** : `feedback_kb_commission_model.md` (2026-05-21)

**Règle** : commission **2,00 € HT flat par commande** + frais Stripe (1,5 % + 0,25 €) en pass-through au resto via `on_behalf_of` du PaymentIntent Stripe Connect.

**Implication code** :
- Tout PaymentIntent (ou Checkout Session) via la PWA doit inclure :
  - `on_behalf_of: acct_resto`
  - `transfer_data.destination: acct_resto`
  - `application_fee_amount: 200` (en centimes TTC, soit 2,00 € HT × 1,20 TVA)
- **PAS de logique conditionnelle** dans le code pour calculer la commission selon le panier. C'est flat sur tous paniers (15 €, 50 €, 200 €).
- Le resto devient settlement merchant Stripe → Stripe prélève ses frais directement sur le compte resto, pas sur la plateforme KB.
- Le client voit le nom du resto sur son relevé bancaire (cohérent avec positionnement "KB invisible").

**Référence contrat** : Article 3 du contrat template (`docs/legal/contrat_template.md`) — 3.1 commission, 3.2 prélèvement Stripe, 3.3 transparence frais Stripe, 3.4 facturation hors PSP, 3.5 évolution.

**Comparatif** :
- Panier 25 € → resto reçoit 22,375 € (= 25 - 0,625 Stripe - 2 KB)
- Panier 50 € → resto reçoit 47,00 €
- Panier 100 € → resto reçoit 96,25 €
- Panier 200 € → resto reçoit 194,75 €

Cf. [docs/contexts/payment/CONTEXT.md](../contexts/payment/CONTEXT.md) et [PRD 30](../prd/30_paiement_stripe_connect.md) pour le contexte complet.

---

## 2. MOAT base clients = verrouillage contractuel + technique

**Source memory** : `feedback_db_clients_moat.md`

**Règle** : la base de données clients finaux constituée via la Plateforme KitchenBoost est l'actif différenciant exclusif KB. Aucun resto ne peut l'emporter à la résiliation.

**3 couches défensives contrat** (`docs/legal/contrat_template.md` Articles 2 ter + 5.4) :
- **2 ter.1** : KB = responsable de traitement RGPD (pas co-responsable) → KB seule définit finalités et moyens
- **2 ter.2** : Partenaire **aucun droit** sur la base (pas de propriété, pas d'accès acquis, pas d'exploitation autonome). Extraction / copie / agrégation hors Plateforme = strictement interdit
- **2 ter.3** : Base = actif propre exclusif KB, **titularité inchangée après résiliation**

**Implication code** (critique pour KB Admin frontend) :
- L'interface restaurateur **doit empêcher techniquement** (pas juste contractuellement) :
  - Export CSV / Excel de la liste clients → **AUCUN endpoint** ne doit retourner d'objet `customer` au rôle `kb_manager`
  - Copier-coller massif → pas de `<table>` sélectionnable en bloc côté KB Manager
  - Récupération via API publique → toutes les routes `customers.*` doivent throw si caller ∉ `kb_admin`
- Le resto peut consulter au cas par cas via l'UI, **c'est tout**
- V1 décision actée : **aucune liste individuelle côté KB Manager**, seulement KPI globaux agrégés (`aggregateCustomerKPIs(tenantId)`)
- Aucune feature "exporter ma base" même sur demande resto

**Test à écrire** : convention Convex assert que `paginationOpts.numItems ≤ 20` sur toutes queries touchant `customers` + helper réflexif qui scan les queries exportées et vérifie qu'aucune ne retourne d'objet `customer` brut au rôle `kb_manager`.

Cf. [docs/contexts/customer-data/CONTEXT.md](../contexts/customer-data/CONTEXT.md) + [ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md).

---

## 3. Architecture cuisine V1 = 2 interfaces obligatoires

**Source memory** : `feedback_tablette_uber_kiosk_vs_pwa.md` (2026-05-22)

**Constat architectural confirmé doc Uber Developer** : Uber Eats Orders (app native Android/iOS) **n'affiche PAS les cmds Uber Direct**. C'est architectural, pas une question de tablette.

**Pourquoi** :
- Uber Direct API ne reçoit jamais les détails de cmd cuisine (items, modifiers, instructions, allergènes). Elle ne connaît que les infos delivery (adresse pickup/dropoff, valeur colis, contact).
- POS Integration API d'Uber est **unidirectionnelle** : Uber Eats marketplace → POS marchand. Aucun mécanisme pour injecter une cmd externe (notre PWA) dans Uber Eats Orders.
- Même en devenant Integration Partner Uber, **KB ne peut pas** fusionner les 2 flux dans l'app native Uber Eats Orders.

**Implication code KB Orders** :
- KB Orders (app/native) gère **uniquement les cmds Uber Direct** (= cmds direct via PWA KB)
- Le resto continue d'utiliser **Uber Eats Orders** en parallèle pour les cmds Uber Eats marketplace
- Setup V1 = **BYOD 1 device** (tablette/smartphone perso du resto fait tourner les 2 apps cohabitent)
- Setup Phase 2 = **KDS tiers** (Deliverect ~100-150 €/mois) qui ingest les 2 flux en single inbox — argument commercial à 5-10 restos signés
- **Notification audio PWA KB** : son court ~1 s **distinct** du buzzer Uber Eats Orders pour que le resto ne confonde pas

Cf. [docs/contexts/kb-orders/CONTEXT.md](../contexts/kb-orders/CONTEXT.md) + [PRD 20](../prd/20_kb_orders.md) + [ADR 0009](../adr/0009-hubrise-reporte-v2.md) (V1 = 3 interfaces cuisine assumées car Hubrise V2).

---

## 4. Direction artistique produit

**Source memory** : `project_kitchenboost_phase1.md`

**Palette KitchenBoost** (apps web + admin + native + emails + Wallet pass) :
- Vert foncé : `#1B7A3D`
- Fond blanc
- Texte noir : `#111111`
- Accents jaune/or : `#E5A100`

**Logo** : typographique, "Kitchen" en noir + "Boost" en vert, sans-serif bold (Inter, Poppins ou Montserrat).

**Ton** : pro, concret, résultats. Pas de fioritures.

**Domaines** :
- `kitchen-boost.fr` (principal — sous-domaines tenants `<slug>.kitchen-boost.fr`)
- `kitchen-boost.com`
- `kitchen-boost.store`
- `kitchen-boost.org`

**Stockage** : à mettre dans `packages/shared/constants.ts` (déjà prévu par le template avec `APP_NAME`, `APP_DOMAIN`, etc.) + tokens Tailwind v4 dans chaque app.

---

## 5. Onboarding restaurateur — 5 phases

**Source memories** : `project_onboarding_process.md` + `reference_onboarding_resto.md`

**Process de vie restaurateur** structuré en 5 phases avec gates explicites entre phases :

| Phase | Code CRM | Quoi | Output |
|---|---|---|---|
| **A. Approche** | `contacté` | Visite repérage, qualification | Prospect dans CRM KB |
| **B. Closing** | `signé` | RDV signature contrat + 3 docs Uber (KBIS, ID, RIB) + canal de comm direct + liste articles + prix net cible | Contrat signé + docs uploadés |
| **B+. Préparation menu offline** | `en préparation` | Création marque virtuelle (skill `create-virtual-brand` offline, asynchrone) | Menu finalisé + tuto Uber Manager + DA + prompts photos |
| **C. Kickoff** | `lancé` | RDV mise en place tablette + setup Uber Manager validé + ouverture du store | Resto actif sur Uber Eats |
| **D. Opérationnel** | `actif` | Suivi hebdo + facturation 2 €/cmd, activation promo 1+1 post-boost (semaine 3+) | Récurrent |

**Gates explicites** (à coder dans KB Admin wizard) :
- **B → B+** : contrat signé physique + 3 docs Uber + canal de comm direct testé + liste articles + prix net cible validé + photos emballages
- **B+ → C** : menu.json complet + tuto Uber Manager + photos produites + hero banner uploadé + tablette pré-configurée + packaging MVP commandé/livré
- **C → D** : test commande end-to-end OK + resto formé sur Uber Orders + stock validé + premier déclenchement officiel Uber Manager
- **D activation promo 1+1** : boost auto Uber expiré (semaine 3+) + items éligibles identifiés + prix Uber bumpés alignement Gimmy

**Pipeline Kanban KB Admin** = 5 colonnes A / B / B+ / C / D + transitions validées par les gates.

Cf. [docs/plans/onboarding_restaurateur_process.md](../plans/onboarding_restaurateur_process.md) pour le détail opérationnel + [docs/contexts/kb-admin/CONTEXT.md](../contexts/kb-admin/CONTEXT.md).

---

## 6. Uber Direct — patterns techniques

**Source memories** : `reference_uber_direct_deep_dive.md` + `reference_uber_integration_partner.md` + `reference_alternatives_uber_direct.md`

**Décisions actées V1** :
- **Self-signup direct.uber.com par tenant** suffit V1 (1-5 restos). PAS d'Integration Partner Uber (programme commercial-only via direct-fr@uber.com, certif 3-6 mois) — à candidater à 8+ restos signés.
- **Stuart en fallback Phase 2** si Uber Direct down (DoorDash / Wolt / Just Eat / Lalamove **pas en FR**).
- **Bringg = orchestrateur recommandé** Phase 2 multi-courrier.
- KB **pas merchant of record livraison** (contractuel + technique).

**Docs sources complètes dans le repo** :
- [docs/research/uber_direct_deep_dive.md](../research/uber_direct_deep_dive.md) — API (OAuth2, webhooks, Organizations API), flow argent (5,90 € HT, Stripe Connect Express), patterns SaaS multi-tenant, concurrence FR
- [docs/research/alternatives_uber_direct.md](../research/alternatives_uber_direct.md) — 3 alternatives FR (Stuart #1, Deliveroo Signature, Yper)
- [docs/research/uber_integration_partner.md](../research/uber_integration_partner.md) — programme IP commercial-only
- [docs/plans/uber_direct_action_plan.md](../plans/uber_direct_action_plan.md) — roadmap 4 phases sur 14 jours pour V1 SaaS live

**8 open questions à valider call AM Uber FR** (cf. doc deep dive §11) — non bloquant code V1 mais à anticiper.

Cf. [docs/contexts/delivery/CONTEXT.md](../contexts/delivery/CONTEXT.md) + [PRD 40](../prd/40_livraison_uber_direct.md).

---

## 7. Web Push PWA — pattern technique

**Source memory** : `reference_web_push_pwa.md`

**Faisabilité confirmée** :
- **Android** : OUI sans condition
- **iOS** : OUI mais A2HS (Add to Home Screen) obligatoire (iOS 16.4+)

**Stack** :
- Lib npm : `web-push@3`
- VAPID keys self-host (générées au setup)
- Coût : **0 € jusqu'à 40K push/mois**
- F&B = top 2 CTR (catégorie qui convertit le plus en push)

**Implication code** :
- Tourne dans **Next.js API route runtime Node** (offload Convex action), cf. STACK.md §2.3
- Service Worker custom à écrire (`apps/web/public/sw.js`, ~80 lignes)
- Pas de `next-pwa` (mort), envisager `@serwist/next` si Workbox utile

Cf. doc complet [docs/research/web_push_pwa.md](../research/web_push_pwa.md) + [ADR 0002](../adr/0002-push-moat-dual-stack-wallet-a2hs.md).

---

## 8. Memories volontairement non exportées

Les memories suivantes existent dans le project Alex au 2026-05-25 mais **n'apportent rien au code** de la plateforme KitchenBoost SaaS. Si la session fresh en a besoin, demander à Alex de les charger explicitement.

| Memory | Pourquoi pas exportée |
|---|---|
| `feedback_sales_training.md`, `feedback_profil_prospects.md` | Coaching commercial Alex, hors code |
| `project_terrain_15avril.md`, `project_terrain_22avril.md` | Compte-rendus terrain prospection |
| `feedback_no_inventer_specs_resto.md` | Règle pour la création de marques virtuelles offline, pas pour le code SaaS |
| `feedback_no_modifier_parfum.md`, `feedback_format_output_menu.md` | Conventions de saisie menu Uber Eats Manager (offline), pas pour le code |
| `feedback_process_kickoff_resto.md`, `feedback_retro_creation_marque_virtuelle.md` | Process opérationnel Phase B+ (offline), pas pour le code |
| `project_emballages_neutres.md`, `feedback_packaging_livraison.md` | Stratégie packaging marque virtuelle (offline) |
| `feedback_seo_uber_eats.md`, `feedback_yanis_growth_hacks.md`, `feedback_da_pop_pink_hard_flash.md`, `feedback_da_aesop_baseline.md`, `feedback_descriptions_5_star_hook.md`, `feedback_hero_food_50pct.md`, `feedback_prompts_visual_reference.md`, `feedback_prompts_no_variables.md` | Tactiques marketing + direction artistique marques virtuelles (offline) |
| `feedback_winner_criteria.md`, `project_strategie_chaine_burger.md`, `feedback_uber_account_strategy.md`, `feedback_uber_pricing_tiers_fr.md`, `feedback_no_ia_uber_menu_setup.md` | Business strategy + opérationnel Uber Eats Manager (offline) |

---

## 9. Conseil pour la session fresh

Au démarrage, **ne pas tenter de tout absorber d'un coup**. Workflow recommandé :

1. Lire les §1-7 de ce fichier (~10 min)
2. Lire [STACK.md](../contexts/_architecture/STACK.md) + [WORKFLOW.md](../contexts/_architecture/WORKFLOW.md) en entier (~20 min)
3. Lire le CONTEXT.md + PRD du **chantier en cours**, pas tous les contextes
4. Lire les **ADRs référencés** par les docs ci-dessus (pas tous, seulement ceux cités)
5. Demander à Alex confirmation des prochaines étapes

Si tu as un doute sur une règle ou une décision passée, **demande à Alex** plutôt qu'inventer — la mémoire ne couvre pas tout.
