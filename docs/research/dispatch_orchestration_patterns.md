# Orchestration du dispatch coursier — patterns d'implémentation Uber Direct

**Date** : 2026-06-07
**Auteur** : Deep-research (sources primaires developer.uber.com/docs/deliveries) + synthèse implémentation
**Objectif** : Documenter précisément **quand** et **comment** on appelle un coursier via Uber Direct, **comment** on pilote le timing, et **comment** on traduit ça en code dans le backend KB. Le PRD 40 traite le QUOI (scope V1) ; ce doc traite le COMMENT (implémentation).
**Lié à** : [PRD 40 — Livraison Uber Direct](../prd/40_livraison_uber_direct.md) · [Uber Direct deep dive](uber_direct_deep_dive.md) · [Alternatives Uber Direct](alternatives_uber_direct.md)

---

## TL;DR — 5 insights actionnables

1. **Tu ne "calls" jamais le livreur toi-même.** Tu déclares juste **l'intention de livrer** avec une fenêtre temporelle. Uber se débrouille pour assigner un coursier qui respecte cette fenêtre. La seule chose que tu pilotes activement : (a) les timestamps au booking, (b) les PATCH si ton estim était fausse, (c) la consommation des webhooks pour afficher l'état.

2. **Différence Marketplace vs Direct sur le contrôle du timing** :
   - **Marketplace** (Uber Eats inbound) : resto envoie `ready_time` (durée relative). Uber dispatch. Resto subit le timing.
   - **Direct** (outbound white-label) : KB envoie `pickup_ready_dt` (timestamp absolu). Uber dispatch en respectant la contrainte. KB pilote le timing.

3. **3 stratégies de booking possibles** : **Eager** (book au ACCEPT, recommandé Phase 1) / **Eager+PATCH** (production-grade, ajuste si retard cuisine) / **Lazy / Just-in-time** (book quand sac prêt, coûte plus cher).

4. **4 webhooks Uber Direct exactement** : `delivery_status`, `courier_update` (toutes les 20s post-assignment), `refund_request`, `shopping_progress` (Pick & Pack uniquement, hors scope KB).

5. **L'algo Uber dispatch ~5-15 min avant `pickup_ready_dt`** pour ne pas geler un coursier trop tôt. C'est interne à Uber, KB n'a RIEN à coder pour ça.

---

## 1 — Les 4 timestamps clés à envoyer à Uber Direct

Quand on crée une livraison via `POST /v1/customers/{id}/deliveries`, on passe ces 4 timestamps (ISO 8601 UTC) :

| Champ                 | Sémantique                                            | Conséquence côté Uber                                                                                              |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pickup_ready_dt`     | "Le sac sera prêt à cette heure"                      | Uber dispatch le coursier pour **arriver à cette heure**, pas avant                                                |
| `pickup_deadline_dt`  | "Au plus tard, le coursier doit pickup à cette heure" | Fenêtre +10-20 min = ratio prix/fiabilité optimal. Trop court → surcoût ; trop long → courier en avance qui attend |
| `dropoff_ready_dt`    | "Au plus tôt le client veut recevoir"                 | Sert si client réserve à l'avance ("livraison à 19h30") — V3 KB                                                    |
| `dropoff_deadline_dt` | "Au plus tard le client accepte de recevoir"          | SLA contractuel Uber Direct                                                                                        |

**Règle empirique V1** : `pickup_deadline_dt - pickup_ready_dt = 10-20 min`. `dropoff_deadline_dt = pickup_deadline_dt + 45 min`.

---

## 2 — Stratégies de booking — choisir selon la maturité produit

### Stratégie A — "Eager booking" (recommandée V1)

On book la livraison **dès que le resto accepte la commande**, avec un `pickup_ready_dt` calculé à partir d'un `prep_time_minutes` moyen par resto (config tenant).

```
t=0:00  Client checkout sur PWA KB du resto
        ↓
t=0:01  POST /orders → backend KB Convex
        ↓
t=0:02  Push notif tablette resto : "Nouvelle commande"
        ↓
t=0:03  Resto tap ACCEPT
        ↓
t=0:03  Backend KB lit prep_time_minutes du resto (ex: 15 min)
        Calcule pickup_ready_dt = now + 15 min
        Calcule pickup_deadline_dt = now + 25 min
        ↓
