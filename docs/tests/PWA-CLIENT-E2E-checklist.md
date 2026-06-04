# E2E manual checklist — PWA Client KitchenBoost (V1)

Checklist E2E manuelle pour la PWA client (`apps/web`), nomenclature canonique alignée sur le PRD section Testing Decisions (A / M / C / CHK / PAY / TRK / WAL / A2H / REC). Chaque parcours est à exécuter à la main contre `apps/web` en dev (Convex live + seeds e2e + Stripe test + Uber sandbox + device réel iPhone Safari OU Android Chrome).

- **Date** : 2026-06-04 (squelette créé en préparation drain AFK PWA)
- **Statut global** : 🟡 **EN CONSTRUCTION** — les groupes se remplissent au fur et à mesure que les slices #449-#464 mergent. Chaque PR sub-agent propose 1 à 3 scénarios E2E dans sa description ; l'orchestrateur (cf. handoff `handoff-pwa-client-afk-loop-2026-06-04.md`) filtre + agrège ici au fil des merges. Objectif : coverage exhaustif des 66 user stories du [sub/10-pwa-client/00-master.md](../prd/sub/10-pwa-client/00-master.md) sans redondance entre groupes.
- **Pré-requis transverses** : seeds `e2e` chargées (≥ 1 tenant `bunsbao` slug + custom domain, menu publié ≥ 3 catégories ≥ 15 items dont 2 avec modifiers obligatoires + 1 item out-of-stock toggleable depuis admin), Convex deployment dev (`impartial-goshawk-798` ou équivalent), Stripe en mode test avec `acct_resto` rattaché au tenant, Uber Direct sandbox creds, VAPID keys valides, Apple PassKit cert + Google Wallet issuer ID valides, Resend test pour emails transactionnels. Pour les tests Wallet/push, device physique iPhone 15+ Safari et device physique Android Chrome récent.
- **Convention** : format strict aligné sur la campagne admin (cf. [`E2E-checklist.md`](E2E-checklist.md) validée 12/12 groupes 2026-06-03) — **Acteur / Pré-requis / Étapes / Attendu / Couvre**. La colonne "Couvre" référence : les US du PRD master + les issues `#N` mergées + les modules deep extraits.
- **Slices de référence** : voir [00-issues-breakdown.md](../prd/sub/10-pwa-client/00-issues-breakdown.md) pour le DAG des 19 slices (3 HITL + 16 AFK) et le mapping US ↔ slice.

---

## A — Address-first flow

> **Slices** : #449 (S1 tenant resolution) + #451 (S3 address-first) · **Statut** : ⏳ EN ATTENTE merge slices
>
> Couvre : address-first BLOQUANT avant menu, Google Places autocomplete obligatoire, auto-validate au sélection, chain `signIn → getOrCreateCurrentCustomer → updateAddress → requestDeliveryQuote`, 4 verdicts (`deliverable` / `hors_zone` / `hors_horaire` / `surge`), édit adresse re-fire quote.

_À remplir au fur et à mesure que les PRs des slices #449 + #451 mergent — chaque sub-agent propose 1-3 scénarios E2E dans sa description PR, l'orchestrateur filtre + agrège ici._

---

## M — Menu browsing

> **Slices** : #452 (S4 menu ISR + item modal Vaul + overlay LIVE) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : LCP <1.5s 4G, catégories scrollables + ancres latérales, badges + filtres allergènes (14 UE 1169/2011), item modal bottom-sheet Vaul `?item=<id>` URL-stateful (back button ferme), modifiers required/optional (badge "À choisir"), overlay LIVE `available` Convex sub par-dessus HTML cached ISR, deep-link `?promo=<itemId>` scroll + highlight.

_À remplir au fur et à mesure que la PR slice #452 merge._

---

## C — Cart + delivery mode toggle

> **Slices** : #453 (S5 cart + Note resto + Delivery mode toggle) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : lignes panier dédupées par config item × modifiers, edit qty + suppression, Note resto 200 chars max, sous-total + frais livraison (prix barré "Offert par X" si pricing rule) + total, toggle Livraison/C&C header permanent switch sans re-quote (verdict initial cache 2 modes), mode initial cohérent avec verdict S3.

_À remplir au fur et à mesure que la PR slice #453 merge._

