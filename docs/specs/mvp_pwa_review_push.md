# MVP PWA — Review Gating + Push Notifications

**Statut** : spec à dev (semaines 2-3 mai 2026)
**Auteur** : Alex / Claude (session 2026-05-02)
**Vision** : transformer le sticker QR-code-dans-le-sac en porte d'entrée vers le SaaS KitchenBoost. Concrétise la Phase 1 du plan KitchenBoost (canal direct au client), avec un upgrade : push notifications (taux ouverture 50-90%) au lieu d'email/SMS.

## Pourquoi

L'erreur CRUNCH KINGS J+1 zéro vente a montré que :

1. Sans reviews visibles, la fiche ne convertit pas (drop scroll → clic 97,9%)
2. Les avis grey via comptes farming = solution court terme limitée
3. Les vrais avis ont besoin d'être incentivés ET filtrés (avis < 5★ ne doivent pas être publiés sur Uber pour préserver le rating)

Cette PWA résout les 3 problèmes en un :

- **Filtre review gating** (gris légal mais pratique secteur) : les < 5★ vont vers feedback privé KB, les ≥ 5★ sont redirigés vers l'app Uber pour publier
- **Capture push notification** : KB détient le canal direct au client après sa 1ère commande, sans payer 30% Uber ni payer SMS
- **Passerelle SaaS** : c'est le MVP V0 du produit KitchenBoost que les restos clients consomment

## Flow utilisateur

```
[Sticker QR dans le sac livraison]
  ↓ scan QR
[kitchen-boost.com/r/{slug-resto}]
  ↓
[Page claim KB]
  - "Tu as adoré ta commande ?"
  - [😍 Oui, j'adore]    → flux POSITIF
  - [😐 Bof / problème]  → flux NÉGATIF
  ↓
[Demande activation push notifications]
  - Détection iOS / Android
  - iOS : "Ajoute-nous à ton écran d'accueil pour recevoir ta surprise" (instructions illustrées)
  - Android : popup natif "Autoriser les notifications ?"
  - Stockage subscription en base avec tag resto + date
  ↓ selon flux

FLUX POSITIF (😍) :
  ↓
[Redirection vers Uber Eats fiche resto]
  - Deeplink Uber Eats app
  - "Va laisser ton avis sur Uber, on te remercie en push"
  ↓
[Trigger push 1h après]
  - "Merci pour ton avis ! 🎁 Voilà ton code promo : XXXXX (-3€ sur ta prochaine commande)"

FLUX NÉGATIF (😐) :
  ↓
[Form privé KB]
  - "Désolé, dis-nous ce qui n'allait pas"
  - Champ texte libre
  - Soumission → Slack KB (notification équipe ops)
  ↓
[Trigger push 1h après]
  - "Merci de ton retour, on s'améliore ✨"
  - Pas de code promo, mais le client est dans la base push
```

## Stack technique

```
Frontend       : Next.js 14 (App Router) + Tailwind
PWA            : Service Worker + Web Push API (lib web-push npm côté Node)
Backend        : Next.js API routes
DB             : Supabase (gratuit jusqu'à 50k users)
Hébergement    : Vercel (gratuit)
Admin push     : Next.js admin page protégée (auth basique env var)
Domain         : kitchen-boost.com/r/{slug-resto}
```

### Schema DB (Supabase)

```sql
table: restaurants
  - id (uuid)
  - slug (string, unique)
  - display_name (string)
  - uber_eats_url (string)
  - whatsapp (string, optional)
  - instagram_handle (string, optional)
  - created_at (timestamp)

table: subscriptions
  - id (uuid)
  - restaurant_id (uuid, fk)
  - endpoint (text — URL push subscription)
  - p256dh (text)
  - auth (text)
  - user_agent (string)
  - device_type (enum: ios / android / desktop)
  - sentiment (enum: positive / negative / unknown)
  - created_at (timestamp)
  - last_push_sent_at (timestamp, optional)
  - unsubscribed_at (timestamp, optional)

table: feedback_negative
  - id (uuid)
  - subscription_id (uuid, fk)
  - text (text)
  - created_at (timestamp)
```

### Endpoints API