t=0:03  POST /v1/customers/{id}/delivery_quotes
        → quote {fee: 5.50€, duration: 25 min, id: "qt_abc"}
        ↓
t=0:04  POST /v1/customers/{id}/deliveries
        {quote_id, pickup_ready_dt: now+15, pickup_deadline_dt: now+25,
         manifest_items, customer info, undeliverable_action: "return"}
        ↓
        ◄── delivery {id: "del_xyz", status: "pending", tracking_url}
        ↓
t=0:08  Uber dispatch algo : "courier à 7 min du resto, je l'assigne à t=0:08
        pour qu'il arrive à t=0:15"
        webhook delivery_status: "pickup" (courier en route vers resto)
        ↓
t=0:10  webhook courier_update toutes les 20s (lat/lng)
        ↓
t=0:13  webhook delivery_status: "pickup_imminent" (2 min)
        → tablette resto : "Livreur arrive dans 2 min, sac #42"
        ↓
t=0:15  webhook delivery_status: arrived_at_pickup
        → tablette resto : "Livreur sur place, donne le sac"
        ↓
t=0:16  Resto handoff au coursier
        webhook delivery_status: "pickup_complete"
        ↓
t=0:35  webhook delivery_status: "delivered"
```

**Avantages** : simple, prévisible, fonctionne avec un `prep_time` statique par resto.
**Inconvénient** : si la cuisine prend du retard, le coursier arrive trop tôt → il attend → frais d'attente à charge resto (cf. PRD 40 v0.3) + mauvaise note resto.

### Stratégie B — "Eager + PATCH pattern" (production-grade, V2)

Comme A, **mais on PATCH la delivery quand le resto signale du retard ou de l'avance** via les boutons KDS "+5 min" / "Sac prêt".

```
Tablette resto : bouton "+5 min" / "Sac prêt"
        ↓
        ├── tap "+5 min" → PATCH /v1/customers/{id}/deliveries/{del_id}
        │                  {pickup_ready_dt: previous + 5 min}
        │                  Uber repousse le dispatch courier
        │
        └── tap "Sac prêt" → PATCH /v1/customers/{id}/deliveries/{del_id}
                             {pickup_ready_dt: now}
                             Uber accélère le dispatch (priorité)
```

**Caveat** : PATCH peut être refusé si le coursier est déjà en route (état `pickup`). Lire le HTTP code de retour, fallback sur affichage "courier déjà parti, fais au mieux".

### Stratégie C — "Lazy / Just-in-time booking"

On **ne book PAS au ACCEPT**. On attend que le resto tape "Sac prêt", puis on book avec `pickup_ready_dt = now + 2 min`.

**Avantages** : zéro risque coursier en avance.
**Inconvénients** :

- Coût livraison **majoré** (urgence)
- Pas de quote prévisible côté client au moment du checkout (problème UX majeur)
- Si pas de coursier dispo immédiatement → délai d'attente visible au resto

**Verdict** : Stratégie A pour MVP V1, migrer vers B dès qu'on a les boutons +5min/Sac prêt sur la tablette KB (V1.x ou V2). Stratégie C écartée (UX checkout cassée).

---

## 3 — Pseudocode TS (à adapter dans le backend Convex)

```ts
// 1. Resto tape ACCEPT sur la tablette KDS
async function onRestaurantAccept(orderId: string) {
  const order = await db.orders.get(orderId);
  const resto = await db.restaurants.get(order.restaurantId);

  const now = new Date();
  const pickupReady = new Date(now.getTime() + resto.avgPrepMinutes * 60_000);
  const pickupDeadline = new Date(pickupReady.getTime() + 10 * 60_000);
  const dropoffDeadline = new Date(pickupDeadline.getTime() + 45 * 60_000);

  // 2. Get quote (optionnel mais recommandé pour valider faisabilité)
  const quote = await uberDirect.post(
    `/customers/${UBER_CUSTOMER_ID}/delivery_quotes`,
    {
      pickup_address: resto.address,
      dropoff_address: order.deliveryAddress,
      pickup_ready_dt: pickupReady.toISOString(),
      pickup_deadline_dt: pickupDeadline.toISOString(),
    },
  );

  // 3. Create delivery
  const delivery = await uberDirect.post(
    `/customers/${UBER_CUSTOMER_ID}/deliveries`,
    {
      quote_id: quote.id,
      pickup_name: resto.name,
      pickup_address: resto.address,
      pickup_phone_number: resto.phone,
      pickup_ready_dt: pickupReady.toISOString(),
      pickup_deadline_dt: pickupDeadline.toISOString(),
      dropoff_name: order.customer.name,
      dropoff_address: order.deliveryAddress,
      dropoff_phone_number: order.customer.phone,
      dropoff_deadline_dt: dropoffDeadline.toISOString(),
      manifest_items: order.items.map((i) => ({
        name: i.name,
        quantity: i.qty,
        size: "small",
      })),
      undeliverable_action: "return",
      tip_by_customer: order.tip ?? 0,
    },
  );

  await db.orders.update(orderId, {
    uberDirectDeliveryId: delivery.id,
    trackingUrl: delivery.tracking_url,
    pickupReadyDt: pickupReady,
  });
}

