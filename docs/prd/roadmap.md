# Roadmap KitchenBoost — Exécution

**Statut** : ✅ Complet · **Version** : 2.0 · **Dernière mise à jour** : 2026-05-23

> **Changements v2.0** : alignement sur scope V1 étendu (12 blocs, cf. master § 5). Suppression des sprints d'1 semaine V1.A/V1.B. **Stratégie de release : soft-launch progressif** sur premier pilote Buns & Bao, avec checkpoints incrémentaux. V1 livré sur ~4 mois calendaires.

---

## Vision temporelle

| Horizon | Période | Objectif | Métrique de sortie |
|---------|---------|----------|--------------------|
| **Pré-V1 (S0)** | 2026-05-26 → 2026-06-02 (1 sem) | Lever les blockers externes, décisions stratégiques | Q1-Q5, Q7, Q8, Q13-Q16 répondues ; bootstrap dev |
| **V1 (soft-launch progressif)** | 2026-06-02 → 2026-09-30 (~4 mois) | 12 blocs fonctionnels en prod chez 3+ restos. Buns & Bao reçoit chaque livraison au fur et à mesure. | Definition of Done V1 atteinte (cf. § Critères de release) |
| **V2** | 2026-Q4 → 2027-Q1 (~3 mois) | Industrialisation : 30-50 restos, fallback Stuart, modules add-ons | 30+ tenants actifs, time-to-install < 7j |
| **V3** | 2027-Q2 → 2028 (en cours) | Croissance : captation client active, modules add-ons monétisables | Run rate > 50 K€/mois HT |

**Philosophie release V1** : pas d'attente de tout-ou-rien. Chaque feature est livrée en production sur Buns & Bao dès qu'elle est prête. Buns & Bao apprend pendant qu'on construit. Les checkpoints ci-dessous marquent des moments significatifs du soft-launch, mais ne sont pas des gates bloquantes.

---

## Pré-V1 — Sprint S0 (semaine du 2026-05-26)

**Objectif** : poser le cadre, lever les blockers externes critiques avant d'écrire la 1ère ligne de code applicative.

| Tâche | Owner | Statut | Deadline | Notes |
|-------|-------|--------|----------|-------|
| Validation PRD master + sous-PRDs critiques | Alex | 🟡 En cours | 2026-05-30 | Tu lis ce PRD, tu pousses des amendements |
| Call AM Uber Direct France (`direct-fr@uber.com`) | Alex | ⛔ À faire | 2026-05-30 | Lève Q1, Q2, Q3, Q4 du master § 10 |
| Call commercial Hubrise | Alex | ⛔ À faire | 2026-06-02 | Lève Q13 : contrat KB master ou resto direct + pricing négocié + faisabilité timing V1 |
| Décision Q5 (Stripe Connect KYC self-serve vs manuel) | Alex | ⛔ À faire | 2026-05-30 | Test en sandbox Stripe |
| Décision Q7 (custom domain : KB fournit ou resto achète) | Alex | ⛔ À faire | 2026-05-30 | Impacte UX onboarding |
| Décision Q8 (fallback iOS push : SMS Twilio ou email) | Alex | ⛔ À faire | 2026-05-30 | Impacte budget V1 |
| Décision Q15 (click & collect modulable par resto ou imposé) | Alex | ⛔ À faire | 2026-05-30 | Impacte UI dashboard resto |
| **PoC Stripe Customer cross-tenant** via Connect | Dev lead | ⛔ À faire | 2026-06-30 | Lève Q14. Si bloqué, fallback : carte sauvegardée intra-tenant V1 + cross-tenant V2 |
| Décision Q16 (stack app native — pas dans PRD, par dev lead) | Dev lead | ⛔ À faire | 2026-06-15 | Choix de stack + estimation effort |
| Bootstrap repo dev (séparé du repo "ops" actuel) | Dev lead | ⛔ À faire | 2026-06-02 | Stack à décider |
| Sandbox Stripe Connect + sandbox Uber Direct + sandbox Hubrise | Dev lead | ⛔ À faire | 2026-06-09 | Comptes test |

**Checkpoint S0** : Q1-Q5, Q7, Q8, Q13, Q15 répondues. Sandbox testables. PRD validé. Recap call Uber / Hubrise propagé en PRDs.

