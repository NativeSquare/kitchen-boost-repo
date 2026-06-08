# 75 — Dashboard Resto Web (équivalent Uber Manager MVP)

**Statut** : 🟡 Squelette · **Version** : 0.1 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 9](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | UI web par resto (accessible via `manager.<slug>.kitchen-boost.com` ou `kitchen-boost.com/manager` avec auth) : édition menu (catégories/items/modifiers/prix/photos/disponibilité/upsell), vue cmds en cours et historique, vue clients (siens + ceux KB partagés), campagnes marketing simples (push + email), configuration moteur pricing livraison, génération QR code PDF, statistiques basiques. RBAC : owner resto = R/W. |
| **V2**  | Multi-utilisateur par tenant (owner / manager / staff caisse / staff cuisine), édition menu collaborative, A/B testing campagnes, analytics avancées (LTV, cohortes), modération reviews, import menu en bulk (CSV / parse Uber Eats Manager).                                                                                                                                                                                    |
| **V3**  | API publique pour resto (export programmable), intégrations tierces (Google Business Profile sync, Instagram catalog sync), recommandations basées ML.                                                                                                                                                                                                                                                                            |

## Hors scope

- POS caisse / encaissement en salle.
- Comptabilité (juste export CSV).
- Gestion stock / approvisionnement / fournisseurs.
- Gestion RH / planning équipe.
- Recettes / fiches techniques cuisine.
- Export brut clients pour le resto (JAMAIS — c'est le moat KB).

## Personas concernés

- **Restaurateur** (owner resto, primaire — utilise le dashboard ~30 min/jour pour gérer son business)
- **Manager / staff resto** (V2 — accès limité selon rôle)
- **Admin KB** (peut accéder via impersonation pour assister)

## Surface fonctionnelle (sections à remplir)

### 1. Auth + RBAC

- Login email + password + 2FA (V1)
- 1 owner par tenant V1 (multi-user V2)
- Magic link login (sans password) en alternative — V2
- Admin KB peut "impersonate" un resto pour assistance (audit log obligatoire)

### 2. Dashboard home (vue d'ensemble)

- KPIs jour : CA total, nb cmds, panier moyen, cmds en cours
- Source des cmds (V1 direct only, V1 étendu : direct + Uber Eats + Deliveroo via Hubrise)
- Statut resto (ouvert / fermé / pause)
- Alertes (cmd en attente refus, stock bas — V2)

### 3. Édition menu

- Vue arborescente : catégories → items → modifiers
- CRUD complet :
  - Catégories : nom, ordre d'affichage, icône
  - Items : nom, description, prix HT/TTC, photo (upload), disponibilité (toggle out of stock), tags (végé, vegan, allergènes), modifiers liés
  - Modifiers : nom, type (single/multi choice), required/optional, options (avec prix delta)
- **Logique upsell** : suggestions cross-sell sur item (ex: "client commande un burger → suggérer side fries et boisson"), modifiers populaires mis en avant
- Versioning : historique modifs, rollback possible — V2
- Preview : visualiser comment l'item s'affiche dans la PWA client avant publication
- Drag & drop pour réordonner

### 4. Vue commandes

- Liste cmds en cours (live update via SSE/WebSocket) : statuts, items, total, courier ETA
- Historique cmds (paginé, filtrable par date / statut / source)
- Détail cmd : récap complet, possibilité de refund (V1 total, V2 partiel)
- Source taggée (icône direct / Uber Eats / Deliveroo via Hubrise)
- Export CSV cmds (pour comptable, V1)

### 5. Vue clients

- **Liste paginée** des clients du resto (max 20 par page)
- Clients = ses propres clients (ayant commandé chez lui) + ceux que KB lui a partagés (V1 partage manuel par KB, V2 partage automatique selon proximité géo)
- Colonnes : prénom, dernière cmd, nb cmds, panier moyen, segment (actif / inactif / VIP)
- **PAS de téléphone ni email visibles en clair** (V1 = visualisation, V2 = communication via KB)
- **PAS de bouton "Exporter CSV"** des clients (JAMAIS — c'est le moat)
- Anti-scraping : pas de sélection en bloc, pas de copy massive
- Filtres : segment, période d'activité, source de captation (organique / KB partage)
- Audit log : chaque consultation est loggée (RGPD + traçabilité)

### 6. Campagnes marketing

- Créer campagne :
  - Type : push ou email (V1)
  - Segment : actifs / inactifs / VIP / tous (V1 simple, V2 critères fins)
  - Template : titre + corps + lien (ex: vers item promo, vers menu, vers page resto)
  - Schedule : envoyer maintenant ou plus tard (V1 envoyer maintenant only, V2 schedule)
- Preview avant envoi
- Quotas : 3 push marketing/sem/client max (anti-spam), illimité email
- Stats post-envoi : envoyés / ouverts / cliqués / convertis (cmds résultantes)
- Pas d'accès brut aux coordonnées clients — KB envoie en proxy

### 7. Configuration moteur pricing livraison

- UI no-code pour configurer les règles (cf. [35_pricing_engine.md](35_pricing_engine.md) section 2)
- Liste règles avec drag & drop pour priorité
- Activate/Deactivate par règle
- Simulator V2 : "Si client X commande Y €, voilà ce qui se passe"

### 8. Génération QR code

- Bouton "Télécharger mon QR code"
- Génère un PDF imprimable avec :
  - QR code haute résolution (1 ou plusieurs, ex: format sticker 50mm)
  - URL en clair (fallback texte)
  - Branding resto (logo + couleur)
- Multiples templates : sticker rond, format A6 carte, format A4 affiche

### 9. Paramètres resto

- Édition infos : nom, adresse, téléphone, horaires d'ouverture
- Branding : upload logo, color picker primaire (reflété en PWA et dashboard)
- Modes acceptés : livraison (toggle) + click & collect (toggle)
- Zone livraison : automatiquement gérée par Uber Direct, affichage informatif
- Notifications : config DNT (do not disturb) heures, fallback SMS opt-in

### 10. Intégrations

- Statut Stripe Connect (connecté / pending / disabled) + bouton "ré-authentifier"
- Statut Uber Direct (configuré ou non)
- Statut Hubrise (configuré ou non, activable depuis ici en V1)

### 11. Statistiques basiques (V1)

- CA total / mois (graph)
- Nb cmds / jour
- Panier moyen
- Top 5 items vendus
- Heures de pointe
- Taux conversion PWA (visites → cmds)
- Comparatif CA direct vs Uber Eats / Deliveroo (V1 avec Hubrise)

### 12. Support / aide

- Lien chat support KB (Slack ou Intercom V2)
- FAQ
- Lien vers son contrat KB (PDF)
- Bouton "Contacter mon CSM KB" (Alex en V1)

## Flows nominaux

1. **Khan édite son menu** : login dashboard → "Menu" → ajoute catégorie "Smashs" → ajoute item "Smash Triple" 14€ → upload photo → ajoute modifier "Steaks (1/2/3/4)" → save → publié en PWA en < 30 sec.
2. **Khan configure une règle pricing** : login → "Pricing livraison" → "Nouvelle règle" → condition "panier >= 25€" → action "livraison offerte" → save.
3. **Khan lance une campagne push** : login → "Campagnes" → segment "Inactifs 30j" → template "On vous a manqué, -20% sur votre prochaine cmd" → preview → envoyer → 150 push envoyés → 45 ouverts → 8 cmds générées.
4. **Khan voit ses clients partagés par KB** : login → "Clients" → filtre "Source : partagé par KB" → 12 clients listés (sans tel/email visibles) → KB lui a donné cette liste lors du onboarding pour bootstrap son acquisition.
5. **Khan DL son QR code** : login → "QR code" → choisit format sticker → bouton "Télécharger PDF" → impression → colle dans sacs Uber Eats.

## Edge cases

- **Resto édite menu pendant qu'un client est en train de commander** : la cmd capture le menu au moment du panier (snapshot). Edit prend effet sur les futures cmds.
- **Resto désactive un item en stock pendant cmd en cours** : la cmd existante reste valide. Future visualisation PWA = item out of stock.
- **Photo upload trop lourde** : auto-resize backend, max 2 Mo.
- **Resto veut supprimer un client** : refus systématique. C'est un client KB. Lui expliquer qu'il peut juste ne pas le solliciter.
- **2 owners éditent le menu en concurrent** (V2 multi-user) : optimistic locking, message si conflit.
- **Resto change de couleur primaire**: prévisualisation avant validation pour éviter coquille.
- **Resto inactif 60 jours** : tenant non suspendu mais alerte ops + relance par CSM.

## Critères de succès / acceptation

### V1

- [ ] Khan édite son menu et publie sans assistance KB en < 5 min pour 1 item.
- [ ] Configuration d'1 règle pricing en < 3 min.
- [ ] Génération QR PDF en < 10 sec.
- [ ] 0 fuite cross-tenant testée (Khan ne voit jamais les clients d'un autre resto).
- [ ] RBAC respecté : owner Khan ne peut pas modifier le tenant d'un autre resto.
- [ ] Dashboard responsive desktop + tablette + mobile (consultation au moins).
- [ ] Latence édition menu → propagation PWA : < 30 sec.

### V2

- [ ] Multi-user par tenant fonctionnel + audit log granulaire.
- [ ] Import menu CSV opérationnel.
- [ ] A/B testing campagnes déployé.

## Dépendances

| Dépendance                                                       | Type    | Bloque quoi                                     |
| ---------------------------------------------------------------- | ------- | ----------------------------------------------- |
| [10_pwa_client_commande.md](10_pwa_client_commande.md)           | Interne | Édition menu propagée en PWA                    |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md)   | Interne | Refunds + statut Stripe affiché                 |
| [35_pricing_engine.md](35_pricing_engine.md)                     | Interne | UI configuration règles (section 7)             |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md)       | Interne | Statut intégration affichée                     |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)               | Interne | RBAC + scope tenant                             |
| [60_integration_marketplaces.md](60_integration_marketplaces.md) | Interne | Activation Hubrise + affichage cmds marketplace |
| [80_notifications.md](80_notifications.md)                       | Interne | Section 6 campagnes                             |
| [90_donnees_clients_crm.md](90_donnees_clients_crm.md)           | Interne | Section 5 vue clients (avec restrictions moat)  |

## Open questions

| Q     | Question                                                                                           | Deadline | Owner        |
| ----- | -------------------------------------------------------------------------------------------------- | -------- | ------------ |
| 75-Q1 | URL dashboard : `manager.<slug>.kb.fr` (sous-domaine par tenant) ou `kb.fr/manager` (URL unique) ? | V1       | Produit + UX |
| 75-Q2 | Stack frontend : Next.js / SvelteKit / Remix ? (décision dev lead, pas PRD)                        | V1 S0    | Dev lead     |
| 75-Q3 | Multi-user par tenant V1 ou V2 ? V1 = 1 owner login par resto.                                     | V1       | Alex         |
| 75-Q4 | Édition menu temps réel collaborative ou bloquante (V2) ?                                          | V2       | Produit      |
| 75-Q5 | Import menu Uber Eats Manager : screenshot OCR ou manual ?                                         | V2       | Produit      |
| 75-Q6 | Logique upsell V1 : configurable manuellement par resto OU auto-suggérée par KB ?                  | V1       | Produit      |
| 75-Q7 | KB peut-il modifier le menu d'un resto sans l'avertir (assistance) ou il faut son OK ?             | V1       | Alex + legal |
| 75-Q8 | Statistiques V1 : juste tableaux ou graphs visuels ?                                               | V1       | Produit      |

## Notes / décisions actées

- **Dashboard resto ≠ Admin KB**. RBAC strict : owner resto = son tenant, admin KB = tous tenants.
- **Le resto ne peut JAMAIS exporter sa base clients** (Article 2 ter contrat). UI visualisation seule.
- **KB peut partager des clients de sa base à un resto** (argument commercial). V1 = partage manuel par KB (depuis admin KB), V2 = partage auto selon règles.
- **Logique upsell** = différenciation forte vs Uber Eats. À soigner UX.

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                      |
| ---------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création — nouveau sous-PRD pour acter le dashboard resto V1 (équivalent Uber Manager MVP). Séparé du 70_admin_backoffice_kb (admin KB ≠ dashboard resto). |
