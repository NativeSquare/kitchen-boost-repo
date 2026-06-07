# 60 — Intégration Marketplaces (Hubrise)

**Statut** : 🔴 Reporté V2 · **Version** : 0.3 · **Dernière mise à jour** : 2026-05-24
**Lié au master** : [00_master.md § 5 bloc 7](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)
**ADR de référence** : [ADR 0009](../adr/0009-hubrise-reporte-v2.md)
**Recherche associée** : [Middleware aggregators HubRise/Deliverect/Uber Direct](../research/middleware_aggregators_hubrise_deliverect.md) ← **comparatif pricing 2026-06, programme partenaire white-label, leviers de négo, économie Phase 1**

> **v0.3** : ⚠️ **Décision actée 2026-05-24** — Hubrise **bascule V2** (cf. [ADR 0009](../adr/0009-hubrise-reporte-v2.md)). Le PRD 60 entier passe V2. Raison : dépendance externe non maîtrisée + négo réaliste avec entreprise FR établie pas envisageable Phase 1 + V1 = 1 resto pilote, ROI Hubrise négatif avant mutualisation, focus V1 sur le MOAT.

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | **Aucune intégration marketplace.** [[KB Orders]] traite uniquement les cmds [[Direct]] (PWA KB). Le resto continue à gérer Uber Eats sur sa tablette Uber Eats Orders + Deliveroo sur sa propre tablette. 3 interfaces cuisine acceptées V1 (cf. [feedback_tablette_uber_kiosk_vs_pwa.md](../../.claude/memory/feedback_tablette_uber_kiosk_vs_pwa.md)).                         |
| **V2**  | **Intégration Hubrise** pour récupérer cmds Uber Eats + Deliveroo dans [[KB Orders]]. Mapping menu KB ↔ menu marketplace. Affichage cmds avec icône source (direct / Uber Eats / Deliveroo). Activation par tenant via [[KB Admin]]. **Négo commerciale Hubrise déclenchée Phase 2** quand KB a 3-5 restos pour mutualiser. Plan B Deliverect (100-150 €/mois) si Hubrise refuse. |
| **V3**  | Mapping menu collaboratif avancé, sync auto menu KB → marketplace (push depuis dashboard resto), gestion refus/annulation marketplace via API Hubrise, stats unifiées par source. Intégration directe Uber Eats Marketplace API (sans intermédiaire Hubrise) si l'économie le justifie. Extension à d'autres marketplaces (Just Eat France, Snapfeast, etc.).                     |

## Hors scope V1

- **Aucune intégration marketplace V1** (cf. [ADR 0009](../adr/0009-hubrise-reporte-v2.md)). [[KB Orders]] traite uniquement les cmds direct.
- **3 interfaces cuisine V1 assumées** : KB Orders (cmds direct) + tablette Uber Eats Orders (cmds Uber Eats) + tablette Deliveroo (cmds Deliveroo le cas échéant).
- Pas de tag [[Source]] visible côté KDS V1 (toutes les cmds = direct par construction). Field DB préservé pour V2 (default `direct`).

## Hors scope V2

- Pas de modification du menu Uber Eats / Deliveroo depuis KB (le resto continue à les gérer dans leurs UIs propres). V3 peut envisager menu sync.
- Pas d'analytics cross-marketplace V2 (juste affichage cmds). V3 = stats unifiées.

## Personas concernés

- **Restaurateur** (gain de productivité : 1 seul écran cuisine au lieu de 3)
- **Cuisinier** (UX simplifiée)

## Surface fonctionnelle (sections à remplir)

### 1. Négociation commerciale Hubrise

- Pricing public : 30€/mois/location + 25€ setup
- Négocier : volume discount si KB onboarde N restos, ou revue de marge
- Évaluer alternative concurrent (Deliverect ~100-150€/mois, Innovorder)
- Décider si KB absorbe le coût (intégré dans 2€/cmd) ou le refacture (transparent au resto)

### 2. Onboarding Hubrise par tenant

- Le resto signe son propre contrat Hubrise (ou KB master, à voir négociation)
- KB intègre via OAuth Hubrise (1 fois côté plateforme)
- Liaison tenant KB ↔ location Hubrise

### 3. Mapping menu KB ↔ menu marketplace

- Le menu KB est la source de vérité côté direct
- Le menu Uber Eats / Deliveroo reste géré dans leurs UI (en V1/V2)
- Mapping items KB ↔ items marketplace (via SKU ou nom)
- V3 : sync auto du menu KB vers marketplace (push depuis KB Admin)

### 4. Réception cmds marketplace dans KDS

- Hubrise webhook → KB backend → KDS
- Cmds taggées par source (icône Uber Eats / Deliveroo / Direct)
- Workflow KDS identique : nouvelle / prep / prête / remise
- Pas de changement de statut renvoyé vers Hubrise V2 (lecture seule), V3 peut bi-directionnel

### 5. Refus / annulation cmd marketplace

