# 10 — PWA Client Commande

**Statut** : 🟡 Squelette · **Version** : 0.4 · **Dernière mise à jour** : 2026-06-04
**Lié au master** : [00_master.md § 5 bloc 1](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)
**Sub-PRD canonique** : [sub/10-pwa-client/00-master.md](sub/10-pwa-client/00-master.md) + [decisions-log](sub/10-pwa-client/00-decisions-log.md) + [issues-breakdown](sub/10-pwa-client/00-issues-breakdown.md)

> **v0.4** : Grilling architectural PWA acté 2026-06-04 (Q1→Q8). §2 address-first auto-validate au sélection. §5 overlay LIVE `available` Convex sub par-dessus HTML ISR. §9 push enrollment refondu en 3 paliers (soft prompt + bandeau permanent en amont du modal bloquant au paiement) + détection canal actif Convex sub côté `/checkout` + fallback 3 niveaux frictionnels détaillé. §11 tracking realtime Convex sub sans polling + cas incident. Sub-PRD complet versé dans `docs/prd/sub/10-pwa-client/` (master + decisions-log Q1→Q8 + 19 vertical slices breakdown publié comme issues GitHub #445-#464).
> **v0.3** : Grilling DDD acté 2026-05-24 — address-first flow + toggle livraison/C&C header permanent + PWA standalone (pas widget embed) + dual stack Wallet pass commun sous marque neutre + A2HS PWA + push enrollment BLOQUANT à la validation paiement + branding asymétrique (PWA resto / Wallet commun) + page tracking unifiée avec récap collapsible + 14 allergènes UE paramétrables + modifiers min/max comme Uber Manager + lignes panier séparées par config + pas de search V1 + pas de marketplace V1 + pas de codes promo manuels V1 + pas de banner cookie V1 (first-party only) + reviews = V2 → Google jamais Uber Eats. ADRs 0002/0003/0004 créés.
> **v0.2** : Scope V1 étendu suite révision master v2.0. Apple Pay/Google Pay, position géo, carte sauvegardée cross-resto, click & collect, push marketing — désormais V1.

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | **PWA standalone** sur sous-domaine KB (`<slug>.kitchen-boost.fr`) ou domaine custom resto, pas de widget embed (cf. [ADR 0004](../adr/0004-pwa-standalone-pas-widget-embed.md)). **Address-first flow** Google Places obligatoire à l'arrivée + quote Uber Direct immédiat. **Toggle Livraison/C&C visible permanent en header** (pattern Uber Eats, switchable avant paiement, panier préservé). Home menu, panier (lignes séparées par config item×modifiers), checkout Stripe, **Apple Pay / Google Pay**, **carte sauvegardée cross-resto KB** (Stripe Customer cross-tenant via `clone PaymentMethod` API), suivi commande temps réel (page tracking = page confirmation, animations Lottie + ETA + récap collapsible). **Captation obligatoire** email + tel + prénom + position géo + **consentement par clic Payer** ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md)). **Branding asymétrique** : PWA + icône A2HS + email transactionnel = branded resto 100% (logo + 1 couleur + hero photo) ; carte Wallet = commune sous marque neutre + logo resto principal en header. **Dual stack push enrollment** : Wallet pass commun (canal primary, cf. [ADR 0002](../adr/0002-push-moat-dual-stack-wallet-a2hs.md) + [ADR 0003](../adr/0003-wallet-pass-commun-marque-neutre.md)) + A2HS PWA secondary (Android natif / iOS post-cmd) + Web push Android sans A2HS. **Push enrollment BLOQUANT à la validation paiement** (bouton "Payer" disabled tant qu'au moins un canal n'est pas actif, fallback ultra-frictionnel). **Incentive Wallet paramétrée par resto** en Phase C (texte + code promo conditional `pass_installed`). Modes livraison Uber Direct + click & collect activés par défaut (choix client). **Item out of stock** = toggle 1-tap KDS + auto-réactivation lendemain. **Note resto** = champ texte libre global panier, 200 chars max. **14 allergènes UE 1169/2011** paramétrables item par item depuis KB Manager. **Modifiers paramétrés min/max** comme Uber Manager (bouton "Ajouter" disabled si min non satisfait). **Pas de search V1** (catégories scrollables avec ancres). **Pas de codes promo manuels V1** (seul code Wallet install auto-généré). **Pas de banner cookie V1** (first-party only). **Pas de marketplace web V1**. FR only. |
| **V2**  | Branding PWA étendu (multi-couleurs, fonts custom upload, hero animé/dégradé), historique cmds client visible, profil persistant cross-resto avec UI explicite, deep linking depuis push (déjà supporté techniquement V1, UI étendue V2), A/B testing variants de PWA, **reviews gating post-livraison cible Google My Business du resto (JAMAIS Uber Eats)** avec smart-routing 4★+ → Google / <4★ → form privé KB, **codes promo manuels ad-hoc** (UI KB Admin), **search dans le menu**, **option premium "carte Wallet par resto"** pour restos sensibles à leur autonomie de marque, **horaires séparés livraison vs C&C**, **map embed tracking** si demande terrain, **email marketing cross-tenant** "[Nom carte] × Buns & Bao" co-branded, **mode widget embed** (sans push iOS, limitation architecturale incontournable).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **V3**  | Multi-langue, app native client final si métriques PWA insuffisantes, paniers partagés (group order), pré-commande planifiée, programme loyauté visible, marketplace web `restoparis.fr` listing tous les restos KB du quartier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Hors scope (même si demandé)

- **Marketplace KB consumer-facing V1** : pas de page `kitchen-boost.fr/restaurants` listing les restos KB. Chaque resto a son URL propre. La marque consumer-side neutre [[Wallet pass]] commune suffit pour activer le réseau V1. Marketplace web = V3.
- **Widget embed dans site host du resto V1** : casse le push iOS (limite architecturale incontournable, cf. [ADR 0004](../adr/0004-pwa-standalone-pas-widget-embed.md)). V2 envisageable sans push iOS.
- **Codes promo manuels ad-hoc V1** : complique l'intégration Stripe (`application_fee_amount` calcul post-promo) + sous-système non-trivial. Le resto peut jouer directement sur les prix items depuis KB Admin. Seul code V1 = auto-généré via Incentive Wallet install.
- **Search dans le menu V1** : navigation par catégories scrollables + ancres latérales suffit pour ~25 items/resto.
- **Banner cookie V1** : first-party cookies essentiels uniquement (customer_id token), CNIL exempte. **Consentement par clic « Payer »** ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md)), **pas de checkbox**. V2 si analytics tiers branchés.
- **Compte unifié type "Yelp"** avec reviews public, photos communautaires.
- **Recommandations algorithmiques de plats** (cross-resto).
- **Reviews post-livraison V1** : V2, ciblera Google My Business du resto, JAMAIS Uber Eats (principe : KB capte off-platform, ne réalimente pas le moat Uber).
- **Pré-commande planifiée** (paie maintenant, livraison à 18h30) : V3.
- **Tip courier** (pourboire) : V2 si demande.

