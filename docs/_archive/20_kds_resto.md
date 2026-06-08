# 20 — KDS Resto (Kitchen Display System)

**Statut** : 🟡 Squelette · **Version** : 0.2 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 2](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.2** : Scope V1 étendu suite révision master v2.0. KDS tablette = **alternative** à l'app native resto (cf. [76](76_app_native_resto.md)), pas la seule interface cuisine. Agrégation marketplaces (Hubrise) **dès V1**. Mode click & collect **dès V1**.

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1**  | Liste cmds en cours, workflow nouvelle/prep/prête/remise courier OU remise client (click & collect), notif audio+visuelle, refus cmd avec refund auto Stripe, statut horaires/pause resto, **affichage cmds direct + Uber Eats + Deliveroo via Hubrise**, **mode click & collect**, source taggée. PWA standalone sur tablette. Cohabite avec [76 App Native Resto](76_app_native_resto.md) — le resto choisit l'un, l'autre, ou les deux. |
| **V2**  | Auto-refus si cuisine saturée (threshold configurable), stats temps réel KDS, multi-poste basique.                                                                                                                                                                                                                                                                                                                                         |
| **V3**  | Multi-poste avancé (cuisine vs comptoir vs livreur), routing items par poste, intégration imprimante thermique CloudPRNT primaire (cf. [docs/research/kitchen_notification_solutions.md](../research/kitchen_notification_solutions.md)).                                                                                                                                                                                                  |

## Hors scope (même si demandé)

- POS caisse / encaissement en salle.
- Gestion stock / approvisionnement.
- Gestion planning équipe / RH.
- Recettes / fiches techniques cuisine.

## Personas concernés

- **Cuisinier / personnel de service** (primaire — cf. [00_master.md § 3.3](00_master.md#33-cuisinier--personnel-de-service-utilisateur-opérationnel))
- **Restaurateur** (supervisorial — peut accéder pour debug ou stats simples)

## Surface fonctionnelle (sections à remplir)

### 1. Accès et auth

- URL `kds.kitchen-boost.com/<tenant>` ou domaine custom
- Auth simple : code PIN par resto (V1) ou login resto (V2)
- Lock screen après inactivité 30 min (config)

### 2. Vue principale "commandes en cours"

- Cards commandes ordonnées par horodatage (plus récente en haut)
- Pour chaque card : ID cmd, items, modifiers, total, ETA livraison, statut courier
- Couleurs / icônes par source (V2 : direct vs Uber Eats vs Deliveroo)
- Badge "nouvelle" non lu (compte les non-acknowledged)

### 3. Workflow commande (état machine)

```
[nouvelle]  → bouton "Accepter / Préparer" → [en préparation]
[en prep]   → bouton "Prête"                → [prête]
[prête]     → bouton "Remise au coursier"   → [remise]
[remise]    → courier en route, suivi auto via Uber Direct webhooks
[livrée]    → fade out de la liste (archivée)
```

### 4. Notification audio + visuelle

- Beep audible (configurable) à chaque nouvelle cmd
- Beep en boucle 30s si non acknowledged
- Badge rouge + couleur de fond card
- Vibration tablette (si supporté)

### 5. Refus / annulation cmd

- Bouton "Refuser" sur card nouvelle (raison : rupture / fermeture / surcharge)
- Trigger refund Stripe automatique
- Notif client (push + email) avec motif
- Log dans audit trail (cf. [70_admin_backoffice_kb.md](70_admin_backoffice_kb.md))

### 6. Statut resto / horaires

- Toggle "ouvert / fermé / pause"
- Affichage prochaine ouverture si fermé
- "Pause exceptionnelle" avec ETA reprise (15 min, 30 min, 1h)
- Impact PWA client : checkout désactivé pendant fermé/pause

### 7. Détail cmd (modal)

- Récap complet : items, modifiers, notes client, adresse livraison
- Téléphone client (visible mais pas exportable)
- Téléphone courier (visible quand assigné)
- Historique statuts horodaté

### 8. V2 : auto-refus si surcharge cuisine

- Threshold configurable (ex: max 8 cmds en cours)
- Bouton "pause auto" qui suspend acceptation cmds 15 min
- Auto-pause si X refus consécutifs

### 9. V3 : multi-poste cuisine

- Routing items par poste (entrée / plat / dessert)
- Vue cuisine vs vue comptoir
- Ticket print thermique CloudPRNT optionnel

## Flows nominaux

1. **Cmd nouvelle reçue** : cmd arrive → beep + flash → cuisinier tap "Accepter" → état = en prep → cuisinier prépare → tap "Prête" → état = prête → courier arrive → cuisinier tap "Remise" → état = remise → suivi courier auto.
2. **Cmd refusée pour rupture** : cmd arrive → cuisinier tap "Refuser" → choisit raison "rupture stock" → confirme → refund Stripe auto + push client "désolé, rupture, vous êtes remboursé".
3. **Resto met en pause exceptionnelle** : gérant tap "Pause" → choisit "30 min" → PWA client affiche bandeau "Resto en pause, reprise à HH:MM" → checkout désactivé → après 30 min, état revient à "ouvert" auto.

## Edge cases

- **Tablette perdue / battery dead** : SMS fallback vers tel resto pour cmds urgentes (V2). En V1, monitoring envoie alerte Alex.
- **Courier Uber Direct ne se présente pas** : statut bloque à "prête", timeout 20 min, escalade auto (Stuart V2 ou notif client de retard).
- **Internet coupé en cuisine** : tablette met en cache cmds reçues, sync au retour. Mais nouvelles cmds peuvent ne pas arriver si webhook côté backend perdu (à mitiger : polling fallback).
- **Multiple tablettes par resto** (V2/V3) : synchronisation des statuts en temps réel (pessimistic locking via DB).
- **Cmd modifiée par client après envoi** (V3) : pas autorisé en V1, mais à anticiper.
- **Notif sonore désactivée par OS** : alerter resto via banner persistant + email backup.

## Critères de succès / acceptation

### V1

- [ ] Cmd nouvelle apparaît sur KDS en moins de 5 sec après paiement validé.
- [ ] Beep audible à 5m de distance (volume tablette).
- [ ] Workflow complet en moins de 5 taps : Accepter → Prête → Remise.
- [ ] Refus cmd déclenche refund Stripe en moins de 30 sec.
- [ ] 0 cmd "perdue" (toute cmd payée apparaît bien sur KDS).
- [ ] PWA installable A2HS Android (tablette Samsung) et iPadOS.

### V2

- [ ] Cmds Uber Eats / Deliveroo visibles dans même UI (via Hubrise).
- [ ] Auto-pause configurable.

## Dépendances

| Dépendance                                                       | Type       | Bloque quoi                     |
| ---------------------------------------------------------------- | ---------- | ------------------------------- |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md)   | Interne    | Refund auto refus cmd           |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md)       | Interne    | Statut courier, remise          |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)               | Interne    | Auth par tenant                 |
| [80_notifications.md](80_notifications.md)                       | Interne    | Push client sur refus / statuts |
| [60_integration_marketplaces.md](60_integration_marketplaces.md) | Interne V2 | Hubrise pour cmds marketplace   |
| Tablette Samsung Galaxy Tab A9 ou BYOD                           | Hardware   | KDS fonctionne                  |
| Connexion WiFi resto stable                                      | Infra      | Polling / WebSocket KDS         |