---

## CHK — Checkout + push enrollment 3 paliers

> **Slices** : #454 (S6 checkout form RSC + détection canal actif) + #455 (S6a Wallet branch) + #456 (S6b Web Push branch + iOS<16.4 mask) + #457 (S6c fallback 3 niveaux + noChannelPossible) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : RSC `preloadQuery(getCurrentCustomer)` pré-remplissage form (firstName/email/phone capturés à un checkout précédent), Convex sub réactive bouton "Payer" gated dynamique, wording CGV ≥ 12px sous bouton, modal push enrollment single-screen non-skippable (Esc/click outside ignorés), branche Wallet (loader 30s + "Tester sans attendre" + "J'ai changé d'avis"), branche Web Push (`Notification.requestPermission` + masquage iOS <16.4), fallback 3 niveaux frictionnels (lien 12px → modal confirm → re-display modal initial → flag `noChannelPossible`).

_À remplir au fur et à mesure que les PRs des slices #454-#457 mergent. Particulièrement critique : le scénario combiné "0 canal → palier 3 Wallet refusé + Web Push denied → lien fallback → 3 niveaux → flag posé + Payer débloqué" qui couvre la state machine complète du module `push-enrollment-orchestrator`._

---

## PAY — Stripe payment

> **Slices** : #458 (S7 Stripe payment + latching surge + Apple Pay verification) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : Stripe Elements lazy-loaded uniquement sur `/checkout` (vérif DevTools Network sur `/menu`), saved card cross-resto pre-selected (tile + "Utiliser autre carte"), Payment Element neuve avec Apple Pay button visible iOS + Google Pay Android, checkbox "Sauvegarder ma carte" neutre, latching `recaptureQuoteAtPayment` AVANT `stripe.confirmPayment` (modal bloquant si surge), 3DS handle par SDK transparent, retry inline max 3 échecs → 3ᵉ échec toast + Sentry log, redirect direct `/c/[orderId]` au webhook `payment_intent.succeeded`.

_À remplir au fur et à mesure que la PR slice #458 merge._

---

## TRK — Tracking realtime + incidents

> **Slices** : #459 (S8 tracking page realtime + incidents) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : `/c/[orderId]` redirect direct post-paiement (état T+0 "Cmd reçue"), placeholders SVG simples 6 étapes delivery + 3 C&C (Lottie swap V1.1 post HITL-3), ETA texte live dérivé webhook Uber, Convex subscription realtime <500ms sans polling, récap items collapsible `<details>` natif, card "Incident livraison, tu as été remboursé" si `delivery.status ∈ {incident_after_pickup, refused_post_payment}`, URL `/c/[orderId]` non-protégée partageable (orderId Convex Id brut non-devinable).

_À remplir au fur et à mesure que la PR slice #459 merge._

---

## WAL — Wallet pass install + bridge identité

> **Slices** : #460 (S9a Wallet install button + 3 paliers) + #461 (S9b Wallet bridge identité au tap deep-link) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : palier 1 (card pleine page après submit address-first, dismissable "Plus tard"), palier 2 (bandeau permanent menu/panier, dismissable session-scoped), palier 3 = modal CHK ci-dessus, install effectif iPhone Safari (Blob `.pkpass` MIME sheet natif Apple Wallet), install effectif Android Chrome (`googleSaveLink` Google Wallet preview), Convex sub flip `walletStatus = "enrolled"` au webhook `pass_installed`, bridge identité au tap deep-link `?wallet=<serial>` (re-signIn cookie session sur customer global → firstName + address + savedPaymentMethodId cross-device/cross-resto immédiats), re-branding pass à chaque cmd nouveau resto via `triggerUpdate.recordBrandChange` silent push, **vérification spécifique iOS** : push Wallet avec workaround `app-launch-url` update juste avant push fonctionne effectivement (US 43, backend déjà mergé).

_À remplir au fur et à mesure que les PRs des slices #460 + #461 mergent._

---

## A2H — A2HS install (Android + iOS)