## Personas concernés

- **Client final mangeur** (primaire — cf. [00_master.md § 3.2](00_master.md#32-client-final-mangeur-utilisateur-consommateur))
- **Restaurateur** (secondaire : il consulte parfois la PWA pour vérifier que tout est OK côté client)

## Surface fonctionnelle

### 1. Entrée dans l'app

- Scan QR code (sticker dans sac livraison Uber Eats du resto) OU URL directe `<slug>.kitchen-boost.fr` OU domaine custom resto OU push deep link Wallet (`?promo=XXX`)
- PWA standalone (pas widget embed, cf. [ADR 0004](../adr/0004-pwa-standalone-pas-widget-embed.md))
- Si client déjà connu via Anonymous account token (cookie HttpOnly) → reconnaissance silencieuse, accès direct à l'écran "Indique ton adresse" avec pré-remplissage

### 2. Address-first flow (BLOQUANT avant menu)

- À l'arrivée : écran "Indique ton adresse" via Google Places autocomplete obligatoire (saisie libre interdite)
- **Auto-validate au sélection** suggestion Google (pas de bouton "Valider" indépendant — 1 tap de moins, acté grilling PWA Q7 2026-06-04). Chain au sélection : `signIn("anonymous")` → `getOrCreateCurrentCustomer` → `updateAddress({address, lat, lng})` → action `delivery.quote.requestDeliveryQuote`
- Pendant quote (~500-800ms) : spinner inline "On vérifie la livraison…"
- Si quote OK : toggle Livraison/C&C visible + accès au menu
- Si quote refusé (hors zone / hors horaire / surge bloquant) : mode livraison verrouillé, seul C&C accessible avec message contextualisé
- Position géo lat/lng captée → alimente customer record + déclenche Quote
- Édit adresse après validation → re-fire quote automatique (debounce 300ms)

### 3. Toggle Livraison / Click & Collect (header permanent)

- Pattern Uber Eats : `[🛵 Livraison · 2,95 €] [🚶 Retrait · Gratuit]`
- Visible en permanence dans le header de la PWA
- Switchable à tout moment avant validation paiement (panier préservé, frais livraison + ETA recalculés)
- Mode initial : livraison si quote OK, C&C si quote refusé (livraison grisée)

### 4. Home / présentation resto

- Hero photo resto (livrable Phase 4 skill `create-virtual-brand`)
- Logo + nom + courte desc
- Statut "ouvert / fermé / en pause" (selon plage horaire de service KB-managed)
- Accès direct au menu

### 5. Catalogue / menu

- Catégories scrollables (avec ancres latérales, pas de search V1)
- Items avec photo, nom, prix, description courte
- Badges allergènes (14 UE 1169/2011) + filtres rapides "Sans gluten / Vegan / Végé"
- Items grisés "Indisponible ce soir" si out of stock (toggle KDS)
- **Rendering = ISR + on-demand revalidate** (acté grilling PWA Q2 2026-06-04) : `publishedMenus` change uniquement au clic "Publier" admin → mutation Convex `publishMenu` déclenche `revalidateTag('menu:<tenantId>')` côté Vercel → CDN invalidé → prochain visiteur déclenche re-render. LCP cible <1.5s sur 4G grâce au HTML pré-rendu CDN.
- **Overlay LIVE `available` via Convex subscription** (acté grilling PWA Q2) : le champ `available` (cf. [[Item out of stock]]) n'est PAS dans l'[[Instantané publié]] ISR, c'est un overlay temps réel par-dessus le HTML cached — toggle KDS depuis [[KB Orders]] → re-render PWA <500ms sans full reload, sans invalidation CDN, sans republication menu. Pareil si item passe out-of-stock entre cart add et checkout (sub réactive sur `/panier`).

### 6. Item détail

- Photo + description complète
- Modifiers paramétrés min/max (comme Uber Manager) — single-choice si max=1, multi-choice sinon
- Bouton "Ajouter au panier" disabled tant que les modifiers `min_select > 0` ne sont pas satisfaits + badge "À choisir" sur modifier manquant
- Quantité

### 7. Panier

- Liste items : **chaque combinaison item × modifiers = 1 ligne distincte** (ex: `Smash Double - Ketchup × 1` + `Smash Double - Mayo × 1` = 2 lignes)
- Modif quantité, suppression par ligne
- **Note resto** : champ texte libre global panier, 200 chars max, optionnel ("Une note pour le resto ? — allergies, demandes spéciales")
- Sous-total + frais livraison (transparent + mention "Offert par X" si pricing rule) + total
- CTA "Commander" → checkout

### 8. Identification / capture client (au checkout)

- Form rapide : email + téléphone + prénom (adresse déjà captée à l'étape 2)
- Si client déjà connu (Anonymous account = **cookie device** ; cross-device **uniquement via carte Wallet**, pas de match email/tel — [ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md)) → pré-remplissage
- RGPD : **consentement par clic « Payer »** ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md), supersede l'ancienne checkbox [ADR 0001](../adr/0001-consent-marketing-bloquant-checkout-v1.md)) — phrase lisible sous le bouton, enregistre `cgvAcceptedAt` + `cgvVersionHash` (cf. [90_donnees_clients_crm.md](90_donnees_clients_crm.md))

### 9. Push enrollment — 3 paliers Wallet + BLOQUANT au paiement

**3 paliers de prompt Wallet progressifs en amont du bloquant** (acté grilling PWA Q5/Q8 2026-06-04, capture aussi les visiteurs low-intent qui auraient skip un push enrollment uniquement-au-paiement) :

1. **Palier 1 — Soft prompt** : juste après submit address-first, card pleine page "🎁 -10% sur ta prochaine cmd → Ajoute la carte" + bouton primary + "Plus tard" link skippable. NON bloquant.
2. **Palier 2 — Bandeau permanent** : bandeau top fin permanent sur menu/panier "🎁 -10% offerts → ajoute la carte", dismissable session-scoped (sessionStorage). NON bloquant.
3. **Palier 3 — Modal BLOQUANT au clic "Payer"** : check qu'au moins UN canal push enrollment est actif :
   - Pass Wallet installé (event `pass_installed` reçu)
   - Permission web push accordée + subscription valide
   - A2HS PWA détectée (`display-mode: standalone`)
   - Si rien : modal **non-skippable** (Esc / click outside ignorés) single-screen "Pour finaliser ta cmd, choisis comment recevoir ta confirmation + offres : 🥇 Carte fidélité Wallet (2 taps recommandé) / 🥈 Notifs navigateur (1 tap)"
   - Option Web Push **masquée si iOS <16.4** (détecté via `'PushManager' in window === false`)
   - Incentive Wallet paramétrée par le resto affichée comme hook ("🎁 Reçois -10% sur ta prochaine cmd")
   - Flow async install Wallet : loader 30s "En attente confirmation Wallet…" + bouton "Tester sans attendre" (poll `wallet.checkInstallStatus`) + lien "J'ai changé d'avis" (retour modal initial). Convex sub sur `customers.pushEnrollment.walletStatus` flip `"enrolled"` au webhook `pass_installed` → modal close auto

**Détection canal actif côté front** (acté Q8) : RSC `/checkout` `preloadQuery(getCurrentCustomer)` check `pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}`. Si au moins UN = `"enrolled"` → modal NE s'affiche PAS, bouton "Payer" actif direct. **Convex subscription client-side** réactive le bouton sans reload si install effectif pendant que le client est sur `/checkout` (ex: au palier 1 5 min plus tôt).

**Fallback "Continuer sans notifs" — 3 niveaux frictionnels** (apparaît uniquement après 2 échecs documentés, ex: Wallet refusé + Web Push denied) : lien microscopique 12px muted → modal confirm "Sans notifs : AUCUNE confirmation, AUCUN suivi, AUCUNE offre. Sûr ?" → modal final "On a vraiment besoin d'au moins un canal…" → re-display modal initial une dernière fois. Re-refus final → flag `customer.pushEnrollment.noChannelPossible = true` + close modal + proceed paiement (SMS fallback transactionnel via [[Cascade Notifications]], coût ~0.5-1€/mois/resto pour <5% des cas).

### 10. Checkout Stripe

- Stripe Elements embed (sécurisé)
- Apple Pay / Google Pay dispo V1
- Carte sauvegardée cross-resto KB si client déjà connu (Stripe Customer cross-tenant, `clone PaymentMethod`)
- Validation paiement → trigger backend (cf. [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md))

### 11. Page Tracking (= page de confirmation, état T+0)

- Redirect immédiat post-paiement validé vers cette page (URL = `/c/[orderId]`, `orderId` = Convex Id brut non-devinable, URL non-protégée par auth — partageable SMS/push)
- **Animations Lottie SVG par étape + ETA texte live**, pas de map, white-label total
- 6 étapes mode livraison : `Cmd reçue` → `En préparation` → `Courier assigné` (prénom + ETA pickup) → `Courier en route vers le resto` (ETA pickup live) → `Courier en route vers toi` (ETA dropoff live) → `Livrée` (push "Bon appétit ! 🍽️")
- 3 étapes mode C&C : `Cmd reçue` → `En préparation` (ETA prête dans X min) → `Prête à récupérer` (push "ta cmd t'attend chez [resto]")
- **Realtime via Convex subscription, SANS polling** (acté grilling PWA Q7 2026-06-04) : `useQuery(api.orders.getOrderTracking, {orderId})` côté client → webhook Uber Direct (ou KDS pour C&C) écrit `deliveries.status` / `orders.status` → Convex push toutes UIs subscribers → re-render <500ms (pas de `setInterval`, pas de re-fetch manuel). ETA dérivé webhook Uber `pickup_eta` / `dropoff_eta` (~30s refresh côté Uber).
- **Récap items collapsible** : bouton "Voir le détail de ma cmd" déplie items + modifiers + total + adresse (élément `<details><summary>` natif HTML, pas de lib)
- Email transactionnel envoyé en parallèle avec récap complet (backup permanent)
- Cas incident : si `delivery.status ∈ {'incident_after_pickup', 'refused_post_payment'}` → card "Incident livraison, tu as été remboursé" + Lottie incident (cf. [[Cmd avortée]] dans [[Delivery]])

### 12. Post-livraison (V1)

- Push "Bon appétit ! 🍽️" sur event `delivered`
- **Pas de demande de review V1** (V2 → Google My Business du resto, jamais Uber Eats)
- Suggestions de réorder V2

## Flows nominaux (high-level user stories)

1. **First-time order via QR scan** : client scanne sticker dans sac Uber Eats → atterrit sur PWA branded resto → écran "Indique ton adresse" Google Places → quote OK → toggle Livraison sélectionné par défaut → menu → ajoute items → panier → checkout (capture email/tel/prénom + RGPD bloquant) → **push enrollment BLOQUANT** (modal Wallet ou Web Push avec incentive) → Stripe Elements → paie → page Tracking T+0 "Cmd reçue" avec animation Lottie → ... → "Livrée" → push "Bon appétit !".
2. **Returning order via push notif Wallet** : client reçoit push lock-screen "[Nom carte]" + "🥢 Buns & Bao : -20% bao ce soir !" → tap → ouvre PWA `bunsbao.kitchen-boost.fr/?promo=BAO20` directement (deep link de la notif, pas via Wallet) → reconnaissance silencieuse Anonymous account → adresse pré-remplie → quote OK → menu → ajout panier (promo appliquée) → paie (carte CB préchargée, Stripe Customer cross-tenant) → Tracking.
3. **Returning order direct URL ou QR sticker resto** : client tape `<slug>.kitchen-boost.fr` ou scan QR sticker boîte → home avec adresse pré-remplie → toggle Livraison/C&C → menu (filtres allergènes) → ajout panier → checkout → paie en 2 clics.
4. **Cross-tenant push KB root (V1 dès onboarding nouveau resto)** : nouveau resto Y signe → KB pousse à tous les clients KB de la zone "Nouveau resto à 5 min de chez toi : Y" via carte Wallet commune → tap → ouvre PWA `y.kitchen-boost.fr` → trafic immédiat J+1.
5. **Address hors zone à l'entrée** : client indique adresse → quote refusé → mode livraison verrouillé, message "trop éloignée, essaie une autre adresse ou viens chercher (C&C)" → bascule C&C ou change adresse.

## Edge cases

- **Resto fermé / hors plage horaire** : message contextualisé "Le resto est fermé, ouvre à 18h30" → checkout bloqué (pas de pré-commande V1).
- **Item out of stock** : grisé "Indisponible ce soir" avec toggle 1-tap KDS, ajout panier empêché. Auto-réactivation au lendemain.
- **Adresse hors zone livraison** : quote refusé à l'entrée → mode livraison verrouillé, C&C accessible avec message "trop éloignée, essaie autre adresse ou viens chercher".
- **Paiement échoué** : retry possible (3 max), pas de double-charge.
- **Connexion perdue pendant checkout** : recovery via cookie / localStorage panier.
- **Push enrollment refusé sur iOS (Wallet + Web Push + A2HS tous refusés)** : modal frictionnel "Continuer sans notifs" disponible après 2 échecs avec disclaimer fort. ~5-10% des cas iOS estimés, drop conversion accepté.
- **Blocage technique pass install (mode privé Safari, MDM entreprise, iOS <16.4)** : fallback frictionnel s'active. Backend tag `no_push_enrolled = true` pour retargeting email.
- **Adresse imprécise / mauvaise** : Google Places autocomplete obligatoire (saisie libre interdite V1) garantit format normalisé.
- **Multiple items même type avec modifiers différents** : 1 ligne distincte par config dans le panier (ex: `Smash Double - Ketchup × 1` + `Smash Double - Mayo × 1`).
- **Surge Uber Direct entre quote et paiement** : re-capture au paiement (latching), si moins avantageux → prompt explicite "Le tarif livraison est passé de X € à Y €, confirmes-tu ?".
- **Client revient sur PWA après une cmd, change d'avis sur le mode** : toggle Livraison/C&C re-switchable jusqu'au clic "Payer".

## Critères de succès / acceptation

### V1

- [ ] Une commande complète (scan → payée) en moins de 3 minutes pour un nouveau client.
- [ ] PWA installable A2HS iOS 16.4+ et Android.
- [ ] LCP < 2.5s en 4G sur catalogue.
- [ ] 0 fuite cross-tenant testée (un client de Buns & Bao n'accède pas au menu d'un autre resto par manipulation URL).
- [ ] Branding logo + couleur primaire reflétés.

### V2

- [ ] Historique commandes visible client.
- [ ] Reviews gating opérationnel (positif → Google, négatif → form privé).

## Dépendances

| Dépendance                                                     | Type    | Bloque quoi                                 |
| -------------------------------------------------------------- | ------- | ------------------------------------------- |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md) | Interne | Section 7 checkout                          |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md)     | Interne | Section 9 suivi temps réel + zone livraison |
| [50_multi_tenant_saas.md](50_multi_tenant_saas.md)             | Interne | Toute la PWA (par tenant)                   |
| [80_notifications.md](80_notifications.md)                     | Interne | Sections 8, 9, 10 (push + email)            |
| [90_donnees_clients_crm.md](90_donnees_clients_crm.md)         | Interne | Section 6 captation                         |
| Stripe.js                                                      | Externe | Section 7                                   |
| Google Places API                                              | Externe | Section 6 adresse                           |

