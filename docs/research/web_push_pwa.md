# Web Push depuis PWA — Faisabilité iOS + Android (Mai 2026)

**Date** : 2026-05-20
**Objectif** : Donner à KitchenBoost une certitude technique pour pitcher les **notifications push** comme argument commercial face à Uber Eats.

---

## TL;DR

**OUI, c'est faisable sur iOS ET Android en 2026.**

| Plateforme | Support | Condition |
|---|---|---|
| **Android** | ✅ Sans condition | Opt-in direct depuis le navigateur, pas d'installation requise |
| **iOS 16.4+** | ✅ Avec condition | **L'utilisateur doit ajouter le site à l'écran d'accueil** (Partager → Ajouter à l'écran d'accueil) avant de pouvoir recevoir des push |

**Pitch honnête à utiliser** : "Sur Android (~70% des clients FR), notifications instantanées après opt-in. Sur iPhone (~25%), le client doit ajouter ton site à son écran d'accueil — 2 taps — et ensuite c'est comme une vraie app."

**Stack recommandée** : `web-push` (npm, Mozilla) + VAPID + Service Worker self-hosted. **Coût ~0€** même à 40K push/mois. Pas besoin de FCM ni OneSignal en intermédiaire.

---

## 1. iOS Web Push — État 2026

### Versions clés

- **iOS 16.4 (mars 2023)** : première version supportant Web Push. >95% du parc iPhone est sur 16+
- **Safari 18.4 (avril 2025)** : Declarative Web Push (push sans Service Worker) + Screen Wake Lock
- **iOS 26 (auto 2025)** : tout site ajouté au home screen s'ouvre par défaut comme web app

### Add-to-home-screen : OBLIGATOIRE

Pas d'échappatoire. **Push API n'est pas accessible depuis un onglet Safari**. Le user doit faire Share → "Sur l'écran d'accueil". C'est la contrainte n°1.

### EU / DMA

Apple avait cassé les PWA en EU avec iOS 17.4 (fév 2024), puis a **fait marche arrière le 2 mars 2024**. **Web Push fonctionne en France en 2026.** Pas de risque DMA actif.

### Limitations connues iOS

- **Subscription killed si silent push** : si le SW reçoit un event push et n'appelle pas `showNotification()`, iOS résilie l'abonnement → `event.waitUntil(showNotification())` obligatoire
- **Cache PWA expire après ~7 jours d'inactivité** — abonnement peut être perdu chez les users occasionnels
- **Taux de livraison iOS 70-85%** vs 90-95% Android (background management agressif)
- **"Clear History and Website Data"** efface l'abonnement → re-prompt à la visite suivante
- **Pas de Background Sync / Periodic Sync** — Apple ne donne pas de timeline
- **Permission UX** : popup natif iOS, **doit être déclenché par un user gesture** (click)
- **Notifications riches** : images, actions, badge count (Badging API) tous supportés sur iOS 16.4+
- **Navigation privée Safari** : pas de Push (pas de SW persistant)

### Taux d'installation home-screen attendu

- Pas de donnée publique solide pour un site grand public
- Prompts d'install bien présentés : **~16% mobile** vs 6% desktop
- Sans incentive : **5-15%** naturel
- **Avec incentive bien placé** ("-10% sur ta prochaine commande si tu installes l'app") : **20-30%** sur clientèle resto fidèle

---

## 2. Android Web Push — État 2026