---

## V1 — Soft-launch progressif (juin → septembre 2026)

La V1 est livrée en **4 phases** thématiques. Chaque phase ajoute des blocs en production sur Buns & Bao. Ce n'est pas un découpage temporel strict — les phases peuvent se chevaucher si les équipes travaillent en parallèle.

### Phase 1 — Chemin critique commande (semaines 1-4)

**Objectif** : Buns & Bao peut prendre une commande payée et livrée (ou click & collect) end-to-end via PWA, sans intervention manuelle KB sur le live.

| Livrable | Sous-PRD | Notes |
|----------|----------|-------|
| Backend multi-tenant + RBAC fondations + DB schema | [50](50_multi_tenant_saas.md) | Tables : tenants, users (avec rôles), menus, items, modifiers, customers (global), orders, payments, push_subs |
| Provisioning d'un tenant (script CLI minimum + UI `KitchenBoost Admin` basique) | [50](50_multi_tenant_saas.md) + [70](70_kb_admin.md) | Crée row DB + sous-domaine `<slug>.kitchen-boost.fr` + lien Stripe Connect + user `kb_manager` + ligne `user_tenants` |
| Onboarding Stripe Connect Express via lien magique | [30](30_paiement_stripe_connect.md) | Direct charges, `application_fee_amount` TTC, sandbox testé |
| PWA Client Commande chemin nominal | [10](10_pwa_client_commande.md) | Menu, panier, checkout. Branding logo + couleur. Captation client minimale (email/tel/adresse + position géo). |
| Apple Pay / Google Pay dès Phase 1 | [30](30_paiement_stripe_connect.md) | Stripe Payment Element supporte nativement. UX fluide. |
| `KB Orders` app native iOS + Android — squelette workflow cmd | [20](20_kb_orders.md) | Workflow nouvelle → prep → prête → remise. Beep + flash. APNs + FCM. Mode tablette plein écran. |
| Création course Uber Direct au paiement validé | [40](40_livraison_uber_direct.md) | Self-signup Uber Direct par tenant. Webhook par tenant. |
| Mode click & collect alternatif | [40](40_livraison_uber_direct.md) | Toggle par resto dans config tenant. Client choisit "livraison" ou "à emporter" au checkout. |
| Notifs transactionnelles (push web client + email confirmation) | [80](80_notifications.md) | Resend pour email, web-push self-host pour push client. |
| Custom domain CNAME Vercel + SSL auto | [50](50_multi_tenant_saas.md) | Buns & Bao : `commander.bunsbao.fr` ou équivalent |
| QR code stickers imprimés livrés Buns & Bao | [10](10_pwa_client_commande.md) + onboarding process | 100 stickers min, posés dans les sacs Uber Eats du resto |

🎯 **Checkpoint 1** : **Buns & Bao prend sa 1ère vraie commande publique via la PWA KB**. Soft-launch friends & family 3-5 jours, puis go-live public. Cible : **2026-06-30** (environ).

### Phase 2 — KB Admin (vue KB Manager) + KB Orders + moteur pricing (semaines 4-10, en parallèle de Phase 1 si équipe permet)

**Objectif** : Khan (Buns & Bao) prend possession de son outil. Il édite son menu via `KitchenBoost Admin` (vue KB Manager), configure ses règles de pricing livraison, reçoit ses cmds sur `KB Orders` app native iOS/Android.

