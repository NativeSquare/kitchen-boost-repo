# KB Orders

Le contexte de l'app native iOS + Android du restaurateur, équivalent direct **Uber Eats Orders**. Surface unique pour la gestion opérationnelle des commandes côté cuisine + côté gérant : nouvelle → prep → prête → remise. **Une seule app native**, installable au choix sur téléphone perso du gérant ou tablette en cuisine (mode kiosque).

PRD : [20_kb_orders.md](../../prd/20_kb_orders.md)

> **Note de fusion** : ce contexte résulte du regroupement des anciens `kitchen-display` (KDS PWA tablette) et `merchant-mobile` (app native). La PWA tablette n'existe plus comme produit séparé. La PWA reste **uniquement** côté [[Client Ordering]].

## Language

**App native** :
Application installée depuis App Store + Play Store. Stack (RN/Expo/Flutter/Swift+Kotlin) = décision dev lead (Q20-Q1), pas PRD. SSO avec [[KB Admin]]. Surface unique pour téléphone ET tablette cuisine (même build).
_Avoid_: Native app, Mobile app (générique), PWA (à éviter — la PWA est côté client)

**APNs** (Apple Push Notification Service) :
Service Apple pour push système iOS. Fiabilité **élevée** même app fermée ou device en veille — différenciateur principal vs push web PWA.
_Avoid_: iOS push, Apple push

**FCM** (Firebase Cloud Messaging) :
Équivalent APNs côté Android. Géré via SDK Firebase ou wrapper si stack cross-platform.
_Avoid_: Android push, Google push

**Push système** :
Notification déclenchée par APNs ou FCM, **opposée** au push web (Web Push API + VAPID via service worker, cf. [[Notifications]]). Fiabilité supérieure. Atterrit en lock screen + vibration + son.
_Avoid_: Native push, App push

**Card cmd** :
Représentation visuelle d'une cmd sur l'écran KB Orders. Contient : ID, items, modifiers, total, ETA livraison ou pickup, statut, source (icône direct / Uber Eats / Deliveroo), tag mode (🚴 LIVRAISON / 🛍️ À EMPORTER).
_Avoid_: Tile, Ticket (peut être confondu avec impression thermique V3)

**Workflow status** :
État dans la machine d'états d'une cmd côté KB Orders : `nouvelle` → `en préparation` → `prête` → `remise` → état terminal selon le mode : `livrée` (mode livraison) ou `collectée` (mode click & collect / pickup). Après l'état terminal, la cmd disparaît de l'écran d'accueil (archivée). Si refusée, état = `refusée` + refund auto.
_Avoid_: Status (générique), Etape

**`livrée`** :
État terminal d'une cmd en **mode livraison** : le coursier Uber Direct a récupéré et la course est complétée. Distinct de `remise` (acte physique au coursier) — c'est la clôture de la commande côté livraison.
_Avoid_: Delivered, Terminée (générique)

**`collectée`** :
État terminal d'une cmd en **mode click & collect / pickup** : le client est venu chercher la cmd en boutique. Distinct de `remise` (acte physique au client) — c'est la clôture de la commande côté retrait.
_Avoid_: Collected, Picked-up, Récupérée

**Acknowledged** (Accepter) :
Action du cuisinier qui passe une cmd de `nouvelle` à `en préparation`. Stoppe le beep en boucle.
_Avoid_: Accept (anglicisme), Validate

**Pause exceptionnelle** :
Statut transitoire du tenant (15, 30, 60 min) qui désactive le checkout côté [[Client Ordering]] mais laisse les cmds en cours actives. Différent de `fermé` (horaire normal) et `ouvert` (statut nominal).
_Avoid_: Snooze, Suspended

**Refusal** (Refus) :
Action du cuisinier qui annule une cmd nouvelle avec une raison (rupture / fermeture / surcharge / autre). Trigger **refund auto** Stripe + push client + log audit. Confirmation à 2 étapes pour éviter tap accidentel.
_Avoid_: Cancel (ambigu — peut venir du client), Reject

