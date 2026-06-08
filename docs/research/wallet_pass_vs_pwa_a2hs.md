# Wallet Pass vs PWA A2HS — Comparaison & Stratégie KitchenBoost

**Date initiale** : 2026-05-24
**Dernière révision** : 2026-05-24 (pivot vers carte commune)
**Auteur** : Recherche consolidée pour décisions produit V1 client-ordering
**Objectif** : Documenter le choix de moat "install client" V1 KitchenBoost (Wallet pass + A2HS PWA, dual stack) et fournir les sources pour relecture future.

> ⚠️ **Révision majeure 2026-05-24** : la décision initiale "1 carte par resto" (section 2.5 ci-dessous) a été révisée en cours de session vers **1 carte commune sous marque neutre** pour tous les restos KB. Voir [ADR 0003](../adr/0003-wallet-pass-commun-marque-neutre.md) pour la justification stratégique complète (asymétrie de migration, vision "Uber Eats à 2€", cross-tenant push trivialisé, network effect immédiat). Le contenu technique de ce doc reste valide (PassKit, Google Wallet API), seul l'identifiant unique par instance change : `serialNumber` lié à `customer_id` (cross-tenant) plutôt qu'à `customer_id × tenant_id`. Sections 4.x mises à jour ci-dessous.

---

## TL;DR — 5 insights actionnables

1. **Sur iOS, Apple Wallet pass écrase A2HS PWA en friction install** (2 taps vs 4+ taps avec connaissance du menu Share). Apple refuse toute API prompt programmatique pour A2HS. Le Wallet pass est le **seul vrai canal push sans friction iOS**.

2. **Sur Android, A2HS PWA bat Google Wallet pass en friction install** (1 tap natif `beforeinstallprompt` vs 2 taps). Le web push Android marche même sans A2HS (permission grant seule suffit).

3. **Engagement Wallet pass 3-4× supérieur aux apps natives** et 8× supérieur aux email coupons. 71% des users d'apps de loyalty disparaissent en 90 jours, mais les wallet cards restent (parce que l'app Wallet est déjà sur le device, non désinstallable).

4. **Les deux mécanismes sont complémentaires, pas concurrents** : Wallet pass = canal push lock-screen (carte fidélité + offres) ; A2HS PWA = expérience commande full-app (menu, panier, paiement, tracking). KB déploie les deux V1.

5. **Faisabilité multi-tenant** : 1 cert Apple Developer NativeSquare + 1 `passTypeIdentifier` partagé + N instances de pass (1 par client × resto) avec branding distinct. Côté backend, lien via `customer_id` global = moat préservé. Idem Google Wallet (`issuerId` partagé + `classId` partagé + N `objectId`).

---

## 1. A2HS PWA (Add To Home Screen)

### 1.1 Définition

PWA = Progressive Web App = ton site web qui peut être "installé" sur l'écran d'accueil d'un téléphone comme une vraie app. Une fois installé, l'icône maison ouvre l'app **en plein écran sans la barre Safari/Chrome**, expérience native.

Gratuit, pas besoin d'App Store. Web push possible via Service Worker.

### 1.2 Friction install iOS

**4+ taps + connaissance Share menu** :

```
1. Le client est sur bunsbao.kitchen-boost.com dans Safari
2. Il doit taper l'icône "Partager" (↑) en bas de Safari
3. Faire défiler le menu Share
4. Taper "Sur l'écran d'accueil"
5. Confirmer "Ajouter"
→ Icône Buns & Bao apparaît sur son home screen
```

**Apple ne donne aucune API pour déclencher ce prompt programmatiquement**. KB ne peut afficher qu'un bandeau ou bottom sheet avec instructions ("tape Share puis Ajouter à l'écran d'accueil"). [La plupart des utilisateurs ignorent que cette option existe et les taux de conversion sur banner éducatif sont très faibles](https://www.mobiloud.com/blog/progressive-web-apps-ios).