| Livrable | Sous-PRD | Notes |
|----------|----------|-------|
| `KitchenBoost Admin` — vue KB Manager — édition menu | [70](70_kb_admin.md) | Catégories, items, modifiers / personnalisations, prix, photos, disponibilité |
| `KitchenBoost Admin` — vue commandes + vue clients masqués | [70](70_kb_admin.md) + [90](90_donnees_clients_crm.md) | Cmds en cours + historique. Clients = ses propres + ceux KB lui partage (V1 manuel, V2 auto) |
| `KitchenBoost Admin` — statistiques basiques | [70](70_kb_admin.md) | CA, panier moyen, top items, heures de pointe |
| `KitchenBoost Admin` — génération QR code PDF | [70](70_kb_admin.md) | KB Manager DL son QR à volonté |
| **Moteur pricing dynamique** | [35](35_pricing_engine.md) | Modèle de règles : "si panier > X € livraison offerte", etc. Évaluation au checkout, transparent client. |
| `KitchenBoost Admin` — UI config moteur pricing | [70](70_kb_admin.md) | UI no-code pour configurer les règles |
| `KB Orders` app native iOS — features complètes | [20](20_kb_orders.md) | APNs, workflow cmd complet, modes livraison + click & collect, refus + refund auto |
| `KB Orders` app native Android — features complètes | [20](20_kb_orders.md) | Idem iOS, FCM pour push |
| RBAC : KB Manager = R/W sur tenants attachés (via `user_tenants`) | [50](50_multi_tenant_saas.md) | Khan ne voit que son tenant. Walid voit ses N tenants via switcher. |
| **Pipeline onboarding visuel + CRM + contrats** (côté KB Admin) | [70](70_kb_admin.md) | Phases A→D avec checklist, CRM cliquable, génération contrat via `tools/generate_contract.py` + Odoo signature |

🎯 **Checkpoint 2** : **Khan édite son menu sans aide KB depuis `KitchenBoost Admin`**. Cible : **2026-07-15**.
🎯 **Checkpoint 3** : **Khan reçoit ses cmds via `KB Orders` app native iOS+Android, push fiables**. Cible : **2026-07-31**.
🎯 **Checkpoint 4** : **Khan configure ses 1ères règles de pricing livraison** (ex: "livraison offerte si panier > 25€"). Cible : **2026-07-31**.

### Phase 3 — Agrégation marketplaces + marketing + carte cross-resto (semaines 8-14)

**Objectif** : Khan voit ses cmds Uber Eats unifiées avec ses cmds direct. Il lance ses 1ères campagnes push. Le 2e client de Buns & Bao utilise sa CB sauvegardée chez un autre resto KB.

| Livrable | Sous-PRD | Notes |
|----------|----------|-------|
| Hubrise OAuth + intégration cmds Uber Eats | [60](60_integration_marketplaces.md) | Cmds Uber Eats arrivent dans `KitchenBoost Admin` + `KB Orders`, taggées icône source |
| Hubrise — intégration cmds Deliveroo | [60](60_integration_marketplaces.md) | Idem Uber Eats |
| Push marketing déclenchable par KB Manager | [80](80_notifications.md) | `KitchenBoost Admin` → "Campagnes" → segment + template + envoyer (proxy KB) |
| Email marketing simple déclenchable | [80](80_notifications.md) | Template basique, envoyé via Resend |
| SMS fallback iOS (opt-in) | [80](80_notifications.md) | Pour users iOS sans push web opt-in. Via Twilio ou OVH SMS. |
| Segmentation simple clients (actifs / inactifs / VIP) | [90](90_donnees_clients_crm.md) | Critères : nb cmds, dernière cmd, panier moyen |
| **Carte sauvegardée cross-resto KB** (Stripe Customer cross-tenant) | [30](30_paiement_stripe_connect.md) | Un client qui paie chez Resto X peut utiliser sa CB chez Resto Y sans re-saisie. **Subject to Q14 PoC validation** |
| Base clients KB : partage manuel KB → resto | [90](90_donnees_clients_crm.md) | KB attribue un client de sa base à un resto. Argument commercial "on te ramène des clients". |
| Base clients KB : capture position géo enrichie | [90](90_donnees_clients_crm.md) | Lat/lng + adresse normalisée au signup PWA |
| Anti-extraction technique côté `KitchenBoost Admin` (vue KB Manager) | [70](70_kb_admin.md) + [90](90_donnees_clients_crm.md) | Pas d'export CSV, watermark, pagination limitée, audit log |

🎯 **Checkpoint 5** : **Khan voit toutes ses cmds (direct + Uber Eats + Deliveroo) dans un seul écran**. Cible : **2026-08-15**.
🎯 **Checkpoint 6** : **Khan lance sa 1ère campagne push marketing**. Cible : **2026-08-31**.
🎯 **Checkpoint 7** : **2e client utilise sa CB sauvegardée chez un autre resto KB sans re-saisie**. Cible : **2026-09-15**.

