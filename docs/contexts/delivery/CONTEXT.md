# Delivery

Le contexte du transport physique du repas du resto vers le client. **Uber Direct** est le seul transporteur V1 (self-signup par tenant), avec **click & collect** comme alternative modulable. Stuart en fallback V2.

PRD : [40_livraison_uber_direct.md](../../prd/40_livraison_uber_direct.md)

## Language

**Uber Direct** :
Service de livraison à la demande "white label" d'Uber Portier B.V. Tarif public ~5,90 € HT IDF. Le resto est client direct d'Uber (compte Uber Direct par tenant), pas KB.
_Avoid_: Uber Eats (différent — Uber Direct = whitelabel sans visibilité marketplace)

**Quote** (Delivery Quote) :
Devis de course retourné par `POST /delivery_quotes` Uber Direct. Inclut tarif + ETA. **Demandé dès la saisie d'adresse à l'arrivée sur la PWA (avant accès au menu, cf. [[Address-first flow]])** — pas au checkout. Re-capturé au paiement pour anti-surge (cf. [[Pricing]] latching).
_Avoid_: Estimate, Quote livraison

**Address-first flow** :
Parcours d'entrée PWA imposé : à l'arrivée sur la PWA tenant, **Sophie doit indiquer son adresse via Google Places autocomplete avant d'accéder au menu** (pattern identique à Uber Eats). Dès la saisie, KB déclenche un [[Quote]] Uber Direct. Selon résultat :
- **Quote OK** → mode livraison ouvert, frais livraison déjà connus pour le reste du parcours, le client peut composer son panier sereinement.
- **Quote refusé** (hors zone, hors horaire, surge bloquant) → **mode livraison verrouillé**, seul [[Click & collect]] reste disponible avec message contextualisé selon raison du refus : hors zone → "Cette adresse est trop éloignée du resto. Essaie une autre adresse ou viens chercher (click & collect)." / hors horaire → "Le resto est fermé, ouvre à 18h30." / surge bloquant → "Indisponible à cet horaire, réessaie dans quelques minutes." (Q40-Q9 acté 2026-05-24).
- Le client peut modifier son adresse à tout moment → re-déclenche un [[Quote]].

Évite la frustration de composer un panier complet puis se retrouver bloqué au paiement. Cohérent avec [[Customer Data]] : adresse captée upfront alimente la position géo (lat/lng) du customer record dès l'entrée. Q40-Q acté 2026-05-24.
_Avoid_: Checkout flow, Adresse au checkout, Menu-first

**Course** :
Une livraison effective créée via `POST /deliveries`. Possède un `uber_delivery_id`. Stockée dans `orders.uber_delivery_id`.
_Avoid_: Delivery (acceptable anglais), Ride (Uber-rider, à ne pas confondre)

**Course refusée par Uber (post-paiement)** :
Cas rare (quote validé en amont) où Uber refuse la création de la course après que le client ait payé (zone bloquée à la dernière minute, surge bloquant, erreur Uber). **V1 = refund auto immédiat** dès réception de l'échec API/webhook → push client "désolé, livraison non disponible, tu as été remboursé". Pas de proposition click & collect, pas de routage cross-resto, zéro friction. Cuisine non notifiée (cmd n'a jamais été transmise au KDS). Q40-Q6 acté 2026-05-24.
_Avoid_: Course échouée (ambigu — courier qui annule = cas différent)

**Courier annule avant pickup** :
Courier accepte puis se désiste avant d'avoir pris la cmd. Uber Direct **re-dispatche silencieusement** un autre courier (statut reste `pending`/`pickup`, juste un nouveau `courier_update` avec nouveau nom). **V1 KB = comportement passif** : on relaie le nouveau courier sur [[Tracking client]] et [[KB Orders]] sans message d'incident. **Push client "petit retard ⏰" UNIQUEMENT si glisse d'ETA cumulée > 10 min**. Pas de refund. Cohérent avec la promesse "smooth & transparent". Q40-Q acté 2026-05-24.
_Avoid_: Courier no-show (ambigu avec "client absent")

**Incident après pickup** (event `canceled` / `failed` Uber) :
Le courier a pris la cmd mais ne la livre pas (accident, panne, abandon — très rare). **V1 = refund auto total immédiat** (même flow que [[Course refusée par Uber (post-paiement)]]) + push client "incident livraison, tu as été remboursé, désolé" avec animation Lottie "incident" sur [[Tracking client]]. Côté [[KB Orders]], cmd marquée "incident — non livrée". Le resto récupère jusqu'à 60 €/cmd via le process refund Uber natif (cf. Uber Direct Refund Policies) — **KB n'intervient PAS dans la réclamation Uber/resto**, cohérent avec "KB pas merchant of record livraison" (Article 2 contrat). Q40-Q acté 2026-05-24.
_Avoid_: Course perdue, Cmd perdue