- **Chrome 64,65% + Samsung Internet 3,76% + Firefox 1,51%** en France mobile (Statcounter avril 2026). Tous supportent Push API
- **Pas besoin d'installer la PWA** — opt-in direct depuis le navigateur
- **Permission UX** : popup natif Chrome, déclenché par user gesture. Éviter le prompt "à froid" au chargement (Chrome pénalise les sites abusifs)
- **Notifications riches** : images, actions (jusqu'à 3 boutons), badge, vibration — full support
- **Wake from sleep** : oui, FCM réveille l'appareil même en doze mode
- **Taux de livraison 90-95%**

---

## 3. Stack technique recommandée

### Recommandation KitchenBoost

**`web-push` (npm Mozilla/web-push-libs) + VAPID + Service Worker maison.** Pas besoin d'OneSignal ni FCM — la stack native fonctionne sur tous navigateurs (Chrome, Safari, Firefox, Samsung) via un seul code. VAPID est le standard RFC8030, stable.

### Code minimal front (`sw.js`)

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge.png',
      image: data.image,
      data: { url: data.url },
      actions: data.actions
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

### Code minimal back (Node)

```js
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:contact@kitchen-boost.fr',
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

await webpush.sendNotification(subscription, JSON.stringify({
  title: 'Nouveau plat chez Le Bistrot',
  body: 'Pizza truffe -20% ce soir',
  url: 'https://lebistrot.kitchen-boost.fr/menu',
  image: 'https://.../pizza.jpg'
}));
```

### VAPID

- Génération : `webpush.generateVAPIDKeys()` une fois, stockée en env
- Pas de rotation obligatoire — un seul couple clé par tenant suffit
- JWT généré automatiquement par la lib, expiration 12-24h

### Alternatives évaluées

| Stack | Pertinence KB | Pourquoi |
|---|---|---|
| `web-push` self-host | ✅ **Recommandé** | Gratuit illimité, contrôle total, zero lock-in |
| FCM Web | ⚠️ Possible | Gratuit illimité mais SDK lourd + dépendance Google |
| OneSignal Free | ⚠️ MVP rapide | OK jusqu'à 10K subscribers, lock-in vendor, à virer ensuite |
| Pushwoosh / Batch.com | ❌ Overkill Phase 1 | Payant, features pro inutiles |

---

## 4. Coûts à scale

Pour **10 000 utilisateurs × 4 push/mois = 40K push/mois** :

| Stack | Coût mensuel |
|---|---|
| `web-push` + VAPID self-hosted | **~0€** (juste le VPS qui envoie) |
| FCM Web | **0€** (illimité gratuit) |
| OneSignal Free | **0€** (jusqu'à 10K subs/envoi) |
| OneSignal Growth (>10K subs) | ~$9-50/mois |

**Recommandation finale : self-host avec `web-push` npm.**

---

## 5. Benchmarks opt-in et CTR

- **Opt-in web push e-commerce** : moyenne **2,7%** (range 2,3-5%), jusqu'à **6,6%** avec prompt navigateur bien placé. Mobile : **10-15%** si bien exécuté
- **CTR moyen browser push** : **0,84%** (manuel) → **8,21%** (automatisé/triggered)
- **CTR rich push (image)** : **9,2%** vs **6,9%** simple
- **CTR retail/e-com Android** : **3,78%**, iOS : **3,05%**
- **Food & Beverage** = **top 2 industries** pour CTR (derrière Travel) ✅
- **Meilleurs créneaux resto** : 8-9h et 18-20h. Lundi/mardi top, samedi flop

**Comparatif vs email** :
- Email resto : ~20% open / 2% CTR
- Push web : 0,84-8% CTR sans bataille de spam, livraison instantanée
- → Push gagne sur conversion court terme, email reste meilleur pour relationship long terme

---

## 6. Risques

1. **Apple change d'avis** : risque faible. Trajectoire iOS 16.4 → iOS 26 = ouverture. Le DMA pousse dans le bon sens
2. **"Clear History" casse l'abonnement** : réel, mitigeable par re-prompt à la prochaine visite
3. **iOS résilie subscription si silent push** : à gérer via `event.waitUntil(showNotification())` systématique
4. **Cache 7j d'inactivité iOS** : pour resto, cycle de commande typique <30j → abonnement peut sauter chez clients occasionnels. Pas grave pour la clientèle fidèle (cible réelle)
5. **RGPD** : opt-in push n'est pas un cookie au sens strict, **mais** consentement clair requis (popup explicite, finalité marketing détaillée dans privacy policy). Pas de bandeau CMP obligatoire mais doc légale à jour

---

## 7. Recommandation KitchenBoost — Pitch commercial

### Comment positionner auprès du restaurateur

> "On envoie des notifications push directement sur le téléphone de vos clients fidèles.
> Sur Android (~70% des clients en France), c'est instantané après opt-in sur le site.
> Sur iPhone (~25%), le client doit ajouter votre site à son écran d'accueil — 2 taps — et après on peut le pinger comme une vraie app.
> **Pour la moitié de vos clients réguliers qui auront fait le geste, c'est un canal direct 100% gratuit, sans intermédiaire, sans 30% de commission Uber Eats.**"

### Incentive à intégrer dans le flow

- **Sur la landing post-QR scan** : "Active les notifs → -10% sur ta prochaine commande"
- Pour iOS : **tuto A2HS clair avec capture d'écran "Partager → Ajouter à l'écran d'accueil"**
- Cibler en priorité les **clients post-2e commande** (engagement déjà prouvé)

### Réalisme commercial à présenter au resto

- Sur 100 clients qui scannent le QR → attendre **15-30% d'opt-in push** total (mix iOS + Android, mix install + opt-in direct)
- Sur ces opt-in → **CTR 3-8% par push**
- Avec **4 push/mois bien envoyés** → tu génères **0,5-1 commande/abonné/mois** = ROI démontrable

### Argument clé vs Uber Eats

> "Uber Eats ne te donne **jamais** le canal de communication direct avec le client. Web Push, c'est exactement ça : un canal direct, gratuit, sans commission, que tu contrôles."

---

## 8. Sources

- [WebKit Features in Safari 18.4 (Declarative Web Push)](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)
- [Apple Developer — Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Safari 18.4 Release Notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes)
- [PWA Push Notifications on iOS in 2026 — Webscraft](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- [PWA iOS Limitations and Safari Support 2026 — MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Do Progressive Web Apps Work on iOS? 2026 — Mobiloud](https://www.mobiloud.com/blog/progressive-web-apps-ios)
- [iOS web push setup — OneSignal Docs](https://documentation.onesignal.com/docs/en/web-push-for-ios)
- [iOS 17.4 EU PWA reversal — Progressier](https://intercom.help/progressier/en/articles/8955905-updates-about-the-impact-of-ios-17-4-for-pwas-in-the-eu)
- [web-push npm package](https://www.npmjs.com/package/web-push)
- [web-push-libs on GitHub](https://github.com/web-push-libs/web-push)
- [Firebase Pricing (FCM gratuit)](https://firebase.google.com/pricing)
- [OneSignal Pricing](https://onesignal.com/pricing)
- [Push notification benchmarks 2025 — Pushwoosh](https://www.pushwoosh.com/blog/push-notification-benchmarks/)
- [Mobile browser market share France 2025 — Statcounter](https://gs.statcounter.com/browser-market-share/mobile-tablet-/france/2025)
- [Web Almanac 2025 — PWA chapter](https://almanac.httparchive.org/en/2025/pwa)