### Phase 4 — Industrialisation V1 + 2 nouveaux restos (semaines 12-17)

**Objectif** : Buns & Bao tourne stable. On installe les 2 autres restos signés (Eline + Thai Street) via le wizard admin KB. La definition of done V1 est atteinte.

| Livrable | Sous-PRD | Notes |
|----------|----------|-------|
| Wizard `KitchenBoost Admin` outillé (création tenant en < 30 min) | [70](70_kb_admin.md) | Form Stripe Connect, génération domain, import menu, QR sticker PDF, création user KB Manager, activation |
| Onboarding Eline (japonais-falguiere) | Process opérationnel | Cf. [docs/plans/onboarding_restaurateur_process.md](../plans/onboarding_restaurateur_process.md) |
| Onboarding Thai Street Saint Michel | Process opérationnel | Idem |
| Monitoring fiabilisé (Sentry, UptimeRobot, dashboards Grafana par tenant) | [50](50_multi_tenant_saas.md) + [70](70_kb_admin.md) | Alertes Slack sur incidents |
| Tests automatisés chemin critique end-to-end | [50](50_multi_tenant_saas.md) | Cypress/Playwright |
| Tests cross-tenant fuite (audit manuel + automatisé) | [50](50_multi_tenant_saas.md) | 2 tenants créés, vérification 0 fuite via API et UI |
| Audit log V1 (qui a fait quoi sur quel tenant) | [70](70_kb_admin.md) | Conservation 3 ans RGPD |

🎯 **Definition of Done V1** : 3 restos en prod, 200+ cmds/sem cumulées via Plateforme KB, métriques V1 atteintes. Cible : **2026-09-30**.

### V1 — Dépendances externes critiques (vue d'ensemble)

| Dépendance | Bloque quoi | Mitigation si retard |
|------------|-------------|----------------------|
| Réponses call AM Uber (Q1-Q4) | Précision pricing resto, webhook architecture | Démarrer Phase 1 sur tarif public 5,90€ HT + webhook par resto. Ajuster post-call. |
| Validation Stripe Connect du resto pilote | Phase 1 onboarding | Buns & Bao a déjà signé contrat + KYC simple resto FR. Risque faible. |
| **Négo commerciale Hubrise** | Phase 3 (agrégation marketplaces V1) | Si refus / pricing prohibitif : reporter Hubrise en V2 + acter dans PRD. Buns & Bao continue à gérer Uber Eats sur tablette séparée jusqu'à V2. |
| **PoC Stripe Customer cross-tenant** | Phase 3 (carte sauvegardée cross-resto) | Si bloqué technique : carte sauvegardée intra-tenant V1 + cross-tenant V2. Acter dans PRD. |
| Couverture Uber Direct sur Paris 19e (Buns & Bao) | Phase 1 livraison | Vérifier en S0 via API quote test. Si refus, **click & collect en fallback V1**. |
| `KB Orders` iOS App Store review | Phase 2 | Soumettre tôt (semaine 6-7 max), prévoir 1-2 sem review Apple. TestFlight en interne pendant ce temps. |
| Validation Stripe pour Apple Pay merchant cert | Phase 1 | À demander en sandbox dès S0 |

---

## V2 — Industrialisation (Q4 2026 → Q1 2027)

### Phase V2.A — Industrialisation onboarding (4 semaines)

- Wizard public self-serve resto (form public + Stripe Connect auto + activation pending review KB).
- Tests automatisés extension (couverture 80%+).
- Audit log RGPD complet par tenant.
- ~~Multi-utilisateur par tenant~~ → **base déplacée en V1** (rôles `kb_manager` + `staff` per-tenant, cf. PRD 50 / 50-Q6). V2.A garde la **granularité fine** (sous-rôles staff cuisine / staff caisse) + invites avancées.

### Phase V2.B — Fallback livraison Stuart (3 semaines)

- Intégration Stuart API.
- Logique de routing : Uber Direct si dispo + quote acceptable, sinon Stuart, sinon notif client "livraison non dispo" + suggestion click & collect.
- Activable par tenant.

### Phase V2.C — Modules add-ons (5 semaines)