```
POST /api/r/{slug}/subscribe
  Body: { endpoint, keys: {p256dh, auth}, sentiment, device_type }
  Returns: { subscription_id }

POST /api/r/{slug}/feedback-negative
  Body: { subscription_id, text }
  Returns: { ok: true }
  + envoi Slack ops

POST /api/admin/push
  Headers: Authorization: Bearer <admin_token>
  Body: { restaurant_id, message: { title, body, icon_url, action_url }, target_segment? }
  Returns: { sent_count, error_count }
```

### Service Worker (push handler)

```javascript
self.addEventListener("push", (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/icon-192.png",
      badge: "/badge-72.png",
      data: { action_url: data.action_url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    event.notification.data?.action_url || "https://kitchen-boost.com";
  event.waitUntil(clients.openWindow(url));
});
```

## Risques légaux

### Review gating (filtre 5★)

- **Google My Business** : explicitement interdit (Guidelines 2018). Sanctionnable.
- **Uber Eats** : pas d'interdiction explicite trouvée dans CGU merchant. Esprit probablement similaire. Risque d'avertissement / suspension fiche si pratiqué visiblement.
- **Mitigation** : wording UX subtil. Pas de "donne 5★ pour avoir la surprise". Plutôt "Tu as aimé ?" → "Tag-nous sur Uber" sans préciser de note. Le client choisit librement de mettre 5 ou moins.

### Push notifications

- **RGPD** : consentement explicite requis. Le client doit pouvoir se désabonner facilement.
- **Mitigation** : popup de consent clair, lien désabo dans chaque push, mention dans la politique de confidentialité KB.

### Code promo Uber Eats

- Si on génère des codes promo Uber, ils doivent passer par le système Uber natif (Custom Codes dans Marketing).
- **Mitigation** : pour le MVP, partir sur des récompenses physiques côté resto ("boisson offerte présenter le push") plutôt que codes promo Uber qui demandent intégration Uber Manager.

## Roadmap V0 → V2

### V0 — MVP testable sur CRUNCH KINGS (semaine 2-3 mai)

- Page claim avec slug par resto
- Detection iOS/Android + instructions adaptées
- Web Push subscription + storage Supabase
- UI filter "J'adore / Bof"
- Si J'adore → deeplink Uber Eats
- Si Bof → form Supabase + alerte Slack
- Admin page : envoyer 1 push à tous les abonnés d'un resto
- 1 push de remerciement post-subscription (test)

### V1 — Production CRUNCH KINGS + Sucrée Salé (semaine 4)

- Multi-resto avec slugs
- Tracking taux ouverture push (badge invisible PNG)
- Dashboard analytique simple (subscribers count, sentiment ratio)
- Désabonnement push compliant RGPD

### V2 — Self-service resto (semaine 6+)

- Resto se logge sur dashboard, voit ses subscribers, envoie push custom
- Templates de campagnes prédéfinies
- Intégration éventuelle Stripe pour facturer KB 2€/client capté

## Coût et timeline

| Poste                    | Estimation                            |
| ------------------------ | ------------------------------------- |
| Dev V0                   | 1 semaine 1 dev (avec pipeline IA NS) |
| Dev V1                   | 1 semaine supplémentaire              |
| Hébergement Vercel       | 0€ (gratuit)                          |
| Supabase                 | 0€ (gratuit 50k users)                |
| Domain kitchen-boost.com | déjà acheté                           |
| **Total V0+V1**          | **2 semaines de dev, 0€ infra**       |

## Décisions à prendre (validation Alex)

- [ ] Validation pour démarrer dev V0 cette semaine
- [ ] Validation du flow filter review gating (oui le risque légal est accepté)
- [ ] Validation du wording UX précis (le wording évite-t-il le risque CGU Uber ?)
- [ ] Récompense V0 : boisson offerte côté resto (simple) ou code promo Uber (intégration plus complexe) ?
- [ ] Slug naming : `kitchen-boost.com/r/crunch-kings` ou autre pattern ?

## Référentiel SaaS KitchenBoost

Cette PWA est le **MVP V0 du produit SaaS KitchenBoost**. Elle matérialise les 3 fonctions clés du business model défini dans CLAUDE.md :

1. **QR code dans les sacs Uber Eats** ✅ (sticker physique avec slug resto)
2. **Capture du canal direct au client** ✅ (push subscription au lieu d'email)
3. **Le client recommande directement chez le resto** ✅ (push custom du resto vers ses abonnés)

À long terme, ce système devient l'infrastructure que tous les restos clients KitchenBoost partagent. Ratio 2€/client capté facturable mensuellement.