**Client absent** (event `returned` Uber) :
Le courier est arrivé au dropoff mais le client est introuvable. Courier attend ~10 min puis ramène la cmd au resto. **Le resto paie la course retour**. **V1 KB = PAS de refund auto** (le client est en faute). Push client "le coursier ne t'a pas trouvé, contacte le resto au [numéro] pour récupérer ta cmd". Côté [[KB Orders]], cmd marquée "client absent" + bouton refund manuel disponible (le resto décide d'un geste commercial). Q40-Q acté 2026-05-24.
_Avoid_: No-show, Livraison manquée

**Courier** (Coursier) :
La personne physique qui effectue la course Uber Direct. Téléphone visible côté [[KB Orders]] quand assigné. Côté client PWA, **prénom + ETA** affichés sur l'étape "Courier assigné" (cf. [[Tracking client]]). Le numéro du courier n'est pas exposé au client V1 (passage par [[KB Orders]] si besoin contact).
_Avoid_: Driver (Uber Eats côté Eats), Livreur (FR acceptable)

**Tracking client** (Suivi PWA = page de confirmation post-paiement) :
**Page unique** affichée côté client final dès le paiement validé et pendant toute la durée de la cmd. Pas de page de "confirmation" séparée — c'est cette même page qui démarre à l'état T+0 "Cmd reçue" et évolue jusqu'à "Livrée" / "Récupérée" (Q10-Q9 acté 2026-05-24). **V1 = animations Lottie SVG par étape + ETA texte live**, pas de map, pas de tracking GPS live, pas de branding Uber visible (white-label total côté client). **Récap items collapsible** : Lottie + ETA en focus visuel haut, bouton "Voir le détail de ma cmd" déplie items + modifiers + total + adresse. Email transactionnel envoyé en parallèle avec récap complet (backup permanent). 6 étapes mode livraison : `Cmd reçue` → `En préparation` → `Courier assigné` (prénom + ETA pickup) → `Courier en route vers le resto` (ETA pickup live) → `Courier en route vers toi` (ETA dropoff live) → `Livrée` (push "Bon appétit ! 🍽️" — pas de demande de review V1). 3 étapes mode click & collect : `Cmd reçue` → `En préparation` (ETA prête dans X min) → `Prête à récupérer` (push "ta cmd t'attend chez [resto]"). ETA dérivés des webhooks Uber Direct (`pickup_eta` / `dropoff_eta`). V2 envisagera map embed si demande terrain. Q40-Q7 + Q10-Q9 actés 2026-05-24.
_Avoid_: Map tracking, Live GPS, Suivi GPS, Page de confirmation (= même page)

**Review post-livraison** (V2) :
Demande d'avis envoyée au client après l'étape `Livrée`. **Hors scope V1** (Q40-Q acté 2026-05-24). **Quand activée V2 : cible EXCLUSIVEMENT Google My Business du resto, JAMAIS Uber Eats** — principe : un client capté off-platform via KB ne doit pas réalimenter l'e-réputation Uber (le moat à construire est Google, qui survit même si Uber suspend le resto). Pattern V2 envisagé : T+15 min push → smart-routing 4★+ → lien Google Reviews du resto / <4★ → form feedback privé KB (capture l'insatisfaction sans la rendre publique sur Google). Reward conditionnel (code promo prochaine cmd PWA) à arbitrer V2 selon retour terrain et risque légal "incitation à avis" (CGI / DGCCRF).
_Avoid_: Avis Uber, Note Uber Eats, Pousser sur Uber