> **Slices** : #462 (S10 A2HS Android post-cart) + #463 (S11 A2HS iOS post-tracking) · **Statut** : ⏳ EN ATTENTE
>
> Couvre : Android `beforeinstallprompt` capturé en `<PWAInstallContext>`, bouton install bottom-right rendered après 1er add cart, click → prompt natif Android, accept → `appinstalled` event → `recordA2hsAccepted` flip `a2hsStatus = "enrolled"`, masquage bouton à la visite suivante via Convex sub. iOS bottom-sheet Vaul sur `/c/[orderId]` état T+0 (GIF 8s loop Share→"Sur l'écran d'accueil"→"Ajouter"), heuristique standalone à la visite suivante (`matchMedia('(display-mode: standalone)').matches` + flip enrolled).

_À remplir au fur et à mesure que les PRs des slices #462 + #463 mergent._

---

## REC — Recognition retour

> **Slices** : #464 (S12 Bandeau "Bonjour firstName" + "Ce n'est pas moi") · **Statut** : ⏳ EN ATTENTE
>
> Couvre : 2ᵉ visite après checkout terminé → bandeau "Bonjour {firstName} 👋" visible au-dessus form Google Places, form pré-rempli avec address cached + bouton "Confirmer" (au lieu de "Valider"), click "Ce n'est pas moi →" clear cookie Convex Auth (route handler `/api/signout`) + page reload → form vide + bandeau absent (cookie tenant inchangé), cas cookie présent mais `firstName === null` → AUCUN bandeau juste pré-rempli silencieux, **audit visuel garde-fou** : aucun texte "On a ton adresse" / "Voici tes 4 dernières cmds" / mention historique explicite (anxiogène = surveillance vs hospitalité).

_À remplir au fur et à mesure que la PR slice #464 merge._

---

## Notes méthodologie campagne

### Comment l'orchestrateur peuple ce fichier

Pour chaque PR sub-agent qui merge :

1. **Récupérer** les 1-3 scénarios E2E proposés dans la description PR (constraint non-négociable cf. issues #449-#464 bloc Constraints).
2. **Filtrer** :
   - Écarter les tautologies ("le bouton apparaît quand on le rend visible")
   - Écarter les tests trop bas-niveau ("le bouton est vert") — couverts par audit visuel inline, pas un test E2E dédié
   - Écarter les redondances avec scénarios déjà présents dans un autre groupe
3. **Agréger** : fusionner les scénarios qui peuvent se chaîner en 1 parcours continu plus efficace. Exemple : "S4 add cart depuis menu" + "S5 toggle livraison/C&C" → 1 scénario "Groupe M : Menu → add cart Smash Burger → toggle livraison → fees re-calculés" plutôt que 2 scénarios isolés.
4. **Inscrire** dans le bon groupe avec format strict **Acteur / Pré-requis / Étapes / Attendu / Couvre**.
5. **Mettre à jour le statut du groupe** : `⏳ EN ATTENTE` → `🟡 EN COURS` → `✅ X/X validés` une fois testé sur device réel par Alex.

### Tests NON couverts par ce fichier

- **Tests unitaires + cross-tenant fuzz + tests React Testing Library** : réalisés directement par les sub-agents dans leur PR, mergés avec le code (vitest, mock convex/react, etc.). Pas filtrés par l'orchestrateur — c'est l'agent qui implémente qui les écrit. Référence : pattern `apps/admin` fichiers `.test.tsx` validé.
- **Snapshots UI** : non utilisés (brittle, couverts par E2E manuel ici).
- **Tests automatisés Playwright/Cypress** : V1 = manuel sur device, retour V2 si volume justifie.

### Devices cibles V1

| Device                                 | OS              | Browser | Cas couverts                                                                                                                                                                  |
| -------------------------------------- | --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone 15+                             | iOS 17+         | Safari  | A2HS bottom-sheet GIF, Wallet `.pkpass` Blob sheet, Apple Pay, push Wallet, iOS <16.4 Web Push masking (test secondaire sur iPhone OS 15 si dispo)                            |
| Android récent (Pixel 8 ou équivalent) | Android 14+     | Chrome  | A2HS `beforeinstallprompt`, Google Wallet preview, Google Pay, Web Push, `actionUri` deep-link                                                                                |
| Desktop fallback                       | macOS / Windows | Chrome  | Vérification : bouton Wallet désactivé "Disponible sur mobile uniquement", message "Continue depuis ton mobile pour finaliser" au modal push enrollment (PRD V1 mobile-first) |