## Open questions

| Q     | Question                                                                                                | Deadline | Owner                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| 20-Q1 | Mécanisme de sync KDS ↔ backend : polling 5s, SSE, WebSocket ?                                          | V1 S3    | Dev lead                                                                                                    |
| 20-Q2 | Tablette KB fournie : on installe la PWA en kiosque (full-screen, pas de barre) ou comme app standard ? | V1 S4    | Alex (impact UX)                                                                                            |
| 20-Q3 | Si refus cmd, remboursement immédiat ou différé (24h pour appel client) ?                               | V1 S3    | Alex + legal                                                                                                |
| 20-Q4 | Notif sonore : sound file custom ou son système ?                                                       | V1 S3    | Produit                                                                                                     |
| 20-Q5 | Multi-tablette par resto en V1 (cuisine + comptoir) : oui/non ?                                         | V1 S3    | Alex                                                                                                        |
| 20-Q6 | Imprimante thermique CloudPRNT : V1 optionnel ou V2+ uniquement ?                                       | V1 S3    | Alex (cf. [docs/research/kitchen_notification_solutions.md](../research/kitchen_notification_solutions.md)) |

## Notes / décisions actées

- KDS = PWA, pas d'app native (cf. [feedback_tablette_uber_kiosk_vs_pwa.md](../../.claude/memory/feedback_tablette_uber_kiosk_vs_pwa.md)).
- Tablette KB fournie = Samsung Galaxy Tab A9 (~99€ HT) si BYOD impossible.
- Notif primaire = audio + visuel KDS PWA. Notif secondaire = push notif sur device. Tertiaire = SMS gérant.
- Uber Eats Orders app ne peut PAS afficher les cmds Uber Direct → KDS KB obligatoire (architectural, cf. [docs/research/uber_direct_deep_dive.md § 3.7](../research/uber_direct_deep_dive.md)).

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                        |
| ---------- | ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création squelette.                                                                                                                          |
| 2026-05-23 | 0.2     | Alex (via Claude) | Extension scope V1 : Hubrise marketplaces V1, click & collect V1, refund auto Stripe, cohabite avec app native [76](76_app_native_resto.md). |
