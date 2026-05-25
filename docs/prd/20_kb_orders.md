# 20 — KB Orders (App native resto, équivalent Uber Eats Orders)

**Statut** : 🟡 Squelette · **Version** : 1.0 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 2](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v1.0 (fusion)** : ce PRD résulte de la **fusion** des anciens `20_kds_resto.md` (KDS PWA tablette) et `76_app_native_resto.md` (app native iOS+Android). Le KDS PWA n'existe plus comme produit séparé — il n'y a qu'**une seule app native** installable au choix sur téléphone (gérant) ou tablette (cuisine). La PWA reste **uniquement côté client final** ([10](10_pwa_client_commande.md)). Anciens fichiers : [docs/_archive/](../_archive/).

---

## Pourquoi une app native

Le restaurateur (et son équipe cuisine) doit recevoir les commandes **sans rater une seule**, où qu'il soit. Les push web (via PWA + service worker) ont une fiabilité limitée sur iOS (notamment hors PWA active). Les push système **APNs / FCM** sont quasi 100% fiables même app fermée, lock screen, ou device en veille.

Une seule app native, deux usages possibles :
- **Téléphone du gérant** : suivi des cmds en mobilité (en salle, en déplacement, à la maison)
- **Tablette cuisine** : même app installée en mode plein écran sur tablette Samsung Galaxy Tab A9 (ou BYOD), posée sur le comptoir, beep audible 5m

C'est l'équivalent direct d'**Uber Eats Orders** que les restos connaissent déjà.

---

## Scope

| Horizon | Inclus |
|---------|--------|
| **V1** | App native iOS + Android. Auth SSO avec [70 KB Admin](70_kb_admin.md). Notifs push APNs (iOS) + FCM (Android), réveil app en background. Liste cmds en cours + historique, workflow nouvelle/prep/prête/remise. **Modes livraison + click & collect** différentiables visuellement. Refus cmd avec refund auto Stripe. Statut resto (ouvert/fermé/pause exceptionnelle). Source cmd taggée (direct / Uber Eats / Deliveroo via Hubrise dès V1). **Multi-tenant per user V1** : un KB Manager attaché à N tenants voit un switcher en haut de l'app (cas Walid). Mode tablette plein écran (kiosque) optionnel. |
| **V2** | Édition légère depuis l'app (toggle out of stock items, pause exceptionnelle scheduling), dark mode, accessibilité étendue, multi-device pour 1 owner (téléphone + tablette en même temps). |
| **V3** | App native pour le client final (si les métriques PWA s'avèrent insuffisantes). Pour l'instant le client = PWA only. |

## Hors scope

- App native pour le **client final** mangeur (PWA suffit V1/V2, cf. [10](10_pwa_client_commande.md)).
- **PWA KDS tablette** : explicitement abandonnée. La tablette en cuisine = même app native installée (cohérence + fiabilité push).
- POS caisse / encaissement en salle.
- Module RH / planning équipe.
- Recettes / fiches techniques cuisine.

## Personas concernés

- **Gérant resto** (= KB Manager, primaire) — utilise l'app sur son téléphone + éventuellement sur tablette cuisine
- **Cuisinier / staff** (V2) — utilise l'app sur tablette dédiée OU son téléphone perso

## Surface fonctionnelle

### 1. Onboarding / auth
- Login email + password (lien magique optionnel V2)
- **SSO avec [70 KB Admin](70_kb_admin.md)** : un seul compte par user, accessible web ou app
- 2FA optionnel V1, obligatoire V2 sur actions sensibles
- Détection automatique du / des tenants liés au user (via `user_tenants` cf. [50](50_multi_tenant_saas.md))
- **Switcher tenant** en haut de l'app si user attaché à N tenants (cas Walid, Thai Street). Sélection persistée par device.

### 2. Écran d'accueil (cmds en cours)
- Liste cmds triées par horodatage (plus récente en haut)
- Card par cmd : ID, items, modifiers, total, ETA livraison ou pickup, statut, **source taggée** (icône direct / Uber Eats / Deliveroo)
- Badge "nouvelle" non lue
- Pull-to-refresh
- Filtres : par statut, par source
- Compteur en bas : "X en cours, Y en attente"

### 3. Notifications push système
- iOS : APNs
- Android : FCM
- Trigger sur :
  - **Nouvelle cmd reçue** (vibration + son + lock screen)
  - Cmd passée en "courier en route" (info)
  - Cmd annulée par client (urgent, son distinct)
  - Cmd Uber Eats / Deliveroo via Hubrise (icône source, son distinct optionnel V2)
- Configurable :
  - DNT (do not disturb) heures
  - Sons par type de notif (V2)
  - Vibration on/off
- **Beep en boucle** si non acknowledged 30 s+ (même comportement qu'ancien KDS tablette)

### 4. Détail cmd (page)
- Récap complet : items, modifiers, notes client, adresse livraison (si livraison) ou note "à emporter" (si click & collect)
- Téléphone client visible (mais pas exportable, cf. moat [90](90_donnees_clients_crm.md))
- Téléphone courier visible quand assigné
- Map courier (V2 — V1 = statut texte)
- Historique statuts horodaté

### 5. Workflow cmd

```
[nouvelle]  → bouton "Accepter / Préparer" → [en préparation]
[en prep]   → bouton "Prête"                → [prête]
[prête]     → bouton "Remise au coursier"   → [remise]  (si mode livraison)
[prête]     → bouton "Remise au client"     → [remise]  (si mode click & collect)
[remise]    → suivi auto via Uber Direct webhooks (livraison) OU cmd archivée immédiatement (click & collect)
[livrée / collectée] → fade out de la liste, accessible dans historique
```

### 6. Refus / annulation cmd
- Bouton "Refuser" sur card nouvelle, raison : rupture / fermeture / surcharge / autre
- Confirmation à 2 étapes (évite tap accidentel)
- Trigger refund Stripe automatique (cf. [30](30_paiement_stripe_connect.md))
- Notif client (push + email) avec motif
- Log dans audit trail (cf. [70](70_kb_admin.md))

### 7. Statut resto (toggle ouvert / fermé / pause exceptionnelle)
- Toggle visible sur écran d'accueil
- "Pause exceptionnelle" avec ETA reprise (15 min / 30 min / 1 h)
- Impact PWA client : checkout désactivé pendant `fermé` ou `pause`
- Synchro temps réel avec [70 KB Admin](70_kb_admin.md) (changement bi-directionnel)

### 8. Historique cmds
- Liste paginée des cmds passées (filtres : période, statut, source)
- Détail cmd
- Recherche par ID cmd ou nom client

### 9. Stats rapides (V1 basiques)
- CA jour + nb cmds jour
- CA semaine
- Comparatif vs semaine précédente
- (Stats détaillées = [70 KB Admin](70_kb_admin.md))

### 10. Settings
- Profil user (nom, email, password change)
- Notifs : DNT, sons, vibration
- Compte rattaché : nom du / des tenants, statut Stripe, statut Uber Direct, lien vers KB Admin web
- **Switcher tenant** (si N tenants)
- Logout
- Version app + check update
- Lien support KB

### 11. Modulabilité livraison vs click & collect
- Activable par tenant dans [70 KB Admin](70_kb_admin.md) — paramétrage modes acceptés
- L'app affiche un tag visible "🚴 LIVRAISON" ou "🛍️ À EMPORTER" sur chaque card
- Workflow boutons adapté (remise coursier vs remise client)
- Un tenant peut accepter les deux modes simultanément

### 12. Mode tablette (kiosque cuisine)
- Même app native installée sur tablette Samsung Galaxy Tab A9 (~99 € HT KB-fournie) ou BYOD
- Mode plein écran (lock task / pinning) pour empêcher sortie accidentelle
- Auth via code PIN raccourci (alternative au login email)
- Volume beep à fond, écran always-on

### 13. Sécurité / fiabilité
- Token JWT auth API, refresh régulier
- Mode offline minimal : cmds en cache 30 min (lecture seule) si perte connexion
- Background fetch / push pour notifs même app en background
- Heartbeat : si l'app n'a pas reçu de push depuis X min, prompt "vérifiez votre connexion"
- Update mandatoire (force update) configurable pour cas critique (V1 ou V2 selon Q20-Q6)

## Flows nominaux

1. **Nouvelle cmd reçue (push système)** : Khan est dans son bureau, iPhone vibre + son + lock screen → "Buns & Bao — Nouvelle cmd 18 € → Smash double + frites" → unlock + swipe → app ouvre sur card → tap "Accepter" → cuisinier prépare → tap "Prête" → courier arrive → tap "Remise" → cmd archivée.
2. **Cmd Uber Eats via Hubrise** : push reçu "Uber Eats — Nouvelle cmd 22 € — Burger trio" avec icône Uber Eats orange → workflow identique au direct, seule la source diffère.
3. **Cmd click & collect** : push "Buns & Bao — Cmd à emporter 16 €" → tag visuel "🛍️ À EMPORTER" → workflow : Accepter → Prête → "Remise au client" quand le client se présente → archivée.
4. **Walid switche entre ses 3 restos** : Walid login app → écran d'accueil affiche Thai Street Saint Michel par défaut (dernier sélectionné) → tap switcher en haut → choisit Thai Street Châtelet → écran rafraîchi avec les cmds du 2ᵉ resto.
5. **Refus surcharge cuisine** : cuisine débordée → tap "Refuser" sur cmd nouvelle → choisit "Surcharge cuisine" → confirme → refund auto Stripe + push client "désolé, surcharge".
6. **Pause exceptionnelle** : Khan tap "Pause" → choisit "30 min" → PWA client affiche "Resto en pause, reprise HH:MM" + checkout désactivé → après 30 min auto-reprise.

## Edge cases

- **App fermée (kill swipe)** : iOS continue de recevoir push système. Si user a kill-swipe-killed l'app et désactivé les notifs en OS, prompt "réactivez les notifs" à la reconnexion.
- **Téléphone mode silencieux** : son désactivé mais vibration + notif visuelle persistent. Configurable.
- **Connexion perdue** : cache 30 min, indication visuelle "hors connexion", retry auto. Notif "reconnecté".
- **Plusieurs cmds simultanées** : toutes affichées, son distinct si rafale > 3.
- **Modification cmd par client après envoi** (V3) : pas autorisé V1, notif "cette cmd a été modifiée, revoyez-la".
- **Push refusé au niveau OS** : prompt re-activation dans settings app + fallback SMS opt-in (cf. [80](80_notifications.md)).
- **Multi-device pour 1 user** : V2. V1 = 1 device actif par compte (logout auto sur ancien). **Exception** : mode tablette cuisine + téléphone gérant peuvent coexister si le device tablette est marqué comme "device cuisine partagé".
- **Tablette battery dead** : alerte ops si pas de heartbeat 1h. SMS fallback vers tel gérant (V2).
- **Internet coupé en cuisine** : tablette met en cache cmds reçues, sync au retour. Risque : nouvelles cmds non reçues si webhook côté backend ne re-livre pas. Mitigation : polling fallback toutes les 60 s.
- **Multi-tenant user (Walid) reçoit push** : la notif doit indiquer **clairement le tenant concerné** (titre = "Thai Street Châtelet — Nouvelle cmd"). Sinon confusion.

## Critères de succès / acceptation

### V1
- [ ] App déployée App Store + Play Store
- [ ] Notifs push système fiabilité > 95% mesuré sur 30 j
- [ ] Latence cmd backend → notif device : < 5 sec p95
- [ ] Workflow cmd complet utilisable depuis l'app sans aller sur KB Admin web
- [ ] Modes livraison + click & collect différentiables visuellement
- [ ] Source cmd (direct / Uber Eats / Deliveroo) clairement visible
- [ ] Switcher tenant fonctionnel pour user N-tenants (test Walid Thai Street)
- [ ] App responsive : iPhone SE → iPhone Pro Max, Android petits écrans → tablettes 10"
- [ ] Mode tablette plein écran fonctionnel
- [ ] Tests sur 5+ devices physiques (iOS 16+, Android 12+)
- [ ] 0 cmd "perdue" (toute cmd payée apparaît bien dans l'app sous 5 sec)

### V2
- [ ] Édition légère depuis l'app (toggle out of stock items)
- [ ] Dark mode
- [ ] Multi-device pour 1 user (téléphone + tablette en parallèle)

## Dépendances

| Dépendance | Type | Bloque quoi |
|------------|------|-------------|
| Stack mobile native (décision dev lead, hors PRD) | Tech | Tout |
| APNs (Apple Push Notification Service) | Externe | Push iOS |
| FCM (Firebase Cloud Messaging) | Externe | Push Android |
| App Store + Play Store dev accounts | Compliance | Déploiement |
| Backend API KB (triggers notifs + workflow cmd) | Interne | Tout |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md) | Interne | Refund refus cmd |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md) | Interne | Statut courier |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md) | Interne | Auth + RBAC + `user_tenants` |
| [60_integration_marketplaces.md](60_integration_marketplaces.md) | Interne | Cmds marketplace via Hubrise |
| [70_kb_admin.md](70_kb_admin.md) | Interne | SSO + paramétrage tenant (modes, branding) |
| [80_notifications.md](80_notifications.md) | Interne | Triggers push backend |
| Tablette Samsung Galaxy Tab A9 ou BYOD | Hardware | Mode kiosque cuisine |

## Open questions

| Q | Question | Deadline | Owner |
|---|----------|----------|-------|
| 20-Q1 | Stack mobile : 1 codebase (React Native / Expo / Flutter) ou 2 (Swift + Kotlin) ? | V1 S0 | **Dev lead** (pas PRD) |
| 20-Q2 | Soumission App Store en Phase 2 (semaine 6) pour anticiper review : faisable ? | V1 | Dev lead |
| 20-Q3 | App native pour staff cuisinier (login limité) en V1 ou V2 ? | V1 | Alex |
| 20-Q4 | Notifs sons différents par source (direct / Uber Eats / Deliveroo) en V1 ou V2 ? | V1 | Produit |
| 20-Q5 | Mode kiosque tablette : lock task Android natif ou solution tiers (Scalefusion, etc.) ? | V1 | Dev lead |
| 20-Q6 | Update mandatoire (force update) : config V1 ou laisser V2 ? | V1 | Produit |
| 20-Q7 | Multi-device pour 1 user V1 (téléphone + tablette en même temps) ou V2 ? | V1 | Produit |
| 20-Q8 | Mécanisme polling fallback si push perdu : intervalle (30 s / 60 s / 5 min) ? | V1 S3 | Dev lead |
| 20-Q9 | Refus cmd : remboursement immédiat ou différé 24 h pour appel client ? | V1 S3 | Alex + legal |
| 20-Q10 | Multi-tenant switcher UX : sélecteur en header (top), sidebar, ou bottom-sheet ? Mesurer impact UX Walid. | V1 | Produit |

## Notes / décisions actées

- **Une seule app native**, pas de PWA tablette. La tablette cuisine = même build, installation native, mode plein écran.
- **Notifs push système** (APNs / FCM) = différenciateur clé vs push web. Fiabilité quasi 100% même app fermée.
- **SSO avec KB Admin** : 1 compte user accessible web et mobile.
- **Multi-tenant per user dès V1** : un user attaché à N tenants (cas Walid Thai Street avec 3 restos) — switcher dans l'app. Cf. [50](50_multi_tenant_saas.md) data model `user_tenants`.
- **Uber Eats Orders app ne peut pas afficher cmds Uber Direct** (architectural, cf. [feedback_tablette_uber_kiosk_vs_pwa](../../.claude/memory/feedback_tablette_uber_kiosk_vs_pwa.md)). KB Orders gère les deux cas (direct + marketplace via Hubrise) dans une seule UI.

## Changelog

| Date | Version | Auteur | Notes |
|------|---------|--------|-------|
| 2026-05-23 | 1.0 | Alex (via Claude) | **Création par fusion** des anciens `20_kds_resto.md` v0.2 + `76_app_native_resto.md` v0.1. Suppression de la PWA tablette comme produit séparé (la tablette = même app native installée). Multi-tenant per user V1 (cas Walid). Anciens fichiers : [docs/_archive/](../_archive/). |