- Module loyauté complet (points configurables par resto, paliers, déclencheurs).
- Module réservation (1-click activation, table booking).
- Module Factur-X (deadline obligatoire sept 2026, à anticiper).
- Marketing automation avancée (triggers comportementaux : anniversaire, panier abandonné, etc.).
- Analytics avancées (LTV, cohortes, A/B testing).

### Gate V2 → V3

- 30+ tenants actifs.
- Time-to-install médian < 7j.
- Run rate revenu > 15 K€/mois HT.
- Churn 3 mois < 10%.

---

## V3 — Croissance (Q2 2027 → 2028)

À détailler dans un PRD V3 dédié, à écrire après release V2. Direction esquissée :

- **Captation client active** : SEO local par resto, Google Ads, partenariats micro-influenceurs locaux, push promo géolocalisé.
- **Multi-langue + multi-pays** (TVA, devises, conformité par pays).
- **Livraison propre KB** : flotte coursiers indépendants ou partenariat flotte logistique.
- **Intégration directe Uber Eats / Deliveroo** sans intermédiaire Hubrise (si l'économie le justifie).
- **App mobile client final natif** (si métriques PWA insuffisantes).

---

## Calendrier high-level (vue mensuelle)

```
        2026                                       | 2027
  Mai Jun Jul Aoû Sep Oct Nov Déc                  | Jan Fév Mar Avr ...
  S0  ────                                         |
      Phase 1 (chemin critique cmd)                |
          ▲ Checkpoint 1 : 1ère cmd publique B&B   |
          Phase 2 (KB Admin vue KB Manager + KB Orders + pricing)
              ▲ C2 menu  ▲ C3 KB Orders  ▲ C4 pricing |
                  Phase 3 (marketplaces + marketing)
                      ▲ C5 ag  ▲ C6 push  ▲ C7 cross-CB
                          Phase 4 (industrialisation + 2 restos)
                              ▲ DOD V1 (3 restos prod)
                                  V2.A V2.B V2.C  |
                                                  | V3.A captation client →
                                                  | V3.B modules add-ons →
```

---

## Critères de release par horizon (definitions of done)

### Definition of Done — V1
- [ ] 3+ restos installés en production (Buns & Bao + Eline + Thai Street au moins)
- [ ] Tous les 10 blocs fonctionnels opérationnels (cf. master § 5)
- [ ] 200+ commandes/sem cumulées via Plateforme KB en heures pleines
- [ ] Apple Pay/Google Pay actifs sur 100% des transactions
- [ ] Carte sauvegardée cross-resto fonctionnelle (subject to Q14 PoC ; sinon documenter le report en V2)
- [ ] Hubrise opérationnel chez au moins 1 resto (Uber Eats + Deliveroo cmds visibles)
- [ ] Moteur pricing dynamique : chaque resto a configuré au moins 1 règle
- [ ] `KB Orders` app native iOS+Android déployée App Store + Play Store
- [ ] 0 fuite cross-tenant testée par audit (automatisé + manuel)
- [ ] PWA installable A2HS iOS 16.4+ et Android
- [ ] Uptime 99% mesuré sur 30j post-go-live Buns & Bao
- [ ] Push APNs/FCM fiabilité > 95%
- [ ] Latence cmd → notif resto < 5 sec
- [ ] Documentation onboarding resto à jour
- [ ] Hotline support 24h Alex + dev lead sur 14j post-Checkpoint 1

### Definition of Done — V2
- [ ] 30+ tenants actifs en production
- [ ] Wizard self-serve resto opérationnel
- [ ] Stuart fallback testé sur 5+ livraisons réelles
- [ ] Modules loyauté + réservation + Factur-X déployés
- [ ] Marketing automation avancée déployée
- [ ] Tests automatisés couvrent 80%+ du chemin critique

### Definition of Done — V3
À définir dans PRD V3.

---

## Risques de planning (V1)

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Phase 1 sous-estimée (multi-tenant + Stripe + Uber Direct + click & collect) | Moyenne | Décale Checkpoint 1 de 1-2 sem | Découpler en livraisons hebdomadaires, soft-launch dès qu'un sous-ensemble est prêt (ex: PWA + Stripe + click & collect d'abord, Uber Direct ensuite) |
| Phase 2 (`KB Orders` app native iOS+Android) glisse (App Store review, complexité) | Élevée | Décale Checkpoint 3 de 2-3 sem | Démarrer la soumission App Store tôt (semaine 6). En attendant, `KitchenBoost Admin` web reste utilisable depuis tablette pour traiter les cmds (mode dégradé). |
| Négo Hubrise échoue ou pricing prohibitif | Moyenne | Phase 3 partielle (sans agrégation marketplaces) | Reporter Hubrise en V2 + documenter dans PRD. Buns & Bao gère Uber Eats sur tablette séparée jusqu'à V2. |
| PoC Stripe Customer cross-tenant impossible | Moyenne | Checkpoint 7 pas atteignable V1 | Reporter carte cross-resto en V2 + documenter. V1 garde Apple Pay/Google Pay + carte sauvegardée intra-tenant. |
| Bug critique post-Checkpoint 1 Buns & Bao | Moyenne | Image marque KB chez 1er resto pilote | Soft launch friends & family, Alex sur place J-day Checkpoint 1, hotline 24h, possibilité de revenir en arrière sur la feature buggée |
| Dev lead non recruté à temps | Moyenne | V1 démarre tard | Faire dev V1 via pipeline IA agentique NativeSquare (déjà 15K€/mois CA Upwork validé) + 1 dev senior |
| Multi-tenant mal conçu en Phase 1 → refonte coûteuse | Moyenne | 2-3 sem de tech debt | Le sous-PRD [50](50_multi_tenant_saas.md) est prioritaire et doit être robuste dès la 1ère semaine de Phase 1 |
| Resto pilote (Buns & Bao) annule/retarde | Faible | Décalage Checkpoint 1 | Fallback : démarrer Phase 1 sur Eline (japonais-falguiere) qui est aussi signé |
| Scope V1 trop large → on essaye de tout livrer en parallèle et rien n'est fini | **Critique** | DOD V1 jamais atteinte | Discipline sur les checkpoints. Si une phase glisse, arbitrer : prioriser ce qui débloque Buns & Bao en prod vs ce qui peut attendre. |

