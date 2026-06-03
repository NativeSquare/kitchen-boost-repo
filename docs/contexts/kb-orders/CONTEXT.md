# KB Orders

Le contexte de l'app native iOS + Android du restaurateur, équivalent direct **Uber Eats Orders**. Surface unique pour la gestion opérationnelle des commandes côté cuisine + côté gérant : nouvelle → en préparation → prête → remise → livrée / collectée. **Une seule app native**, installable au choix sur téléphone perso du gérant ou tablette en cuisine (mode kiosque).

PRD : [20_kb_orders.md](../../prd/20_kb_orders.md) v1.4 (grilling 2026-06-03)

> **Note de fusion** : ce contexte résulte du regroupement des anciens `kitchen-display` (KDS PWA tablette) et `merchant-mobile` (app native). La PWA tablette n'existe plus comme produit séparé. La PWA reste **uniquement** côté [[Client Ordering]].
>
> **Note de grilling (2026-06-03)** : 3 axes verrouillés, 26 stories publiées (#393–#418). Source de vérité réception = **Convex subscription**, push APNs/FCM = **wakeup uniquement**. Cf. ADRs [0016](../../adr/0016-timeout-acceptation-auto-expired-stripe-auto-capture.md), [0017](../../adr/0017-force-update-expo-pattern-deux-couches.md), [0018](../../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md).

## Language

**App native** :
Application installée depuis App Store + Play Store. Stack actée : **Expo + Expo Router + NativeWind** (acté V1, Q20-Q1 fermée). SSO avec [[KB Admin]]. Surface unique pour téléphone ET tablette cuisine (même build, comportement adapté par mode kiosque/téléphone).
_Avoid_: Native app, Mobile app (générique), PWA (à éviter — la PWA est côté client)

**APNs** (Apple Push Notification Service) :
Service Apple pour push système iOS. **Rôle V1 : wakeup uniquement** — la source de vérité de la réception est la sub Convex. Le push réveille l'app si pas foreground, mais ne porte pas la cmd.
_Avoid_: iOS push, Apple push

**FCM** (Firebase Cloud Messaging) :
Équivalent APNs côté Android. **Wakeup uniquement** V1, sub Convex = SoT.
_Avoid_: Android push, Google push

**Push système** :
Notification déclenchée par APNs ou FCM, **opposée** au push web (Web Push API + VAPID via service worker, cf. [[Notifications]]). Fiabilité supérieure. Atterrit en lock screen + vibration + son. **V1 : sert de wakeup pour que l'app se synchronise via sub Convex**.
_Avoid_: Native push, App push

**Convex subscription** :
Subscription temps réel sur les cmds + statut tenant + sessions. **Source de vérité primaire** pour la réception des cmds V1 (post-grilling 2026-06-03). Si la sub est broken → écran rouge full screen `Mode déconnecté`. Sans sub vivante, l'app est aveugle même si le push système arrive.
_Avoid_: Realtime sub (trop générique), Live query

**Card cmd** :
Représentation visuelle d'une cmd sur l'écran KB Orders. Contient : ID, items, modifiers, total, ETA livraison ou pickup, statut, **tag mode 🚴 LIVRAISON / 🛍️ À EMPORTER**. **Pas de badge `direct` en V1** (acté Q3.3) — l'icône source n'apparaît que pour les marketplaces V2.
_Avoid_: Tile, Ticket (peut être confondu avec impression thermique §14)

**Workflow status** :
État dans la machine d'états d'une cmd côté KB Orders : `nouvelle` → `en préparation` → `prête` → `remise` → état terminal selon mode : `livrée` (mode livraison) ou `collectée` (mode click & collect / pickup). **Deux états terminaux alternatifs distincts** : `refusée` (refus humain via §6a) et `auto_expired` (système, timeout 5 min via §6b, cf. ADR 0016).
_Avoid_: Status (générique), Etape

**`livrée`** :
État terminal d'une cmd en **mode livraison** : le coursier Uber Direct a récupéré et la course est complétée. Distinct de `remise` (acte physique au coursier) — c'est la clôture de la commande côté livraison.
_Avoid_: Delivered, Terminée (générique)

**`collectée`** :
État terminal d'une cmd en **mode click & collect / pickup** : le client est venu chercher la cmd en boutique. Distinct de `remise` (acte physique au client) — c'est la clôture de la commande côté retrait.
_Avoid_: Collected, Picked-up, Récupérée

**`refusée`** :
État terminal d'une cmd refusée **par un humain** via §6a — bouton « Refuser » avec choix motif explicite (`rupture | fermeture | surcharge | autre`). 2-step depuis `nouvelle`, 3-step anti-fat-finger depuis `en préparation` / `prête`. Refund Stripe immédiat + push client motivé. **Distinct** de `auto_expired` (signaux orthogonaux, cf. ADR 0016).
_Avoid_: Reject, Cancel (ambigu, peut venir du client)

**Cmd manquée (`auto_expired`)** :
État terminal alternatif à `refusée` quand le **système** expire la cmd au timeout (5 min sans acknowledgment via `scheduler.runAfter` Convex). **Distinct** de `refusée` parce que les signaux business divergent — un resto qui refuse 5 cmds/jour = signal business (rupture stock), un resto qui en `auto_expired` 5 = signal opérationnel (tablette HS, Khan AFK). Refund Stripe automatique + push client **neutre** (pas de motif). Cf. ADR 0016.
_Avoid_: Expired, Timed-out (génériques), Refusée timeout

**Timeout d'acceptation** :
Délai de **5 minutes** posté en `scheduler.runAfter` Convex à chaque `paymentSucceeded`. Si la cmd est encore `nouvelle` à l'expiration, le job idempotent la transitionne vers `auto_expired` + refund + push neutre. **Failsafe contractuel** du KPI « 0 cmd perdue ». Cf. ADR 0016 + PRD 20 §6b.
_Avoid_: Acceptance deadline, Order timeout

**Escalation push** :
Re-trigger des notifs push APNs/FCM **à T+60s** sans acknowledgment, sur **tous les devices subscribed du tenant** (tablette cuisine + téléphone gérant). Corps distinct _« URGENT — cmd non prise »_. Idempotent : si un device ack avant T+60s, l'escalation no-op. Exploite la coexistence multi-device autorisée V1 (kiosque + téléphone gérant). Cf. PRD 20 §6c.
_Avoid_: Re-push, Retry push

**Acknowledged** (Accepter) :
Action du cuisinier qui passe une cmd de `nouvelle` à `en préparation`. **Déclenche l'auto-print** (cf. `Impression thermique cuisine`). **Stoppe l'escalation push T+60s** + le scheduler `auto_expired` (idempotent côté backend).
_Avoid_: Accept (anglicisme), Validate

**Mode déconnecté** :
État affiché lorsque la **Convex subscription est cassée** au-delà de 3-5 secondes (perte wifi, backend down). Écran rouge **full screen bloquant** style Uber Eats — _« Connexion perdue, vérifie ton réseau »_. Transitoire : disparaît automatiquement au reconnect. Pas de cache local, pas de queue offline V1 — la sub Convex est la SoT. Empêche le restaurateur d'interpréter l'absence de cmd comme un calme alors qu'il est aveugle. Si auth expirée, ramène au login. Cf. PRD 20 §13.
_Avoid_: Offline mode (suggère cache local), Network error

**Disponibilité commerciale** :
Périmètre d'actions **"ici et maintenant"** sur l'offre du tenant, accessibles depuis **les deux apps** (KB Admin web + KB Orders native) avec synchro temps réel Convex (1 source de vérité). 4 surfaces V1 :

- **Pause exceptionnelle** (15/30/60 min)
- **Fermeture exceptionnelle** (1+ jour)
- **Toggle item indispo** (granularité item, pas catégorie V1)
- **Modif horaires d'ouverture du jour / de la semaine**

**Frontière vs édition catalogue** (KB Admin seul V1+V2) : création/suppression item, prix, description, photo, modifiers, toggle catégorie entière. Cf. [ADR 0018](../../adr/0018-frontiere-edition-catalogue-vs-disponibilite-commerciale.md).
_Avoid_: Live availability, Real-time menu (confond avec édition)

**Édition catalogue** :
Travail **posé**, sur grand écran, hors service : catégorisation, ordre, prix réfléchis, photo bien shootée, modifiers. **KB Admin seul** V1 et V2. Frontière trace par « fréquence × urgence × granularité » : action ponctuelle au calme → KB Admin ; action quotidienne en activité → KB Orders. Cf. ADR 0018.
_Avoid_: Menu editing (générique, confond avec disponibilité commerciale)

**Pause exceptionnelle** :
Statut transitoire du tenant **15, 30 ou 60 minutes uniquement** V1 (ETA reprise figée, pas de custom). Désactive le checkout côté [[Client Ordering]] mais laisse les cmds en cours actives. Auto-resume via `scheduler.runAt`. Différent de `fermé` (horaire normal) et de la **fermeture exceptionnelle** (durée 1+ jour). Synchro KB Admin ↔ app native. Cf. PRD 20 §7a.
_Avoid_: Snooze, Suspended, Pause (générique)

**Fermeture exceptionnelle** :
Statut tenant **durable 1+ jour** avec date de réouverture explicite (date picker début/fin). Cas d'usage : vacances annuelles, panne frigo, incident hygiène, intempéries. Réversible à tout moment. **Distinct** de la pause exceptionnelle (transitoire 15-60 min) et de la fermeture nominale (horaires d'ouverture standard). Impact PWA client : checkout désactivé + message _« Resto fermé jusqu'au JJ/MM »_. Cf. PRD 20 §7b.
_Avoid_: Long pause, Holiday mode