- V2 : refus = signaler à Hubrise → Uber/Deliveroo gère l'annulation côté client
- Process différent du direct (KB ne refund pas, c'est Uber/Deliveroo qui le fait)

### 6. Statistiques unifiées (V2 basique, V3 complet)

- Volume cmds par source (direct vs Uber Eats vs Deliveroo)
- Comparaison CA net (direct ~95% vs Uber ~70%)
- Argument resto : "regardez combien le direct vous rapporte vs Uber"

## Flows nominaux

1. **Cmd Uber Eats arrive dans KDS unifié** : client commande sur Uber Eats → Uber → Hubrise → webhook KB → cmd s'affiche dans KDS avec icône orange "Uber Eats" → cuisinier traite comme une cmd direct.
2. **Cmd direct + cmd Uber Eats simultanées** : KDS affiche les 2 en parallèle, cuisinier peut prioriser. Pas de différence de workflow.

## Edge cases

- **Hubrise down** : cmds Uber Eats ne s'affichent pas dans KDS → resto doit retomber sur tablette Uber Eats Orders. Notif resto en cas de panne.
- **Menu désynchronisé** : item ajouté sur Uber Eats mais pas mappé KB → cmd arrive avec item "inconnu". Mitigation : fallback affichage texte brut.
- **Resto opt-out Hubrise** : continue de gérer Uber Eats sur tablette séparée. KB respecte le choix.
- **Hubrise cesse activité** : plan B = intégration directe Uber Eats Marketplace API (long mais faisable). V3.

## Critères de succès / acceptation

### V2

- [ ] 50%+ des restos KB opt-in Hubrise dans les 6 mois post-V2.
- [ ] Latence cmd marketplace → KDS : < 30 sec.
- [ ] 0 cmd marketplace "perdue" (toutes affichées dans KDS).
- [ ] Cuisinier ne distingue plus visuellement les cmds direct vs marketplace dans le workflow (sauf icône source).

### V3

- [ ] Sync menu auto KB → marketplaces opérationnel.

## Dépendances

| Dépendance                                         | Type    | Bloque quoi                      |
| -------------------------------------------------- | ------- | -------------------------------- |
| Hubrise API + contrat commercial                   | Externe | Tout                             |
| [20_kb_orders.md](20_kb_orders.md)                 | Interne | Affichage cmds dans KB Orders    |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md) | Interne | Configuration Hubrise par tenant |
| [70_kb_admin.md](70_kb_admin.md)                   | Interne | UI activation Hubrise par tenant |

## Open questions (toutes reportées V2)

| Q     | Question                                                                                               | Deadline               | Owner                          |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------ |
| 60-Q1 | Hubrise = contrat KB master ou resto direct ? Impact pricing négocié.                                  | V2 (avant intégration) | Alex — call commercial Hubrise |
| 60-Q2 | KB absorbe coût Hubrise (intégré dans 2€/cmd) ou refacture transparent ?                               | V2                     | Alex                           |
| 60-Q3 | Alternative Deliverect (100-150€/mois) à évaluer si Hubrise refuse / tarde ?                           | V2                     | Alex                           |
| 60-Q4 | V3 sync menu KB → Uber Eats / Deliveroo : effort vs ROI ?                                              | V3                     | À évaluer post-V2              |
| 60-Q5 | Gestion des cmds refusées (KB ne peut pas refund Uber, comment escalader le resto vers Uber support) ? | V2                     | Produit                        |

## Notes / décisions actées

- **Hubrise reporté V2** (cf. [ADR 0009](../adr/0009-hubrise-reporte-v2.md)) — négo réaliste avec entreprise FR établie pas envisageable Phase 1 + V1 = 1 resto pilote sans mutualisation possible.
- **V1 = 3 interfaces cuisine assumées** : KB Orders (direct) + tablette Uber Eats Orders + tablette Deliveroo. Pitch terrain doit mentionner agrégation V2 comme roadmap visible.
- **Hubrise = first choice** pour V2 (vs Deliverect plus cher, plan B activable si négo bloque).
- **Cf. [docs/research/uber_direct_deep_dive.md § 4](../research/uber_direct_deep_dive.md)** pour comparatif concurrence FR.
- **Cf. [feedback_tablette_uber_kiosk_vs_pwa.md](../../.claude/memory/feedback_tablette_uber_kiosk_vs_pwa.md)** : Uber Eats Orders app ne peut PAS afficher cmds Uber Direct, donc 2 interfaces obligatoires côté cuisine en V1 de toute façon (KB Orders + Uber Eats Orders). Hubrise V2 unifie.

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                |
| ---------- | ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création squelette.                                                                                                                                                                                                  |
| 2026-05-23 | 0.2     | Alex (via Claude) | **Changement majeur** : Hubrise passe en V1 (vs V2). Subject to négo commerciale Q13.                                                                                                                                |
| 2026-05-24 | 0.3     | Alex (via Claude) | **Décision actée [ADR 0009](../adr/0009-hubrise-reporte-v2.md) : Hubrise bascule V2.** PRD entièrement reporté V2. V1 = aucune intégration marketplace, 3 interfaces cuisine assumées. Q60-Q1 à Q60-Q5 reportées V2. |