---

## Tracker des checkpoints (à updater au fil de l'exécution)

| Checkpoint | Cible date | Date réelle | Statut | Notes |
|------------|-----------|-------------|--------|-------|
| S0 — gates débloquées | 2026-06-02 | — | ⛔ Pas démarré | |
| 1 — 1ère cmd publique Buns & Bao | 2026-06-30 | — | ⛔ | |
| 2 — Khan édite son menu via `KitchenBoost Admin` (vue KB Manager) | 2026-07-15 | — | ⛔ | |
| 3 — Khan reçoit cmds via `KB Orders` app native iOS+Android | 2026-07-31 | — | ⛔ | |
| 4 — Khan configure 1ères règles pricing | 2026-07-31 | — | ⛔ | |
| 5 — Khan voit cmds direct + Uber Eats + Deliveroo unifiées | 2026-08-15 | — | ⛔ | |
| 6 — 1ère campagne push marketing | 2026-08-31 | — | ⛔ | |
| 7 — 2e client utilise CB sauvegardée chez 2e resto KB | 2026-09-15 | — | ⛔ | |
| DOD V1 | 2026-09-30 | — | ⛔ | 3 restos en prod, métriques atteintes |

---

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 1.0 | Alex (via Claude) | Création initiale — V1 4 sprints semaine, V2 13 semaines. |
| 2026-05-23 | 2.0 | Alex (via Claude) | Révision majeure : suppression V1.A/V1.B figés, adoption soft-launch progressif sur ~4 mois avec 7 checkpoints. Alignement sur scope V1 étendu (12 blocs). Ajout Phase 2 (dashboard + app native) et Phase 3 (Hubrise + marketing + cross-CB). Risques planning étendus. |
| 2026-05-23 | 2.1 | Alex (via Claude) | Refonte sémantique : 12 → 10 blocs (fusion KDS+native → `KB Orders`, fusion Dashboard Resto+Admin → `KitchenBoost Admin`). Mise à jour cross-refs partout. Ajout pipeline onboarding + CRM + contrats en Phase 2. |