## Open questions

| Q       | Question                                                                                                                                                                                                                                                                                                                                 | Deadline | Owner                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------- |
| 10-Q1   | ~~Cookie consent banner obligatoire ?~~ **ACTÉ 2026-05-24** : V1 = first-party cookies only (customer_id token + session), pas de banner cookie (CNIL exempte). Consentement = clic « Payer » ([ADR 0007](../adr/0007-consentement-clic-payer-v1.md)), pas de checkbox. V2 si analytics tiers branchés.                                  | —        | —                                       |
| 10-Q2   | ~~Niveau de customisation visuelle V1 ?~~ **ACTÉ 2026-05-24** : Branding asymétrique. PWA + email transactionnel = branded resto 100% (logo + 1 couleur + hero photo + Inter). Carte Wallet = commune sous marque neutre. V2 branding PWA étendu.                                                                                        | —        | —                                       |
| 10-Q3   | ~~Affichage frais livraison transparent ?~~ **ACTÉ 2026-05-24** (via pricing CONTEXT) : transparent + prix barré + mention "Offert par [Resto]" si pricing rule absorbe. Pas de mention KitchenBoost.                                                                                                                                    | —        | —                                       |
| 10-Q4   | ~~Guest checkout vs création de compte ?~~ **ACTÉ 2026-05-24** (via customer-data CONTEXT) : Anonymous account silencieux (pattern Firebase Anonymous Auth). Pas d'écran "créer un compte", `customer_id` créé silencieusement au checkout, reconnaissance silencieuse cross-device.                                                     | —        | —                                       |
| 10-Q5   | Délai max entre paiement et préparation cuisine (sinon cancel auto avec refund) ?                                                                                                                                                                                                                                                        | V1       | Voir [20_kb_orders.md](20_kb_orders.md) |
| 10-Q6   | ~~Allergènes V1 ou V2 ?~~ **ACTÉ 2026-05-24** : V1 = compliance stricte 14 allergènes UE 1169/2011 paramétrables item par item depuis KB Manager. V2 import auto via fiches recettes Gimmy/Taster si format standardisé.                                                                                                                 | —        | —                                       |
| 10-Q7   | ~~Codes promo manuels ad-hoc V1 ?~~ **ACTÉ 2026-05-24** : V2. Complique l'intégration Stripe + sous-système non-trivial + le resto peut jouer directement sur les prix items. Seul code V1 = auto-généré via Incentive Wallet install.                                                                                                   | —        | —                                       |
| 10-Q8a  | ~~Modifier obligatoire UX ?~~ **ACTÉ 2026-05-24** : paramétré min_select/max_select par le resto depuis KB Admin (modèle Uber Manager). Bouton "Ajouter au panier" disabled tant que min non satisfait + badge "À choisir" inline.                                                                                                       | —        | —                                       |
| 10-Q8b  | ~~Search dans menu V1 ?~~ **ACTÉ 2026-05-24** : pas de search V1, navigation par catégories scrollables + ancres latérales. V2 si menu grossit.                                                                                                                                                                                          | —        | —                                       |
| 10-Q8c  | ~~Plusieurs items même type avec modifiers différents : agrégés ou séparés ?~~ **ACTÉ 2026-05-24** : lignes panier séparées par combinaison item × modifiers.                                                                                                                                                                            | —        | —                                       |
| 10-Q9   | ~~Confirmation cmd post-paiement : page séparée ou unifiée avec tracking ?~~ **ACTÉ 2026-05-24** : page unique. La page Tracking commence à l'état T+0 "Cmd reçue" et évolue jusqu'à "Livrée". Récap items collapsible (Lottie + ETA en focus, "Voir le détail" déplie). Email transactionnel envoyé en parallèle.                       | —        | —                                       |
| 10-Q10a | ~~Push enrollment bloquant ou non bloquant V1 ?~~ **ACTÉ 2026-05-24** (révision) : BLOQUANT à la validation paiement. Bouton "Payer" disabled tant qu'au moins UN canal push n'est pas actif. Fallback ultra-frictionnel pour ~5-10% blocages techniques irréductibles. Cf. [ADR 0002](../adr/0002-push-moat-dual-stack-wallet-a2hs.md). | —        | —                                       |
| 10-Q10b | ~~Wallet pass : carte par resto ou carte commune ?~~ **ACTÉ 2026-05-24** : carte COMMUNE sous marque neutre (pas "KitchenBoost" littéral). V2 option premium carte propre par resto. Cf. [ADR 0003](../adr/0003-wallet-pass-commun-marque-neutre.md).                                                                                    | —        | —                                       |
| 10-Q10c | ~~PWA standalone ou widget embed V1 ?~~ **ACTÉ 2026-05-24** : PWA standalone. Widget embed casse le push iOS. V2 envisageable sans push iOS. Cf. [ADR 0004](../adr/0004-pwa-standalone-pas-widget-embed.md).                                                                                                                             | —        | —                                       |
| 10-Q11  | Naming carte Wallet commune Phase 1 (ex: "Resto Paris" / "Pass Resto" / autre) — choix définitif avant V1 launch (updatable plus tard sans coût).                                                                                                                                                                                        | V1 S0    | Alex (brainstorm marketing)             |
| 10-Q12  | Article 2 ter contrat à reformuler pour autoriser carte commune sous marque neutre (avenant ou nouveau contrat pour 3 restos déjà signés).                                                                                                                                                                                               | V1 S0    | Alex + avocat                           |