**iOS 26 (oct 2025)** : tout site ajouté à l'écran d'accueil s'ouvre en mode "web app" par défaut, même sans manifest PWA. Mais **l'install reste manuel** via Share menu.

### 1.3 Friction install Android

**1 tap natif** via l'event `beforeinstallprompt` que le développeur peut déclencher sur un user gesture (clic bouton "Installer l'app"). Le navigateur affiche un dialog natif "Installer Buns & Bao ?" → Confirmer → Icône apparaît.

### 1.4 Capacités push

| Plateforme         | Push Web sans A2HS             | Push Web avec A2HS |
| ------------------ | ------------------------------ | ------------------ |
| **iOS Safari**     | ❌ Impossible (Apple)          | ✅ Oui (iOS 16.4+) |
| **Android Chrome** | ✅ Possible (permission grant) | ✅ Possible (idem) |

**Conséquence pratique** : sur Android, le push web fonctionne même sans A2HS — l'install A2HS apporte l'icône + l'expérience full-screen, mais pas le push (qui marche déjà). Sur iOS, A2HS est **prérequis bloquant** pour le push.

### 1.5 Manifest par tenant (KB)

Chaque PWA tenant a son propre `manifest.json` servi dynamiquement par le backend :

```json
{
  "name": "Buns & Bao",
  "short_name": "B&B",
  "icons": [
    {
      "src": "/icons/bunsbao-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    { "src": "/icons/bunsbao-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#FF6B9D",
  "background_color": "#FFFFFF",
  "start_url": "/",
  "display": "standalone"
}
```

iOS exige en plus `apple-touch-icon.png` à 180×180 servi à la racine du sous-domaine.

Livrable du skill `create-virtual-brand` Phase 4 (DA + assets).

---

## 2. Wallet Pass (Apple Wallet / Google Wallet)

### 2.1 Définition

"Carte" numérique (carte de fidélité, billet, coupon) qui s'ajoute dans l'app **Wallet préinstallée** sur tous les iPhones (Apple Wallet) et Android (Google Wallet). Le resto peut **pousser des notifications directement sur l'écran de verrouillage** via cette carte, sans qu'une app KB soit installée.

### 2.2 Friction install

**iOS Apple Wallet — 2 taps** :

```
1. Client scan QR code (sticker sac, fin de cmd PWA)
   OU clique bouton "Ajouter à Apple Wallet" sur la PWA
2. iOS ouvre Apple Wallet avec un preview de la carte
3. Tap "Ajouter"
→ Carte fidélité Buns & Bao dans son Wallet
```

**Android Google Wallet — 2 taps** :

```
1. Client clique bouton "Save to Google Wallet"
2. Google Wallet ouvre avec preview
3. Tap "Save"
→ Carte dans Google Wallet
```

### 2.3 Capacités push

