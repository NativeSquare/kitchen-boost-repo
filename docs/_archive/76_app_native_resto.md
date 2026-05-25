# 76 — App Native Resto (iOS + Android, équivalent Uber Eats Orders)

**Statut** : 🟡 Squelette · **Version** : 0.1 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 10](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **Pourquoi une app native et pas juste la PWA KDS ?** Sur tablette en cuisine, la PWA KDS (cf. [20](20_kds_resto.md)) reste utilisable. Mais le restaurateur veut souvent suivre les cmds **sur son téléphone perso** (gérant pas toujours en cuisine, en déplacement, en cas de doute). Une app native iOS+Android offre une fiabilité de notifications push système (APNs / FCM) très supérieure aux push web (qui dépendent du browser actif). C'est l'équivalent direct d'**Uber Eats Orders** que les restos connaissent déjà.

---

## Scope

| Horizon | Inclus |
|---------|--------|
| **V1** | App native iOS + Android pour le restaurateur : notifs push système (APNs/FCM), liste cmds en cours + historique, workflow nouvelle/prep/prête/remise, modes livraison + click & collect, refus cmd avec refund auto, statut resto (ouvert/fermé/pause), source cmd (direct + Uber Eats/Deliveroo via Hubrise dès V1), auth login resto via dashboard SSO. |
| **V2** | Multi-tenant pour resto multi-établissement (1 utilisateur, plusieurs restos), édition menu basique depuis l'app (toggle out of stock), push opt-in granulaire, dark mode, accessibilité étendue. |
| **V3** | App native pour le client final (si métriques PWA insuffisantes). Pour l'instant le client = PWA only. |

## Hors scope

- App native pour le client final mangeur (PWA suffit V1/V2).
- Édition menu complète depuis l'app (V1 = via dashboard web ; V2 toggle out of stock seulement).
- POS caisse intégré.
- Module RH / planning équipe.

## Personas concernés

- **Restaurateur** (owner — utilise l'app sur son téléphone perso)
- **Cuisinier / staff** (V2 — utilise l'app sur tablette dédiée OU son téléphone)

## Surface fonctionnelle (sections à remplir)

### 1. Onboarding / auth
- Login via email + password (avec lien magique optionnel V2)
- Single Sign-On avec le dashboard web (un seul compte par owner resto)
- 2FA optionnel V1, obligatoire V2 (déclenché sur action sensible)
- Détection du tenant lié à l'utilisateur (récup via API : "quels restos a ce user accès ?")
- Multi-tenant V2 : si plusieurs restos, switch dans l'app

### 2. Écran d'accueil (cmds en cours)
- Liste cmds triées par horodatage (plus récente en haut)
- Card par cmd avec : ID, items, modifiers, total, ETA livraison/pickup, statut, source (icône direct / Uber Eats / Deliveroo)
- Badge "nouvelle" non lue
- Pull-to-refresh
- Filtres : par statut, par source

### 3. Notifications push système
- iOS : APNs (Apple Push Notification Service)
- Android : FCM (Firebase Cloud Messaging)
- Trigger sur :
  - Nouvelle cmd reçue (vibration + son + lock screen)
  - Cmd qui passe en "courier en route" (info)
  - Cmd annulée par client (urgent, son distinct)
  - Cmd Uber Eats / Deliveroo reçue via Hubrise (V1, son distinct par source ?)
- Configurable :
  - DNT (do not disturb) heures
  - Sons par type de notif (V2)
  - Vibration on/off

### 4. Détail cmd
- Récap complet : items, modifiers, notes client, adresse livraison (si livraison) ou note "à emporter" (si click & collect)
- Téléphone client (visible mais pas exportable)
- Téléphone courier (visible quand assigné)
- Map courier (V2 — V1 = statut texte seulement)
- Historique statuts horodaté

### 5. Workflow cmd
```
[nouvelle]  → bouton "Accepter / Préparer" → [en préparation]
[en prep]   → bouton "Prête"                → [prête]
[prête]     → bouton "Remise au coursier"   → [remise] (si livraison)
[prête]     → bouton "Remise au client"     → [remise] (si click & collect)
[remise]    → courier en route OU client est venu chercher
[livrée / collectée] → fade out de la liste (archivée)
```

### 6. Refus / annulation cmd
- Bouton "Refuser" sur card nouvelle (raison : rupture / fermeture / surcharge / autre)
- Confirmation à 2 étapes
- Trigger refund Stripe auto via API backend
- Notif client (push + email) avec motif
- Log dans audit trail

### 7. Statut resto (toggle ouvert/fermé/pause)
- Toggle visible sur écran d'accueil
- "Pause exceptionnelle" avec ETA reprise (15 min, 30 min, 1h)
- Impact PWA client : checkout désactivé pendant fermé/pause
- Synchro avec dashboard web (changements bi-directionnels temps réel)

### 8. Historique cmds
- Liste paginée des cmds passées (filtres : période, statut, source)
- Détail cmd
- Recherche par ID cmd ou nom client

### 9. Stats rapides (V1 basiques)
- CA jour + nb cmds jour
- CA semaine
- Comparatif vs semaine précédente
- (Stats détaillées = dashboard web)

### 10. Settings
- Profil utilisateur (nom, email, password change)
- Notifs : DNT, sons, vibration
- Compte rattaché : nom du resto, statut Stripe, statut Uber, lien vers dashboard web
- Logout
- Version app + check update
- Lien support KB

### 11. Modulabilité livraison vs click & collect
- Le resto choisit dans son dashboard quels modes il accepte (cf. [75](75_dashboard_resto.md) section 9)
- L'app affiche les cmds avec un tag visible "🚴 LIVRAISON" ou "🛍️ À EMPORTER"
- Workflow boutons adapté (remise coursier vs remise client)

### 12. Sécurité / fiabilité
- Token JWT pour auth API, refresh régulier
- Mode offline minimal : cmds en cache 30 min en cas de perte connexion (lecture seule)
- Background fetch / push pour notifs même app en background
- Heartbeat / monitoring : si l'app n'a pas reçu de push depuis X temps, prompt "vérifiez votre connexion"

## Flows nominaux

1. **Nouvelle cmd reçue (push native)** : Khan est dans son bureau, son iPhone vibre + son distinct + lock screen montre "Buns & Bao - Nouvelle cmd : Smash double + frites - 18€" → Khan unlock, swipe notif → app ouvre sur card cmd → tap "Accepter" → cuisinier prépare → Khan tap "Prête" → courier arrive → Khan tap "Remise" → cmd archivée.
2. **Cmd Uber Eats via Hubrise** : Khan reçoit push "Uber Eats - Nouvelle cmd : Burger trio - 22€" (icône Uber Eats) → workflow identique à direct, juste la source diffère.
3. **Refus cmd surcharge** : Khan reçoit cmd nouvelle mais cuisine débordée → tap "Refuser" → choisit "Surcharge cuisine" → confirme → refund auto Stripe + push client "désolé, surcharge cuisine".
4. **Toggle pause cuisine** : Khan tap "Pause exceptionnelle" → choisit "30 min" → PWA client affiche bandeau "Resto en pause, reprise à HH:MM" + checkout désactivé → après 30 min auto-reprise.

## Edge cases

- **App fermée (kill)** : push système doit quand même réveiller l'app (background mode). Si iOS user a kill swipe-up l'app, prompt "réactivez les notifs".
- **Téléphone en mode silencieux** : son désactivé mais vibration + notif visuelle persistent. Configurable.
- **Connexion perdue** : cache 30 min, indication visuelle "hors connexion", retry auto. Notif "reconnecté".
- **Plusieurs cmds simultanées** : toutes affichées, son distinct si rafale.
- **Modification cmd par client après envoi** (V3 si jamais) : pas autorisé V1, notif "cette cmd a été modifiée, revoyez-la".
- **Push refusé OS niveau** : prompt re-activation dans settings de l'app + fallback SMS opt-in.
- **Multi-device pour 1 owner** : V2. V1 = 1 device actif par compte (logout auto sur ancien).
- **Update mandatoire** : prompt blocking si version trop vieille (failsafe en cas de bug critique).

## Critères de succès / acceptation

### V1
- [ ] App déployée App Store + Play Store
- [ ] Notifs push système fiabilité > 95% mesuré sur 30j
- [ ] Latence cmd backend → notif device : < 5 sec p95
- [ ] Workflow cmd complet utilisable depuis l'app sans aller sur dashboard web
- [ ] Modes livraison + click & collect différentiables visuellement
- [ ] Source cmd (direct / Uber Eats / Deliveroo via Hubrise) clairement visible
- [ ] App responsive : iPhone SE → iPhone Pro Max, Android petits écrans → tablettes
- [ ] Tests sur 5+ devices physiques (iOS 16+, Android 12+)

### V2
- [ ] Multi-tenant per user (Khan peut switch entre Buns & Bao et un 2e resto qu'il gère)
- [ ] Toggle out of stock items depuis l'app
- [ ] Dark mode

## Dépendances

| Dépendance | Type | Bloque quoi |
|------------|------|-------------|
| Stack mobile native (à décider par dev lead, pas dans PRD) | Tech | Tout |
| APNs (Apple Push Notification Service) | Externe | Section 3 iOS |
| FCM (Firebase Cloud Messaging) | Externe | Section 3 Android |
| App Store + Play Store dev accounts | Compliance | Déploiement |
| Backend API KB (notifs trigger + workflow cmd) | Interne | Tout |
| [20_kds_resto.md](20_kds_resto.md) | Interne | Workflow cmd partagé (PWA KDS = équivalent web) |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md) | Interne | Refund refus cmd |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md) | Interne | Statut courier |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md) | Interne | Auth + RBAC + tenant scoping |
| [60_integration_marketplaces.md](60_integration_marketplaces.md) | Interne | Cmds marketplace via Hubrise |
| [75_dashboard_resto.md](75_dashboard_resto.md) | Interne | SSO + cohérence UX |
| [80_notifications.md](80_notifications.md) | Interne | Triggers push backend |

## Open questions

| Q | Question | Deadline | Owner |
|---|----------|----------|-------|
| 76-Q1 | Stack mobile : 1 codebase (React Native / Expo / Flutter) ou 2 (Swift + Kotlin) ? | V1 S0 | **Dev lead** (pas PRD) |
| 76-Q2 | Soumission App Store en Phase 2 (semaine 6) pour anticiper review : faisable ? | V1 | Dev lead |
| 76-Q3 | App native pour staff cuisinier en V1 ou seulement owner ? | V1 | Alex |
| 76-Q4 | Notifs sons différents par source (direct / Uber Eats / Deliveroo) en V1 ou V2 ? | V1 | Produit |
| 76-Q5 | Mode kiosque tablette via app native (full-screen, pas de barre nav) vs PWA en kiosque ? Lequel privilégier en cuisine ? | V1 | Alex (compare avec [20](20_kds_resto.md)) |
| 76-Q6 | Update mandatoire (force update) : config V1 ou laisser V2 ? | V1 | Produit |
| 76-Q7 | Multi-device pour 1 owner V1 (Khan ouvre app sur iPhone + iPad) ou V2 ? | V1 | Produit |

## Notes / décisions actées

- **L'app native est un complément de la PWA KDS tablette**, pas un remplacement. Les 2 cohabitent. Le resto choisit ce qui lui convient en cuisine (PWA tablette OU app native sur tablette dédiée OU les deux).
- **Notifs push système** = différenciateur clé vs PWA KDS (fiabilité APNs > fiabilité push web).
- **SSO avec dashboard web** : 1 compte par owner resto, accessible depuis web ou app.
- **Cf. [feedback_tablette_uber_kiosk_vs_pwa.md](../../.claude/memory/feedback_tablette_uber_kiosk_vs_pwa.md)** : Uber Eats Orders app ne peut pas afficher cmds Uber Direct (architectural). KB app gère les 2 cas.

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 0.1 | Alex (via Claude) | Création — nouveau sous-PRD pour acter l'app native resto iOS+Android V1 (équivalent Uber Eats Orders). |