## Notes / décisions actées

- Architecture multi-tenant : 1 backend, 1 frontend paramétré par `tenant_id` extrait du sous-domaine.
- **PWA standalone V1** (pas widget embed, cf. [ADR 0004](../adr/0004-pwa-standalone-pas-widget-embed.md))
- **Pas d'app native pour le client final en V1** — PWA suffit (l'app native existe pour le resto, cf. [20 KB Orders](20_kb_orders.md)).
- **Captation email + tel + position géo** = chemin obligé V1 (cf. moat clients). Position géo captée à l'arrivée (address-first flow), pas au checkout.
- **Apple Pay / Google Pay activés dès V1** via Stripe Payment Element (cf. [30](30_paiement_stripe_connect.md)).
- **Carte sauvegardée cross-resto KB** activée V1 via Stripe Customer cross-tenant (`clone PaymentMethod` API officielle Stripe Connect, cf. [30](30_paiement_stripe_connect.md)).
- **Click & collect** activé par défaut V1 (choix client final au toggle header, pas de switch resto V1).
- **Push enrollment bloquant** à la validation paiement V1 (Wallet pass commun OU A2HS OU Web Push, cf. [ADR 0002](../adr/0002-push-moat-dual-stack-wallet-a2hs.md) + [ADR 0003](../adr/0003-wallet-pass-commun-marque-neutre.md)).
- **Branding asymétrique V1** : PWA + email transactionnel = branded resto 100%, Wallet pass = commun sous marque neutre.
- **Address-first flow** : adresse Google Places obligatoire à l'arrivée PWA avant accès menu (déclenche quote Uber Direct immédiat).
- **Toggle Livraison/C&C visible permanent header** (pattern Uber Eats).
- **Reviews post-livraison V1 = hors scope** (V2 → Google My Business du resto, JAMAIS Uber Eats).

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création squelette.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-23 | 0.2     | Alex (via Claude) | Extension scope V1 : Apple Pay/Google Pay, carte cross-resto, position géo, click & collect, push marketing, reviews gating.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-24 | 0.3     | Alex (via Claude) | Grilling DDD acté : address-first flow + toggle livraison/C&C header permanent + PWA standalone (ADR 0004) + dual stack Wallet pass commun marque neutre (ADR 0002+0003) + A2HS PWA + push enrollment BLOQUANT à la validation paiement + branding asymétrique + page tracking unifiée récap collapsible + 14 allergènes UE paramétrables + modifiers min/max + lignes panier séparées + pas de search/codes promo/banner cookie/marketplace V1 + reviews V2 → Google jamais Uber Eats. Q10-Q1 à Q10-Q12 actés ou ouverts.                                                                                                                                                                                                                                                                                                                     |
| 2026-06-04 | 0.4     | Alex (via Claude) | Grilling architectural PWA acté (Q1→Q8) : tenant resolution middleware Edge + cookie HttpOnly + route map ISR/RSC + sign-in anonymous timing au submit address (option C) + session 365j sliding + reconnaissance retour bandeau "Bonjour {firstName}" + manifest dynamic per host + SW minimal + 3 paliers Wallet install (soft prompt + bandeau permanent + modal bloquant) + bridge identité serial deep-link + Stripe Elements lazy `/checkout` + Apple Pay domain verification manual V1 + Google Places auto-validate + toggle livraison/C&C sans re-quote + latching `recaptureQuoteAtPayment` + modal push enrollment single-screen non-skippable + fallback 3 niveaux frictionnels + flag `noChannelPossible` + SMS fallback. Sub-PRD versé `docs/prd/sub/10-pwa-client/`. 20 issues GitHub publiées (parent #445 + 3 HITL + 16 AFK). |