**Pickup / Dropoff** :
Pickup = adresse du resto où le courier vient récupérer. Dropoff = adresse du client final. Inputs du `POST /deliveries`. Bien distincts du **mode pickup** côté client (= click & collect, qui n'utilise pas Uber).
_Avoid_: Origin/Destination (trop génériques)

**Frais d'attente courier** (Wait fees) :
Frais facturés par Uber Direct au-delà du seuil d'attente courier au pickup (~10 min) si la cuisine n'a pas remis la cmd. **V1 = entièrement à charge du resto** (cohérent avec `BILLING_TYPE_DECENTRALIZED` self-signup, le resto est facturé direct par Uber). KB n'intervient ni dans la facturation ni dans la réclamation — si le resto trouve abusif, réclamation directe Uber. **KB rend visible côté [[KB Orders]] KDS pour éviter** : (a) timer pickup ETA visible sur ticket, (b) push tablette KDS à T-3 min sans "prête" cochée → "⚠️ Courier arrive bientôt, cmd #X pas encore prête". **Aucune notification au client final** (coulisses cuisine, pas son problème). Q40-Q acté 2026-05-24.
_Avoid_: Wait time, Frais retard, Attente cuisine

**Click & collect** (Mode pickup) :
Mode alternatif à la livraison : le client vient chercher en boutique. Pas d'appel Uber Direct. Frais livraison = 0. Côté [[KB Orders]], "remise au client" au lieu de "remise au courier". **V1 : les 2 modes (livraison + click & collect) sont activés par défaut pour tout nouveau tenant** — c'est le **client final qui choisit au checkout PWA** entre les deux. Pas de switch resto V1 pour désactiver l'un des modes (Q40-Q acté 2026-05-24). V2 envisagera un toggle resto depuis [[KB Admin]] si demande terrain.
_Avoid_: Takeaway (ambigu — peut aussi désigner livraison), Retrait sur place

**Webhook tenant** :
URL `api.kitchenboost.fr/webhooks/uber/<tenant_id>` par tenant V1 (self-signup). Migrera vers webhook centralisé V2 avec Organizations API.
_Avoid_: Callback, Listener

**Organizations API** (V2) :
Pattern Uber Direct où KB devient "Organization" parent avec sub-accounts par resto. Permet 1 webhook centralisé + onboarding simplifié. Accessible uniquement après Integration Partner certification.
_Avoid_: Master account, Multi-account

**Integration Partner** (IP) :
Programme commercial Uber. KB candidate à 8+ restos signés via `direct-fr@uber.com`. Certification 3-6 mois. **PAS prérequis** pour démarrer (self-signup suffit en V1).
_Avoid_: Partner, Reseller

**Surge** :
Augmentation tarifaire Uber en heures de pointe. Capturée au paiement (pas au panier) pour éviter dérive entre affichage et facturation.
_Avoid_: Peak pricing, Dynamic pricing (ambigu avec [[Pricing]])

**Plage horaire de service** :
Créneaux pendant lesquels le resto accepte des commandes. **KB est source de vérité** : la plage est configurée en Phase C onboarding depuis [[KB Admin]] et modifiable à tout moment par le resto. Uber Direct est en backup uniquement (refus du quote si Khan oublie de synchro ses horaires Uber). **V1 : créneau UNIQUE partagé entre livraison ET click & collect** (Q40-Q acté 2026-05-24) — exemple BB : 11h30–14h30 et 18h30–22h30 valent pour les deux modes. V2 envisagera des horaires séparés livraison vs C&C si demande terrain (resto qui veut C&C plus large que livraison). **Hors plage côté client = checkout BLOQUÉ** ("Fermé, ouvre à 18h30"), pas de paiement possible. **Pas de pré-commande V1** (paie maintenant pour livraison à 18h30) — V2 minimum, ajoute complexité scheduling cuisine + Uber Direct hors scope V1.
_Avoid_: Horaires d'ouverture (ambigu avec heures physiques resto), Service hours, Opening times

**Stuart** (V2 fallback) :
Concurrent Uber Direct FR. Activable par tenant en V2 si Uber Direct refuse ou trop cher. Pas dans le scope V1.
_Avoid_: Backup courier, Alternative

**Tip courier** (Pourboire) :
Champ `tip` exposé par l'API Uber Direct pour reverser un pourboire au courier. **Hors scope V1** (Q40-Q acté 2026-05-24) — pas d'encart pourboire au checkout PWA, pas de tip post-livraison. Raisons : friction conversion sur premier achat + culture FR du pourboire ≠ US + zéro upside business KB/resto (le tip va au courier). Roadmap V2 : encart optionnel au checkout (boutons 1€/2€/5€/Autre, défaut Aucun) si demande terrain confirmée.
_Avoid_: Pourboire, Gratuity

## Example dialogue

**Alex** : Buns & Bao est en 75019. Comment je sais si Uber Direct livre ?

**Dev** : On fait un quote test au moment de l'onboarding tenant (Q40-Q5 — déjà validé pour BB). En prod, au checkout, on appelle `POST /delivery_quotes` avec l'adresse client. Si refus → message "non livrable, essayez une autre adresse".

**Alex** : Et si la cmd est click & collect ?

**Dev** : Pas d'appel Uber. Frais livraison = 0 dans le moteur [[Pricing]]. Au niveau de [[KB Orders]], bouton "Remise au client" au lieu de "Remise au courier". Pas d'événement `CourierStatus`.

**Alex** : Si le courier se tape un retard de 25 min et se présente pas ?

**Dev** : Webhook timeout 20 min sans pickup → escalade auto Stuart V2 (V1 = juste alerte ops). Le client est notifié du retard mais on ne refund pas tant que la cmd est en cours.

**Alex** : Et si Uber Direct facture un peu cher sur BB ?

**Dev** : C'est précisément pour ça qu'il y a [[Pricing]] : Khan peut configurer "livraison offerte resto si panier >= 25 €" pour rendre le ticket attractif côté client en mangeant la marge. V2 on aura Stuart comme alternative moins chère.