**Remise** :
Acte physique de donner la cmd prête. Deux variantes selon mode de la cmd :

- **Remise au coursier** (mode livraison) : courier Uber Direct récupère.
- **Remise au client** (mode click & collect) : client vient chercher en boutique.
  Le bouton de transition `prête → remise` est adapté au mode.
  _Avoid_: Handover, Dispatch

**Mode kiosque tablette** :
Configuration de l'app native sur tablette cuisine en plein écran (lock task Android / guided access iOS / pinning). Empêche sortie accidentelle. Auth via code PIN raccourci au lieu d'email/password. Beep volume max, écran always-on.
_Avoid_: Kiosk mode (acceptable mais "mode kiosque" plus précis), Full-screen

**BYOD** (Bring Your Own Device) :
Le tenant utilise sa propre tablette (vs tablette fournie par KB Samsung Galaxy Tab A9 ~99 €). MVP = BYOD préféré pour éviter coût logistique hardware.
_Avoid_: Owned device, Self-hosted

**Switcher tenant** :
Sélecteur en header de l'app permettant à un [[KB Manager]] attaché à N tenants (cas Walid Thai Street) de choisir le tenant courant. Vide ou caché si user 1-tenant (cas Khan).
_Avoid_: Tenant picker, Switch resto

**SSO avec KB Admin** :
Login unifié : 1 compte user, accessible depuis [[KB Admin]] (web) ou KB Orders (app). JWT refresh régulier. Pas de mots de passe distincts.
_Avoid_: OAuth (technique sous-jacente)

**Beep** :
Signal sonore audible 5 m+ déclenché à chaque nouvelle cmd. **En boucle 30 s** si non acknowledged. Configurable par tenant (son, volume).
_Avoid_: Alert sound, Chime

**Background fetch** :
Mode où l'app native peut réveiller le système pour traiter une notif même si elle n'est pas au premier plan. Critique pour réception push fiable.
_Avoid_: Background mode

**Multi-device pour 1 user** (V2) :
Capacité pour 1 owner de garder l'app active sur téléphone + tablette en parallèle. V1 = 1 device actif par compte (logout auto sur ancien), **exception** : mode tablette cuisine + téléphone gérant peuvent coexister si la tablette est marquée "device cuisine partagé".
_Avoid_: Multi-session

**Force update** (Q20-Q6) :
Mécanisme failsafe qui bloque l'app si version < seuil et impose la mise à jour. Pour cas critiques (bug, fuite cross-tenant détectée).
_Avoid_: Mandatory upgrade

## Example dialogue

**Alex** : Pourquoi pas garder le KDS en PWA tablette comme on avait ?

**Dev** : Parce que les push web sur PWA hors PWA active = peu fiables, surtout iOS. APNs/FCM sur l'app native = quasi 100 %. Et maintenir 2 codebases (PWA tablette + native téléphone) pour le même workflow = coût. Une seule app native installée sur tablette en mode kiosque + sur le téléphone du gérant = même build, fiabilité maximale, moins de code à maintenir.

**Alex** : Khan a la tablette en cuisine ET son iPhone perso. Il reçoit la cmd 2 fois ?

**Dev** : Oui, chaque device subscribed reçoit le push. Pas un bug — c'est une redondance voulue. Si la tablette est en veille ou la batterie morte, Khan reçoit quand même sur son tel. Beep tablette + vibration tel.

**Alex** : Walid switche entre ses 3 restos ?

**Dev** : Sélecteur en header (récup depuis JWT `tenant_ids`). Tap → recharge contexte → écran d'accueil filtré sur ce tenant. Persistance device-side via cookie (`kb_current_tenant`). Le push reçu indique **clairement** le tenant concerné dans le titre ("Thai Street Châtelet — Nouvelle cmd 22 €") pour éviter confusion.

**Alex** : Si Khan refuse une cmd ?

**Dev** : Bouton "Refuser" sur la card nouvelle → choix raison → confirmation 2 étapes → refund Stripe auto + push client. Log dans audit trail côté [[KB Admin]].
