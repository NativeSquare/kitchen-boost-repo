# Client Ordering

Le contexte du client final mangeur : il scanne un QR code, parcourt un menu, ajoute des items au panier, paie, suit sa commande. C'est l'unique surface du produit côté consommateur en V1 (PWA, pas d'app native).

PRD : [10_pwa_client_commande.md](../../prd/10_pwa_client_commande.md)

## Language

**Cart** (Panier) :
Liste ordonnée d'items + modifiers + quantités, attachée à une session client. Le panier est local au browser tant que le paiement n'est pas validé. Au checkout, il devient une [[Order]]. Inclut éventuellement une [[Note resto]] (texte libre global). **V1 : chaque combinaison item × modifiers = 1 ligne distincte** (Q10-Q8c acté 2026-05-24). Exemple : `Smash Double - Ketchup × 1` et `Smash Double - Mayo × 1` = 2 lignes panier (pas agrégées). Permet une lecture cuisine sans ambiguïté + gestion de quantités par config.
_Avoid_: Basket, Bag

**Code promo manuel** (V2) :
Mécanisme de réduction par code à saisir au checkout (ex: `RAMADAN15 = -15%`). **Hors scope V1** (Q10-Q7 acté 2026-05-24). Raisons : (1) sous-système non-trivial (génération, validité, limite usages, anti-fraude code partagé) ; (2) complique l'intégration Stripe ([[application_fee_amount]] calculé sur prix post-promo) ; (3) le resto peut déjà jouer directement sur le prix des items depuis [[KB Admin]] pour faire des promos courtes. Seul mécanisme de réduction V1 = code auto-généré via [[Incentive Wallet]] délivré après install du [[Wallet pass]]. V2 envisagera codes manuels si demande terrain.
_Avoid_: Coupon, Discount code, Promo code

**Note resto** (Instructions client global) :
Champ texte libre **unique au niveau panier** (pas par item) que le client peut renseigner avant checkout. **V1 = max 200 caractères**, optionnel, label "Une note pour le resto ? (allergies, demandes spéciales)". Affiché en évidence sur le ticket cuisine [[KB Orders]]. **Non transmis au manifest Uber Direct** (info cuisine uniquement, le courier n'en a pas besoin). Pas de validation/filtering contenu V1 (pas de blocage si "sans gluten" demandé sur item glutineux — Khan voit la note et décide). Q10-Q acté 2026-05-24. **Risques assumés V1** : tartines clients ("sans sel mais salé"), demandes non honorables. À monitorer V2 (V2 envisagera vocabulaire whitelisted "allergies → arachide/lactose/gluten").
_Avoid_: Special instructions, Commentaire, Notes per item

**Item** :
Un produit du menu vendable (ex: "Smash Burger Double"). Possède un prix de base, des modifiers optionnels ou obligatoires, une disponibilité ([[Item out of stock]]), des allergènes.
_Avoid_: Product, Dish, Plat (interne FR seulement), SKU

**Allergènes** :
Déclaration des allergènes potentiels par item. **V1 = compliance stricte Règlement UE 1169/2011** (Q10-Q6 acté 2026-05-24) : 14 allergènes obligatoires à déclarer pour la vente à distance (livraison) — `gluten, crustacés, œufs, poissons, arachides, soja, lait, fruits à coque, céleri, moutarde, graines de sésame, sulfites, lupin, mollusques`. **Paramétrable item par item depuis [[KB Admin]]** par le resto (matrice items × 14 cases à cocher, saisie en Phase C onboarding). Affichage côté PWA : badges allergènes sur fiche item détail + filtre simple "Sans gluten / Vegan / Végé" sur la home menu. Couvre la responsabilité légale du resto (qui reste responsable de la véracité des déclarations). V2 envisagera import auto via fiches recettes Gimmy/Taster si format standardisé.
_Avoid_: Allergens (acceptable EN), Tags diététiques, Régimes alimentaires (mélange — différent des allergènes au sens strict)

**Item out of stock** (Disponibilité item) :
Mécanisme de désactivation temporaire d'un item du menu côté client PWA. **V1 = toggle 1-tap depuis tablette KDS [[KB Orders]]** (Q10-Q acté 2026-05-24) : Khan tape sur l'item dans son KDS → switch "Indisponible jusqu'à fin de service" → côté client PWA, l'item passe en grisé "Indisponible ce soir" + empêche ajout au panier. **Auto-réactivation automatique au lendemain à l'ouverture** du resto (selon [[Plage horaire de service]]). Backup : si Khan oublie de désactiver et qu'une cmd arrive sur item épuisé, le bouton "refuser cmd → refund" sur [[KB Orders]] reste disponible (cf. [[Payment]]). Pas de sync stock physique V1.
_Avoid_: Out of stock, 86, Sold out

**Modifier** :
Groupe de choix appliqué à un item lors de l'ajout au panier. **Paramétré par le resto depuis [[KB Admin]] sur le modèle Uber Manager** (Q10-Q8a acté 2026-05-24) : chaque modifier group a un `min_select` (0 = optionnel, ≥1 = obligatoire) et un `max_select` (1 = single-choice / ≥1 = multi-choice). Chaque option a un prix delta (positif ou nul). **Réutilisables entre items** (acté 2026-05-25, modèle Uber Eats) : un modifier group est créé une fois puis **attaché à N items** (relation N-N item ↔ group), pas recréé par item. **UI panier client V1** : bouton "Ajouter au panier" disabled tant que tous les modifiers `min_select > 0` ne sont pas satisfaits, badge inline "À choisir" sur le modifier manquant (pattern Uber Eats). Les modifiers ne sont jamais des "parfums" (cf. [feedback_no_modifier_parfum](../../../.claude/memory/feedback_no_modifier_parfum.md) — items distincts par parfum).
_Avoid_: Option, Topping, Extra, Variant

**Category** (Catégorie) :
Regroupement éditorial d'items dans le menu (ex: "Smashs", "Sides", "Boissons"). Ordonnée pour l'affichage. Pas de hiérarchie multi-niveaux en V1. **V1 : navigation par ancres latérales scrollables**, pas de search/filtre (Q10-Q8b acté 2026-05-24, search = V2 si menu grossit ou demande terrain).
_Avoid_: Section, Group

**Checkout** :
Étape entre "panier validé" et "paiement confirmé". Capture obligatoire en V1 : email + tel + prénom + adresse + position géo (lat/lng) + consentement RGPD. Délègue ensuite à Payment via Stripe Elements.
_Avoid_: Cashier, Order page

**Branding tenant V1** (Asymétrique) :
Niveau de personnalisation visuelle par tenant V1, **asymétrique selon la surface** (révision 2026-05-24 suite décision carte Wallet commune) :

- **PWA tenant** (`bunsbao.kitchen-boost.fr`) = **Branded resto à 100%** (Medium acté Q10-Q2) : logo + 1 couleur primaire + hero photo personnalisée + police standard (Inter). UX commande = expérience resto pure.
- **Icône A2HS + manifest + splash screen** = **Branded resto** (cf. [[A2HS]] / [[PWA standalone]])
- **Email transactionnel** (confirmation cmd, suivi) = **Branded resto à 100%** (vient "du resto")
- **Carte [[Wallet pass]]** = **Branded commun "[Nom carte TBD]"** avec logo du dernier resto commandé en header + mention "Membre [Nom carte]" en bas
- **Email marketing cross-tenant V2** = **Co-branded** "[Nom carte] × Buns & Bao : nouvelle offre"

Cette asymétrie laisse l'ordering en white-label pur côté resto, mais ouvre le moat consumer-side via Wallet + marketing cross-tenant. V2 envisagera branding PWA étendu (multi-couleurs, fonts custom upload, hero animé/dégradé) si demande terrain.
_Avoid_: Customisation uniforme, Theming, Branding complet

**Push targeting** (Ciblage notifications) :
Capacité de pousser à un sous-ensemble de clients. **V1 = supporté nativement** (Q10-Q10 acté 2026-05-24) :

- **Khan (resto)** peut pousser à SES clients seulement (`WHERE tenant_id = 'buns-bao'`), filtré éventuellement par [[Segment]] (Actif/Inactif/VIP) — UI campagne dans [[KB Admin]] V1
- **KB root** peut pousser à TOUS les clients KB cross-tenant (ex: "Nouveau resto à 5 min de chez toi", filtré par géo)
- **Deep link par notif** : chaque notif contient son propre `app-launch-url` (Apple) / `actionUri` (Google) — tap notif → redirige vers la PWA du resto qui pousse, indépendamment de la carte Wallet courante. Ex: notif BB → `bunsbao.kitchen-boost.fr/?promo=BAO20`, notif Crêperie → `creperie.kitchen-boost.fr/?promo=CREPE1`.
- **Sender name notif iOS** : affiche le nom de la [[Wallet pass]] commun ("[Nom carte]") — mitigation = préfixer le titre de la notif par le nom du resto + emoji distinct (ex: "🥢 Buns & Bao : -20% bao ce soir").

Limite Google Wallet : 3 push par pass par 24h (anti-spam). Spec détaillée dans le contexte [[Notifications]] et UI dans [[KB Admin]].
_Avoid_: Push segment, Audience push

**Wallet pass** (Apple Wallet / Google Wallet) :
Carte de fidélité numérique stockée dans l'app Wallet préinstallée du device (Apple Wallet iOS / Google Wallet Android). **V1 = canal push PRIMARY**, surtout sur iOS où il bypass complètement la friction A2HS (2 taps install vs 4+ pour A2HS). Push notifications délivrées directement sur le lock screen (taux ouverture 85-99% selon plateforme). **V1 = 1 carte commune sous marque neutre** (pas "KitchenBoost" littéral, naming acceptable-enough pour Phase 1, ex: "Resto Paris" / "Pass Resto Paris") **pour tous les restos KB participants** (révision majeure 2026-05-24). Justification : (a) **asymétrie de migration** — carte commune → carte premium par resto V2 = trivial, inverse = casse-tête ; (b) **vision long terme "Uber Eats à 2€"** exige un consumer brand activable dès V1 ; (c) **cross-tenant push trivialisé** (1 channel pour tous les restos KB) ; (d) **onboarding nouveau resto crée trafic immédiat** (push réseau J+1 = clients qualifiés). Sous chaque pass, le **logo du resto principal commandé est mis en avant visuellement** (header carte = logo BB si dernier resto commandé = BB), mention "Membre [Nom carte]" en bas. Carte premium par resto = **option V2** pour restos sensibles à leur autonomie (paient un supplément X €/mois). Article 2 ter contrat à reformuler pour autoriser la carte commune sous nom neutre. **Naming évolutif** : le nom de la carte (et le branding visuel non-technique) est **updatable à tout moment via push update Wallet** sans action client requise (Apple PassKit Web Service / Google Wallet API). Conséquence : on peut démarrer V1 avec un nom safe-enough ("Resto Paris" Phase 1) puis migrer ("Resto France" Phase scale / "Resto Pass" Phase EU) sans casser les installs existants. Le `passTypeIdentifier` technique reste fixe (invisible client), seul le branding visible évolue. Doc de référence : [docs/research/wallet_pass_vs_pwa_a2hs.md](../../research/wallet_pass_vs_pwa_a2hs.md).
_Avoid_: Loyalty card, Carte fidélité (FR acceptable), Apple Wallet (ambigu — désigne aussi l'app), Carte par resto (= option V2 premium)

**Incentive Wallet** (Récompense d'install paramétrée par resto) :
Texte d'accroche + code promo associé à l'install du [[Wallet pass]], configurés en Phase C onboarding depuis [[KB Admin]] et modifiables à tout moment par le resto. Exemples : "🎁 Reçois -10% sur ta prochaine cmd" / "🥤 1 Cristaline offerte" / "🍰 1 dessert offert". **Code promo généré et appliqué uniquement si pass effectivement installé** (event `pass_installed` via webhook Apple/Google côté backend) — pas de fake reward. **V1 = [[Push enrollment]] BLOQUANT à la validation paiement** (révision Q10-Q acté 2026-05-24) : bouton "Payer" disabled tant que le client n'a pas activé au moins un canal push (Wallet pass OU Web Push OU A2HS). Modal incontournable au moment du clic "Payer" : "Pour finaliser ta cmd, choisis comment recevoir ta confirmation + offres : 🥇 Carte fidélité Wallet (2 taps) / 🥈 Notifs navigateur (1 tap)". Trade-off conversion iOS assumé (~10-15% drop possible) pour préserver le moat 100%. **Fallback "Continuer sans notifs"** : TBD (cf. Q-Order-7bis ouverte).
_Avoid_: Promo install, Reward A2HS, Surprise

**PWA standalone** (Architecture surface client) :
La surface client final V1 est une **PWA hébergée par KB sur un sous-domaine `<slug>.kitchen-boost.fr`** (ou domaine custom resto si configuré). **PAS un module/widget embedded** dans le site existant du resto. Q10-Q acté 2026-05-24. Raisons : (1) le push web V1 nécessite [[A2HS]] qui n'est possible que sur PWA standalone (pas en widget), (2) la majorité des TPE cible KB n'ont pas de site existant — KB devient leur "vitrine commande" en bonus, (3) maintenance/support sur N stacks CMS host (WP, Wix, Shopify, Webflow) irréaliste V1 micro-équipe. **V2 envisagera un mode widget overlay** pour restos avec site fort qui veulent embed le commande sur leur domaine — mais sans push iOS dans ce mode (limite architecturale).
_Avoid_: Widget, Embed, Iframe (acceptable V2 si confirmé)

**A2HS** (Add To Home Screen) :
Installation de la PWA sur l'écran d'accueil du device. **V1 = canal app commande PRIMARY** (UX full-screen, accès direct au menu/panier). Sur iOS 16.4+, A2HS est **prérequis bloquant pour le push web** (Apple). Sur Android, web push fonctionne même sans A2HS (permission grant seule suffit) — A2HS apporte juste l'icône + l'expérience full-screen. Friction install : iOS = 4+ taps manuels via Share menu (Apple refuse l'API prompt programmatique), Android = 1 tap natif via `beforeinstallprompt`. **V1 KB triggers** : Android = bouton "Installer Buns & Bao" persistant header (1 tap natif) ; iOS = bottom sheet instructions + GIF animé après cmd validée (pas avant — friction conversion). Manifest + icône + splash screen brandés par resto (livrable Phase 4 skill `create-virtual-brand`). **Pas bloquant techniquement V1** mais wording incentif fort. Présuppose [[PWA standalone]] (impossible en widget embedded). Cf. doc référence [docs/research/wallet_pass_vs_pwa_a2hs.md](../../research/wallet_pass_vs_pwa_a2hs.md).
_Avoid_: PWA install (acceptable mais moins précis), Add to homescreen

**Reviews gating** (V2) :
Mécanisme post-livraison qui demande au client son ressenti. Si positif → redirige vers Google Reviews du resto (jamais Uber Eats, cf. [[Delivery]] CONTEXT). Si négatif → form privé KB (pas de bad review publique). **Hors scope V1** (Q40-Q11 acté 2026-05-24, on confirme côté client-ordering la cohérence).
_Avoid_: Rating, Feedback gating, Avis Uber

**Mode livraison vs mode pickup** :
Une cmd est en **mode livraison** (par défaut, courier Uber Direct) ou en **mode pickup** (= **click & collect**, retrait sur place). **V1 : les 2 modes sont activés par défaut pour tout tenant** (cf. [[Click & collect]] dans [[Delivery]]) — c'est le client qui tranche au [[Mode toggle]].
_Avoid_: Delivery/Takeaway (terme acceptable mais on dit "click & collect" en interne)

**Mode toggle** :
Toggle UI **visible en permanence dans le header de la PWA** (pattern Uber Eats), affichant les deux modes avec leur prix : `[🛵 Livraison · 2,95 €] [🚶 Retrait · Gratuit]`. Switchable à tout moment **avant validation paiement** — le panier est préservé, seuls les frais livraison + ETA changent. Mode initial : livraison si quote OK, C&C si quote refusé (livraison alors grisée dans le toggle). Le mode finalement sélectionné au clic "Payer" déclenche le latching (cf. [[Pricing]]). Q10-Q acté 2026-05-24.
_Avoid_: Switch mode, Tab livraison

**Reorder** :
Recommander à l'identique une cmd passée. Visible si client revient via URL directe ou push marketing. **V1 = cross-resto** grâce à [[Anonymous account]] silent + [[Stripe Customer (cross-tenant)]] côté [[Payment]] (carte préchargée + adresse préremplie sur 2ᵉ resto KB, cf. [[Effet réseau]] dans [[Customer Data]]).
_Avoid_: Repeat order

## Example dialogue

**Alex (PM)** : Quand un client tape `commander.bunsbao.fr` puis ajoute un Smash Burger au panier, est-ce qu'il est déjà identifié ?

**Dev** : Non. On extrait le tenant_id depuis le hostname mais le client est anonyme tant qu'il n'a pas atteint le checkout. Le panier vit en localStorage.

**Alex** : OK. Et s'il a déjà commandé chez ce resto la semaine dernière ?

**Dev** : On le reconnaît silencieusement via le token persistant device ([[Anonymous account]] = cookie device) — email/tel/prénom/adresse pré-remplis. Sa carte sauvegardée est aussi proposée via [[Stripe Customer (cross-tenant)]] (acté V1). Si même client commande chez un AUTRE resto KB **depuis le même device** → même reconnaissance silencieuse (cookie partagé sur le domaine parent). **Cross-device : reconnaissance uniquement via la carte Wallet installée — PAS de match email/tel** ([ADR 0008](../../adr/0008-identite-customer-cookie-device-only-v1.md)).

**Alex** : Et le modifier "parfum" sur les boissons ?

**Dev** : Pas de modifier "parfum". Chaque parfum est un **item** distinct dans la catégorie Boissons. Règle actée [feedback_no_modifier_parfum](../../../.claude/memory/feedback_no_modifier_parfum.md).