[Selon les data 2026 de Regulr](https://regulr.ai/blog/apple-wallet-loyalty-programs) :

- **99% taux d'ouverture push** (lock screen Apple Wallet)
- **85-95% taux de livraison**
- **8× meilleur taux de redemption** vs coupons email
- **3-4× plus d'engagement** vs apps natives
- **60% taux d'ouverture push** sur Apple Wallet (vs 15-20% email)

**Google Wallet** : [TEXT_AND_NOTIFY message type](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications) ajoute un message au pass + déclenche un push. Limité à 3 push par pass par 24h (anti-spam).

**Google Nearby Passes (2026)** : la carte fidélité remonte automatiquement en notif quand le client passe à proximité physique du resto. Killer feature pour resto local.

### 2.4 Flow "commander depuis une notif Wallet"

```
[Lock screen iPhone — 21h47]
┌────────────────────────────────────┐
│ 🥢 Buns & Bao                       │
│ -20% sur les bao burgers ce soir ! │
│ Tape pour commander →               │
└────────────────────────────────────┘
   ↓ tap notif
[Apple Wallet s'ouvre, carte Buns & Bao mise en avant]
┌────────────────────────────────────┐
│  [Logo Buns & Bao]                  │
│  Carte fidélité — 3 cmds            │
│                                     │
│  🎁 -20% sur les bao ce soir       │
│                                     │
│  [ COMMANDER MAINTENANT → ]         │  ← webServiceURL ou backFields
└────────────────────────────────────┘
   ↓ tap bouton
[Safari ouvre bunsbao.kitchen-boost.com]
   → adresse pré-remplie (Anonymous account silent)
   → menu accessible direct
   → carte CB préchargée (Stripe Customer cross-tenant)
```

**Friction totale = 3 taps**, ~5 secondes.

**Bonus si A2HS PWA installée avant** : Safari détecte la PWA installée et **renvoie directement dans l'app PWA** (pas de barre Safari). UX 100% app native.

Le bouton "Commander" est un lien embarqué dans le champ `webServiceURL` ou `backFields` du pass. Peut être :

- Statique : toujours pointer vers la home PWA
- Dynamique : pointer vers une offre (`/?promo=BAO20`) qui pré-applique le code promo

### 2.5 Faisabilité multi-tenant (1 carte par resto, customer_id unique côté serveur)

**Apple PassKit** :

- NativeSquare a 1 certif Apple Developer + 1 `passTypeIdentifier` partagé (ex: `pass.fr.kitchenboost.loyalty`)
- Pour chaque resto × client, on génère une instance de pass avec :
  - `serialNumber` unique (lié à `customer_id × tenant_id`)
  - Champs branding par resto : `logoText` = "Buns & Bao", `backgroundColor` = couleur BB, `logo.png` = logo BB, `strip.png` = hero photo BB
  - `authenticationToken` unique → permet à KB de pousser des updates et notifs sur ce pass spécifique
- Apple range les passes par "Loyalty Card" mais chaque pass a son visuel propre

**Google Wallet** :

- 1 `issuerId` KB + 1 `classId` partagée (ex: "KitchenBoost-Loyalty") + N `objectId` (instances par client × resto)
- Branding par instance via `hexBackgroundColor`, `logo`, `programName`, hero image

**Backend KB** :

```
Table wallet_passes
  pass_id        (PK)
  customer_id    (FK → customers.id)   ← clé moat global cross-tenant
  tenant_id      (FK → tenants.id)     ← branding visuel resto
  platform       (apple | google)
  serial_number  (unique Apple/Google)
  auth_token     (unique, pour pousser updates)
  installed_at   (timestamp pass_installed webhook)
  ...
```

Quand on pousse un update sur le pass BB (`-20% bao ce soir`), seul ce pass se met à jour. Quand on veut faire de l'analytics cross-resto sur Sophie, on requête par `customer_id`.

**White-label intégral respecté côté UX**. Effet réseau actif côté backend (cross-tenant customer_id) sans aucun message "KitchenBoost" visible au client.

---

## 3. Comparaison synthétique

| Critère                         | **A2HS PWA**                            | **Wallet Pass**                                                           |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Install iOS                     | 4+ taps + connaissance Share menu       | **2 taps** (Add to Wallet)                                                |
| Install Android                 | 1 tap natif (`beforeinstallprompt`)     | 2 taps                                                                    |
| Prompt déclenchable par dev iOS | ❌ Impossible (Apple)                   | ✅ Oui (bouton "Add to Wallet")                                           |
| Push iOS                        | ✅ après A2HS install (16.4+)           | ✅ sans condition                                                         |
| Push Android                    | ✅ avec ou sans A2HS                    | ✅                                                                        |
| Taux ouverture push             | ~40-60% (web push standard)             | **85-99%** (lock screen Wallet)                                           |
| Engagement long terme           | Mauvais (icône PWA peut être supprimée) | **3-4× meilleur** (Wallet pas désinstallable)                             |
| UI commande dispo dedans ?      | ✅ App complète, menu, panier, paiement | ❌ Juste une carte (code, points, push) → renvoie vers PWA                |
| Coût dev pour KB                | Faible (PWA déjà à construire)          | Moyen (certif Apple Dev + signature pass server-side + Google Wallet API) |
| Cas d'usage                     | Expérience commande full-app            | Canal push direct + carte fidélité visible                                |

---

## 4. Stratégie KitchenBoost V1

### 4.1 Architecture dual stack

```
              ┌─── iOS user ────┐         ┌─── Android user ───┐
              ▼                  ▼         ▼                    ▼
        Wallet pass         A2HS PWA   A2HS PWA           Wallet pass
        (PRIMARY)           (BONUS)    (PRIMARY)          (SECONDARY)
              │                  │         │                    │
              └──── push notif ──┴─────────┴────── push notif ──┘
                          ↓                              ↓
                  Tap notif → PWA commande (3 taps Wallet / 1 tap A2HS)
```

### 4.2 Triggers (paramétrables par resto en Phase C)

| Étape                    | Action iOS                                                                        | Action Android                                            |
| ------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Arrivée PWA**          | —                                                                                 | Bouton "📱 Installer Buns & Bao" header (1 tap natif)     |
| **Post-paiement validé** | Bottom sheet "🎁 Ajoute ta carte fidélité + récupère ta surprise" (2 taps Wallet) | Bottom sheet idem (2 taps Wallet)                         |
| **Post-livraison**       | —                                                                                 | Bandeau "Installe l'app pour ne rien rater" (A2HS prompt) |
| **Re-visite cookie hit** | Si pass pas installé → re-prompt Wallet                                           | Si A2HS pas installée → re-prompt natif                   |

### 4.3 Incentive Wallet (paramétrable par resto)

Configuration en Phase C depuis [[KB Admin]] :

- **Texte incentive** : libre, max ~80 caractères ("🎁 Reçois ta surprise dès ta prochaine cmd")
- **Récompense** : code promo (`-10% prochaine cmd` / `1 boisson offerte` / `1 dessert offert`)
- Modifiable à tout moment

**Mécanique anti-triche** : code promo généré et appliqué uniquement si pass effectivement installé (event `pass_installed` via webhook Apple/Google côté backend). Pas de fake reward.

### 4.4 Pas bloquant techniquement V1 mais wording fort

- Pas de blocage paiement si refus d'install (risque conversion iOS énorme)
- Wording incentive psychologiquement contraignant : "Tu es sûr de refuser ta surprise ? 😢"
- Re-prompt à la 2ᵉ cmd si pas installé (pression douce)

---

## 5. Décisions actées 2026-05-24 (révisées en cours de session)

| #   | Décision finale                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Wallet pass V1 = canal push primary** — **carte commune sous marque neutre** (pas "KitchenBoost" littéral, ex: "Resto Paris" Phase 1) pour tous les restos KB participants. Logo du resto principal commandé mis en avant en header de la carte, mention "Membre [Nom carte]" en bas. Cf. [ADR 0003](../adr/0003-wallet-pass-commun-marque-neutre.md).     |
| 2   | **A2HS PWA V1 = canal app commande primary** (Android prompt natif 1 tap / iOS bottom sheet post-cmd 1ère commande). PWA standalone obligatoire, pas de widget embed V1. Cf. [ADR 0004](../adr/0004-pwa-standalone-pas-widget-embed.md).                                                                                                                     |
| 3   | **Web push V1 dispo Android sans A2HS** (permission grant seule) / **iOS requiert A2HS install préalable** (16.4+).                                                                                                                                                                                                                                          |
| 4   | **Incentive Wallet paramétrée par le resto en Phase C** (libre, ex: "-10% prochaine cmd" / "1 Cristaline offerte").                                                                                                                                                                                                                                          |
| 5   | **Code promo délivré uniquement si Wallet pass effectivement installé** (event `pass_installed` webhook).                                                                                                                                                                                                                                                    |
| 6   | **Icône PWA + manifest + splash screen brandés par resto** (livrable Phase 4 skill `create-virtual-brand`).                                                                                                                                                                                                                                                  |
| 7   | **Push enrollment BLOQUANT à la validation paiement** (révision en cours de session — précédemment "pas bloquant"). Bouton "Payer" disabled tant qu'au moins un canal n'est pas actif. Fallback ultra-frictionnel "Continuer sans notifs" pour ~5-10% de blocages techniques irréductibles. Cf. [ADR 0002](../adr/0002-push-moat-dual-stack-wallet-a2hs.md). |
| 8   | **Article 2 ter contrat à reformuler** pour autoriser carte commune sous marque neutre (KB reste propriétaire des données, marque consumer-side neutre acceptée). À coordonner avec avocat avant V1 launch.                                                                                                                                                  |
| 9   | **Carte premium par resto = option V2** pour restos sensibles à leur autonomie de marque (paient supplément X €/mois).                                                                                                                                                                                                                                       |
| 10  | **Naming carte commune évolutif** : updatable à tout moment via push update Wallet sans action client (PassKit Web Service / Google Wallet API). Phase 1 démarre avec nom acceptable-enough, optimisable plus tard sans coût.                                                                                                                                |
| 11  | **Cross-tenant push = ACTIF dès V1** via carte commune (1 channel pour N restos). KB peut pousser "Nouveau resto à 5 min de chez toi" à tous les clients du quartier dès l'onboarding d'un nouveau resto.                                                                                                                                                    |
| 12  | **Deep linking par notif** : chaque notif a son propre `app-launch-url` (Apple) / `actionUri` (Google) — tap notif → redirige vers la PWA du resto qui pousse, indépendamment de la carte Wallet courante.                                                                                                                                                   |

---

## 6. Sources

### Apple Wallet

- [Apple Developer — Loyalty Passes](https://developer.apple.com/wallet/loyalty-passes/)
- [Apple Wallet Loyalty Programs: The Complete 2026 Playbook (Regulr)](https://regulr.ai/blog/apple-wallet-loyalty-programs)
- [Apple Wallet Loyalty Card: Full Guide vs Apps (FaveCard)](https://www.favecard.co/en/blog/wallet-vs-loyalty-apps/)
- [Apple Wallet Updates & Push Notifications (Passcreator)](https://www.passcreator.com/en/blog/apple-wallet-pass-updates-and-push-notifications-how-they-work-and-how-to-use-them)

### Google Wallet

- [Google Wallet — Trigger Push Notifications](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications)
- [Google Wallet Pass Notifications (PassKit Support)](https://help.passkit.com/en/articles/12527916-understanding-google-wallet-pass-notifications)

### Restaurants (use cases)

- [Google & Apple Wallet Passes for Restaurants: 2026 Guide (82dash)](https://blog.82dash.com/google-apple-wallet-passes-restaurants-complete-guide/)
- [Best Digital Wallet Pass Tools for Restaurants and Hotels 2026 (82dash)](https://blog.82dash.com/best-digital-wallet-pass-tools-restaurants-hotels-2026/)

### PWA iOS

- [PWA iOS Limitations and Safari Support 2026 (MagicBell)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Do Progressive Web Apps Work on iOS? Complete 2026 (Mobiloud)](https://www.mobiloud.com/blog/progressive-web-apps-ios)

### SaaS Wallet pass platforms (benchmarks)

- [PassKit — Mobile Wallet Engagement Platform](https://passkit.com/)
- [Passcreator — Wallet pass platform](https://www.passcreator.com/)
- [Regulr — Apple Wallet loyalty platform](https://regulr.ai/)