// 4. Resto tape "+5 min" (cuisine en retard) — Stratégie B / V2
async function onRestaurantDelay(orderId: string, additionalMinutes: number) {
  const order = await db.orders.get(orderId);
  const newReady = new Date(
    order.pickupReadyDt.getTime() + additionalMinutes * 60_000,
  );

  try {
    await uberDirect.patch(
      `/customers/${UBER_CUSTOMER_ID}/deliveries/${order.uberDirectDeliveryId}`,
      { pickup_ready_dt: newReady.toISOString() },
    );
  } catch (err) {
    if (err.status === 409) {
      // Courier déjà en route - affichage tablette "Courier déjà parti, prévenez-le"
      await notifyTablet(orderId, "courier_already_dispatched");
    } else throw err;
  }
}

// 5. Webhook handler (HTTP action Convex)
export const uberDirectWebhook = httpAction(async (ctx, req) => {
  const event = await req.json();

  switch (event.kind) {
    case "event.delivery_status":
      // status: pending | pickup | pickup_complete | dropoff | delivered | canceled | returned
      await ctx.runMutation(internal.orders.updateDeliveryStatus, {
        deliveryId: event.delivery_id,
        status: event.status,
      });
      if (event.status === "pickup" && event.minutes_until_arrival <= 5) {
        await ctx.runMutation(internal.tablet.notify, {
          deliveryId: event.delivery_id,
          message: `Livreur arrive dans ${event.minutes_until_arrival} min`,
        });
      }
      break;

    case "event.courier_update":
      // Toutes les 20s post-assignment - utile pour map temps réel (V2)
      // En V1 (PRD 40 v0.3, pas de map), suffit de stocker pour debug
      await ctx.runMutation(internal.orders.updateCourierLocation, {
        deliveryId: event.delivery_id,
        lat: event.courier.location.lat,
        lng: event.courier.location.lng,
      });
      break;

    case "event.refund_request":
      // Courier signale problème (sac introuvable, resto fermé, etc.)
      // Mappe sur "incident après pickup" (PRD 40 v0.3 cas 3) → refund auto + push "incident"
      await ctx.runMutation(internal.orders.flagForReview, {
        deliveryId: event.delivery_id,
        reason: event.reason,
      });
      break;
  }

  return new Response("ok");
});
```

---

## 4 — Ce qui se passe vraiment côté Uber quand on envoie `pickup_ready_dt`

```
t=0:00  Requête POST /deliveries arrive avec pickup_ready_dt = t+15
        ↓
        Uber crée la delivery en status "pending"
        Réponse instantanée avec delivery_id
        ↓
t=0:05  Algo Uber : "Pour arriver à t+15 au resto situé à X, j'ai besoin
                     d'un coursier qui peut être là dans 10 min.
                     Je broadcast l'offer à 3 coursiers dans un rayon de 2km."
        ↓
t=0:06  Un coursier accepte (ou pas → re-broadcast)
        webhook delivery_status: "pickup" (status = "courier assigné + en route")
        ↓
        À PARTIR D'ICI : on reçoit courier_update toutes les 20s