**Refusal** (Refus humain) :
Action **du cuisinier humain** qui annule une cmd avec une raison dans le closed set `rupture | fermeture | surcharge | autre`. Trigger **refund Stripe immédiat** + push + email client **motivé** + log audit. **2-step confirm depuis `nouvelle`** (#403), **3-step confirm depuis `en préparation`/`prête`** (#413, coût d'erreur fort = travail cuisine perdu). **Distinct du timeout d'acceptation** (`auto_expired`, système sans humain) — signaux orthogonaux, métriques distinctes. Cf. PRD 20 §6a + ADR 0016.
_Avoid_: Cancel (ambigu — peut venir du client), Reject, Refus (sans préciser humain — ambigu avec auto_expired)

**Remise** :
Acte physique de donner la cmd prête. Deux variantes selon mode de la cmd :

- **Remise au coursier** (mode livraison) : courier Uber Direct récupère.
- **Remise au client** (mode click & collect) : client vient chercher en boutique.
  Le bouton de transition `prête → remise` est adapté au mode.
  _Avoid_: Handover, Dispatch

**Mode kiosque tablette** :
Configuration de l'app native sur tablette cuisine, activée par **toggle au premier login** (#393 — pas d'auto-détection par form factor). Caractéristiques :

- **Tenant pinné** (`device.pinnedTenantId` stocké local + Convex)
- **Switcher tenant masqué**
- **Audit monolithique** (toutes actions attribuées au KB Manager session)
- Beep volume max programmatique
- `expo-keep-awake` actif tant que foreground
- Mode plein écran (lock task Android / guided access iOS) recommandé

