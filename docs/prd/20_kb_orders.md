# 20 — KB Orders (App native resto, équivalent Uber Eats Orders)

**Statut** : 🟢 Grillé · **Version** : 1.4 · **Dernière mise à jour** : 2026-06-03
**Lié au master** : [00_master.md § 5 bloc 2](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v1.0 (fusion)** : ce PRD résulte de la **fusion** des anciens `20_kds_resto.md` (KDS PWA tablette) et `76_app_native_resto.md` (app native iOS+Android). Le KDS PWA n'existe plus comme produit séparé — il n'y a qu'**une seule app native** installable au choix sur téléphone (gérant) ou tablette (cuisine). La PWA reste **uniquement côté client final** ([10](10_pwa_client_commande.md)). Anciens fichiers : [docs/\_archive/](../_archive/).

> **⚠️ Réconciliation 2026-05-25** : les mentions « Uber Eats / Deliveroo via Hubrise **dès V1** » sont **périmées** — [ADR 0009](../adr/0009-hubrise-reporte-v2.md) a **reporté Hubrise en V2**. **V1 = commandes directes uniquement** ; le champ `source` existe (valeur `direct`) et l'UI prévoit le tag marketplace, mais l'**ingestion marketplace est V2** (chantier 2.6 Marketplaces). Par ailleurs : **refus cmd → remboursement immédiat** (20-Q9 acté).

> **🟢 v1.4 (grilling 2026-06-03)** — Trois axes verrouillés en session de grilling, 26 stories `ready-for-agent` (#393–#418) publiées en aval :
>
> 1. **Fiabilité réception** : Convex subscription = transport primaire, push APNs/FCM = wakeup uniquement. Mode déconnecté = écran rouge full screen si la sub Convex est broken (#405). Force update **2 couches** au boot (criticalIndex OTA + minSupportedBuildVersion natif, [ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md), #394). Escalation push T+60s sur tous les devices subscribed du tenant (#414). Timeout d'acceptation 5 min → état terminal `auto_expired` distinct, refund Stripe auto ([ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md), #404).
> 2. **Auth tablette + mode kiosque + audit monolithique V1** : toggle kiosque/téléphone au premier login (#393), tenant pinné en kiosque + switcher caché (#399), session révocable depuis KB Admin avec écran « Session révoquée » côté app (#396, #400). V1 : pas de login multi-staff, tout est attribué au KB Manager de la session ouverte sur le device.
> 3. **Périmètre V1 étendu — disponibilité commerciale + impression thermique** : pause / fermeture exceptionnelles, toggle item indispo, modif horaires depuis l'app native ([ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md), #406–#409). Impression thermique cuisine via Star WebPRNT (HTTP sur LAN, zéro module natif, #412 + #416). Édition catalogue (prix, photos, modifiers) reste **KB Admin seul** V1 et V2.

---

## Pourquoi une app native

Le restaurateur (et son équipe cuisine) doit recevoir les commandes **sans rater une seule**, où qu'il soit. Les push web (via PWA + service worker) ont une fiabilité limitée sur iOS (notamment hors PWA active). Les push système **APNs / FCM** sont quasi 100% fiables même app fermée, lock screen, ou device en veille.

Une seule app native, deux usages possibles :

- **Téléphone du gérant** : suivi des cmds en mobilité (en salle, en déplacement, à la maison)
- **Tablette cuisine** : même app installée en mode plein écran sur tablette Samsung Galaxy Tab A9 (ou BYOD), posée sur le comptoir, beep audible 5m

C'est l'équivalent direct d'**Uber Eats Orders** que les restos connaissent déjà.

> **Note d'architecture (post-grilling 2026-06-03)** : la fiabilité de réception ne repose **plus** sur le push système seul. Le push APNs/FCM est un **wakeup** ; la **source de vérité** est la subscription Convex temps réel sur les cmds du tenant. Cf. §13.

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | App native iOS + Android. Auth SSO avec [70 KB Admin](70_kb_admin.md). Notifs push APNs (iOS) + FCM (Android) = wakeup, **Convex subscription = source de vérité**. Liste cmds en cours + historique paginé (4 onglets : Toutes / Livrées-Collectées / Refusées / Manquées). Workflow nouvelle → en préparation → prête → remise → livrée\|collectée. Modes livraison + click & collect différentiables visuellement. Refus humain (2-step depuis `nouvelle`, 3-step depuis `en préparation`/`prête`) + état terminal `auto_expired` distinct via timeout 5 min Convex `scheduler.runAfter` + refund Stripe auto. Escalation push T+60s sur tous devices subscribed du tenant. Statut tenant (ouvert/fermé/pause exceptionnelle). Pause exceptionnelle 15/30/60 min, fermeture exceptionnelle 1+ jour, toggle dispo item, modif horaires d'ouverture du jour/semaine accessibles depuis l'app (mirror KB Admin). Impression thermique cuisine Star WebPRNT (HTTP sur LAN, auto-print à l'ack + bouton Réimprimer + IP configurable dans Settings). Source cmd taggée (V1 = **direct uniquement**, **pas de badge `direct` affiché** ; Uber Eats / Deliveroo via Hubrise = **V2**, [ADR 0009](../adr/0009-hubrise-reporte-v2.md)). **Multi-tenant per user V1** : un KB Manager attaché à N tenants voit un switcher en header (cas Walid), caché en mode kiosque. Mode tablette plein écran (kiosque) avec tenant pinné + switcher masqué + audit monolithique. Toggle kiosque/téléphone au premier login + checklist réglages device (volume max, écran always-on). Force update gate 2 couches au boot ([ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md)). Mode déconnecté écran rouge full screen quand la sub Convex est broken. Alertes statut tenant (critiques full screen rouge + non-critiques banner). Page Sessions actives + révocation distante depuis KB Admin. Stats rapides (CA jour, nb cmds, CA semaine, delta S-1). |
| **V2**  | Multi-staff cuisinier login (audit per-staff au lieu de monolithique), multi-device pour 1 owner en parallèle même tenant (téléphone + tablette en // sur le même device-set), dark mode, accessibilité étendue, sons par source push (direct vs marketplace), badge `direct` réintroduit si marketplaces V2 actives, ingestion marketplace via Hubrise, intégration packaging photos client courier. Édition catalogue depuis l'app **rejetée** par [ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md). Migration Stripe manual capture (ADR de remplacement à venir, cf. [ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **V3**  | App native pour le client final (si les métriques PWA s'avèrent insuffisantes). Pour l'instant le client = PWA only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Hors scope

- App native pour le **client final** mangeur (PWA suffit V1/V2, cf. [10](10_pwa_client_commande.md)).
- **PWA KDS tablette** : explicitement abandonnée. La tablette en cuisine = même app native installée (cohérence + fiabilité push).
- **Édition catalogue** depuis KB Orders (V1 et V2) : création/suppression item, prix, description, photo, modifiers — **KB Admin seul** ([ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md)).
- POS caisse / encaissement en salle.
- Module RH / planning équipe.
- Recettes / fiches techniques cuisine.
- **CTA « Appeler »** sur les numéros client/coursier : impossible (tablette sans dialer fiable, gain UX nul, cf. §4).

## Personas concernés

- **Gérant resto** (= KB Manager, primaire) — utilise l'app sur son téléphone + éventuellement sur tablette cuisine
- **Cuisinier / staff** (V2) — utilise l'app sur tablette dédiée OU son téléphone perso
- **Ops KB** — accès KB Admin pour révoquer sessions, monitorer cmds manquées, configurer impression

## Surface fonctionnelle

### 1. Onboarding / auth

#### 1a. Séquence post-login (#398)

Au premier login d'un user sur un device, séquence obligatoire **dans cet ordre** :

1. **Login** email + password (SSO avec [70 KB Admin](70_kb_admin.md))
2. **Push permission prompt** avec rationale custom — _« KB Orders a besoin des notifs pour ne pas rater une commande — active-les »_. Pas dès le splash : au moment où le besoin est compréhensible.
3. **Toggle kiosque/téléphone** (#393) — _« Cette tablette sera dédiée à la cuisine ? Oui / Non »_. Choix persistant device-side, conditionne pinning tenant + masquage switcher + volume programmatique + `expo-keep-awake`.
4. **Checklist réglages device** (#398) — plus critique que la perm push selon Alex :
   - ☐ Volume à fond (instruction OS, pas programmable)
   - ☐ Écran toujours allumé (Settings → Affichage → Auto-verrouillage = Jamais)
   - Boutons « J'ai fait » par item, non-validation programmatique (juste guide UX)
5. **Redirect home** `(tabs)/index`.

Flag `device.onboardingCompleted` côté Convex → séquence skip aux re-launches.

#### 1b. Auth + multi-tenant

- Login email + password (lien magique optionnel V2)
- **SSO avec [70 KB Admin](70_kb_admin.md)** : un seul compte par user, accessible web ou app
- 2FA optionnel V1, obligatoire V2 sur actions sensibles
- Détection automatique du / des tenants liés au user (via `user_tenants` cf. [50](50_multi_tenant_saas.md))
- **Switcher tenant** en header (#399) si user attaché à N tenants (cas Walid Thai Street), **mode téléphone uniquement** — caché en mode kiosque (tenant pinné). Sélection persistée par device dans `device.lastSelectedTenantId`.
- Sur push reçu, **titre = tenant explicite** (ex : _« Thai Street Châtelet — Nouvelle commande 22 € »_) pour éviter confusion multi-tenant.

#### 1c. Audit monolithique V1 (grilling axe 2)

V1 : **pas de login multi-staff** sur l'app tablette. Toutes les actions (Accept, Prête, Remise, Refus, toggles dispo, etc.) sont attribuées au **KB Manager dont la session est ouverte** sur ce device. V2 réouvre la possibilité d'un sous-login par staff cuisinier (Q20-Q3).

### 2. Écran d'accueil (cmds en cours)

- Liste cmds triées par horodatage (plus récente en haut)
- Card par cmd : ID, items, modifiers, total, ETA livraison ou pickup, statut, **tag mode** 🚴 LIVRAISON / 🛍️ À EMPORTER
- **Pas de badge `direct` en V1** (acté Q3.3) — l'icône source taggée n'apparaît que pour les futures sources marketplace (V2). En V1, toutes les cmds sont direct.
- Badge "nouvelle" non lue
- Pull-to-refresh (geste rassurant même si Convex sub temps réel)
- Filtres : par statut, par tag mode
- Compteur en bas : « X en cours, Y en attente »

### 3. Notifications push système

- iOS : APNs — **wakeup uniquement** (la source de vérité est la sub Convex)
- Android : FCM — idem
- Trigger sur :
  - **Nouvelle cmd reçue** (vibration + son + lock screen) — titre = tenant explicite
  - Cmd passée en _« courier en route »_ (info)
  - Cmd annulée par client (urgent, son distinct)
  - **Escalation T+60s** si cmd non acknowledged (cf. §6c)
- Configurable côté Settings :
  - DNT (do not disturb) heures
  - Vibration on/off
  - Sons par type de notif (V2 — V1 = son unique)
- **Pas de beep en boucle 30 s+** (retiré v1.4) — remplacé par l'escalation push T+60s, plus efficace en multi-device.
- Si push permission OS refusée (#395) : **banner rouge persistant** sur toutes les routes `(app)` avec _« Notifs désactivées — tu vas rater des commandes »_ + bouton qui ouvre `Linking.openSettings()`. Permission `undetermined` (jamais demandée) → pas de banner (c'est le job de la séquence onboarding §1a de demander).

### 4. Détail cmd (page)

- Récap complet : items, modifiers, notes client, adresse livraison (si livraison) ou note _« à emporter »_ (si click & collect)
- **Téléphones client + coursier en tap-to-reveal** (acté Q3.6) — pas affichés par défaut sur la card, révélés au tap explicite (réduction surface PII accidentelle / coup d'œil shoulder surfing)
- **Pas de CTA « appeler »** (acté Q4.2) — affichage du num uniquement (tablette = pas de dialer fiable, gain UX nul, source de bugs cross-OS)
- Map courier (V2 — V1 = statut texte)
- Historique statuts horodaté
- Bouton **« Réimprimer »** (cf. §14) qui déclenche un reprint manuel via Star WebPRNT

### 5. Workflow cmd

```
[nouvelle]    → bouton « Accepter / Préparer »  → [en préparation]   (impression auto cf. §14)
[en prep]     → bouton « Prête »                → [prête]
[prête]       → bouton « Remise au coursier »   → [remise]            (mode livraison)
[prête]       → bouton « Remise au client »     → [remise]            (mode click & collect)
[remise]      → suivi auto Uber Direct webhooks (livraison) → [livrée]
                OU cmd archivée immédiatement (click & collect) → [collectée]
[livrée] / [collectée] → fade out home, accessible dans historique
```

**États terminaux alternatifs** :

- `refusée` — refus humain via §6a (motif explicite, push client motivé)
- `auto_expired` — système, timeout 5 min via Convex `scheduler.runAfter` (cf. §6b + [ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md))

Les deux états sont **distincts** dans le schéma et l'UI (onglets séparés dans l'historique) — signaux orthogonaux : refus humain = signal business (rupture chronique, surcharge), auto_expired = signal opérationnel (tablette HS, Khan AFK).

### 6. Refus / annulation / timeout cmd

#### 6a. Refus humain (#403, #413)

**Depuis `nouvelle`** (2-step confirm, #403) :

1. Bouton « Refuser » sur card
2. Étape 1 : choix motif dans closed set `rupture | fermeture | surcharge | autre`
3. Étape 2 : « Confirmer le refus + refund » → exécution

**Depuis `en préparation` ou `prête`** (3-step confirm anti-fat-finger, #413) — coût d'erreur fort (travail cuisine perdu, refund total) :

1. Étape 1 : choix motif (closed set)
2. Étape 2 : _« Es-tu sûr ? La cuisine a déjà commencé »_ — preview du temps écoulé
3. Étape 3 : _« Confirmer refus + refund total »_

Exécution commune :

- Cmd → `refusée` avec `refusalReason` rempli
- Refund Stripe immédiat ([ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md) — auto-capture mode V1, refund après débit)
- Push + email client **avec motif** (template motivé)
- Audit log côté backend (`actor`, `at`, `tenantId`, `orderId`, `action=refuse`, `reason=...`)

#### 6b. Auto-expired timeout (#404)

À chaque `paymentSucceeded`, le backend poste un `scheduler.runAfter(5min, expireIfNotAcknowledged)` idempotent côté Convex :

- Si la cmd est encore `nouvelle` à T+5min → transition vers état terminal **`auto_expired`** (distinct de `refusée`, cf. [ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md))
- Refund Stripe automatique (même code path que refus humain — auto-capture mode)
- Push + email client avec template **neutre** : _« Votre commande n'a pas pu être traitée par le restaurant »_ — pas de motif, pas de stigmate marque
- Idempotent : si entre-temps la cmd a été acknowledged ou refusée, le job no-op

C'est le **failsafe contractuel** du KPI « 0 cmd perdue » (cf. §13).

#### 6c. Escalation push T+60s (#414)

À chaque `paymentSucceeded`, le backend poste aussi un `scheduler.runAfter(60s, escalateIfNotAcknowledged)` :

- Si la cmd est encore `nouvelle` à T+60s → re-trigger push APNs/FCM avec **corps distinct** _« URGENT — cmd non prise »_ sur **tous les devices subscribed du tenant** (tablette cuisine + téléphone gérant simultanément autorisés en V1 cas multi-device limité, cf. §13)
- Idempotent : si entre-temps un device a acknowledged, l'escalation est skip sur tous
- Pas de niveau d'escalation supplémentaire — un seul re-trigger à T+60s, puis on attend le timeout `auto_expired` à T+5min

### 7. Disponibilité commerciale (frontière vs édition catalogue)

[ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md) trace la frontière : **disponibilité commerciale "ici et maintenant"** = accessible depuis app native + KB Admin avec synchro temps réel Convex (1 source de vérité). **Édition catalogue** = KB Admin seul. **Pas de modif prix dans KB Orders V1 ou V2**.

Synchro KB Admin ↔ app native pour chacune des 4 surfaces (#397 côté admin).

#### 7a. Pause exceptionnelle (#406)

- 3 boutons fixes : **15 / 30 / 60 min** (ETA reprise figée V1, pas de custom)
- Tenant → `pause` avec `pauseUntil = now + duration`
- Impact PWA client : checkout désactivé + message _« Resto en pause, reprise HH:MM »_
- **Auto-resume** à expiration via `scheduler.runAt`
- Cmds en cours déjà acceptées **restent actives** — la pause bloque seulement les nouvelles cmds côté client

#### 7b. Fermeture exceptionnelle (#407)

- Bouton « Fermer aujourd'hui » / « Fermer du... au... » en accès rapide + Settings
- Date picker début + fin (avec raccourci _« aujourd'hui seulement »_)
- Cas d'usage : vacances annuelles, panne frigo durable, incident hygiène, intempéries
- **Différent** de la pause (transitoire 15-60 min) : durable 1+ jour avec date de réouverture explicite
- Impact PWA client : checkout désactivé + message _« Resto fermé jusqu'au JJ/MM »_
- Réversible à tout moment côté app native ou KB Admin

#### 7c. Toggle dispo item (#408)

- Vue Menu lecture + toggle dispo/indispo par item (**pas d'édition** cf. ADR 0018)
- **Granularité item uniquement** V1 — pas de toggle catégorie entière (acté Q3.7a)
- **Tooltip obligatoire au premier usage** sur un device :
  > _« Ce toggle masque l'item du menu côté client. Pas de modification permanente — il restera disponible dans ton catalogue KB Admin. »_
- Tooltip dismissé pour usages suivants (flag `device.itemToggleTooltipSeen`)
- **Comportement event-driven côté PWA client** : si l'item passe en `unavailable` pendant qu'un client a cet item au panier, le client reçoit une erreur à `confirmPayment` (_« Désolé, cet item n'est plus disponible »_) — le panier PWA revalide à confirmation, pas à T0 d'ajout

#### 7d. Modif horaires d'ouverture du jour / de la semaine (#409)

- Onglet « Aujourd'hui » + onglet « Cette semaine »
- Édition des créneaux du jour courant ou des 7 jours suivants (cas : _« ce soir on ferme à 22h au lieu de 23h »_, _« un seul cuisinier de service → réduction horaires »_)
- Édition complète des horaires permanents (toute la semaine, jours fériés annuels) reste **KB Admin seul** ([ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md))
- Impact PWA client : checkout désactivé hors créneaux modifiés

### 8. Historique cmds (#417)

- Liste paginée des cmds passées
- **4 onglets de statut terminal** : `Toutes | Livrées/Collectées | Refusées | Manquées`
  - Onglet **« Manquées »** rend visibles les `auto_expired` — le gérant mesure son propre taux de cmds ratées (acté Axe 1)
- **Filtres** : période (aujourd'hui / 7j / 30j / custom)
- **Détail cmd** depuis chaque ligne : motif si `refusée`, message neutre si `auto_expired`
- **Recherche** par ID cmd ou nom client
- Pagination (infinie ou numérotée — à trancher à l'impl)

Côté KB Admin (#415) : **mêmes 4 onglets** + métrique calculée par tenant + alerte ops si `auto_expired/jour` > seuil (~3-5 par défaut).

### 9. Stats rapides V1 (#410)

Page Stats accessible depuis nav. Métriques V1 minimales (stats détaillées = [70 KB Admin](70_kb_admin.md)) :

- **CA du jour** (somme totaux des cmds livrées/collectées aujourd'hui)
- **Nombre de cmds du jour** (exclut `refusée` et `auto_expired` — c'est du CA réalisé)
- **CA de la semaine en cours**
- **Comparatif vs semaine précédente** (delta absolu + pourcentage)

Pas de graphique V1 — big numbers + delta vs S-1. Subscription Convex temps réel, pas de refresh manuel.

### 10. Settings (#418)

Page Settings complète avec toutes les sections :

- **Profil user** : nom, email, password change
- **Notifs** : DNT (do not disturb) heures, sons on/off, vibration on/off
- **Compte rattaché** : nom du / des tenants, statut Stripe, statut Uber Direct, lien vers [70 KB Admin](70_kb_admin.md) web
- **Imprimante cuisine** (cf. §14) : IP imprimante Star WebPRNT + bouton « Tester l'impression » + statut connecté/HS
- **Switcher tenant** (si N tenants, mode téléphone uniquement, caché en kiosque, plug #399)
- **Toggle mode kiosque/téléphone** (plug #393 — permet de rebasculer plus tard)
- **Logout** : révoque la session locale côté Convex Auth
- **Version app + check update** : version installée vs disponible + lien store
- **Lien support KB**

### 11. Modulabilité livraison vs click & collect

- Activable par tenant dans [70 KB Admin](70_kb_admin.md) — paramétrage modes acceptés
- L'app affiche un tag visible **🚴 LIVRAISON** ou **🛍️ À EMPORTER** sur chaque card
- Workflow boutons adapté (remise coursier vs remise client)
- Un tenant peut accepter les **deux modes simultanément** — les cards discriminent par tag, états terminaux distincts (`livrée` vs `collectée`)

### 12. Mode tablette (kiosque cuisine)

- Même app native installée sur tablette Samsung Galaxy Tab A9 (~99 € HT KB-fournie) ou BYOD
- **Toggle au premier login** (#393) — pas d'auto-détection par form factor (Khan peut vouloir un grand téléphone en cuisine ou tablette en mobilité)
- En mode kiosque :
  - Tenant courant **pinné** (`device.pinnedTenantId` stocké local + Convex)
  - **Switcher tenant masqué** (cf. §1b)
  - **Audit monolithique** : toutes les actions attribuées au KB Manager de la session ouverte (V1, cf. §1c)
  - Beep volume max programmatique
  - `expo-keep-awake` activé tant que foreground
  - Mode plein écran (lock task Android / guided access iOS) recommandé pour empêcher sortie accidentelle
- Toggle re-modifiable depuis Settings (#418) pour rebasculer

### 13. Sécurité / fiabilité (réécrit v1.4)

#### Transport primaire = Convex subscription

La source de vérité pour les nouvelles cmds est la **subscription Convex temps réel** sur les cmds du tenant courant. Le push APNs/FCM est un **wakeup** pour réveiller l'app si elle n'est pas foreground — il ne porte pas la cmd elle-même. Conséquence : si le push est perdu (OS-bloqué, mode silencieux extrême), la sub Convex rattrape dès que l'app revient foreground (intervalle max = re-foreground naturel ou expiration timeout `auto_expired` cf. §6b).

#### Mode déconnecté écran rouge (#405)

Détection temps réel du statut de la sub Convex (perte wifi, backend down). Au-delà de **3-5 secondes** sans reconnect (Convex auto-retry en backoff) → **écran rouge full screen bloquant** style Uber Eats _« Connexion perdue, vérifie ton réseau »_. L'écran est **transitoire** — disparaît automatiquement au reconnect. Pas de cache local, pas de queue offline : la sub Convex est la SoT. Empêche le restaurateur d'interpréter l'absence de cmd comme un calme alors qu'il est en réalité aveugle.

#### Force update gate au boot (#394 + [ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md))

**Avant le rendu de toutes les routes**, deux couches indépendantes :

1. **Couche OTA (JS)** — compteur `expo.extra.criticalIndex` dans `app.config.ts` ; `Updates.checkForUpdateAsync()` compare incoming vs running ; si incoming > running, `fetchUpdateAsync()` + `reloadAsync()` blocage sur splash. Permet patch JS en minutes sans App Store.
2. **Couche native** — `Application.nativeBuildVersion` (via `expo-application`) comparé à `minSupportedBuildVersion` servi par query Convex publique (pré-auth). Si inférieur, écran rouge bloquant avec lien App Store / Play Store. Bloque toutes les anciennes builds en cas de faille sécurité native.

Pré-requis : `runtimeVersion: "fingerprint"` (Expo SDK 52+) pour que EAS Update exclue les bundles incompatibles avec le binaire installé. Guard `__DEV__` autour de l'OTA check (Updates.manifest undefined en dev).

#### Révocation session distante (#396 KB Admin + #400 app)

KB Admin web expose une page **Sessions actives** par tenant avec bouton « Révoquer » par ligne. Mutation `revokeSession(sessionId)` invalide le token Convex Auth de la session ciblée.

Côté app native : listener temps réel du statut token. Si token invalide détecté en mode authentifié → écran bloquant **« Session révoquée — contactez KB »** pendant ~3s → logout local automatique → redirect `(auth)/sign-in`. SLA : apparition de l'écran révoqué en **< 5s** après la révocation depuis KB Admin. Compliance RGPD (Article 2 ter contrat) : vol / perte / employé licencié / device en SAV.

#### Alertes statut tenant (#411)

Subscription Convex sur `tenant.stripeStatus` et `tenant.uberDirectStatus`.

**Critiques (écran rouge full screen bloquant, même UX que Mode déconnecté)** :

- Stripe Connect `restricted` → _« Compte Stripe en attente — règle dans KB Admin »_ + lien
- Uber Direct disconnected / token expiré **ET** livraison est le seul mode actif du tenant

**Non-critiques (banner persistant en haut, app reste utilisable)** :

- KYC Stripe `pending_verification` → banner orange + CTA
- Refresh token Uber Direct dans < 7j → banner orange
- Uber Direct disconnected mais click&collect actif → banner rouge (mode dégradé livraison)
- Statut tenant incomplet → banner gris

Pas de push système V1 sur ces alertes (in-app only).

#### Audit log

- Toute action mutation côté backend log `actor`, `at`, `tenantId`, `orderId | tenantConfigId | itemId`, `action`, `payload`
- V1 = data layer présente (foundation `logAudit`), UI exposée KB Admin V2

#### Multi-device V1 (limité)

- V1 = 1 device actif par compte (logout auto sur ancien)
- **Exception** : mode tablette cuisine + téléphone gérant peuvent **coexister** si la tablette est en mode kiosque sur ce tenant — exploité par l'escalation push T+60s (#414)
- V2 = multi-device libre

### 14. Impression thermique cuisine (#412 + #416)

Intégration **Star Micronics WebPRNT** — HTTP-based sur la LAN du resto, **zéro module natif côté Expo** (pas de Bluetooth, pas de driver natif à packager).

**Auto-print à l'ack** : à la transition `nouvelle → en préparation` (cf. §5), si le tenant a une `printerConfig.starWebPrntUrl` non-vide, fire-and-forget HTTP POST vers l'imprimante avec ESC/POS body :

- Tenant name
- ID cmd
- Items + modifiers
- Notes client
- Tag mode (🚴 LIVRAISON / 🛍️ À EMPORTER)

**Bouton « Réimprimer »** sur la page Détail cmd : reprint manuel si le premier print a échoué.

**Pas de retry auto V1** : si l'imprimante est offline / IP invalide / printer en erreur → toast non-bloquant _« Impression échouée, vérifie l'imprimante »_ + log audit. L'app reste fonctionnelle, Khan peut lire la cmd à l'écran.

**Configuration imprimante** :

- **Côté app native (#418)** : champ « Adresse IP de l'imprimante » dans Settings + bouton « Tester l'impression »
- **Côté KB Admin (#416)** : même section dans la page tenant, **même state Convex partagé** (`tenant.printerConfig.starWebPrntUrl`) — changement côté admin → app native voit immédiatement via sub

**Tests sans imprimante physique** : utiliser le [simulator Star WebPRNT officiel](https://www.starmicronics.com/support/SDKDocumentation.aspx?type=Tools) qui s'enregistre comme une imprimante accessible en HTTP sur la LAN.

---

## Flows nominaux

1. **Nouvelle cmd reçue (Convex sub + push wakeup)** : Khan est dans son bureau, la sub Convex pousse la cmd à la tablette cuisine en < 5s, en parallèle iPhone vibre + son + lock screen → _« Buns & Bao — Nouvelle cmd 18 € → Smash double + frites »_ → unlock + swipe → app ouvre sur card → tap _« Accepter »_ → ticket s'imprime auto sur Star → cuisinier prépare → tap _« Prête »_ → courier arrive → tap _« Remise »_ → cmd archivée. Côté KB Admin, la cmd apparaît dans l'historique sous l'onglet _« Livrées »_.
2. **Cmd click & collect** : push _« Buns & Bao — Cmd à emporter 16 € »_ → tag visuel **🛍️ À EMPORTER** → workflow : Accepter → Prête → _« Remise au client »_ → état terminal `collectée` → archivée.
3. **Walid switche entre ses 3 restos (mode téléphone)** : Walid login app → écran d'accueil affiche Thai Street Saint Michel par défaut (dernier sélectionné) → tap switcher en header → choisit Thai Street Châtelet → écran rafraîchi avec les cmds du 2ᵉ resto. En mode kiosque, le switcher serait caché.
4. **Refus surcharge cuisine** : cuisine débordée → tap _« Refuser »_ sur cmd nouvelle → étape 1 : choisit _« Surcharge cuisine »_ → étape 2 : confirme → refund Stripe auto + push client motivé _« désolé, surcharge »_.
5. **Auto-expired timeout** : cmd reçue à 12h00, Khan absent (téléphone perso oublié, tablette HS) → à 12h05 le scheduler Convex passe la cmd en `auto_expired` → refund Stripe auto + push client **neutre** _« Votre commande n'a pas pu être traitée »_. Cmd visible dans Historique → onglet _« Manquées »_. Si Khan dépasse le seuil de cmds manquées/jour, KB ops reçoit alerte (#415).
6. **Escalation T+60s** : cmd reçue à 12h00, ni la tablette ni le téléphone n'ack à 12h01 → re-trigger push _« URGENT — cmd non prise »_ sur les 2 devices → Khan voit la notif sur son téléphone, ouvre l'app, ack.
7. **Pause exceptionnelle** : frigo cassé à 19h05 → Khan tap _« Pause »_ sur le home → choisit _« 30 min »_ → PWA client affiche _« Resto en pause, reprise 19:35 »_ + checkout désactivé → après 30 min auto-reprise.
8. **Toggle item indispo** : rupture surprise du smash double à 20h → Khan ouvre Menu dans l'app → toggle « Smash double » indispo. Premier usage du toggle → tooltip _« Ce toggle masque l'item du menu côté client. Pas de modification permanente — il restera disponible dans ton catalogue KB Admin. »_ → dismiss. Le client qui a smash double au panier voit erreur à `confirmPayment`.
9. **Modif horaires soir** : un seul cuisinier ce soir → Khan ouvre Modif horaires → onglet _« Aujourd'hui »_ → ferme 22h au lieu de 23h → PWA client bloque le checkout dès 22h.
10. **Mode déconnecté** : tablette perd le wifi → 5s plus tard écran rouge plein écran _« Connexion perdue »_ → wifi revient → écran disparaît automatiquement.
11. **Force update natif** : faille sécurité détectée → KB ops mute `minSupportedBuildVersion` côté Convex → toutes les tablettes anciennes affichent au boot écran rouge bloquant avec lien Play Store / App Store.
12. **Session révoquée (vol tablette)** : tablette volée → KB Admin ouvre Sessions actives du tenant → tap _« Révoquer »_ sur la session de la tablette → 2-step confirm → la tablette voit dans les 5s écran _« Session révoquée — contactez KB »_ → logout auto → retour login.

## Edge cases

- **App fermée (kill swipe)** : iOS continue de recevoir push système. Si user a kill-swipe-killed l'app et désactivé les notifs en OS, banner rouge §3 visible à la reconnexion.
- **Téléphone mode silencieux** : son désactivé mais vibration + notif visuelle persistent. Sub Convex rattrape au foreground.
- **Connexion perdue** : pas de cache local V1 — écran rouge §13 (Mode déconnecté) jusqu'au retour de la sub. Mitigé par scheduler `auto_expired` côté backend.
- **Plusieurs cmds simultanées** : toutes affichées, son distinct si rafale > 3 (V2 — V1 = son unique).
- **Modification cmd par client après envoi** (V3) : pas autorisé V1.
- **Push refusé au niveau OS** : banner rouge §3 + fallback in-app via Convex sub (la cmd arrive quand même via sub, juste pas de wakeup OS). Escalation T+60s ne fait pas non plus de wakeup si OS bloqué — mais l'app foreground voit la cmd via sub.
- **Multi-device pour 1 user** : V1 = 1 device actif (logout auto), exception kiosque tablette + téléphone gérant si tablette en mode kiosque (cf. §13 multi-device).
- **Tablette battery dead** : alerte ops si pas de heartbeat 1h (V2). SMS fallback vers tel gérant (V2). En V1, le téléphone gérant reçoit l'escalation T+60s si la tablette est HS.
- **Internet coupé en cuisine** : écran rouge Mode déconnecté §13. Aucune cmd reçue tant que la sub n'est pas back — le push wakeup ne suffit pas sans sub Convex. Critère : si la tablette est HS / offline > 5 min, les cmds passent en `auto_expired` côté backend, refund client.
- **Multi-tenant user (Walid) reçoit push** : la notif indique **clairement le tenant concerné** (titre = _« Thai Street Châtelet — Nouvelle cmd »_).
- **Item togglé indispo avec cart actif** : revalidation à `confirmPayment` côté PWA client → erreur claire au client (cf. §7c).
- **Pause exceptionnelle expirée pendant qu'une cmd est en `en préparation`** : la cmd reste active (la pause bloque les NOUVELLES cmds, pas les en-cours).
- **Imprimante Star offline à l'ack** : toast erreur non-bloquant, l'app reste fonctionnelle, Khan peut Réimprimer plus tard (cf. §14).
- **Force update détecté pendant qu'une cmd est `en préparation`** : le gate s'applique au prochain reload — pas d'interruption mid-session (iOS App Store contrainte respectée).

## Acceptance criteria V1

22 critères dérivés directement des 26 stories `ready-for-agent` (#393–#418) :

- [ ] **AC1 (#393)** Toggle kiosque/téléphone affiché au premier login sur un device sans préférence, choix persisté côté Convex + local
- [ ] **AC2 (#394)** Force update gate au boot : couche OTA (criticalIndex bumpé → reload auto) + couche native (`nativeBuildVersion < minBuildVersion` → écran rouge bloquant store)
- [ ] **AC3 (#395)** Permission push OS refusée → banner rouge persistant en haut des routes `(app)` + bouton `Linking.openSettings()`
- [ ] **AC4 (#396)** KB Admin : page Sessions actives par tenant + bouton Révoquer (2-step confirm) + RBAC respecté + mutation invalide le token Convex Auth
- [ ] **AC5 (#397)** KB Admin : 4 toggles disponibilité commerciale (pause / fermeture / item / horaires) en mirror state Convex partagé avec app native
- [ ] **AC6 (#398)** Séquence onboarding post-login : push prompt → choix kiosque → checklist volume/veille → home ; skip aux re-launches via `device.onboardingCompleted`
- [ ] **AC7 (#399)** Switcher tenant visible en mode téléphone + caché en mode kiosque, sélection persistée par device, queries scopées sans leak cross-tenant
- [ ] **AC8 (#400)** App détecte token invalide en temps réel → écran _« Session révoquée »_ < 5s → logout local + redirect login
- [ ] **AC9 (#401)** Happy path direct livraison E2E : Convex sub < 5s p95 + push wakeup + home card + detail tap-to-reveal + workflow Accept → Prête → Remise coursier ; pas de badge `direct`
- [ ] **AC10 (#402)** Happy path click & collect E2E : tag 🛍️ À EMPORTER + workflow Remise client + état terminal `collectée` ; tenant mixte = 2 modes coexistent sur le home
- [ ] **AC11 (#403)** Refus depuis `nouvelle` : 2-step confirm + 4 motifs + refund Stripe immédiat + push client motivé + audit log
- [ ] **AC12 (#404)** Auto-expired timeout 5 min : `scheduler.runAfter` idempotent, transition `nouvelle → auto_expired` distinct de `refusée`, refund + push client neutre
- [ ] **AC13 (#405)** Mode déconnecté : écran rouge full screen quand Convex sub broken > 3-5s ; disparition automatique au reconnect
- [ ] **AC14 (#406)** Pause exceptionnelle 15/30/60 min depuis app native : `pauseUntil` + auto-resume scheduler + impact PWA client (checkout désactivé)
- [ ] **AC15 (#407)** Fermeture exceptionnelle 1+ jour : date picker début/fin + réversible + impact PWA client _« Resto fermé jusqu'au JJ/MM »_
- [ ] **AC16 (#408)** Toggle dispo item + tooltip premier usage avec texte exact + granularité item seulement + revalidation PWA client à `confirmPayment`
- [ ] **AC17 (#409)** Modif horaires aujourd'hui / cette semaine depuis app native ; horaires permanents restent KB Admin seul
- [ ] **AC18 (#410)** Stats rapides V1 : 4 cards (CA jour, nb cmds, CA semaine, delta S-1) + exclut `refusée` / `auto_expired` + subscription temps réel
- [ ] **AC19 (#411)** Alertes statut tenant : critiques (Stripe restricted / Uber Direct seul mode KO) = écran rouge full screen ; non-critiques = banner persistant
- [ ] **AC20 (#412 + #416)** Impression Star WebPRNT : auto-print à l'ack + reprint manuel + config IP dans Settings (app + KB Admin) + state Convex partagé + simulator Star valide les E2E
- [ ] **AC21 (#413 + #414)** Refus 3-step depuis `en préparation`/`prête` (anti-fat-finger) + escalation push T+60s sur tous devices subscribed du tenant (idempotent)
- [ ] **AC22 (#415 + #417 + #418)** Historique 4 onglets côté app + côté KB Admin + alerte ops si `auto_expired/jour` > seuil ; Settings complets (profil, notifs, compte, imprimante, switcher, kiosque toggle, logout, version, support)

### Transverses (depuis v1.0)

- [ ] App déployée App Store + Play Store
- [ ] Notifs push système fiabilité > 95% mesuré sur 30 j
- [ ] Latence cmd backend → device : **< 5 sec p95** via Convex sub
- [ ] Workflow cmd complet utilisable depuis l'app sans aller sur KB Admin web
- [ ] App responsive : iPhone SE → iPhone Pro Max, Android petits écrans → tablettes 10"
- [ ] Tests sur 5+ devices physiques (iOS 16+, Android 12+)
- [ ] **0 cmd perdue silencieusement** : toute cmd payée apparaît dans l'app < 5s ou bascule en `auto_expired` à T+5min avec refund auto

### V2 (rappel)

- [ ] Multi-staff cuisinier (login limité, audit per-staff)
- [ ] Multi-device libre pour 1 owner
- [ ] Dark mode + accessibilité étendue
- [ ] Migration Stripe manual capture (ADR de remplacement)

## Dépendances

| Dépendance                                                       | Type       | Bloque quoi                                                                                 |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| Stack mobile native (Expo + Expo Router + NativeWind, acté)      | Tech       | Tout (apps/native déjà initialisé)                                                          |
| APNs (Apple Push Notification Service)                           | Externe    | Push iOS (wakeup)                                                                           |
| FCM (Firebase Cloud Messaging)                                   | Externe    | Push Android (wakeup)                                                                       |
| Convex subscription temps réel                                   | Interne    | Source de vérité cmds (réception, sync)                                                     |
| Convex `scheduler.runAfter`                                      | Interne    | Auto-expired §6b + escalation §6c                                                           |
| App Store + Play Store dev accounts                              | Compliance | Déploiement + force update store links                                                      |
| EAS Update                                                       | Externe    | Force update couche OTA ([ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md)) |
| Star Micronics WebPRNT + simulator                               | Externe    | Impression thermique §14                                                                    |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md)   | Interne    | Refund refus + refund auto_expired                                                          |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md)       | Interne    | Statut courier, alertes critiques §13                                                       |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)               | Interne    | Auth + RBAC + `user_tenants`                                                                |
| [60_integration_marketplaces.md](60_integration_marketplaces.md) | Interne    | Cmds marketplace via Hubrise (V2)                                                           |
| [70_kb_admin.md](70_kb_admin.md)                                 | Interne    | SSO + paramétrage tenant + Sessions actives + toggles dispo mirror                          |
| [80_notifications.md](80_notifications.md)                       | Interne    | Triggers push backend + templates                                                           |
| Tablette Samsung Galaxy Tab A9 ou BYOD                           | Hardware   | Mode kiosque cuisine                                                                        |

## Open questions

| Q         | Question                                                                                | Statut                                                                                                     | Owner    |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| ~~20-Q1~~ | ~~Stack mobile : RN/Expo/Flutter/Swift+Kotlin ?~~                                       | **Résolue** — Expo + Expo Router + NativeWind                                                              | —        |
| 20-Q2     | Soumission App Store en Phase 2 (semaine 6) pour anticiper review : faisable ?          | Ouverte                                                                                                    | Dev lead |
| 20-Q3     | App native pour staff cuisinier (login limité) en V1 ou V2 ?                            | **V2** (audit monolithique acté V1, axe 2 grilling)                                                        | Alex     |
| ~~20-Q4~~ | ~~Notifs sons différents par source (direct / Uber Eats / Deliveroo) en V1 ou V2 ?~~    | **Résolue** — V2 (V1 pas de marketplace, son unique)                                                       | —        |
| 20-Q5     | Mode kiosque tablette : lock task Android natif ou solution tiers (Scalefusion, etc.) ? | Ouverte                                                                                                    | Dev lead |
| ~~20-Q6~~ | ~~Update mandatoire (force update) : config V1 ou laisser V2 ?~~                        | **Résolue** — V1, pattern Expo 2 couches [ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md) | —        |
| ~~20-Q7~~ | ~~Multi-device pour 1 user V1 (téléphone + tablette en même temps) ou V2 ?~~            | **Résolue** — V1 limité (exception kiosque + téléphone gérant, exploité par escalation #414), V2 libre     | —        |
| ~~20-Q8~~ | ~~Mécanisme polling fallback si push perdu : intervalle (30 s / 60 s / 5 min) ?~~       | **Résolue** — Convex sub = SoT, pas de polling. Escalation push T+60s, timeout auto_expired T+5min         | —        |
| ~~20-Q9~~ | ~~Refus cmd : remboursement immédiat ou différé 24 h ?~~                                | **Résolue 2026-05-25** — IMMÉDIAT                                                                          | —        |
| 20-Q10    | Multi-tenant switcher UX : header / sidebar / bottom-sheet ?                            | Ouverte (recommandation header V1)                                                                         | Produit  |

## Notes / décisions actées

- **Une seule app native**, pas de PWA tablette. La tablette cuisine = même build, installation native, mode kiosque toggle au premier login.
- **Notifs push système** (APNs / FCM) = **wakeup uniquement** v1.4. **Convex sub = source de vérité**.
- **SSO avec KB Admin** : 1 compte user accessible web et mobile.
- **Multi-tenant per user dès V1** — switcher dans l'app, caché en kiosque. Cf. [50](50_multi_tenant_saas.md) data model `user_tenants`.
- **Audit monolithique V1** (axe 2) — actions attribuées au KB Manager session du device, multi-staff = V2 (Q20-Q3).
- **Disponibilité commerciale = app + KB Admin partagés** ([ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md)) ; **édition catalogue = KB Admin seul** V1 et V2.
- **Auto-expired distinct de refusée** ([ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md)) — signaux orthogonaux, métriques différentes, templates push différents.
- **Stripe auto-capture + refund** (V1) — migration vers manual capture envisagée V2+ ([ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md)).
- **Force update 2 couches** ([ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md)) — pattern Expo officielle, pas de truc maison.
- **Impression thermique via Star WebPRNT** (HTTP LAN) — zéro module natif, simulator officiel pour les tests.
- **Uber Eats Orders app ne peut pas afficher cmds Uber Direct** (architectural). KB Orders gère les deux cas (direct + marketplace via Hubrise V2) dans une seule UI.

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 1.0     | Alex (via Claude) | **Création par fusion** des anciens `20_kds_resto.md` v0.2 + `76_app_native_resto.md` v0.1. Suppression de la PWA tablette comme produit séparé (la tablette = même app native installée). Multi-tenant per user V1 (cas Walid). Anciens fichiers : [docs/\_archive/](../_archive/).                                                                                                                                                                                                                                         |
| 2026-06-03 | 1.1     | Alex (via Claude) | **Grilling axe 1 — Fiabilité réception** : Convex sub = transport primaire, push APNs/FCM = wakeup. Mode déconnecté écran rouge full screen quand sub broken. Force update 2 couches au boot (criticalIndex OTA + minSupportedBuildVersion natif, [ADR 0017](../adr/0017-force-update-expo-pattern-deux-couches.md)). Auto-expired timeout 5 min via `scheduler.runAfter`, état terminal distinct ([ADR 0016](../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md)). Escalation push T+60s sur tous devices. |
| 2026-06-03 | 1.2     | Alex (via Claude) | **Grilling axe 2 — Auth tablette + mode kiosque + audit monolithique** : toggle kiosque/téléphone au premier login, tenant pinné + switcher caché en kiosque, séquence onboarding post-login (push prompt + checklist réglages), audit attribué au KB Manager de la session sur le device V1 (multi-staff = V2 Q20-Q3), Sessions actives + révocation depuis KB Admin avec écran « Session révoquée » côté app.                                                                                                              |
| 2026-06-03 | 1.3     | Alex (via Claude) | **Grilling axe 3 — Périmètre V1 étendu** : pause exceptionnelle 15/30/60 min, fermeture exceptionnelle 1+ jour, toggle dispo item avec tooltip premier usage, modif horaires aujourd'hui/semaine depuis app native ([ADR 0018](../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md)). Impression thermique cuisine Star WebPRNT (HTTP LAN, zéro module natif). Édition catalogue reste KB Admin seul V1+V2.                                                                                              |
| 2026-06-03 | 1.4     | Alex (via Claude) | **Audit complet** : tap-to-reveal tels client/coursier (Q3.6), pas de CTA appeler (Q4.2), pas de badge `direct` V1 (Q3.3), beep boucle 30s+ retiré (remplacé par escalation push T+60s). 22 ACs publiés (un par story #393–#418 + transverses). Q4/Q6/Q7/Q8 marquées résolues. 26 stories ready-for-agent publiées via `/to-issues`.                                                                                                                                                                                         |