```

**Le "5-10 min avant ready_time" = ce que fait l'algo Uber pour optimiser** : il ne déclenche l'assignation que ~10 min avant pour ne pas geler un coursier trop tôt. **KB n'a RIEN à coder pour ça, c'est interne à Uber.**

---

## 5 — États de la delivery (à mapper dans la table Convex)

Status possibles renvoyés par les webhooks `delivery_status` :

| Status            | Sémantique                            | Action UI tablette resto                 | Action UI client                                                |
| ----------------- | ------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `pending`         | Delivery créée, pas encore de courier | Rien (cuisine prépare)                   | "Commande confirmée"                                            |
| `pickup`          | Courier assigné + en route vers resto | "Livreur en route" + ETA                 | "Livreur en route vers le resto"                                |
| `pickup_complete` | Courier a récupéré le sac             | "Sac récupéré, en route client"          | "En cours de livraison"                                         |
| `dropoff`         | Courier en route vers client          | "En cours de livraison"                  | "Livraison imminente"                                           |
| `delivered`       | Livré                                 | "Terminée"                               | "Livré, bon appétit !"                                          |
| `canceled`        | Course annulée (Uber, courier, ou KB) | Notif "Course annulée" + action          | Notif "Incident" + refund auto                                  |
| `returned`        | Client absent, sac retourné resto     | Notif "Sac retourné, contacte le client" | "Contacte le resto" (pas de refund auto, cf. PRD 40 v0.3 cas 4) |

**Important** : le PRD 40 v0.3 distingue 3 cas d'incident **avant** ces status (course refusée Uber post-paiement / courier annule avant pickup / incident après pickup / client absent `returned`). Le mapping webhook → cas PRD se fait dans `updateDeliveryStatus` mutation.

---

## 6 — Edge cases à coder explicitement

1. **PATCH refusé (409)** car courier déjà assigné → fallback notif "courier déjà parti".
2. **Webhook ordering** : Uber ne garantit pas l'ordre des webhooks. Stocker `event.created_at` et ignorer events plus anciens que le state actuel.
3. **Idempotency** : webhook peut être livré plusieurs fois (retry Uber). Utiliser `event.id` comme dedup key dans une table `webhookEvents`.
4. **Course refusée Uber post-paiement** (Stratégie A) : si la création de delivery échoue après le paiement Stripe, refund auto + notif client (PRD 40 cas 1).
5. **Frais d'attente courier** (cf. PRD 40 v0.3) : Uber facture le resto si le sac n'est pas prêt à l'arrivée du courier. Détecter via `event.delivery_status: pickup` + delta > seuil → push KDS T-3 min.
6. **Webhook signature verification** : valider HMAC du payload (clé `webhook_signing_key` côté Uber Direct). Sinon n'importe qui peut spammer notre endpoint.

---

## 7 — Open questions à clarifier avant le code V1

1. **Format exact JSON des webhooks Uber Direct** (champs, exemples, edge cases) — à scraper de developer.uber.com/docs/deliveries/guides/webhooks AVANT d'écrire le schema Convex `deliveries`.
2. **`shopping_progress` event** : confirmé "Pick & Pack uniquement" donc hors scope KB. Vérifier qu'on ne reçoit jamais cet event en livraison restaurant standard.
3. **Rate limits PATCH** : combien de PATCH par delivery autorisés ? Si on PATCH à chaque tap "+5 min", on peut hitter une limite.
4. **HMAC validation** : où trouve-t-on la signing key dans le dashboard Uber Direct ? Quel header est utilisé pour la signature ?
5. **Fallback Stuart** (V2 cf. PRD 40) : si Uber Direct refuse, on bascule sur Stuart. Mais Stuart a ses propres webhooks (research a échoué à confirmer le détail). À documenter séparément.

---

## 8 — Sources

- [developer.uber.com/docs/deliveries/overview](https://developer.uber.com/docs/deliveries/overview)
- [developer.uber.com/docs/deliveries/guides/webhooks](https://developer.uber.com/docs/deliveries/guides/webhooks)
- [developer.uber.com/docs/deliveries/guides/quotes](https://developer.uber.com/docs/deliveries/guides/quotes)
- [developer.uber.com/docs/deliveries/guides/create-delivery](https://developer.uber.com/docs/deliveries/guides/create-delivery)
- [uber_direct_deep_dive.md](uber_direct_deep_dive.md) — pricing, multi-tenant, billing pattern
- [PRD 40](../prd/40_livraison_uber_direct.md) — scope V1/V2/V3, cas d'incident