Toggle re-modifiable depuis Settings (#418). Cf. PRD 20 §1 + §12.
_Avoid_: Kiosk mode (acceptable mais « mode kiosque » plus précis), Full-screen, Tablet mode

**Audit trail monolithique** :
V1 : **pas de login multi-staff** sur l'app tablette. Toutes les actions (Accept, Prête, Remise, Refus, toggles dispo, etc.) sont attribuées au **KB Manager dont la session est ouverte** sur ce device. Conséquence : pas de granularité par staff cuisinier V1. **V2 réouvre potentiellement** un sous-login staff (Q20-Q3). Acté axe 2 grilling.
_Avoid_: Single-user audit, Tenant-attributed audit

**BYOD** (Bring Your Own Device) :
Le tenant utilise sa propre tablette (vs tablette fournie par KB Samsung Galaxy Tab A9 ~99 €). MVP = BYOD préféré pour éviter coût logistique hardware.
_Avoid_: Owned device, Self-hosted

**Switcher tenant** :
Sélecteur en header de l'app permettant à un [[KB Manager]] attaché à N tenants (cas Walid Thai Street) de choisir le tenant courant. **Mode téléphone uniquement** — caché en mode kiosque (tenant pinné). Sélection persistée dans `device.lastSelectedTenantId`. Vide ou caché si user 1-tenant (cas Khan). Cf. PRD 20 §1b + #399.
_Avoid_: Tenant picker, Switch resto

**SSO avec KB Admin** :
Login unifié : 1 compte user, accessible depuis [[KB Admin]] (web) ou KB Orders (app). Convex Auth (tokens session, refresh régulier). Pas de mots de passe distincts. Sessions révocables depuis KB Admin (#396 + #400).
_Avoid_: OAuth (technique sous-jacente)

**Force update** :
Mécanisme failsafe **deux couches** au boot de l'app, suivant la pattern Expo officielle ([ADR 0017](../../adr/0017-force-update-expo-pattern-deux-couches.md)) :

1. **Couche OTA (JS)** — `expo.extra.criticalIndex` bumpé manuellement avant chaque release critique ; `Updates.checkForUpdateAsync()` + `fetchUpdateAsync()` + `reloadAsync()` blocage splash.
2. **Couche native (binaire)** — `Application.nativeBuildVersion` comparé à `minSupportedBuildVersion` servi par Convex query publique (pré-auth) ; si inférieur, écran rouge bloquant + lien store.

Pré-requis : `runtimeVersion: "fingerprint"`. Gate au root `app/_layout.tsx`. Pas de truc maison. Cf. PRD 20 §13 + #394.
_Avoid_: Mandatory upgrade, App version check

**Impression thermique cuisine** :
Intégration **Star Micronics WebPRNT** — **HTTP-based** sur la LAN du resto. **Pas de native module Expo nécessaire** (pas de Bluetooth, pas de driver à packager). Le KB Manager configure l'IP de l'imprimante dans Settings (#418) + côté KB Admin (#416) avec même state Convex partagé (`tenant.printerConfig.starWebPrntUrl`). **Auto-print à l'ack** (transition `nouvelle → en préparation`, fire-and-forget HTTP POST ESC/POS) + **bouton « Réimprimer »** sur Détail cmd. Pas de retry auto V1 : si printer KO, toast non-bloquant + log audit, l'app reste fonctionnelle. Tests via [simulator Star WebPRNT officiel](https://www.starmicronics.com/support/SDKDocumentation.aspx?type=Tools). Cf. PRD 20 §14 + #412.
_Avoid_: Receipt printer, Bluetooth printer, KDS printer

**Alerte statut critique** :
Bannière **full-screen rouge bloquante** (même UX que Mode déconnecté) déclenchée par certains statuts backend critiques pour le tenant — Stripe Connect `restricted` ou Uber Direct disconnected si la livraison est le seul mode actif. **Distincte** des banners non-critiques (KYC Stripe `pending_verification`, refresh token < 7j, Uber Direct disconnected mais click&collect dispo — banner orange/rouge persistant en haut, app reste utilisable). Pas de push système V1 sur ces alertes (in-app only). Cf. PRD 20 §13 + #411.
_Avoid_: Critical banner (peut prêter à confusion avec banner non-critique), Error screen

**Checklist réglages device** :
Étape de **séquence onboarding post-login** (#398) qui guide le KB Manager pour configurer le device :

- ☐ Volume à fond (instruction OS, non-programmable)
- ☐ Écran toujours allumé (Settings → Affichage → Auto-verrouillage = Jamais)
- Boutons « J'ai fait » par item, non-validation programmatique (juste guide UX)

Précédée du **push permission prompt** et du **choix mode kiosque/téléphone**. Skip aux re-launches via flag `device.onboardingCompleted` côté Convex. Cf. PRD 20 §1a.
_Avoid_: Onboarding tutorial, Setup wizard

**Beep** :
~~Signal sonore audible 5 m+ déclenché à chaque nouvelle cmd. En boucle 30 s si non acknowledged.~~ **v1.4 : retiré le beep en boucle 30s+**. En V1, le son nouvelle cmd se déclenche une fois (porté par le push système APNs/FCM) ; la persistance audible passe par l'**escalation push T+60s** (#414) qui re-déclenche le son sur tous les devices subscribed du tenant. En mode kiosque, le volume est programmatiquement maximisé via la séquence onboarding. Cf. PRD 20 §3 + §6c.
_Avoid_: Alert sound, Chime, Beep loop (n'existe plus V1)

**Background fetch** :
Mode où l'app native peut être réveillée par push wakeup APNs/FCM pour synchroniser via sub Convex. Critique pour la **resync au foreground** mais ne porte pas la cmd elle-même (la sub Convex le fait).
_Avoid_: Background mode

**Multi-device pour 1 user** :
V1 = **1 device actif par compte** (logout auto sur ancien). **Exception** : mode tablette kiosque + téléphone gérant peuvent coexister si la tablette est en mode kiosque sur ce tenant — exploité par l'escalation push T+60s (#414). V2 = multi-device libre. Cf. PRD 20 §13.
_Avoid_: Multi-session

## Example dialogue

**Alex** : Pourquoi pas garder le KDS en PWA tablette comme on avait ?

**Dev** : Parce que les push web sur PWA hors PWA active = peu fiables, surtout iOS. APNs/FCM sur l'app native = quasi 100 % en wakeup, et surtout la sub Convex temps réel rattrape même si le push est perdu. Une seule app native installée sur tablette en mode kiosque + sur le téléphone du gérant = même build, fiabilité maximale, moins de code à maintenir.

**Alex** : Khan a la tablette en cuisine ET son iPhone perso. Il reçoit la cmd 2 fois ?

**Dev** : Oui, chaque device subscribed reçoit le push wakeup + la cmd via sub Convex. Pas un bug — c'est une redondance voulue. Si la tablette est en veille ou la batterie morte, Khan reçoit quand même sur son tel. Et à T+60s sans ack, escalation push _« URGENT »_ sur les 2 devices (#414).

**Alex** : Walid switche entre ses 3 restos ?

**Dev** : Switcher en header (récup depuis Convex `user_tenants`), **mode téléphone uniquement**. Tap → recharge contexte → écran d'accueil filtré sur ce tenant. Persistance device-side via `device.lastSelectedTenantId`. En mode kiosque, le switcher est **caché** parce que le tenant est **pinné** sur le device. Le push reçu indique **clairement** le tenant concerné dans le titre (_« Thai Street Châtelet — Nouvelle cmd 22 € »_) pour éviter confusion.

**Alex** : Si Khan refuse une cmd ?

**Dev** : Si elle est encore `nouvelle` → 2-step confirm (motif + confirmation). Si elle est déjà `en préparation` ou `prête` → 3-step confirm (motif + _« es-tu sûr ? la cuisine a déjà commencé »_ + confirmation finale). Dans les 2 cas : refund Stripe immédiat + push client motivé + audit log. **Refus humain = état terminal `refusée`**, distinct de `auto_expired` (timeout système 5 min sans ack).

**Alex** : Et si Khan oublie complètement la cmd ?

**Dev** : Backend a posté un `scheduler.runAfter(5min)` au `paymentSucceeded`. À T+5min sans ack → transition automatique vers **`auto_expired`** (état distinct de `refusée`, cf. ADR 0016) + refund Stripe auto + push client **neutre** _« Votre commande n'a pas pu être traitée »_. Pas de stigmate marque. Côté KB Admin, ça apparaît dans l'onglet _« Manquées »_, et si Khan dépasse 3-5/jour, alerte ops automatique (#415).

**Alex** : Et si on perd internet en cuisine ?

**Dev** : Au bout de 3-5s sans reconnect de la sub Convex → **écran rouge full screen** _« Connexion perdue »_ (#405). Bloquant, l'app dit explicitement qu'elle est aveugle. Disparaît automatiquement au reconnect. Pas de cache local — la sub Convex est la source de vérité, point. Si la coupure dure > 5 min, les cmds nouvelles passent en `auto_expired` côté backend, refund auto, le client est protégé.

**Alex** : Tablette volée ?

**Dev** : Ops ouvre KB Admin → page Sessions actives du tenant → tap _« Révoquer »_ sur la session de la tablette → 2-step confirm → mutation `revokeSession()` invalide le token Convex Auth. Côté tablette, listener temps réel détecte token invalide → écran bloquant _« Session révoquée — contactez KB »_ < 5s → logout local + retour login (#396 + #400).
