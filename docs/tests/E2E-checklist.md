# E2E manual checklist — KitchenBoost admin (V1)

Checklist E2E manuelle, nomenclature canonique (A / MC / QR / MO / T / P / AC / M / CMD / PR / SUP / W). Chaque parcours est à exécuter à la main contre `apps/admin` en dev (Convex live + seeds e2e).

- **Date** : 2026-06-01
- **Statut global** : 41 stories mergées (#317→#358), 0 bloquée. Wizard complet à 10/10.
- **Pré-requis transverses** : seeds `e2e` chargées (≥ 2 tenants distincts, un KB Admin root, ≥ 1 KB Manager mono-tenant, ≥ 1 KB Manager multi-tenant, un staff). Stripe en mode test avec un `stripeAccountId` rattaché à au moins un tenant. Resend en mode test pour les magic-links et OTP.
- **Convention** : les parcours référencent ces pré-requis par leur étiquette (« seeds e2e ») sans les reproduire. Format strict : **Acteur / Pré-requis / Étapes / Attendu / Couvre**.

---

## A — Auth & shell

> **Statut** : ✅ **7/7 validés manuellement le 2026-06-01** (dev `impartial-goshawk-798`, seed 4-comptes : `admin@kb.test`, `manager@kb.test` mono-tenant T1, `manager-multi@kb.test` rattaché T1+T2, `manager-orphan@kb.test` sans rattachement). Voir `packages/backend/convex/e2e.ts` (`bootstrapE2EInvites` + `bootstrapE2EA2A3Invites` + `finalizeE2EA2A3Accounts`).

### A1 — Login email + password (+ OTP vérif si email non vérifié)

- **Acteur** : KB Manager
- **Pré-requis** : compte manager (email vérifié) ; boîte mail accessible
- **Étapes** :
  1. `/login`, saisir email + password, cliquer « Login ».
  2. Si email non vérifié → redirection `/verify-email?email=...`, saisir l'OTP 6 chiffres reçu par Resend.
- **Attendu** :
  - Cookie session posé ; redirection vers `/` puis `/t/<firstTenant>/menu`.
  - Email du manager visible dans le header.
  - Si email inconnu : message « No account found with this email ».
- **Couvre** : foundation auth password + verify-email.

### A2 — Multi-tenants : dernière resto ouverte restaurée à l'entrée

- **Acteur** : KB Manager multi-tenants (ex. Walid : `lartisan` + `tablelibanaise`)
- **Pré-requis** : navigateur frais (cookies vidés)
- **Étapes** :
  1. Se connecter → arrive sur `/` → `/t/<tenants[0]>/menu`.
  2. Switcher header vers le 2e tenant → URL `/t/<tenants[1]>/menu` ; cookie `kb_current_tenant=<tenants[1]>` écrit par le layout.
  3. Fermer l'onglet, rouvrir, aller sur la racine.
- **Attendu** :
  - URL finale = `/t/<tenants[1]>/menu` (cookie hint honoré).
  - Item sidebar actif = « Menu » sur le bon resto, pas de flash vide.
- **Couvre** : #223 (cookie hint multi-tenant)

### A3 — KB Manager sans tenant rattaché

- **Acteur** : KB Manager dont toutes les rattaches `userTenants` sont révoquées
- **Étapes** : Login → arrive sur `/`.
- **Attendu** :
  - `UnauthorizedCard` « Accès non autorisé » + « Votre compte est authentifié mais aucun restaurant ne lui est associé… ».
  - CTA primaire « Contacter le support » (mailto), CTA secondaire « Se déconnecter ».
  - Aucun spinner infini, aucun redirect en boucle.
- **Couvre** : #169 (NoTenantEmptyState).

### A4a — KB Manager hors-tenant (UnauthorizedCard, pas raw error)

- **Acteur** : KB Manager rattaché à `T1`
- **Étapes** : copier l'URL `/t/T2/menu` et naviguer manuellement.
- **Attendu** :
  - `UnauthorizedCard` « Ce restaurant ne fait pas partie de votre périmètre… » + CTA « Aller à mon resto ».
  - Pas de fuite des données de T2. Pas de teleport silencieux.
- **Couvre** : #175 (decideTenantGate).

### A4b — KB Manager qui hit /monitoring (UnauthorizedCard, pas FORBIDDEN raw)

- **Acteur** : KB Manager
- **Étapes** : naviguer manuellement vers `/monitoring`.
- **Attendu** :
  - `UnauthorizedCard` « Cette page est réservée à l'équipe KitchenBoost… » + CTA « Retour au dashboard ».
  - La query `previewIncidents` n'est PAS fired (skip côté front avant le guard backend).
- **Couvre** : monitoring admin-only guard + UnauthorizedCard.

### A5 — /accept-invite avec token vide

- **Acteur** : visiteur sans session
- **Étapes** : ouvrir `/accept-invite` sans paramètre `token`.
- **Attendu** :
  - Card « Invalid Invitation » + « This invitation link is invalid, expired, or has already been used. ».
  - Bouton « Go to Login ». La query `getInvite` n'est pas fired (skip-sentinel quand token vide).
- **Couvre** : invite token validation fallback.

### A6 — ImpersonationBanner KB Admin sur /t/[id]

- **Acteur** : KB Admin (+ test croisé avec KB Manager)
- **Pré-requis** : seeds e2e
- **Étapes** :
  1. Login KB Admin, naviguer sur `/t/<id>/menu`.
  2. Observer le bandeau ambré en haut du contenu, cliquer « Quitter ».
  3. Logout, login KB Manager rattaché au même tenant, ouvrir `/t/<id>/menu`.
- **Attendu** :
  - Bandeau : « **Mode admin** — tu consultes **<nom resto>** » + bouton « Quitter ».
  - Clic « Quitter » → navigation vers `/monitoring` et cookie `kb_current_tenant` clearé.
  - Pour le KB Manager : bandeau ABSENT (decideImpersonationBanner → hidden).
- **Couvre** : #214

---

## MC — Mes clients

### MC1 — Open « Mes clients » + audit event `customer.kpi.consult`

- **Acteur** : KB Manager
- **Pré-requis** : tenant T1 avec ≥ 1 client (sinon empty state)
- **Étapes** :
  1. Sidebar → « Mes clients » → `/t/T1/mes-clients`.
  2. Convex dashboard → table `auditLog`, vérifier un event `action: "customer.kpi.consult"` avec `tenantId=T1` + `actorUserId` correct.
- **Attendu** :
  - Page rend (skeleton puis cards) sans error boundary.
  - Une seule row d'audit par visite (StrictMode double-mount supprimé).
- **Couvre** : #181 (audit-on-open) ; #186 (route + query).

### MC2 — Cards segments (Actifs / Inactifs / VIP)

- **Acteur** : KB Manager
- **Pré-requis** : mix de clients (actifs 30j / inactifs 90j / VIP ≥ 5 cmd ou LTV ≥ 150€)
- **Étapes** : `/t/<tenantId>/mes-clients`, observer le 1er bloc 3 cards.
- **Attendu** :
  - Card « Actifs » (« ≥ 1 commande sur 30 jours »).
  - Card « Inactifs » (« 0 commande sur 90 jours »).
  - Card « VIP » (« ≥ 5 commandes ou LTV ≥ 150€ »). Chaque card affiche un compteur entier.
- **Couvre** : #186 (segments).

### MC3 — Cards reachability + macro

- **Acteur** : KB Manager
- **Pré-requis** : tenant avec ≥ 1 client joignable par chaque canal
- **Étapes** : `/t/<tenantId>/mes-clients`, observer les 2 blocs suivants.
- **Attendu** :
  - Reachability : 3 cards Push / E-mail / SMS (compteurs entiers de clients atteignables).
  - Macro : 3 cards Total clients / Nouveaux ce mois / Taux de retour (formaté `X %` avec espace insécable).
- **Couvre** : #190.

### MC4 — Anti-PII guard

- **Acteur** : KB Manager
- **Pré-requis** : tenant avec ≥ 10 clients identifiés (email + tel renseignés)
- **Étapes** :
  1. `/t/<tenantId>/mes-clients`, parcourir toutes les sections.
  2. DevTools, chercher (Ctrl+F) un email + un numéro de tel connus de la seed.
- **Attendu** :
  - Aucun email, aucun numéro de tel, aucun nom client visible.
  - Uniquement agrégats / compteurs / pourcentages. Label « E-mail » (hyphené) = canal, jamais une adresse.
- **Couvre** : #190 (anti-PII MOAT).

### MC5 — Liste campagnes : tracer-bullet vide → peuplé

- **Acteur** : KB Manager
- **Pré-requis** : seeds e2e ; tenant `T1` rattaché au manager, aucun `notificationTemplate` actif scope=`tenant` lié à `T1` initialement.
- **Étapes** :
  1. Depuis `/t/T1` (dashboard), cliquer dans la sidebar sur « Campagnes » → URL `/t/T1/campagnes`.
  2. Observer : titre « Campagnes » + message « Aucun template disponible ».
  3. Dans un second onglet KB Admin, insérer 2 templates scope=`tenant` actifs rattachés à `T1` (1 KB-central, 1 spécifique). Laisser Convex réagir.
  4. Vérifier que la liste affiche désormais 2 items, chacun avec son `label` et un dump JSON lisible (variables, body, `deepLinkTarget`…).
- **Attendu** :
  - UI : titre « Campagnes » présent sur les 3 états (loading transitoire, vide, peuplé). État vide en FR (« Aucun template disponible »).
  - DB : aucune écriture côté tenant (slice read-only). Pas de log d'audit créé par cette page.
  - Isolation : un autre KB Manager (autre tenant) qui ouvre `/t/<sonTenant>/campagnes` ne voit QUE ses templates.
- **Couvre** : #179 (slice 1 F-CAMPAGNES) ; sanity check #183 (`useTenantQuery`) + #157 (`listTenantTemplates`).

### MC6 — Garde de route campagnes cross-tenant

- **Acteur** : KB Manager rattaché à `T1` uniquement
- **Pré-requis** : seeds e2e ; templates actifs sur `T1` ET sur `T2` ; manager NON rattaché à `T2`.
- **Étapes** :
  1. Depuis `/t/T1/campagnes` (liste `T1` visible), modifier l'URL à la main vers `/t/T2/campagnes`.
  2. Observer l'écran.
- **Attendu** :
  - UI : `UnauthorizedCard` « Ce restaurant ne fait pas partie de votre périmètre… » rendu par le layout `(app)/t/[tenantId]/layout.tsx` — la page Campagnes ne se monte pas, AUCUN template de `T2` n'est rendu.
  - DB : aucune query `listTenantTemplates` exécutée pour `T2` (la garde court-circuite avant le mount).
  - Bouton « Aller à mon resto » renvoie vers `/t/T1`.
- **Couvre** : #179 (propagation A4 via `useTenantQuery`) + #175 (UnauthorizedCard layout tenant).

### MC7 — Picker campagnes : grid responsive + navigation vers template

- **Acteur** : KB Manager
- **Pré-requis** : seeds e2e (tenant `lartisan` avec ≥ 2 templates `scope:"tenant"` `active:true`) ; session manager loggée ; sur `/t/lartisan/menu`.
- **Étapes** :
  1. Cliquer « Campagnes » dans la sidebar → URL = `/t/lartisan/campagnes`.
  2. Observer la grille : une `TemplateCard` shadcn par template, label visible, badges « Push » (vert KB `#1B7A3D`) et « E-mail » (jaune/or KB `#E5A100`), aperçu body tronqué (80 chars + ellipsis).
  3. Redimensionner la fenêtre (mobile → tablet → desktop) et vérifier la responsivité `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
  4. Cliquer sur une carte → navigation vers `/t/lartisan/campagnes/<templateId>`.
  5. Revenir en arrière.
- **Attendu** :
  - Grille responsive avec cartes shadcn correctement palettées KB.
  - Tri alphabétique stable des labels (déterministe).
  - URL post-clic exactement `/t/lartisan/campagnes/<id>` (id = celui de la carte cliquée).
  - DB inchangée (présentation pure, aucune mutation).
- **Couvre** : #188 (F-CAMPAGNES slice 2/7).

### MC8 — Picker campagnes : empty state CSM

- **Acteur** : KB Manager
- **Pré-requis** : seeds e2e ; un tenant secondaire `nouveau-resto` sans aucun `notificationTemplate` actif scope tenant.
- **Étapes** :
  1. Switcher sur `nouveau-resto` via le header switcher.
  2. Aller sur `/t/nouveau-resto/campagnes`.
- **Attendu** :
  - Card empty-state bordée pointillée centrée avec exactement le texte « Aucun template disponible — contacte ton CSM pour en demander un. ».
  - Aucune skeleton card, aucune grid card.
  - Aucune fuite (pas de templates d'un autre tenant — isolation via `listTenantTemplates`).
- **Couvre** : #188 (empty state) + #170 (cross-tenant fuzz `listTenantTemplates`).

### MC9 — Picker campagnes : loading skeletons sans flash empty

- **Acteur** : KB Manager
- **Pré-requis** : seeds e2e + DevTools Network throttling « Slow 3G » activé.
- **Étapes** :
  1. Hard-reload de `/t/lartisan/campagnes` (Ctrl+Shift+R).
  2. Observer les 100-300 premières ms.
- **Attendu** :
  - 3 skeleton cards shadcn (`animate-pulse`) visibles immédiatement, alignés sur le même grid que les cartes finales (pas de layout shift quand la data arrive).
  - Le titre « Campagnes » est rendu sur la branche loading (pas de blank flash).
  - L'empty-state « Aucun template disponible — … CSM … » ne flash JAMAIS avant la grille (loading ≠ empty).
- **Couvre** : #188 (AC distinction loading/empty).

### MC10 — Template campagne : formulaire dynamique (texte + slider + time)

- **Acteur** : KB Manager
- **Pré-requis** : seeds e2e (tenant `lartisan` avec ≥ 2 templates : un « welcome_back » texte-only, un « weekend_promo » slider+time+texte). Session manager loggée.
- **Étapes** :
  1. Naviguer `/t/lartisan/campagnes` → grid des cartes (slice 2/7).
  2. Cliquer la carte « Promo weekend » (template mixte).
  3. Sur `/t/lartisan/campagnes/<templateId>` : observer le label + le body brut du template en haut, puis le formulaire.
  4. Le formulaire affiche EXACTEMENT 5 champs : Jour (texte), Pourcentage de réduction (slider 0-50), Plat phare (texte), Heure de début (time), Heure de fin (time). Aucun champ « Prénom du client » ou « Nom du restaurant » (non déclarés par ce template).
  5. Glisser le slider → label « -X % de réduction » se met à jour en live ; impossible de dépasser 50.
  6. Saisir « 09:00 » dans Heure de début, « 21:00 » dans Heure de fin → pas d'erreur inline.
  7. Saisir « Vin rouge » dans Plat phare → erreur inline rouge « Mention d'alcool interdite » apparaît sous le champ.
  8. Saisir « vinaigrette » dans Plat phare → aucune erreur (word-boundary OK).
  9. Saisir 200 caractères dans Plat phare → erreur inline « Texte trop long (max 80 caractères) ».
  10. Cliquer « Envoyer maintenant » → button reste désactivé (slice 4/7 l'activera). Cliquer « ← Campagnes » → retour au picker.
- **Attendu** :
  - Slider DOM : `<input type="range" max="50" min="0" step="1">`. Time inputs DOM : `<input type="time">`.
  - Erreur « alcool » s'affiche dès la frappe ; disparaît au remplacement par un mot OK.
  - Bouton « Envoyer maintenant » DOM : `<button disabled data-slot="button">` pendant toute la session.
  - Aucune coordonnée destinataire, aucune liste client affichée (MOAT).
  - Pas de fuite cross-tenant : copier l'URL `/t/<autre_tenant>/campagnes/<templateId>` (template appartient à `lartisan`) → la query refuse `Forbidden` côté backend, le shell `UnauthorizedCard` (A4) prend le relais.
- **Couvre** : #205 (F-CAMPAGNES 3/7) + #188 (carte → navigation, recoupé) + #175 (UnauthorizedCard cross-tenant) + #170 (tenant fuzz).

### MC11 — Template campagne introuvable (URL stale / désactivé)

- **Acteur** : KB Manager
- **Pré-requis** : un `templateId` qui n'existe pas ou plus dans l'`active` set du tenant (template désactivé côté backend OU URL bookmarkée d'un ancien template).
- **Étapes** :
  1. Naviguer manuellement vers `/t/lartisan/campagnes/tpl_doesnotexist`.
  2. Observer la page « Template introuvable ».
  3. Cliquer « Retour aux campagnes ».
- **Attendu** :
  - Page affiche titre « Template introuvable » + paragraphe FR mentionnant le `templateId`.
  - Lien « Retour aux campagnes » navigue vers `/t/lartisan/campagnes` (le picker).
  - Aucun crash, aucun spinner infini.
- **Couvre** : #205 (F-CAMPAGNES 3/7, branche not-found).

### MC12 — Preview live campagne + activation Envoyer (parcours bout-à-bout slice 1→4)

- **Acteur** : KB Manager (kb_manager du tenant cible)
- **Pré-requis** : seeds e2e ; tenant seedé avec au moins 1 template `notificationTemplates` actif scope `tenant` contenant `{prenom_client}`, `{discount}`, `{nom_resto}` (ex. `weekend_promo`, `maxDiscountPercent: 50`, `language: "fr"`, `containsAlcohol: false`) ; manager loggé, rattaché au tenant, à `/t/[tenantId]/campagnes`.
- **Étapes** :
  1. Cliquer sur la `TemplateCard` du template seedé → navigue vers `/t/[tenantId]/campagnes/[templateId]`.
  2. Vérifier que la page affiche `VariablesForm` (champs `prenom_client`, slider `discount`, input `nom_resto`) ET `CampaignPreview` (mocks Push + E-mail, compteur `X / 200`, bouton « Envoyer maintenant »).
  3. Au chargement initial (values vides), constater que le bouton « Envoyer maintenant » est désactivé pour les valeurs creuses (placeholder rendu = `Bonjour , -% chez  !`, compteur ~10/200, vert — pin le comportement vide).
  4. Remplir `prenom_client = "Sophie"`, déplacer le slider `discount` à `20`, remplir `nom_resto = "Buns & Bao"` → observer en temps réel le mock Push qui affiche `Bonjour Sophie, -20% chez Buns & Bao !` et le compteur qui s'incrémente.
  5. Déplacer manuellement le slider à `50` (la borne max) → compteur reste vert, bouton enabled.
  6. Saisir dans `nom_resto` une chaîne de 200 caractères → compteur devient rouge (`destructive`), bannière FR « Message trop long » apparaît, bouton désactivé avec tooltip.
- **Attendu** :
  - UI : preview update instantané sans roundtrip réseau (le helper est pur côté client).
  - UI : compteur vert (`text-[#1B7A3D]`) sous 200, rouge (`text-destructive`) à >= 200.
  - UI : bouton « Envoyer maintenant » disabled = visuel grisé + `title` au survol.
  - DB : aucune mutation déclenchée à ce stade (slice [5/7] plug `sendTenantCampaign`).
- **Couvre** : #215 (F-CAMPAGNES 4/7) + #205 (rendu form) + #188 (picker → navigation) + #145 (EPIC).

### MC13 — Garde-fous violation surfacée (alcool flag défensif)

- **Acteur** : KB Admin (impersonating un tenant ou en provisionnement)
- **Pré-requis** : seeds e2e ; forcer (via seed dev ou script) un template avec `containsAlcohol: true` ou `language: "en"` malgré la validation schema (simule régression défense en profondeur). Alternativement : seed un template dont le body rend > 200 caractères même avec discount=10.
- **Étapes** :
  1. Naviguer vers `/t/[tenantId]/campagnes/[templateId]` du template corrompu.
  2. Remplir les variables avec des valeurs normales (`prenom_client = "Alice"`, etc.).
  3. Observer `CampaignPreview`.
- **Attendu** :
  - UI : bannière `data-slot="campaign-preview-violation"` affichée en FR (« Mention d'alcool interdite » / « Template non français » / « Message trop long »).
  - UI : bouton « Envoyer maintenant » désactivé, `title` = message FR.
  - UI : le mock Push affiche quand même le rendu (pour debug) mais le bouton bloque toute action.
- **Couvre** : #215 (défense en profondeur des bounds backend miroir de `templateBounds.ts`).

### MC14 — Lancer une campagne pendant horaires (envoi immédiat)

- **Acteur** : restaurateur (rôle `kb_manager`)
- **Pré-requis** : tenant seed avec ≥10 clients linkés actifs (au moins 5 joignables push + 3 joignables email), template « Promo weekend » actif, heure courante hors créneau DNT (entre 8h et 22h Europe/Paris). Route de départ : `/t/<tenantId>/campagnes`.
- **Étapes** :
  1. Cliquer sur la card du template « Promo weekend » dans le picker.
  2. Sur `/t/<tenantId>/campagnes/<templateId>`, remplir les variables : `jour` = « samedi », `discount` slider à 20, `nom_resto` = « Buns & Bao ».
  3. Vérifier que la preview live se met à jour à chaque champ + counter sous 200 chars en vert.
  4. Cliquer « Envoyer maintenant ».
  5. Observer le bouton qui passe en « Envoi en cours… » disabled le temps de la mutation.
  6. À résolution, l'écran bascule sur `CampaignResultStats` (6 cards avec les compteurs).
- **Attendu** :
  - UI : titre « Résultats » + 6 cards avec les labels FR exacts, valeurs numériques cohérentes (`targeted` = somme `sent`+`queued`, `queued` = 0 hors DNT).
  - DB : 1 row `notificationCampaignLaunches` pour ce tenant, N rows `notificationCampaignEvents` avec `status="sent"` et `scope="tenant"`. 1 row `auditLog` action=`notifications.campaign.send`.
  - **MOAT** : AUCUN nom/email/téléphone client ne doit apparaître nulle part dans l'UI.
- **Couvre** : #228 (F-CAMPAGNES 5/7 — câblage `sendTenantCampaign` + `CampaignResultStats`) ; valide aussi #145 (EPIC F-CAMPAGNES) et #215 (preview live).

### MC15 — Anti-anomaly bloque deuxième envoi en 48h

- **Acteur** : restaurateur (`kb_manager`)
- **Pré-requis** : tenant seed avec 1 campagne déjà lancée < 48h, ≥5 clients linkés. Route de départ : `/t/<tenantId>/campagnes/<templateId>`.
- **Étapes** :
  1. Remplir les variables d'un template valide.
  2. Cliquer « Envoyer maintenant ».
  3. Observer la dialog qui s'ouvre.
  4. Lire le message « Trop tôt pour relancer » / « Tu as déjà lancé une campagne récemment ».
  5. Cliquer « Compris » pour fermer la dialog.
- **Attendu** :
  - UI : `CampaignAnomalyDialog` ouverte avec titre « Trop tôt pour relancer » et message FR.
  - DB : AUCUN nouveau row `notificationCampaignLaunches` (le throw backend précède l'insert). 1 row `auditLog` action=`notifications.campaign.anomaly` avec `metadata.anomaly = "TOO_FREQUENT_48H"`.
  - Après fermeture dialog : le formulaire reste rempli, bouton « Envoyer maintenant » de nouveau enabled, gérant peut modifier les variables sans perdre son état.
- **Couvre** : #228 (anomaly path) ; valide PRD 80 §7 anti-anomaly.

### MC16 — Isolation cross-tenant via URL forgée sur la mutation send (Forbidden)

- **Acteur** : restaurateur du tenant A (`kb_manager`)
- **Pré-requis** : 2 tenants A et B avec chacun ≥1 template. Le gérant de A est authentifié.
- **Étapes** :
  1. Manuellement naviguer vers `/t/<tenantId_B>/campagnes/<templateId_B>` (forge l'URL).
  2. Observer le rendu.
  3. Tenter de cliquer « Envoyer maintenant » si le formulaire s'affiche.
- **Attendu** :
  - UI : la branche « Template introuvable » ou un état d'erreur (le wrapper `tenantQuery({allow:["kb_manager"]})` rejette avec Forbidden ; le shell tenant B redirige).
  - Si malgré tout le clic passe : la mutation `sendTenantCampaign` rejette server-side (cross-tenant fuzz du wrapper, ADR 0010) → toast erreur générique côté front.
  - DB : aucun row de campaign créé pour le tenant B initié par le gérant de A.
- **Couvre** : #228 ; valide ADR 0010 + cross-tenant fuzz suite du wrapper. Voir aussi T (Tenant isolation).

### MC17 — Historique d'une campagne envoyée (round-trip envoi → historique → détail)

- **Acteur** : KB Manager (`lartisan` ou tenant seed e2e)
- **Pré-requis** : seeds e2e chargées ; au moins 2 clients liés au tenant, marketing-éligibles, l'un avec push enrolled, l'autre email-only ; au moins 1 template campagne actif `scope=tenant` côté `notificationTemplates`.
- **Étapes** :
  1. Login KB Manager, naviguer sur `/t/<tenant>/campagnes`.
  2. Cliquer une template → page détail, remplir variables, cliquer « Envoyer ».
  3. Attendre le résultat (`CampaignResultStats` s'affiche avec les 6 compteurs).
  4. Cliquer le lien « Historique » en haut à droite de `/campagnes`.
  5. Sur la liste, repérer la ligne fraîchement créée (label template + date FR + `Clients ciblés` + `Envoyés maintenant`). Cliquer la ligne.
  6. Sur le détail, vérifier que les 6 cartes `CampaignResultStats` rendent EXACTEMENT les mêmes nombres qu'à l'étape 3.
- **Attendu** :
  - Liste triée date desc, la nouvelle ligne en tête.
  - Date affichée au format `fr-FR` (ex. « 1 juin 2026 à 14:32 »).
  - Détail : titre = label du template, sous-titre = « Lancée le … ».
  - DB : `campaignLaunches` row du tenant carries `templateId` + les 6 compteurs persistés (`recipients`, `sent`, `queued`, `skippedIneligible`, `skippedRateLimited`, `skippedUnreachable`).
  - **MOAT** : aucune adresse e-mail, aucun nom client, aucun téléphone visible sur AUCUN écran.
- **Couvre** : #240 (F-CAMPAGNES 6/7) ; smoke #228 (CampaignResultStats reuse).

### MC18 — Historique : isolation cross-tenant + URL stale launchId

- **Acteur** : KB Manager mono-tenant T1 (ex. seed e2e)
- **Pré-requis** : un launch existant dans T1 dont on connaît le `launchId` ; un second tenant T2 dont T1 n'est pas membre ; un seed launch dans T2.
- **Étapes** :
  1. Login KB Manager T1, ouvrir `/t/T1/campagnes/historique` → la liste contient le launch T1.
  2. Forger l'URL `/t/T1/campagnes/historique/<launchId_T2>` (launch de l'AUTRE tenant) et naviguer.
  3. Forger ensuite `/t/T1/campagnes/historique/<id_inexistant>` et naviguer.
  4. Copier l'URL `/t/T2/campagnes/historique` et naviguer.
- **Attendu** :
  - Étape 2 et 3 : branche « Lancement introuvable » + bouton « Retour à l'historique » (pas de crash, pas de leak du launch T2 — la query retourne `null` côté serveur).
  - Étape 4 : `UnauthorizedCard` (decideTenantGate F-SHELL-04), aucune query T2 firée.
  - Aucun compteur de T2 visible nulle part.
- **Couvre** : #240 (cross-tenant fuzz + not-found branch) ; ADR 0010 isolation.

### MC19 — Historique : état vide (resto neuf, aucune campagne lancée)

- **Acteur** : KB Manager d'un tenant n'ayant jamais envoyé de campagne
- **Pré-requis** : tenant T fraîchement créé / aucun row dans `campaignLaunches` pour T.
- **Étapes** :
  1. Login, naviguer sur `/t/T/campagnes` → cliquer « Historique ».
- **Attendu** :
  - Titre « Historique des campagnes » + sous-titre MOAT.
  - Bloc empty state encadré : « Aucune campagne lancée pour l'instant. ».
  - Pas de skeleton, pas de crash, lien « Historique » toujours visible depuis `/campagnes`.
- **Couvre** : #240 (empty branch).

### MC20 — Dashboard /t/[tenantId] affiche les 4 KPI cards du jour (CA, commandes, panier, en cours)

- **Acteur** : KB Manager
- **Pré-requis** : tenant actif avec au moins 1 commande payée et 1 commande en cours du jour ; session ouverte ; route de départ `/t/[tenantId]` (= `/t/[tenantId]/dashboard`, root override).
- **Étapes** :
  1. Se connecter en tant que manager du tenant.
  2. Naviguer vers `/t/[tenantId]` (ou cliquer « Tableau de bord » depuis la sidebar).
  3. Attendre que les 4 KPI cards s'affichent (skeleton → données).
  4. Vérifier les 4 valeurs : CA jour (€), Commandes du jour (entier), Panier moyen (€), Commandes en cours (entier).
  5. Passer une nouvelle commande payée depuis le PWA client, revenir sur le dashboard.
- **Attendu** :
  - 4 KPI cards rendues, valeurs formatées français (`1 234,56 €` / `12`).
  - Aucun retour à `/menu` (la story remplace l'ancien redirect).
  - Live update post-commande sans refresh manuel (Convex live-query).
  - Les KPIs reflètent uniquement le tenant courant.
- **Couvre** : #252 (F-STATS 2/8 — Dashboard 4 KPI cards + backend `dailyKpis`).

### MC21 — Dashboard isolation cross-tenant via switcher (KB Admin supervision)

- **Acteur** : KB Admin (supervision)
- **Pré-requis** : 2 tenants actifs A et B avec CA distincts aujourd'hui (ex : A = 50€, B = 200€) ; connexion KB Admin avec tenant switcher monté.
- **Étapes** :
  1. Se connecter en KB Admin.
  2. Sélectionner tenant A dans le switcher → atterrir sur `/t/[A]`.
  3. Lire les 4 KPI de A (CA = 50€).
  4. Switcher vers tenant B → atterrir sur `/t/[B]`.
  5. Lire les 4 KPI de B (CA = 200€).
  6. Revenir sur A et vérifier le rollback.
- **Attendu** :
  - Chaque tenant affiche uniquement ses propres chiffres (zéro leak).
  - Le switch déclenche un re-fetch de la query avec le bon `tenantId`.
  - KB Admin a le même rendu visuel que le KB Manager (root override transparent).
- **Couvre** : #252 + ADR 0010 (isolation cross-tenant).

### MC22 — Page Stats `/t/[tenantId]/stats` : RangePicker recalcule les chiffres bruts (7 / 30 / 90)

- **Acteur** : KB Manager
- **Pré-requis** : tenant T rattaché au manager, au moins 1 commande payée < 7j et 1 commande payée entre 30 et 90j ; route de départ `/t/T/stats`.
- **Étapes** :
  1. Observer le RangePicker : « 30 jours » sélectionné par défaut.
  2. Lire « Panier moyen » et « Total commandes » du bloc « chiffres bruts ».
  3. Cliquer « 7 jours » dans le RangePicker.
  4. Attendre la requête Convex (skeleton bref sur les cards « chiffres bruts »).
  5. Re-lire « Panier moyen » et « Total commandes ».
  6. Cliquer « 90 jours », re-lire les deux KPI.
- **Attendu** :
  - Étape 5 : `Total commandes` ≤ valeur étape 2 (7j ⊂ 30j).
  - Étape 6 : `Total commandes` ≥ valeur étape 2 (30j ⊂ 90j).
  - Aucune valeur `NaN`, `undefined`, ni « 0,00 € » alors que `Total commandes > 0`.
  - Le titre « Statistiques » reste affiché en permanence (pas de blank flash).
- **Couvre** : #253 (F-STATS 3/8 — Stats shell + RangePicker + backend `rangeAggregates`).

### MC23 — Stats cross-tenant : KB Manager refusé sur URL forgée d'un autre resto

- **Acteur** : KB Manager du tenant A (sans accès B)
- **Pré-requis** : 2 tenants A (rattaché) et B (non rattaché), tous deux avec commandes payées récentes ; démarrer sur `/t/A/stats` puis taper manuellement `/t/B/stats`.
- **Étapes** :
  1. Naviguer vers `/t/A/stats` — chiffres bruts s'affichent.
  2. Modifier l'URL en `/t/B/stats` et valider.
  3. Observer le rendu : UnauthorizedCard ou redirect explicite, sans afficher les chiffres de B.
  4. Vérifier via DevTools réseau que la query `rangeAggregates` retourne Forbidden pour B.
- **Attendu** :
  - Aucun chiffre de B n'est jamais affiché.
  - `rangeAggregates({ tenantId: B, rangeDays: 30 })` rejette côté `tenantQuery`.
  - Page d'erreur / refus explicite (pas un dashboard vide silencieux).
- **Couvre** : #253 + ADR 0010 (MOAT applicatif Convex).

### MC24 — Stats accessibles par Staff opérationnel (même vue que le manager)

- **Acteur** : Staff du tenant T
- **Pré-requis** : tenant T avec un user `staff` rattaché et au moins 3 commandes payées dans les 30 derniers jours ; route `/t/T/stats`.
- **Étapes** :
  1. Se connecter en tant que staff de T.
  2. Naviguer vers `/t/T/stats`.
  3. Observer le bloc « chiffres bruts » et le RangePicker.
  4. Cliquer « 7 jours » puis « 90 jours ».
- **Attendu** :
  - Les chiffres bruts s'affichent sans erreur de permission.
  - Le RangePicker fonctionne (les chiffres se recalculent).
  - Les 5 cards placeholders sont visibles (skeleton + hint « graph stories 4-8 »).
- **Couvre** : #253 (allow-list `["kb_manager", "staff"]`).

### MC25 — LineChart Revenus par jour : changement de fenêtre temporelle (7 / 30 / 90) + tooltip

- **Acteur** : KB Manager
- **Pré-requis** : tenant `t` actif avec ≥5 commandes payées (`paidAt` set, `pricingSnapshot.total` renseigné) réparties sur les 30 derniers jours ; user `kb_manager` connecté ; route `/tenants/<tenantId>/stats`.
- **Étapes** :
  1. Naviguer vers `/tenants/<tenantId>/stats` — page Stats visible, bloc « Revenus par jour » visible.
  2. Observer le LineChart : axe X = dates (DD/MM), axe Y = montants en €, courbe verte (#1B7A3D).
  3. Cliquer « 7 jours » dans le RangePicker.
  4. Cliquer « 30 jours » puis « 90 jours ».
  5. Survoler un point de la courbe.
- **Attendu** :
  - Étape 2 : 30 points (un par jour, jours sans commande à 0 — continuité visuelle).
  - Étape 3 : 7 points.
  - Étape 4 : 30 puis 90 points, redraw sans skeleton intermédiaire (cache Convex).
  - Étape 5 : tooltip avec date complète + revenu formaté EUR fr-FR (ex. « 23,45 € »).
- **Couvre** : #257 + #253 (RangePicker propagé à plusieurs blocs).

### MC26 — LineChart Revenus : isolation cross-tenant (MOAT)

- **Acteur** : KB Manager du tenant A
- **Pré-requis** : tenants A et B, chacun avec ≥3 commandes payées dans les 30 derniers jours ; user `mgrA` est `kb_manager` sur A uniquement ; route `/tenants/<tenantA-id>/stats`.
- **Étapes** :
  1. Se connecter en tant que `mgrA` et naviguer vers la page Stats de A.
  2. Noter le total visuel approximatif de la courbe.
  3. Manipuler l'URL pour pointer vers `/tenants/<tenantB-id>/stats`.
- **Attendu** :
  - Étape 2 : seul le revenu des commandes du tenant A apparaît.
  - Étape 3 : la page n'affiche PAS les chiffres de B — redirect/forbidden ou erreur surfaceée ; en aucun cas la courbe n'expose le revenu de B (`tenantQuery` refuse Forbidden côté backend).
- **Couvre** : #257 + ADR 0010 (MOAT applicatif).

### MC27 — LineChart Revenus : état empty (aucune commande payée sur 90j)

- **Acteur** : KB Manager
- **Pré-requis** : tenant `t` actif AUCUNE commande payée sur les 90 derniers jours ; user `mgr` connecté ; route `/tenants/<tenantId>/stats`.
- **Étapes** :
  1. Naviguer vers la page Stats.
  2. Vérifier le bloc « Revenus par jour ».
  3. Basculer entre 7 / 30 / 90 jours.
- **Attendu** :
  - Bloc affiche le titre « Revenus par jour » + sous-titre « Sur les N derniers jours ».
  - En lieu et place du LineChart : zone centrée verticalement contenant exactement « Pas encore de données sur cette période ».
  - Le message reste affiché sur les 3 valeurs de range (rien à dessiner sur 7/30/90 jours).
- **Couvre** : #257, US9 (empty state défensif).

---

## QR — Export SVG

> **Statut** : ✅ **2/2 validés manuellement le 2026-06-01** (manager `manager@kb.test`, tenant `test-t1` avec et sans `customDomain`). 4 commits pendant le run :
>
> - **QR2 customDomain ignoré** (`0c428ec`) — la page lisait `loadTenantForStripe` (admin-only) sur le chemin manager, donc fallback systématique sur `<slug>.kitchen-boost.fr`. Fixé en branchant sur `api.lib.admin.tenantSettings.getSettings` (manager-accessible).
> - **QR1 A4/A6 cropped text** (`36f441c`) — accroche centrée sans `maxWidth`, débordait sur les noms de resto longs. Wrap auto désormais.
> - **Simplification produit SVG-only** (`000c6ee` + `972c5d2`) — voir bloc ci-dessous.

> Simplification 2026-06-01 : la page `/t/[tenantId]/qr` ne produit plus
> qu'un seul export — un SVG noir-sur-blanc, sans branding ni accroche, sans
> variantes de format. La direction artistique appartient au restaurateur,
> qui intègre le QR dans son visuel (Canva / Figma / Illustrator). KB ne
> ship que le QR lui-même. Le pipeline PDF historique (3 formats, branding,
> logo) reste vivant uniquement dans l'étape 6 du wizard d'onboarding.

### QR1 — Download SVG nominal

- **Acteur** : KB Manager
- **Pré-requis** : tenant actif avec slug (`test-t1` sans customDomain)
- **Étapes** :
  1. `/t/test-t1/qr`, vérifier l'aperçu inline du QR (carré ~340 px centré, noir sur blanc).
  2. Vérifier l'URL affichée sous le QR (texte brut copiable) : `https://test-t1.kitchen-boost.fr`.
  3. Cliquer « Télécharger SVG ».
- **Attendu** :
  - Fichier téléchargé `qr-test-t1.svg`.
  - Ouverture du SVG dans un viewer ou un scanner QR → décode vers `https://test-t1.kitchen-boost.fr`.
  - Aucun titre / accroche / logo dans le SVG (uniquement le QR vectoriel).
- **Couvre** : #198 (forme simplifiée 2026-06-01).

### QR2 — Download SVG avec customDomain

- **Acteur** : KB Manager
- **Pré-requis** : tenant `test-t1` avec `customDomain = commander.test-t1.kb-e2e.local` (seedé dans cette session pour le spot-check QR2)
- **Étapes** :
  1. `/t/test-t1/qr`, vérifier que l'URL affichée sous le QR est `https://commander.test-t1.kb-e2e.local` (et non `https://test-t1.kitchen-boost.fr`).
  2. Cliquer « Télécharger SVG ».
- **Attendu** :
  - Aperçu et SVG téléchargé encodent l'URL `https://commander.test-t1.kb-e2e.local`.
  - Filename `qr-test-t1.svg` (le slug, pas le customDomain).
- **Couvre** : #358 ; lecture customDomain via `api.lib.admin.tenantSettings.getSettings`.

---

## MO — Monitoring

> **Statut** : ✅ **3/3 validés manuellement le 2026-06-01** (admin `admin@kb.test`, 2 incidents `kyc_pending` seedés via `e2e:seedE2EMonitoringIncidents`). MO4 couvert par A4b (identique). **Caveat V1** : seul le kind `kyc_pending` est visible en runtime — les 2 autres kinds (`webhook_latency`, `paid_no_course`) sont feature-flagged off et ne pourront être testés qu'à l'arrivée des chantiers 2.5 (webhook telemetry) et 2.6 (commandes payées / unfulfilled). MO2 testé sur 2 incidents (la grille demande « ≥ 10 mixtes » pour stresser les filtres AND ; revérifier à l'arrivée des 2 autres kinds).

### MO1 — KB Admin voit les 3 kinds

- **Acteur** : KB Admin
- **Pré-requis** : seeds avec ≥ 1 incident actif de chaque kind
- **Étapes** : login KB Admin, sidebar → `/monitoring`.
- **Attendu** :
  - Titre « Monitoring » + sous-titre « Incidents ops actifs détectés… ».
  - Table 6 colonnes : Type, Cible, Sévérité, Détails, Depuis, Lien.
  - ≥ 3 lignes avec kind `webhook_latency`, `kyc_pending`, `paid_no_course`.
- **Couvre** : #184.

### MO2 — Filtres type / tenant / sévérité (AND)

- **Acteur** : KB Admin
- **Pré-requis** : ≥ 10 incidents mixtes sur ≥ 2 tenants
- **Étapes** :
  1. Type = `kyc_pending`, puis Tenant = `T1`, puis Sévérité = `critical`.
  2. Tout remettre sur « Tous » / « Toutes ».
- **Attendu** :
  - Combinaison AND ; chaque sélection rétrécit immédiatement la table.
  - Aucune requête backend supplémentaire (Network).
  - Sévérités disponibles = `critical` / `warning` (pas de « high »).
- **Couvre** : #197.

### MO3 — Drill-down panel

- **Acteur** : KB Admin
- **Pré-requis** : ≥ 1 incident en table
- **Étapes** :
  1. Cliquer une ligne → `IncidentDetailSheet` slide-in depuis la droite.
  2. Vérifier titre = label humain du kind + liste raw key/value.
  3. Cliquer le lien contextuel (`kyc_pending` → `/pipeline/[prospectId]` ; `paid_no_course` → `/t/[tenantId]/commandes` ; `webhook_latency` → pas de lien).
  4. Fermer via Esc / backdrop / bouton.
- **Attendu** :
  - Sheet rend sans crash ; pas de stale data après fermeture.
  - Lien contextuel `stopPropagation` ne ré-ouvre pas le panel.
- **Couvre** : #207.

### MO4 — Manager refusé (UnauthorizedCard)

Voir A4b (identique).

---

## T — Tenants

### T1 — Tenant switcher (manager + admin avec Supervision pinned)

- **Acteur** : KB Admin (≥ 2 tenants) + KB Manager multi-tenants
- **Étapes** :
  1. Login KB Admin, ouvrir le tenant switcher du header.
  2. Vérifier liste : « Supervision » pinned en haut puis tenants attachés.
  3. Cliquer un tenant → URL `/t/<id>/menu`, cookie `kb_current_tenant=<id>`.
  4. Logout, login KB Manager multi-tenants, switcher entre 2 tenants → cookie réécrit à chaque switch.
- **Attendu** :
  - Admin : « Supervision » en premier, navigue vers `/monitoring`.
  - Manager : aucune entrée « Supervision ».
  - Cookie mis à jour (DevTools → Application → Cookies).
- **Couvre** : #223 ; tenant switcher RBAC.

### T1bis — Cookie stale : manager qui a perdu un resto retombe sur le 1er tenant

- **Acteur** : KB Manager avec cookie `kb_current_tenant=<tenant révoqué>`, conserve A et B
- **Étapes** :
  1. (Setup BO) Retirer la rattache `userTenants` du tenant Z.
  2. Le manager va sur `/`.
- **Attendu** :
  - Redirection vers `/t/A/menu` (premier tenant accessible). Pas d'écran « accès refusé ».
  - Au prochain switch vers B, cookie réécrit `kb_current_tenant=B`.
- **Couvre** : #223 (branche cookie stale).

### T2 — Fiche supervision /pipeline/[prospectId]

- **Acteur** : KB Admin
- **Pré-requis** : seeds e2e (au moins 1 prospect en DB — note : `api.prospects.get` est STUBBÉ V1, la page reste en loading tant que F-PIPELINE-CRM n'a pas atterri)
- **Étapes** : aller manuellement sur `/pipeline/<prospectId>`.
- **Attendu** :
  - Page rend sans 404 ni error boundary.
  - Tant que la query est stub : « Chargement du prospect… ».
  - Quand `api.prospects.get` est branché : header nom prospect + badge phase + `ProvisionLauncherButton` (Lancer / Reprendre / Ouvrir la vue resto) + placeholder dashed « Contenu détaillé livré par F-PIPELINE-CRM ».
  - KB Manager qui deep-link → `UnauthorizedCard` « Cette fiche est réservée à l'équipe KitchenBoost ».
- **Couvre** : #233.

### T3 — Aperçu contrat dans iframe sandboxée

- **Acteur** : KB Admin (root)
- **Pré-requis** : seeds e2e ; un prospect avec contrat déjà généré (HTML stocké côté backend, statut `draft`) ; route `/pipeline/<prospectId>` accessible ; bloc Contrats (slice 1) visible.
- **Étapes** :
  1. Naviguer vers la fiche d'un prospect avec contrat existant — le bloc « Contrats » affiche la ligne contrat (slice 1).
  2. Déclencher l'affichage de `ContractIframe` (clic sur la ligne contrat slice 3, ou story dédiée) avec le HTML du contrat.
  3. Vérifier visuellement que l'iframe affiche bien le contenu du contrat (en-tête, sections, signature).
  4. DevTools → inspecter `<iframe>` : attribut `sandbox` présent, **ne contient pas** `allow-scripts`.
  5. (Test sec) Injecter un `<script>alert("XSS")</script>` dans le template upstream et vérifier que le script **ne s'exécute pas**.
- **Attendu** :
  - UI : contrat rendu visuellement, lisible, mise en forme préservée.
  - DOM : `<iframe sandbox="">` (ou sandbox sans `allow-scripts`).
  - Sécurité : zéro alerte JS, console clean (sandbox iframe bloque le script).
  - DB : statut contrat inchangé (lecture seule).
- **Couvre** : #165 + invariant sécurité PRD 70 §3.5.

### T4 — Téléchargement HTML du contrat

- **Acteur** : KB Admin (root)
- **Pré-requis** : `ContractIframe` monté avec un HTML non vide (cf. T3).
- **Étapes** :
  1. Cliquer sur le bouton « Télécharger HTML ».
  2. Le navigateur déclenche un téléchargement.
  3. Ouvrir le fichier téléchargé dans un onglet ou éditeur de texte.
- **Attendu** :
  - UI : pas de changement visible (iframe reste affichée), bouton non désactivé.
  - Fichier : nom `contrat-<timestamp>.html` (ex : `contrat-1717161600000.html`), MIME `text/html`, contenu identique au `srcDoc` de l'iframe.
  - DB : aucune mutation déclenchée (téléchargement 100% front).
- **Couvre** : #165.

### T5 — Fallback erreur si HTML manquant

- **Acteur** : KB Admin (root)
- **Pré-requis** : `ContractIframe` monté avec `html = ""` ou `null` ou `undefined` (simulation d'échec backend en amont, ou tri-state Convex « no row »).
- **Étapes** :
  1. Naviguer sur la surface où le composant serait monté (story dédiée, ou anticipation slice 3 si la génération échoue).
  2. Observer le rendu.
- **Attendu** :
  - UI : message FR clair (« Aucun contenu de contrat à afficher. La génération a peut-être échoué — réessayez ou contactez le support. »), encadré pointillé, **pas d'iframe blanche silencieuse**, **pas de bouton « Télécharger »**.
  - DB : aucune mutation, aucune erreur console côté front.
- **Couvre** : #165 + PRD 70 §3.5 (pas d'iframe blanche).

### T6 — Génération d'un contrat A&B depuis la fiche prospect (parcours complet)

- **Acteur** : KB Admin (root)
- **Pré-requis** : seeds e2e ; session connectée avec rôle `kb_admin` ; un prospect avec les 5 champs juridiques renseignés (`name`, `siret`, `address`, `contactName`, `email`) ; aucun contrat encore généré pour ce prospect ; route `/pipeline/<prospectId>`.
- **Étapes** :
  1. Ouvrir `/pipeline/<prospectId>` — le bloc « Contrats » affiche « Aucun contrat généré pour ce prospect. » et un bouton « Générer contrat » dans le header.
  2. Cliquer « Générer contrat » — le modal s'ouvre avec le titre « Générer un contrat », 3 radios (A seul / B seul / A & B), et les 5 champs juridiques pré-remplis depuis le prospect (raison sociale, SIRET, adresse, email, représentant).
  3. Sélectionner le radio « A & B ».
  4. Cliquer « Générer » — le bouton affiche « Génération… » et est désactivé pendant l'appel.
  5. À la résolution : le modal se ferme, l'iframe du contrat apparaît sous le bloc Contrats, et la liste des contrats s'est rafraîchie avec une nouvelle ligne « Prestation A&B / Brouillon » datée d'aujourd'hui.
  6. Cliquer « Télécharger HTML » dans l'iframe — un fichier `contrat-<timestamp>.html` est téléchargé.
- **Attendu** :
  - UI : modal fermé, iframe rendue avec le contenu du contrat A&B incluant les 5 champs interpolés (balises `<!-- BEGIN` absentes). Liste contrats avec 1 ligne « A&B / Brouillon ».
  - DB : nouvelle ligne `contracts` avec `prospectId` du prospect, `prestation = "A_AND_B"`, `status = "draft"`, `htmlContent` non-vide contenant les valeurs du prospect, `statusUpdatedAt` et `createdAt` cohérents.
  - Audit : une ligne `audit` avec `action = "contract.generate"` et l'`adminId` courant.
- **Couvre** : #174 (modal Générer contrat) + #158 (bloc lecture seule visible) + #165 (iframe + download).

### T7 — Échec génération sur prospect incomplet (champs juridiques manquants)

- **Acteur** : KB Admin (root)
- **Pré-requis** : seeds e2e ; session `kb_admin` ; un prospect avec `name` + `phone` uniquement (les 4 champs `siret`/`address`/`email`/`contactName` sont vides) ; route `/pipeline/<prospectId>`.
- **Étapes** :
  1. Cliquer « Générer contrat » dans le header du bloc Contrats.
  2. Inspecter le modal : 4 lignes juridiques marquées en rouge avec « — Manquant », la ligne « Raison sociale » remplie (← `name`).
  3. Vérifier que le bouton « Générer » est désactivé (grisé) et que le message « Complète la fiche prospect avant de générer un contrat. Champs absents : SIRET, Adresse, Email, Représentant. » s'affiche sous la recap.
  4. Tenter de cliquer « Générer » — aucune action n'est déclenchée (mutation jamais appelée).
  5. Fermer le modal via « Annuler ».
- **Attendu** :
  - UI : 4 lignes recap rouges (`data-missing="true"`), bouton submit désactivé, message d'aide nominatif avec la liste exacte des champs absents, modal fermable proprement.
  - DB : aucune nouvelle ligne `contracts`, aucune ligne `audit` `contract.generate` ajoutée.
- **Couvre** : #174 (gating champs manquants) + #158 (liste reste vide).

### T8 — Erreur backend génération contrat (toast + pas d'iframe blanche)

- **Acteur** : KB Admin (root)
- **Pré-requis** : seeds e2e ; session `kb_admin` ; un prospect complet (5 champs juridiques OK) ; simulation d'erreur backend (couper la connexion Convex après ouverture du modal, ou seed un prospect dont le SIRET force une `ConvexError` côté `generateContract`) ; route `/pipeline/<prospectId>`.
- **Étapes** :
  1. Ouvrir le modal « Générer contrat ».
  2. Sélectionner la prestation « A seul ».
  3. Cliquer « Générer » — le bouton affiche « Génération… ».
  4. Provoquer l'échec de la mutation (cf. pré-requis).
  5. Observer les retours UI.
- **Attendu** :
  - UI : toast d'erreur Sonner en bas avec « Échec génération contrat : <message backend> ». Modal reste ouvert, bouton « Générer » à nouveau actif. Message d'erreur inline dans le modal (rouge). **Aucune iframe vide** ne s'affiche sous le bloc Contrats.
  - DB : aucune ligne `contracts` créée.
- **Couvre** : #174 (branche erreur) + #165 (ContractIframe error branch indirectement).

### T9 — Pipeline Kanban accessible KB Admin uniquement (RBAC + Convex wire)

- **Acteur** : root admin (KB Admin) puis KB Manager
- **Pré-requis** : seeds e2e ; au moins 2-3 prospects en base (différentes phases : `acquisition`, `preparation`, `installation`) — utiliser `seedData` ou la mutation `crm.createProspect` ; un compte KB Admin (`role = kb_admin`) et un compte KB Manager (`role = kb_manager` rattaché à au moins 1 tenant) ; starting route : `/` (root-entry redirige selon rôle).
- **Étapes** :
  1. Se connecter en tant que KB Admin → atterrit sur `/pipeline` (root-entry).
  2. Vérifier que la sidebar contient bien l'entrée « Pipeline » (groupe « Supervision »).
  3. Observer la page : titre « Pipeline », un compteur « N prospects », puis la liste des prospects rendus en ligne (nom + phase en majuscule, ex. `ACQUISITION`).
  4. Cliquer sur une ligne → navigation vers `/pipeline/<prospectId>` (la fiche existante de F-SHELL-10).
  5. Se déconnecter, se reconnecter en tant que KB Manager.
  6. Vérifier que la sidebar n'affiche PAS « Pipeline » (groupe « Resto » uniquement).
  7. Taper manuellement `/pipeline` dans l'URL.
- **Attendu** :
  - KB Admin (étapes 1-4) : la page rend la liste correctement, le lien sidebar est visible et actif, chaque ligne expose des `data-prospect-id` + `data-phase` (vérifier dans le DOM), la navigation vers la fiche fonctionne.
  - KB Manager (étapes 5-7) : pas de lien sidebar « Pipeline » ; sur deep-link `/pipeline`, la `UnauthorizedCard` (« Accès non autorisé », même vocabulaire que `/monitoring`) s'affiche avec un bouton « Retour au dashboard » qui ramène en `/`.
  - DB : aucune mutation déclenchée par la simple consultation (la query `listProspects` est read-only). Vérifier dans le dashboard Convex que la query est bien `skip`-ée pour le manager (pas d'appel réseau).
- **Couvre** : #216 (F-PIPELINE-CRM 01) + F-SHELL-06 #196 (sidebar conditional) + F-SHELL-10 #233 (fiche drill-down) + ADR 0014 §5.

### T10 — Pipeline Kanban : loading state et empty state distinguables

- **Acteur** : root admin (KB Admin)
- **Pré-requis** : seeds e2e ; un compte KB Admin connecté ; deux variantes de fixture : (a) base vide (0 prospects) ; (b) base avec 1 prospect minimum ; outils : DevTools (Network throttling « Slow 3G ») pour observer le loading.
- **Étapes** :
  1. Variante (a) : vider la table `prospects` (ou utiliser un deployment vierge). Naviguer vers `/pipeline`.
  2. Observer la page après hydratation complète de la query Convex.
  3. Variante (b) : ajouter 1 prospect via la mutation `crm.createProspect` (ou un seed). Reload `/pipeline` avec throttling « Slow 3G » activé.
  4. Observer le rendu pendant le in-flight de la query, puis après hydratation.
- **Attendu** :
  - Variante (a) : la page affiche « 0 prospects — Kanban riche... » puis la card pointillée « Aucun prospect dans le pipeline pour le moment. » (PAS le loading spinner — la query est résolue mais vide).
  - Variante (b) avec throttling : pendant le in-flight, le titre « Pipeline » apparaît mais le sous-texte est « Chargement des prospects… » (PAS la card empty). Une fois hydraté : « 1 prospect » + ligne unique du prospect.
  - Aucun flicker entre `loading` et `empty` (les deux états ont des copies clairement distinctes).
- **Couvre** : #216 (Convex tri-state contract `undefined` / `[]` / `Doc[]`).

### T11 — Kanban `/pipeline` : 3 colonnes triées par phase + drill-down fiche

- **Acteur** : KB Admin (root)
- **Pré-requis** : tenant KB seed avec ≥ 4 prospects (au moins 1 par phase : `acquisition`, `preparation`, `installation`, `operationnel`) ; auth en root admin ; route de départ `/`.
- **Étapes** :
  1. Ouvrir `/pipeline` depuis la sidebar admin.
  2. Vérifier que 3 colonnes sont visibles : « Acquisition », « Préparation », « Installation » (onglet « Kanban » actif par défaut).
  3. Vérifier que chaque colonne contient les prospects de sa phase (count badge en header).
  4. Vérifier qu'aucune carte de phase `operationnel` n'apparaît dans le Kanban (filtrée vers « Clients actifs »).
  5. Cliquer sur la carte d'un prospect.
- **Attendu** :
  - Header Pipeline affiche le total agrégé (« N prospects »).
  - 3 colonnes scrollables verticalement, count badge correct.
  - Click sur carte → navigation vers `/pipeline/<prospectId>` (fiche F-SHELL-10).
  - Aucun drag-and-drop disponible (story 06 le câble plus tard).
- **Couvre** : #255 + smoke régression #216 + #233 (drill-down fiche).

### T12 — Kanban : recherche par nom filtre les 3 colonnes en temps réel (accent insensible)

- **Acteur** : KB Admin (root)
- **Pré-requis** : tenant KB seed avec au moins 3 prospects nommés : « Café Vert » (acquisition), « Pizza Roma » (preparation), « Sushi Bar » (installation) ; route `/pipeline`.
- **Étapes** :
  1. Cliquer dans le champ « Rechercher un prospect par nom… ».
  2. Taper `pizz`.
  3. Observer les 3 colonnes.
  4. Vider le champ.
  5. Taper `cafe` (sans accent).
- **Attendu** :
  - Étape 2 : seule la colonne « Préparation » contient « Pizza Roma » ; les autres deviennent vides (« Aucun prospect »). Compteur header : « 1 prospect (filtré) ».
  - Étape 4 : toutes les cartes réapparaissent dans leurs colonnes d'origine.
  - Étape 5 : seule la colonne « Acquisition » contient « Café Vert » (recherche accent insensible).
- **Couvre** : #255 (search + partition front-side, identité quand vide).

### T13 — Kanban : onglet « Clients actifs » affiche les prospects Opérationnel + badge tenant

- **Acteur** : KB Admin (root)
- **Pré-requis** : tenant KB seed avec ≥ 1 prospect en phase `operationnel` ET avec un `tenantId` back-link posé (prospect provisionné) ; route `/pipeline`.
- **Étapes** :
  1. Cliquer sur le tab « Clients actifs (N) » au-dessus du Kanban.
  2. Observer la grille rendue.
  3. Repérer la carte d'un prospect provisionné.
  4. Revenir sur l'onglet « Kanban ».
- **Attendu** :
  - Le Kanban (3 colonnes) disparaît, remplacé par une grille responsive (1 colonne mobile → 3 colonnes desktop).
  - Chaque card en phase Opérationnel apparaît ici, AUCUNE n'apparaît dans le Kanban.
  - Badge vert « tenant ✓ » visible sur la card du prospect provisionné, absent sinon.
  - Étape 4 : Kanban réapparaît avec 3 colonnes, « Clients actifs » non persisté en V1.
- **Couvre** : #255 (onglet séparé + badge tenant conditionnel + filtrage Operationnel hors Kanban — PRD 70 §3.3).

### T14 — Fiche prospect : KB Admin coche un milestone Acquisition et observe l'auto-bascule vers Préparation

- **Acteur** : KB Admin (root user)
- **Pré-requis** : 1 prospect seed en phase `acquisition` avec `tabletteMode = "appareil_existant"` et `milestones = { contratSigne: <ts>, kbisRecu: <ts>, pieceIdentiteRecue: <ts> }` (3/4 milestones Closing déjà cochés).
- **Étapes** :
  1. Se connecter en tant que KB Admin et naviguer sur `/pipeline/[prospectId]` du prospect seed.
  2. Vérifier que le panneau identité affiche le nom + le badge phase « Acquisition ».
  3. Vérifier que le bloc `MilestoneChecklist` rend la section « Acquisition » avec les 4 milestones Closing badgés.
  4. Cocher le milestone « RIB reçu » (impactsClosing=true).
  5. Attendre la réactivité Convex (~500 ms).
- **Attendu** :
  - Le badge phase passe de « Acquisition » à « Préparation » sans rechargement.
  - La row « RIB reçu » apparaît cochée + label en line-through.
  - Toast vert ou pas de toast d'erreur.
- **Couvre** : #256 + B-ONBOARDING-MILESTONES (#189) + PIPELINE-06 (réactivité fiche).

### T15 — Fiche prospect : KB Admin met à jour un statut Stripe Connect et voit l'historique pousser

- **Acteur** : KB Admin
- **Pré-requis** : 1 prospect seed sans intégrations initialisées (`milestones.stripeConnect` absent).
- **Étapes** :
  1. Naviguer sur `/pipeline/[prospectId]`.
  2. Localiser le sous-panneau « Stripe Connect » de l'`IntegrationStatusPanel`.
  3. Vérifier badge « not_started » + dropdown avec les 5 statuts canoniques.
  4. Sélectionner « pending_kyc », cliquer « Mettre à jour ».
  5. Sélectionner « verified », cliquer « Mettre à jour ».
- **Attendu** :
  - Le badge passe à « pending_kyc » puis « verified » (vert).
  - L'historique sous le panneau affiche 2 lignes, ordre antichronologique : verified en haut, pending_kyc en bas.
  - Chaque ligne montre timestamp lisible (`2026-06-01 14:32`) + statut.
- **Couvre** : #256 + B-ONBOARDING-MILESTONES slice 4 (#213).

### T16 — Fiche prospect : KB Manager (non-admin) deep-linke `/pipeline/[prospectId]` et voit le refus

- **Acteur** : KB Manager (non-root)
- **Pré-requis** : 1 prospect existant en BD.
- **Étapes** :
  1. Se connecter en tant que KB Manager.
  2. Coller directement l'URL `/pipeline/[prospectId]` dans le navigateur.
- **Attendu** :
  - La page rend l'`UnauthorizedCard` (« Accès non autorisé »).
  - Aucune donnée prospect ne fuite (pas de nom, pas de SIRET, pas de milestone).
  - Aucun appel réseau Convex visible pour `setMilestone` ou `recordIntegrationStatus`.
- **Couvre** : #256 + ADR 0010 (isolation `kbAdminQuery` / `kbAdminMutation`) + F-SHELL-10 (#233 access gate).

### T17 — Kanban DnD : drag clean en avant (Acquisition → Préparation, milestones complets)

- **Acteur** : KB Admin (root)
- **Pré-requis** : ≥ 2 prospects (un dans `acquisition` avec tous les milestones Closing cochés en `appareil_existant` : `contratSigne` + `kbisRecu` + `pieceIdentiteRecue` + `ribRecu` ; un autre dans `preparation`) ; route `/pipeline`, onglet « Kanban » actif.
- **Étapes** :
  1. Localiser la carte du prospect clean dans la colonne Acquisition.
  2. Drag de la carte vers la colonne Préparation (drop sur la zone de la colonne).
  3. Observer la carte changer immédiatement de colonne (réactivité Convex).
  4. Vérifier qu'aucun dialog ne s'ouvre.
  5. Rafraîchir la page et confirmer la persistance.
- **Attendu** :
  - La carte est rendue dans la colonne Préparation.
  - Aucun dialog n'est apparu.
  - Audit `prospect.changePhase` créé, SANS ligne `prospect.changePhase.bypass`.
- **Couvre** : #262.

### T18 — Kanban DnD : drag bypass en avant + dialog de confirmation (milestones manquants)

- **Acteur** : KB Admin (root)
- **Pré-requis** : ≥ 1 prospect en `acquisition` avec `tabletteMode = achat_kb` et seulement 4 des 5 milestones Closing cochés (manque `factureTablettePayee`) ; route `/pipeline`.
- **Étapes** :
  1. Drag de la carte du prospect bypass vers la colonne Préparation.
  2. Observer l'apparition du dialog « Confirmer le bypass » avec le bullet `Facture tablette payée`.
  3. Cliquer sur « Annuler » → la carte reste en Acquisition.
  4. Refaire le drag, cliquer « Confirmer le bypass ».
  5. Vérifier que la carte bascule en Préparation et que le dialog se ferme.
- **Attendu** :
  - Dialog affiche bien le bullet `Facture tablette payée` (label FR du milestone manquant).
  - Cancel ne déplace pas la carte (aucune mutation).
  - Confirm déplace la carte vers Préparation.
  - Audit `prospect.changePhase.bypass` créé avec `missing: ["factureTablettePayee"]` + ligne `prospect.changePhase`.
- **Couvre** : #262.

### T19 — Kanban : toast bascule auto Closing (coche du dernier milestone sur la fiche)

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect en `acquisition`, `tabletteMode = appareil_existant`, 3 des 4 milestones mandatory Closing cochés (manque `ribRecu`) ; deux onglets ouverts : A=`/pipeline` (Kanban), B=`/pipeline/[prospectId]` (fiche).
- **Étapes** :
  1. Onglet B : cocher `RIB reçu` via le `MilestoneChecklist` (mutation `setMilestone`).
  2. Basculer immédiatement sur l'onglet A (Kanban) sans interagir avec le DnD.
  3. Observer la carte du prospect glisser de Acquisition vers Préparation.
  4. Observer le toast `<Nom du prospect> — Prospect basculé en Préparation (Closing complet)` en bas de l'écran.
  5. Refresh de l'onglet A, confirmer la persistance.
- **Attendu** :
  - La carte est passée de Acquisition à Préparation sans intervention DnD.
  - Toast `success` (vert) avec nom du prospect + mention « Closing complet ».
  - Audit `prospect.closing.autoBascule` émis par `maybeAutoBascule`.
- **Couvre** : #262.

### T20 — Fiche prospect : logger une interaction et la voir en tête de timeline

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect `acquisition` seedé avec 1 interaction historique (« Premier contact » jour-30) ; route `/pipeline/<prospectId>`.
- **Étapes** :
  1. Ouvrir la fiche prospect.
  2. Vérifier que le panneau « Interactions » affiche bien l'interaction historique.
  3. Cliquer sur « Logger interaction ».
  4. Saisir la note `"Appel intéressé, RDV à caler"`, sélectionner canal `Cold call`.
  5. Cliquer « Logger ».
  6. Vérifier que le dialog se ferme et que la nouvelle interaction apparaît **en tête** de la timeline.
  7. Recharger la page (F5) — l'interaction reste, datée « à l'instant ».
- **Attendu** :
  - Timeline antichronologique respectée (nouvelle entrée en tête).
  - Canal affiche label FR « Cold call » + icône téléphone.
  - Réactivité Convex (pas de fetch manuel).
  - Audit `prospect.logInteraction` (foundation auto-audit via `kbAdminMutation`).
- **Couvre** : #263.

### T21 — Fiche prospect : éditer l'identité du prospect via modal

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect existant avec `name="L'Artisan"`, SIRET non renseigné, contact `Jean Dupont` ; route `/pipeline/<prospectId>`.
- **Étapes** :
  1. Ouvrir la fiche prospect.
  2. Cliquer sur « Éditer » au-dessus du panneau identité.
  3. Modal pré-rempli avec `L'Artisan` / `Jean Dupont`.
  4. Modifier nom en `L'Artisan Boulangerie`, saisir SIRET `12345678900012`, changer source en `WhatsApp`.
  5. Cliquer « Enregistrer ».
  6. Vérifier que le modal se ferme.
  7. Vérifier que le `ProspectIdentityPanel` affiche immédiatement les nouvelles valeurs.
- **Attendu** :
  - Modal pré-rempli avec les valeurs courantes (pas de champs vides).
  - Après submit : panneau identité reflète les nouvelles valeurs sans rechargement.
  - Audit `prospect.edit` côté backend.
  - Pas d'écriture sur les champs laissés vides (no-touch sur autres champs).
- **Couvre** : #263.

### T22 — Fiche prospect : ExternalLinksPanel — WhatsApp E.164 + direct.uber.com + Stripe disabled

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect avec téléphone `06 12 34 56 78` ; route `/pipeline/<prospectId>`.
- **Étapes** :
  1. Ouvrir la fiche prospect.
  2. Repérer le panneau « Liens externes » (bas de fiche).
  3. Inspecter le `href` du bouton WhatsApp : doit être exactement `https://wa.me/33612345678` (sans `+`, sans espaces, préfixe `33` FR).
  4. Cliquer sur « Ouvrir direct.uber.com » → nouvel onglet sur `https://direct.uber.com`.
  5. Vérifier que « Ouvrir Stripe Connect onboarding » est disabled (champ `stripeConnectOnboardingUrl` pas encore tracé).
- **Attendu** :
  - Deep-link WhatsApp E.164 correctement formaté.
  - `direct.uber.com` ouvre dans un nouvel onglet (`target="_blank"`).
  - Bouton Stripe disabled avec tooltip « Pas encore généré ».
  - Bouton Odoo cliquable (lien générique V1).
- **Couvre** : #263.

### T23 — Fiche prospect : panneau Tenant absent quand pas encore provisionné

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect sans `tenantId` (phase `acquisition` ou `preparation`, wizard de provisioning jamais lancé).
- **Étapes** :
  1. Se connecter en root.
  2. Naviguer vers `/pipeline`.
  3. Cliquer sur une carte de prospect SANS tenant.
  4. Observer la section centrale de la fiche (identité, milestones, intégrations).
- **Attendu** :
  - Aucune carte « Tenant » n'est rendue.
  - Pas de placeholder vide, pas de bandeau « Chargement », pas de squelette.
  - Layout reste compact (pas de gap inutile entre la section identité et la grid milestones/intégrations).
- **Couvre** : #264.

### T24 — Fiche prospect : panneau Tenant + bouton « Ouvrir la vue resto » fonctionnel

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect dont le wizard de provisioning a été complété (step 1 a posé `tenantId`, step 8 a activé le tenant → `status = "active"`) ; tenant a slug + nom.
- **Étapes** :
  1. Se connecter en root.
  2. Naviguer vers `/pipeline/<prospectId>` du prospect provisionné.
  3. Observer la carte « Tenant » sous la section identité : slug + nom + badge vert « Actif ».
  4. Cliquer sur « Ouvrir la vue resto ».
  5. Vérifier l'URL et l'écran d'atterrissage.
- **Attendu** :
  - Carte Tenant rendue avec `slug` + `name` + badge `Actif`.
  - Bouton « Ouvrir la vue resto » navigue vers `/t/<tenantId>` (puis redirige vers `/menu`, sous-route par défaut V1).
  - Bandeau d'impersonation F-SHELL visible en haut (« Mode impersonation : <nom du resto> »).
- **Couvre** : #264 (+ couplage F-SHELL TenantSwitcher).

### T25 — Fiche prospect : panneau Tenant dégradé quand le tenant a été supprimé manuellement

- **Acteur** : KB Admin (root)
- **Pré-requis** : 1 prospect dont `tenantId` pointe sur un tenant supprimé (cas dégradé — typiquement après debug ou rollback manuel en base).
- **Étapes** :
  1. Se connecter en root.
  2. Ouvrir DevTools → Console.
  3. Naviguer vers `/pipeline/<prospectId>` du prospect dont le tenant a disparu.
  4. Observer le panneau Tenant + la console DevTools.
- **Attendu** :
  - Carte Tenant rendue avec le message « Tenant introuvable (id: tenants\_…) ».
  - `console.warn` émis : `[TenantPanel] tenant introuvable pour prospect ... (tenantId: ...)`.
  - Le bouton « Ouvrir la vue resto » n'est PAS rendu (pas de lien cassé).
  - Le reste de la fiche (identité, milestones, intégrations, contrats) reste pleinement fonctionnel.
- **Couvre** : #264.

---

## P — Paramètres

> **Statut** : ✅ **5/5 validés manuellement le 2026-06-01** (manager + admin sanity-check). 3 fixes appliqués pendant le run :
>
> - **P1** (`branding`) — query `getSettings` exposée côté manager (la query manquait, le manager voyait toujours les defaults) + `key` content-dérivée sur les éditeurs (RHF/useState non réactifs au changement de prop) — commits `b6b3083` + `d70589d`.
> - **P1** (toast) — `<Toaster />` Sonner monté UNE FOIS à `(app)/layout.tsx` (était monté seulement sur `/pipeline`, donc toutes les pages tenant-scope avaient des toasts silencieux) — commit `b6b3083`.
> - **P2** (`normalisePhone`) — strip étendu aux séparateurs courants `.`, `-`, `(`, `)`, `/` (rejetait `+33 6 12 34 56 78.` avec point copié-collé d'une vCard) — commit `b6b3083`.

### P1 — Identité visuelle (logo + couleur)

- **Acteur** : KB Manager
- **Pré-requis** : tenant sans branding préalable
- **Étapes** :
  1. `/t/<tenantId>/parametres` → « Identité visuelle ».
  2. Uploader PNG ~200 Ko (preview live), couleur `#E5A100` (swatch live).
  3. Enregistrer, puis F5.
- **Attendu** :
  - Toast vert « Identité visuelle enregistrée. ».
  - Logo + couleur persistés après reload, sans erreur console.
- **Couvre** : #229 ; #168.

### P2 — Coordonnées (save isolé + diff-only)

- **Acteur** : KB Manager
- **Étapes** :
  1. Coordonnées : adresse + téléphone `06 12 34 56 78`, Enregistrer.
  2. Modifier UNIQUEMENT le téléphone (`07 88 99 00 11`), Enregistrer.
- **Attendu** :
  - Toast « Coordonnées enregistrées » à chaque save.
  - Au 2e save, patch envoyé ne contient QUE `phone` (Convex dashboard).
- **Couvre** : #231.

### P2bis — Validation téléphone FR

- **Acteur** : KB Manager
- **Étapes** : saisir `abcd` ou `0812345678` (08 = numéro spécial), corriger `06 12 34 56 78`, Enregistrer.
- **Attendu** :
  - Message inline rouge + bouton Enregistrer désactivé.
  - Après correction : erreur disparaît, bouton réactivé, save passe.
- **Couvre** : #231.

### P2ter — Save isolé entre sections (régression #229)

- **Acteur** : KB Manager
- **Étapes** :
  1. Commencer à modifier la couleur dans Identité visuelle (NE PAS Enregistrer).
  2. Section Coordonnées : changer adresse + tel valide, Enregistrer.
- **Attendu** : toast « Coordonnées enregistrées » ; couleur en cours d'édition préservée (`useForm` isolés).
- **Couvre** : #231 + régression #229.

### P3 — Modes acceptés (au moins un actif)

- **Acteur** : KB Manager
- **Pré-requis** : tenant `acceptedModes = { delivery: true, clickAndCollect: true }`
- **Étapes** :
  1. Désactiver « Click & Collect », Enregistrer.
  2. Tenter de désactiver « Livraison ».
- **Attendu** :
  - Toast « Modes acceptés enregistrés. ».
  - Toggle « Livraison » locked + message inline « Au moins un mode doit rester actif. ».
  - Réactiver Click & Collect déverrouille tout. Reload : état persisté `{ delivery: true, clickAndCollect: false }`.
- **Couvre** : #234 ; #168 (D5).

### P4 — Horaires serviceHours

- **Acteur** : KB Manager
- **Étapes** :
  1. « Horaires de service » : Lundi 11h30–14h30 + 18h30–22h30, Dimanche fermé.
  2. Enregistrer, puis F5.
- **Attendu** :
  - Toast « Horaires enregistrés ».
  - Reload : horaires persistés. Validation : pas de chevauchement, fin > début.
- **Couvre** : #236.

### P5 — Uber Direct read-only (info only V1)

- **Acteur** : KB Manager
- **Étapes** : observer la section « Uber Direct ».
- **Attendu** :
  - Skeleton informationnel : description + statut « Non configuré » / « À venir ».
  - Aucun bouton actif.
- **Couvre** : #193.

---

## AC — Auth core

### AC1 — Accept-invite admin path

_Pas de feature correspondante en V1 — parcours retiré._ Le backend `acceptInvite` admin path EXISTE (branche `targetRole === "kb_admin"` dans `convex/table/admin.ts` ~ligne 280) mais aucune UI ne PERMET d'émettre une invite admin en V1 — l'ancien `inviteAdmin` a été supprimé. L'envoi se fait aujourd'hui via Convex dashboard / script.

### AC2 — Invite manager via wizard step 7

- **Acteur** : KB Admin (envoi) + gérant invité (acceptation)
- **Pré-requis** : prospect en phase `preparation`/`installation`/`operationnel` AVEC `tenantId` ; aucune `managerInvites` row encore
- **Étapes** :
  1. `/pipeline/<prospectId>/provision`, step 7 « Invitation ». Email gérant pré-rempli (= `prospect.email`), READ-ONLY.
  2. Cliquer « Envoyer l'invitation » sans toucher au nom.
  3. Row `managerInvites` apparaît (Convex dashboard) ; badge « Invitation envoyée le DD/MM/YYYY à HH:MM », bouton flippe sur « Renvoyer l'invitation ».
  4. Le gérant ouvre l'email Resend → magic-link → crée son compte → row `userTenants` rôle `kb_manager` insérée.
  5. Revenir sur le wizard : step 7 coché. Cliquer « Renvoyer » → échec `ALREADY_INVITED` → toast erreur.
- **Attendu** :
  - Badge timezone navigateur, format `DD/MM/YYYY à HH:MM`.
  - `useWizardState` flippe step 7 sur « complete » via `getLatestManagerInviteForTenant`.
  - Email Resend avec `tenantName` snapshot. Bouton « Continuer » reste actif (step non-bloquant).
- **Couvre** : #273 ; B-AUTH-4 (#204) ; B-AUTH-5 (#212) ; B-AUTH-6 (#230) ; useWizardState (#265).

### AC2bis — Step 7 non-bloquant + relance après expiration

- **Acteur** : KB Admin
- **Étapes** :
  1. Step 7 sans envoyer : warning « Sans invitation, le gérant ne pourra pas se connecter ».
  2. « Continuer » → step 8.
  3. Revenir, envoyer l'invite, patcher `expiresAt` à `Date.now() - 1` en DB, cliquer « Renvoyer ».
- **Attendu** :
  - Bouton « Continuer » jamais désactivé.
  - Relance : nouvelle row remplace l'expirée, badge affiche le NOUVEAU timestamp.
- **Couvre** : #273 ; B-AUTH-4 relance (#204).

---

## M — Menu

### M1 — Catégories CRUD

- **Acteur** : KB Manager
- **Pré-requis** : tenant fraîchement provisionné, 0 catégorie
- **Étapes** :
  1. `/t/<tenantId>/menu`, « + Catégorie ». Saisir « Entrées ».
  2. Renommer en « Mes Entrées » via inline rename (autosave debounced).
  3. Créer « Plats ». Supprimer « Mes Entrées » via dialog de confirmation.
- **Attendu** :
  - CRUD live (Convex push), pas d'erreur si dernière catégorie supprimée.
  - Validation nom non vide.
- **Couvre** : #200 ; #206.

### M2 — Items list + toggle rupture

- **Acteur** : KB Manager
- **Pré-requis** : menu publié contenant ≥ 1 item « Smash Burger » disponible
- **Étapes** :
  1. `/t/[tenantId]/menu`, basculer le switch « Disponibilité de Smash Burger » OFF (sans Publier).
  2. Onglet incognito : ouvrir l'URL publique PWA du tenant.
- **Attendu** :
  - Admin : badge « Rupture » apparaît immédiatement.
  - PWA mangeur : item grisé / `available: false` immédiatement, sans Publier.
- **Couvre** : #211 (AC3 + AC4) ; ADR 0015.

### M2bis — Réactivité multi-onglets

- **Acteur** : KB Manager (2 sessions)
- **Étapes** : onglet A toggle rupture, onglet B observe la card.
- **Attendu** : onglet B reflète le nouveau state + badge en < 2 s, sans refresh.
- **Couvre** : #211 (AC5).

### M3 — Modale item CRUD

- **Acteur** : KB Manager
- **Pré-requis** : tenant avec ≥ 2 catégories (« Entrées », « Plats »)
- **Étapes** :
  1. « + Item » sous « Entrées » : « Smash Burger », description, prix « 12,90 », allergens « gluten » + « lait ». Créer.
  2. Cliquer la card → modale édition. Changer prix → 13,50 (debounce 600 ms), allergens (immédiat), catégorie « Entrées » → « Plats ».
  3. Rouvrir → Supprimer → confirmer.
- **Attendu** :
  - Create / debounced text edit / autosave immédiate allergens-catégorie / recatégorisation / delete OK.
  - Toggle rupture sur la card n'ouvre PAS la modale (click-propagation guard).
- **Couvre** : #219 ; #211.

### M3bis — Validation prix (front + INVALID_PRICE backend)

- **Acteur** : KB Manager
- **Étapes** : modale édition item : essayer « -5 », « abc », « 12,505 », puis « 12,50 ».
- **Attendu** :
  - Messages inline : prix négatif / format invalide / max 2 décimales.
  - Aucune mutation `items.update` tant qu'invalide ; saisie valide → autosave.
- **Couvre** : #219.

### M4 — Upload photo (libération blob)

- **Acteur** : KB Manager
- **Pré-requis** : item sans photo
- **Étapes** :
  1. Modale item → « Téléverser » PNG/JPG.
  2. « Remplacer » → vérifier que l'ancien blob disparaît (Convex Storage).
  3. « Supprimer la photo » → placeholder revient, blob libéré.
  4. Re-uploader puis supprimer l'item → cascade blob libéré.
- **Attendu** :
  - Thumbnail modale + card synchronisés < 2 s.
  - Aucun blob orphelin dans Convex Storage.
- **Couvre** : #226.

### M5 — DnD reorder items (intra-catégorie)

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 1 catégorie avec ≥ 3 items
- **Étapes** : drag handle d'un item (`data-slot="menu-item-drag-handle"`) du milieu vers le haut, lâcher, F5.
- **Attendu** :
  - Optimistic UI immédiat ; persistance après F5 (`items.reorder`).
  - Le drag NE traverse PAS les catégories. Snapshot publication non impacté tant que pas de Publier.
- **Couvre** : #237.

### M6 — DnD reorder catégories

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 3 catégories
- **Étapes** : drag la 3e catégorie en position 1, lâcher, F5.
- **Attendu** :
  - Ordre persistant (`categories.reorder` complete-list mutation).
  - Items dans chaque catégorie conservent leur ordre interne.
- **Couvre** : #206.

### M7 — CRUD groupes Personnalisations (zone dédiée)

- **Acteur** : KB Manager
- **Pré-requis** : tenant sans groupe
- **Étapes** :
  1. Section « Personnalisations » (`data-slot="menu-modifier-groups-section"`), bouton « + Personnalisation ».
  2. « Sauce », min=1, max=1, options « Ketchup » (0€) + « Mayo » (0€). Créer.
  3. Cliquer la row pour éditer : renommer en « Sauces », ajouter option « BBQ » (+0,50€).
  4. Dans la modale d'édition, cliquer « Supprimer » (delete vit dans la modale, pas sur la row).
- **Attendu** :
  - CRUD complet, validation min ≤ max.
  - Empty state distinct du loading skeleton avant la 1ère création.
  - Suppression bloquée si attaché à des items, avec impact list affichée.
- **Couvre** : #242.

### M8 — Attach/detach groupes (cross-item + détach isolé)

- **Acteur** : KB Manager
- **Pré-requis** : groupe « Suppléments » (min=0, max=3) ; 2 items I1, I2
- **Étapes** :
  1. I1 → picker « Ajouter un groupe existant » → « Suppléments ».
  2. I2 → attacher « Suppléments ».
  3. I1 → « Détacher » sur la row « Suppléments ».
  4. Rouvrir I2.
- **Attendu** :
  - I2 conserve « Suppléments » (détach de I1 isolé).
  - « Suppléments » toujours présent dans la section standalone.
- **Couvre** : #246 (a)(b) ; #242.

### M8bis — Création inline d'un groupe depuis la modale item

- **Acteur** : KB Manager
- **Pré-requis** : I1 existe ; 0 groupe
- **Étapes** :
  1. Ouvrir I1 → section Personnalisations → « Créer un nouveau groupe ».
  2. Modale groupe par-dessus : « Sauce », min=1, max=1, Ketchup + Mayo. Créer.
- **Attendu** :
  - Modale groupe se ferme, modale I1 reste ouverte ; row « Sauce 1/1 · Ketchup, Mayo » + bouton « Détacher ».
  - Reload : « Sauce » toujours attaché à I1.
- **Couvre** : #246 (c) ; #242.

### M8ter — Idempotence attach

- **Acteur** : KB Manager
- **Pré-requis** : groupe G déjà attaché à I1
- **Étapes** : ouvrir I1 → picker « Ajouter un groupe existant ».
- **Attendu** : G N'APPARAÎT PAS dans le picker (filtre UI). Sécurité backend re-attach = no-op.
- **Couvre** : #246 (b).

### M9 — Publier + badge + Aperçu

- **Acteur** : KB Manager
- **Pré-requis** : tenant actif, ≥ 1 item au prix P0 publié au moins une fois
- **Étapes** :
  1. Modifier le prix vers P1 (modale), badge « modifications non publiées » apparaît.
  2. « Aperçu » : nouvel onglet `/menu/preview` au prix **P1**.
  3. PWA / `getPublicMenu` : prix **P0**.
  4. « Publier » : toast « Menu publié », badge disparaît, PWA reflète **P1**.
- **Attendu** :
  - Badge présent uniquement quand draft ≠ snapshot.
  - Aperçu = brouillon, getPublicMenu = snapshot.
- **Couvre** : #254.

### M9bis — Publish sur tenant fraîchement provisionné

- **Acteur** : KB Manager
- **Pré-requis** : tenant jamais publié, 0 catégorie
- **Étapes** :
  1. Créer catégorie « Plats » + item « Pizza » 12,00 €.
  2. Badge apparaît, cliquer « Publier ».
- **Attendu** :
  - Toast « Menu publié », badge disparaît, `getPublicMenu` retourne catégorie + item.
  - Aucune erreur « tenant doit être actif ».
- **Couvre** : #254.

### M9ter — Aperçu protégé par l'auth admin

- **Acteur** : KB Manager
- **Étapes** : copier `/t/[tenantId]/menu/preview`, l'ouvrir en incognito.
- **Attendu** :
  - Shell `(app)` redirige vers `/login`. Une fois loggé, preview accessible.
  - Preview JAMAIS publique.
- **Couvre** : #254.

---

## CMD — Commandes

### CMD1 — Page shell

- **Acteur** : KB Manager
- **Étapes** : sidebar → Commandes → `/t/<tenantId>/commandes`.
- **Attendu** : header « Commandes » + bouton CSV (désactivé si vide), table empty si pas de commandes.
- **Couvre** : #222.

### CMD2 — Table live Convex

- **Acteur** : KB Manager
- **Pré-requis** : tenant avec ≥ 1 commande
- **Étapes** : observer la table, déclencher une nouvelle commande backend.
- **Attendu** : table peuplée, nouvelle commande apparaît live sans refresh.
- **Couvre** : #227.

### CMD3 — Filtres date + statut

- **Acteur** : KB Manager
- **Pré-requis** : tenant avec ≥ 10 commandes étalées sur > 30 j, mix de statuts
- **Étapes** :
  1. `Aujourd'hui`, puis `7 jours`, puis pills statut `nouvelle` + `en préparation`.
  2. Pendant filtres actifs, faire passer une commande backend `en attente de paiement` → `nouvelle`.
- **Attendu** :
  - AND date + OR statuts. Re-render à chaque clic, sans fetch backend supplémentaire.
  - Nouvelle ligne apparaît instantanément (push Convex). Aucun query param URL.
- **Couvre** : #238 ; #227.

### CMD4 — Modal détail

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 1 commande payée (`pricingSnapshot` rempli, ≥ 2 events)
- **Étapes** :
  1. Cliquer une ligne → modal « Détail de la commande ».
  2. Vérifier sections : items (nom + qty + prix + modifiers) ; Pricing (sous-total / livraison / total €) ; Historique (events horodatés FR, ancien → récent) ; Meta (mode + source `direct`).
  3. Fermer, rouvrir.
- **Attendu** :
  - Pas de bouton « Rembourser » (cf. CMD5).
  - Si `restaurantNote` : « Note pour le restaurant ».
- **Couvre** : #239 ; #227.

### CMD4bis — Détail commande en attente de paiement

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 1 commande `en attente de paiement` (`pricingSnapshot` absent)
- **Étapes** : cliquer la ligne.
- **Attendu** :
  - Section « Pricing » ABSENTE (pas de tirets).
  - « Articles » + « Historique » + « Meta » restent.
- **Couvre** : #239 (branche `pricingSnapshot === undefined`).

### CMD4ter — Fermeture modal (Esc + backdrop)

- **Acteur** : KB Manager
- **Étapes** : Esc, rouvrir, clic backdrop.
- **Attendu** : focus revient, pas de portail orphelin.
- **Couvre** : #239.

### CMD5 — Refund

- **Acteur** : KB Manager
- **Pré-requis** : T1 a ≥ 1 commande payée 27,50 € ; Stripe sandbox + `stripeAccountId`
- **Étapes** :
  1. Modal détail → bouton « Rembourser 27,50 € » → AlertDialog + textarea « Raison (optionnelle) » (max 500).
  2. Saisir « test refund e2e », Confirmer.
- **Attendu** :
  - Toast « Commande remboursée », modal se ferme, ligne passe en `refusée` live.
  - PaymentIntent Stripe `refunded`. Notification client `refund_issued` queued.
- **Couvre** : #243 ; #221.

### CMD5bis — Staff ne voit pas le bouton refund

- **Acteur** : staff sur T1
- **Étapes** : ouvrir le modal d'une commande payée.
- **Attendu** : aucun bouton « Rembourser », seul « Fermer ».
- **Couvre** : #243 (RBAC mirror front).

### CMD5ter — Refund déjà effectué (CTA masqué)

- **Acteur** : KB Manager
- **Pré-requis** : commande déjà `refusée`
- **Étapes** : ouvrir le modal.
- **Attendu** : aucun bouton « Rembourser » ; historique montre la transition.
- **Couvre** : #243 (gate refundability).

### CMD6 — Export CSV filtré reflète l'état UI

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 10 commandes mixtes sur 30 j
- **Étapes** :
  1. Filtre date « 7 jours » + statuts « nouvelle » + « livrée ».
  2. « Exporter CSV », ouvrir dans Excel FR.
- **Attendu** :
  - Filename `commandes_<tenantSlug>_<YYYYMMDD>.csv`, séparateur `;`, UTF-8 BOM.
  - CSV reflète exactement les filtres UI.
  - AUCUNE colonne `email`, `phone`, `name`, `adresse`, `lat`, `lng`.
  - Colonnes : `id`, `date`, `statut`, `mode`, `source`, `sous_total_centimes`, `frais_livraison_centimes`, `total_centimes`, `paye_le`, `refuse_le`.
- **Couvre** : #244 ; #238.

### CMD6bis — Bouton CSV désactivé sans données

- **Acteur** : KB Manager
- **Pré-requis** : tenant fraîchement provisionné
- **Étapes** : `/t/<tenantId>/commandes`.
- **Attendu** :
  - Bouton « Exporter CSV » désactivé, aucun téléchargement au clic.
  - Table : « Aucune commande pour le moment. ».
- **Couvre** : #244.

---

## PR — Pricing

### PR1 — Liste règles + auto-priorité

- **Acteur** : KB Manager
- **Pré-requis** : tenant A avec ≥ 2 règles (1 active, 1 inactive, actions variées) ; tenant B vierge
- **Étapes** :
  1. Tenant A → sidebar « Pricing ».
  2. Vérifier bandeau « Quand plusieurs règles s'appliquent, KitchenBoost applique automatiquement celle qui est la plus avantageuse pour ton client. Pas d'ordre à gérer. ».
  3. Résumés FR + badges Active/Inactive (ligne inactive grisée).
  4. Switcher vers tenant B → état vide + « Aucune règle pour l'instant… (10 % par défaut s'applique). ».
- **Attendu** : bandeau auto-priorité sur les 2 tenants. Aucun drag-handle, aucun numéro de priorité visible.
- **Couvre** : #241.

### PR2 — Builder create

- **Acteur** : KB Manager
- **Étapes** :
  1. « + Nouvelle règle ». Modale « Créer une règle ».
  2. Conditions : `total_panier gte 25 EUR` + `premiere_commande true`. Action : `livraison_offerte_resto`. Créer.
- **Attendu** :
  - Modale ferme, règle apparaît avec résumé FR (live).
  - Validation : pas de save si conditions/action manquantes.
- **Couvre** : #245.

### PR3 — Builder edit

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 1 règle persistée (`panier >= 25 EUR + premiere commande → livraison offerte resto`)
- **Étapes** :
  1. « Éditer » → modale « Modifier la règle », champs préfillés.
  2. Modifier seuil 25 → 30 €, Enregistrer.
- **Attendu** : titre = « Modifier la règle ». Liste à jour live (« Panier ≥ 30 € »).
- **Couvre** : #248 ; #245 ; #241.

### PR3bis — Édition avec conditions contradictoires

- **Acteur** : KB Manager
- **Étapes** : ajouter `total_panier lte 10 EUR` à une règle `gte 25 EUR`, Enregistrer.
- **Attendu** :
  - Backend rejette `CONTRADICTORY_CONDITIONS`.
  - Message FR INLINE sous le bouton (pas de toast), modale reste OUVERTE.
  - Recorriger à `lte 50 EUR` → save passe.
- **Couvre** : #248 ; #245.

### PR4 — Toggle active (round-trip préserve la règle)

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 1 règle (conditions + action non triviales)
- **Étapes** :
  1. Toggle OFF, F5 → état persiste. Toggle ON.
  2. « Éditer » → modale pré-remplie EXACTEMENT comme avant.
- **Attendu** : toggle drive `setActive` (persistance F5). Définition intacte après désactiver/réactiver.
- **Couvre** : #249 ; #248.

### PR4bis — Toggle pricing cross-tenant safe

- **Acteur** : KB Manager rattaché à A uniquement, B existe
- **Étapes** :
  1. `/t/A/pricing` : toggle une règle.
  2. Tenter `/t/B/pricing` (substitution URL).
- **Attendu** :
  - A → toggle persiste.
  - B → `<TenantProvider/>` refuse (UnauthorizedCard A4a) ; aucune fuite, aucun flip côté B.
- **Couvre** : #249 ; ADR 0010 / withTenant.

### PR5 — Supprimer (confirmation 2 clics)

- **Acteur** : KB Manager
- **Pré-requis** : ≥ 2 règles actives
- **Étapes** :
  1. « Supprimer » sur la 1ère → dialog « Supprimer cette règle ? Cette action est irréversible. ».
  2. « Annuler » (règle reste). Re-cliquer « Supprimer » → bouton rouge « Supprimer ».
- **Attendu** :
  - Pas de toast (discipline V1).
  - Règle restante : toggle + Éditer/Supprimer OK. F5 : règle supprimée absente.
- **Couvre** : #251.

---

## SUP — Support

### SUP1 — Composant partagé

- **Acteur** : tout rôle
- **Étapes** : charger `/support` ou `/t/[id]/support`.
- **Attendu** :
  - Même composant `SupportPanel` rendu (config statique : CSM + 4 cards).
  - Pas de duplication HTML entre les 2 routes.
- **Couvre** : #210.

### SUP2 — Route supervision `/support`

- **Acteur** : KB Admin (root)
- **Étapes** : naviguer `/support`.
- **Attendu** :
  - Bandeau CSM : « Alex Michelet » + `mailto:` + `tel:` + « Lun–Ven, 9h–19h ».
  - 4 cards (FAQ, Guide démarrage, Vidéo tuto, Kit commercial), icône `ExternalLink` aria-hidden, liens `target="_blank"` + `rel="noopener noreferrer"`.
- **Couvre** : #232 ; #210.

### SUP3 — Route opérationnelle `/t/[tenantId]/support` (y compris tenant suspendu)

- **Acteur** : KB Manager sur T1 (actif) puis T2 (suspended)
- **Étapes** :
  1. `/t/T1/support` : bandeau + 4 cards. Cliquer « FAQ » → lien externe nouvel onglet.
  2. Logout, login manager T2 (suspendu), `/t/T2/support`.
- **Attendu** : T1 et T2 même contenu, aucune redirection, aucune erreur sur T2.
- **Couvre** : #235 ; #150.

### SUP3bis — Parité supervision / opérationnelle (zero duplication)

- **Acteur** : KB Admin
- **Étapes** : comparer visuellement `/support` (admin) vs `/t/T1/support`.
- **Attendu** : mêmes textes, mêmes 4 cards, même ordre, même grid 1col mobile / 2cols desktop.
- **Couvre** : #235 (AC3) ; #210.

---

## W — Wizard provisioning (10/10 steps)

### W1 — Skeleton + stepper

- **Acteur** : KB Admin
- **Pré-requis** : prospect en phase `preparation`
- **Étapes** : `/pipeline/<prospectId>/provision` → shell wizard.
- **Attendu** :
  - Stepper visible (Provisioning / Domaine / Stripe KYC / Branding / Menu / QR / Invitation / Activation).
  - Étapes marquées complete/current/pending via `useWizardState`.
- **Couvre** : #265.

### W2 — Launcher button

- **Acteur** : KB Admin
- **Étapes** : `/pipeline/<prospectId>`, cliquer le bouton (Lancer / Reprendre / Ouvrir la vue resto selon état).
- **Attendu** :
  - Visibilité conditionnée par Closing-completion + `tenant.status`.
  - Clic Lancer/Reprendre → ouvre `/pipeline/<prospectId>/provision`.
- **Couvre** : #266.

### W3 — Step 1 provisionTenant

- **Acteur** : KB Admin
- **Pré-requis** : prospect sans `tenantId`
- **Étapes** : step 1 : nom resto + slug suggéré, « Créer le tenant ».
- **Attendu** :
  - Tenant doc créé `status: pending`, back-link `tenantId` posé sur le prospect.
  - Step 1 complete, wizard avance vers step 2.
- **Couvre** : #267.

### W4 — Step 2 customDomain (débloqué par #358)

- **Acteur** : KB Admin
- **Pré-requis** : step 1 fait
- **Étapes** : step 2 « Domaine » : saisir `commande.monresto.fr`, vérification DNS, confirmer.
- **Attendu** :
  - `setCustomDomain` (#358) appelé, DNS check OK, step 2 complete.
  - URL publique tenant utilise le customDomain.
- **Couvre** : #268 (débloqué) ; #358.

### W5 — Step 3 Stripe Connect KYC

- **Acteur** : KB Admin
- **Pré-requis** : tenant sans `stripeAccountId`
- **Étapes** :
  1. Step 3, « Générer le lien Stripe Connect », Copier, envoyer manuellement au gérant.
  2. Gérant complète KYC. « Régénérer le lien » disponible si besoin.
- **Attendu** : lien Connect valide ; step 3 complete quand `stripeAccountId` + KYC validé (webhook Stripe).
- **Couvre** : #269.

### W6 — Step 4 Branding (bout-en-bout)

- **Acteur** : KB Admin
- **Pré-requis** : step 1 fait. Image PNG/JPG ~200 Ko
- **Étapes** :
  1. Step 4, Identité visuelle : logo + couleur `#E5A100`, Enregistrer (toast).
  2. Coordonnées : adresse + téléphone `06 12 34 56 78`, Enregistrer (toast).
  3. Modes : désactiver Click & Collect (livraison locked avec « Au moins un mode doit rester actif. »), Enregistrer (toast).
  4. « Suivant » → step 5. Revenir step 4 : valeurs pré-remplies.
- **Attendu** :
  - 3 toasts success.
  - Stepper marque step 4 `complete` après `branding.logoUrl` + `branding.primaryColor` posés.
  - Tenant doc porte `branding`, `address`, `phone`, `acceptedModes`.
- **Couvre** : #270 ; #229 ; #231 ; #234 ; #168.

### W6bis — Step 4 INVALID_HEX_COLOR backend

- **Acteur** : KB Admin
- **Étapes** : step 4 : bypass UI (`document.querySelector('[data-slot=parametres-branding-color-input]').value = '#XYZ'` + dispatch `change`). Enregistrer.
- **Attendu** :
  - Toast erreur « Impossible d'enregistrer l'identité visuelle » + description `INVALID_HEX_COLOR ...`.
  - Erreur inline `parametres-branding-submit-error`. Aucune écriture DB.
- **Couvre** : #270 ; #228.

### W7 — Step 5 Menu (publication requise → gate Step 6)

- **Acteur** : KB Admin
- **Pré-requis** : tenant provisionné, aucune publication antérieure
- **Étapes** :
  1. Step 5 (Menu) : badge « Brouillon non publié », « Continuer » désactivé + texte d'aide.
  2. Créer une catégorie, badge reste « Brouillon non publié », Continuer désactivé.
  3. « Publier » → toast « Menu publié ».
  4. Badge passe à « Publié — [date dd/MM/yyyy HH:mm] », « Continuer » actif.
  5. « Continuer » → Step 6.
- **Attendu** :
  - `getPublicMenu({ tenantId })` retourne `{ categories: [...] }` non vide.
  - Aucune navigation vers Step 6 tant que `lastPublishedAt === null`.
- **Couvre** : #271 ; #176 ; #155 ; #160 ; ADR 0015.

### W8 — Step 6 QR sticker PDF

- **Acteur** : KB Admin
- **Pré-requis** : step 5 complete
- **Étapes** :
  1. Step 6 « QR sticker » : preview + sélecteur 3 formats (Sticker rond 50 mm / Carte A6 / Affiche A4).
  2. Cliquer « Télécharger PDF » pour chaque format.
- **Attendu** :
  - Preview QR vers PWA URL. 3 PDF distincts téléchargés `qr-<slug>-<format>.pdf`.
  - Step 6 complete après premier téléchargement (ou nav suivante).
- **Couvre** : #272.

### W9 — Step 7 Invitation gérant

Voir AC2 et AC2bis (couverture identique : #273 + B-AUTH-4/5/6).

### W10 — Step 8 Activation

- **Acteur** : KB Admin
- **Pré-requis** : steps 1-7 complets (ou au moins les bloquants)
- **Étapes** :
  1. Step 8 « Activation » : récap 6 blocs (Tenant / Domaine / Stripe KYC / Branding / Menu / QR + Invitation).
  2. « Activer le restaurant » → dialog 2 étapes : confirmer le slug définitif, puis « Activer ».
- **Attendu** :
  - Tenant `status: active`. Phase prospect `operationnel`.
  - Wizard se ferme / écran de confirmation. Audit event `tenant.activated`.
- **Couvre** : #274.

---

## ⚠️ PRs sans tests E2E proposés

Les 16 PRs suivantes n'ont pas inclus de section « Tests E2E proposés » exploitable dans leur body. Justification rappelée quand explicite ; sinon, marquer comme dette à combler si le parcours n'est pas couvert par une E2E voisine ci-dessus.

| PR   | Ticket  | Domaine                      | Justification / note                                                                                                                                                                                                                                                                                            |
| ---- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #317 | #210    | F-SUPPORT                    | _Justifié_ : composant 100 % statique, sans fetch ni Convex. Premier E2E pertinent = #232 (route /support).                                                                                                                                                                                                     |
| #319 | _(n/a)_ | _empty_                      | Body vide (`@-`). À vérifier.                                                                                                                                                                                                                                                                                   |
| #320 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                                                                                                                                                                                                      |
| #322 | #221    | F-COMMANDES (backend)        | Backend slice ; couvert end-to-end par l'E2E refund de #243.                                                                                                                                                                                                                                                    |
| #323 | #222    | F-COMMANDES                  | _Justifié_ : scaffold placeholder, parcours significatif arrive en #227/#238/#239.                                                                                                                                                                                                                              |
| #325 | #224    | B-MENU-PUBLICATION (backend) | _Justifié_ : invariants backend purs, couverts par 1211 tests convex-test.                                                                                                                                                                                                                                      |
| #327 | #227    | F-COMMANDES                  | Pas de section E2E (slice 2 — liste live). Parcours couvert par les E2E de #238 / #239.                                                                                                                                                                                                                         |
| #329 | #230    | B-AUTH                       | Pas de section E2E. Couvert end-to-end par l'E2E Step 7 wizard (#273).                                                                                                                                                                                                                                          |
| #332 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                                                                                                                                                                                                      |
| #335 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                                                                                                                                                                                                      |
| #336 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                                                                                                                                                                                                      |
| #340 | #242    | F-MENU                       | Pas de section E2E (CRUD groupes Personnalisations standalone). Parcours couvert par les E2E de #246.                                                                                                                                                                                                           |
| #343 | #245    | F-PRICING                    | Pas de section E2E (CREATE de règle). Parcours couvert indirectement par les E2E d'édition #248. À compléter pour le chemin CREATE pur.                                                                                                                                                                         |
| #359 | #158    | F-CONTRATS (slice 1)         | Body PR réduit à `@-` (artefact d'édition post-merge). Parcours « bloc Contrats lecture seule » couvert indirectement par T6 (E2E #174 qui exerce le bloc slice 1 visible).                                                                                                                                     |
| #360 | #163    | B-ONBOARDING-MILESTONES (s1) | _Justifié_ : pure addition de seam backend (`prospectsStore`), aucun appel front, aucune Convex function exposée. Parcours porté par les slices 2/3 (#172, futures).                                                                                                                                            |
| #362 | #172    | B-ONBOARDING-MILESTONES (s2) | _Justifié_ : refacto interne backend (helper privé `maybeAutoBascule`), shape de retour `applyClosing` strictement inchangé, helper hors barrel. Aucune surface modifiée.                                                                                                                                       |
| #365 | #185    | F-CONTRATS (slice 4)         | Body PR réduit à `@-` (artefact d'édition post-merge). Parcours « relecture contrat existant » couvert par T3/T4 (iframe sandboxée + téléchargement HTML) ; clic ligne → iframe vérifié manuellement via T3.                                                                                                    |
| #367 | #189    | B-ONBOARDING-MILESTONES (s3) | Body PR réduit à `@-` (artefact d'édition post-merge). Mutation `setMilestone` granulaire + auto-Closing : invariants backend purs couverts par les tests convex-test du module ; aucune surface front directe (consommée par slices ultérieures).                                                              |
| #374 | #220    | F-PIPELINE-CRM (s4)          | _Justifié_ : module pur `reduceIntegrationStatus` (TypeScript générique sans UI / sans Convex / sans React). Couvert exhaustivement par 5 tests Vitest unitaires. Le flux end-to-end "KB Admin flippe Stripe Connect status → history persistée" relève des stories UI sœurs de l'épique F-PIPELINE-CRM (#144). |
| #375 | #225    | B-ONBOARDING-MILESTONES (s5) | _Justifié_ : refactor barrel `lib/onboarding/index.ts` + JSDoc deprecation sur `editProspect.patch.milestones`. Zéro changement de comportement runtime. Les parcours `setMilestone` / `recordIntegrationStatus` sont déjà couverts par les E2E des slices 3/4 (#189 / #213).                                   |
| #378 | #247    | F-CAMPAGNES (s7 polish)      | _Justifié_ : polish visuel sans nouveau parcours (palette KB, responsive, garde-fous ADR 0006 / ADR 0010 MOAT, FR-only) verrouillés par 21 tests d'audit source-code + 2 tests runtime pour l'accent jaune/or `data-warning` sur la carte rate-limit. Parcours fonctionnels déjà couverts par MC5→MC19.         |
