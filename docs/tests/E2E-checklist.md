# E2E manual checklist — KitchenBoost admin (V1)

Checklist E2E manuelle, nomenclature canonique (A / MC / QR / MO / T / P / AC / M / CMD / PR / SUP / W). Chaque parcours est à exécuter à la main contre `apps/admin` en dev (Convex live + seeds e2e).

- **Date** : 2026-05-31
- **Statut global** : 41 stories mergées (#317→#358), 0 bloquée. Wizard complet à 10/10.
- **Pré-requis transverses** : seeds `e2e` chargées (≥ 2 tenants distincts, un KB Admin root, ≥ 1 KB Manager mono-tenant, ≥ 1 KB Manager multi-tenant, un staff). Stripe en mode test avec un `stripeAccountId` rattaché à au moins un tenant. Resend en mode test pour les magic-links et OTP.
- **Convention** : les parcours référencent ces pré-requis par leur étiquette (« seeds e2e ») sans les reproduire. Format strict : **Acteur / Pré-requis / Étapes / Attendu / Couvre**.

---

## A — Auth & shell

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

---

## QR — QR PDF

### QR1 — Download PDF nominal (3 formats)
- **Acteur** : KB Manager
- **Pré-requis** : tenant actif avec slug
- **Étapes** :
  1. `/t/<tenantId>/qr`, vérifier la preview iframe (format par défaut « Sticker rond 50 mm (planche A4) »).
  2. Switcher vers « Carte A6 » puis « Affiche A4 », observer la régénération de la preview.
  3. Cliquer « Télécharger PDF » pour chaque format.
- **Attendu** :
  - 3 PDF téléchargés, filename `qr-<slug>-<format>.pdf`.
  - QR pointe vers la PWA URL (`<slug>.kitchen-boost.fr` ou `customDomain` si défini).
  - Sur A6 / A4 : logo + couleur primaire si branding renseigné.
- **Couvre** : #182 ; #198.

### QR2 — Regen sur customDomain
- **Acteur** : KB Manager
- **Pré-requis** : tenant avec `customDomain` configuré via #358
- **Étapes** : configurer customDomain (Paramètres → Domaine), revenir sur `/t/<tenantId>/qr`.
- **Attendu** :
  - Preview régénérée automatiquement (`useEffect` dépend de `pwaUrl`).
  - Nouveau PDF pointe sur le customDomain, pas sur `<slug>.kitchen-boost.fr`.
- **Couvre** : #358 ; QR auto-regen.

---

## MO — Monitoring

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

---

## P — Paramètres

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

Les 13 PRs suivantes n'ont pas inclus de section « Tests E2E proposés » exploitable dans leur body. Justification rappelée quand explicite ; sinon, marquer comme dette à combler si le parcours n'est pas couvert par une E2E voisine ci-dessus.

| PR   | Ticket  | Domaine                      | Justification / note                                                                                                                    |
| ---- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| #317 | #210    | F-SUPPORT                    | _Justifié_ : composant 100 % statique, sans fetch ni Convex. Premier E2E pertinent = #232 (route /support).                             |
| #319 | _(n/a)_ | _empty_                      | Body vide (`@-`). À vérifier.                                                                                                           |
| #320 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                              |
| #322 | #221    | F-COMMANDES (backend)        | Backend slice ; couvert end-to-end par l'E2E refund de #243.                                                                            |
| #323 | #222    | F-COMMANDES                  | _Justifié_ : scaffold placeholder, parcours significatif arrive en #227/#238/#239.                                                      |
| #325 | #224    | B-MENU-PUBLICATION (backend) | _Justifié_ : invariants backend purs, couverts par 1211 tests convex-test.                                                              |
| #327 | #227    | F-COMMANDES                  | Pas de section E2E (slice 2 — liste live). Parcours couvert par les E2E de #238 / #239.                                                 |
| #329 | #230    | B-AUTH                       | Pas de section E2E. Couvert end-to-end par l'E2E Step 7 wizard (#273).                                                                  |
| #332 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                              |
| #335 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                              |
| #336 | _(n/a)_ | _empty_                      | Body vide.                                                                                                                              |
| #340 | #242    | F-MENU                       | Pas de section E2E (CRUD groupes Personnalisations standalone). Parcours couvert par les E2E de #246.                                   |
| #343 | #245    | F-PRICING                    | Pas de section E2E (CREATE de règle). Parcours couvert indirectement par les E2E d'édition #248. À compléter pour le chemin CREATE pur. |
| #359 | #158    | F-CONTRATS (slice 1)         | Body PR réduit à `@-` (artefact d'édition post-merge). Parcours « bloc Contrats lecture seule » couvert indirectement par T6 (E2E #174 qui exerce le bloc slice 1 visible).                                |
| #360 | #163    | B-ONBOARDING-MILESTONES (s1) | _Justifié_ : pure addition de seam backend (`prospectsStore`), aucun appel front, aucune Convex function exposée. Parcours porté par les slices 2/3 (#172, futures).        |
| #362 | #172    | B-ONBOARDING-MILESTONES (s2) | _Justifié_ : refacto interne backend (helper privé `maybeAutoBascule`), shape de retour `applyClosing` strictement inchangé, helper hors barrel. Aucune surface modifiée.        |
