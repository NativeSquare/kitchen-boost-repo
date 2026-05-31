# E2E manual checklist — KitchenBoost admin (V1)

Checklist E2E manuelle restructurée selon la nomenclature canonique (groupes A / MC / QR / MO / T / P / AC / M / CMD / PR / SUP / W). Chaque test est un parcours utilisateur à exécuter à la main contre `apps/admin` en dev (Convex live + seeds e2e). Les tests marqués `[à valider]` n'ont pas été dérivés d'une PR du drain et doivent être confrontés au code réel avant exécution.

- **Date** : 2026-05-31
- **Statut global** : 41 stories mergées (#317→#358), 0 bloquée. Wizard complet à 10/10.
- **Pré-requis transverses** : seeds `e2e` chargées (≥ 2 tenants distincts, un compte KB Admin root, ≥ 1 KB Manager mono-tenant, ≥ 1 KB Manager multi-tenant, un compte staff). Stripe en mode test avec un `stripeAccountId` rattaché à au moins un tenant. Resend en mode test pour les magic-links.

---

## A — Auth & shell

### A1 — Login OTP nominal [à valider]

**Acteur** : KB Manager
**Pré-requis** : compte manager existant, boîte mail accessible (Resend test).
**Étapes** :

1. Aller sur `/login`, saisir l'email du manager, cliquer « Recevoir le code ».
2. Récupérer le code OTP depuis l'inbox (ou Resend dashboard).
3. Saisir le code, valider.

**Attendu observable** :

- Redirection vers `/` puis `/t/<firstTenant>/menu`.
- Cookie de session posé.
- Header montre l'email du manager.

**Couvre** : foundation auth OTP.

### A2 — KB Manager multi-tenants : la dernière resto ouverte est restaurée à l'entrée

**Acteur** : KB Manager multi-tenants (ex. Walid : `lartisan` + `tablelibanaise`)
**Pré-requis** : compte manager multi-tenants provisionné ; navigateur frais (cookies vidés).
**Étapes** :

1. Se connecter sur `/login` → arrive sur `/` (root-entry redirect).
2. Observer que la redirection va sur `/t/<tenants[0]>/menu` (premier tenant de la liste session) — pas de cookie encore.
3. Cliquer dans le tenant-switcher du header, basculer sur le 2e tenant. La navigation va sur `/t/<tenants[1]>/menu` ; le layout `/t/[id]` écrit le cookie `kb_current_tenant=<tenants[1]>`.
4. Fermer l'onglet ; rouvrir le navigateur ; aller directement sur la racine.
5. Observer que la redirection va sur `/t/<tenants[1]>/menu` (le cookie hint a été honoré).

**Attendu observable** :

- URL finale = `/t/<tenants[1]>/menu` (le dernier resto ouvert).
- L'item actif dans la sidebar = « Menu » sur le bon resto.
- Aucun flash de contenu vide entre le `/` et la destination (spinner pendant la redirection).

**Couvre** : #223 (cookie hint multi-tenant)

### A3 — KB Manager sans tenant rattaché [à valider]

**Acteur** : KB Manager dont toutes les rattaches `userTenants` ont été révoquées.
**Pré-requis** : compte authentifié sans aucun tenant accessible.
**Étapes** :

1. Login → arrive sur `/`.
2. Observer l'écran de fallback.

**Attendu observable** :

- Écran « Aucun restaurant rattaché » (ou équivalent), pas de spinner infini.
- Lien support visible pour contacter KitchenBoost.
- Aucun redirect en boucle.

**Couvre** : root-entry fallback no-tenant.

### A4a — KB Manager hors-tenant (UnauthorizedCard) [à valider]

**Acteur** : KB Manager rattaché à `T1` uniquement.
**Pré-requis** : tente d'accéder à `T2` via substitution URL.
**Étapes** :

1. Login manager T1, copier l'URL `/t/T2/menu` et naviguer manuellement.
2. Observer le rendu.

**Attendu observable** :

- `UnauthorizedCard` (« Accès refusé » + CTA retour) — PAS une raw error Convex.
- Pas de fuite des données de T2 (titre, items, etc.).

**Couvre** : withTenant guard + UnauthorizedCard fallback.

### A4b — KB Manager qui hit /monitoring (UnauthorizedCard, pas raw error) [à valider]

**Acteur** : KB Manager (non admin).
**Pré-requis** : session manager active.
**Étapes** :

1. Naviguer manuellement vers `/monitoring`.

**Attendu observable** :

- `UnauthorizedCard` rendue proprement (pas un crash ni `FORBIDDEN` brut).
- Sidebar ne propose pas « Supervision ».

**Couvre** : admin-only route guard + UnauthorizedCard fallback.

### A5 — /accept-invite avec token vide [à valider]

**Acteur** : visiteur cliquant sur un lien magic invalide.
**Pré-requis** : navigateur sans session.
**Étapes** :

1. Ouvrir `/accept-invite` (sans paramètre `token`).
2. Observer le rendu.

**Attendu observable** :

- Message « Lien d'invitation invalide ou expiré ».
- Pas de tentative d'appel `acceptInvite` côté serveur.
- CTA pour retourner sur `/login`.

**Couvre** : invite token validation fallback.

---

## MC — Mes clients

### MC1 — Open « Mes clients » + audit event `customer.kpi.consult` [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant `T1` avec ≥ 5 commandes payées sur les 90 derniers jours.
**Étapes** :

1. Login manager T1, ouvrir la sidebar et cliquer « Mes clients » → `/t/T1/clients`.
2. Vérifier que la page charge sans error boundary.
3. Côté Convex dashboard → events, vérifier qu'un event `customer.kpi.consult` a été inséré avec `tenantId=T1` + `userId` correct.

**Attendu observable** :

- Page rend les cards KPI.
- Event d'audit présent côté backend.

**Couvre** : Mes clients route + audit log.

### MC2 — Cards segments (actif/inactif/vip) [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant avec un mix de clients (actifs 30j / inactifs / VIP > 3 commandes).
**Étapes** :

1. `/t/<tenantId>/clients`.
2. Observer les 3 cards segments.

**Attendu observable** :

- Card « Clients actifs » avec compteur > 0.
- Card « Clients inactifs » avec compteur cohérent.
- Card « Clients VIP » avec critère affiché (ex. ≥ 3 commandes / 90j).

**Couvre** : segments KPI cards.

### MC3 — Cards reachability + macro [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant avec ≥ 1 client ayant email + ≥ 1 client ayant téléphone vérifié.
**Étapes** :

1. `/t/<tenantId>/clients`.
2. Observer les cards reachability (email / SMS) et la card macro globale.

**Attendu observable** :

- Card « Joignables par email » avec compteur + % du total.
- Card « Joignables par SMS » idem.
- Card macro (total clients, panier moyen, fréquence) cohérente.

**Couvre** : reachability + macro KPIs.

### MC4 — Anti-PII guard (aucun email/tel visible) [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant avec ≥ 10 clients identifiés (email + tel renseignés).
**Étapes** :

1. `/t/<tenantId>/clients`, parcourir TOUTES les cards et sections.
2. Ouvrir le DOM via DevTools, chercher (Ctrl+F) un email connu et un numéro de tel connu de la seed.

**Attendu observable** :

- Aucun email visible à l'écran.
- Aucun numéro de téléphone visible.
- Uniquement agrégats / compteurs / pourcentages.

**Couvre** : anti-PII discipline V1.

---

## QR — QR PDF

### QR1 — Download PDF nominal [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant actif, slug `lartisan` (URL publique = `https://lartisan.kitchen-boost.fr`).
**Étapes** :

1. Naviguer vers `/t/<tenantId>/qr` (ou section QR depuis Paramètres).
2. Cliquer « Télécharger le sticker PDF ».

**Attendu observable** :

- Fichier `qr_<tenantSlug>.pdf` téléchargé.
- PDF contient le QR code pointant vers l'URL publique du tenant.
- Branding (logo + couleur primaire) visible.

**Couvre** : QR sticker PDF generation.

### QR2 — Regen sur customDomain

**Acteur** : KB Manager
**Pré-requis** : tenant avec `customDomain` configuré (ex. `commande.monresto.fr`) via #358.
**Étapes** :

1. Configurer le customDomain depuis Paramètres → Domaine.
2. Régénérer le QR depuis la section QR.

**Attendu observable** :

- Le nouveau PDF pointe sur le customDomain (pas le slug `*.kitchen-boost.fr`).
- L'ancien PDF (si caché) est invalidé.

**Couvre** : #358 (customDomain backend) ; QR regen sur changement de domaine.

---

## MO — Monitoring

### MO1 — KB Admin voit les 3 kinds (webhook_latency / kyc_pending / paid_no_course) [à valider]

**Acteur** : KB Admin
**Pré-requis** : seeds avec au moins 1 alerte de chaque kind active.
**Étapes** :

1. Login KB Admin, sidebar « Supervision » → `/monitoring`.
2. Observer la table.

**Attendu observable** :

- 3 lignes (au moins) avec kind = `webhook_latency`, `kyc_pending`, `paid_no_course`.
- Chaque ligne montre : tenant, kind, severity, timestamp.

**Couvre** : monitoring dashboard core.

### MO2 — Filtres type/tenant/severity [à valider]

**Acteur** : KB Admin
**Pré-requis** : ≥ 10 alertes mixtes sur ≥ 2 tenants.
**Étapes** :

1. `/monitoring`, sélectionner type=`kyc_pending` → table filtrée.
2. Ajouter filtre tenant=`T1` → restriction supplémentaire.
3. Ajouter severity=`high` → restriction finale.
4. Reset filtres → table complète.

**Attendu observable** :

- Combinaison AND des filtres.
- Aucune requête backend supplémentaire (filtrage UI sur live query).

**Couvre** : monitoring filters.

### MO3 — Drill-down panel [à valider]

**Acteur** : KB Admin
**Pré-requis** : ≥ 1 alerte avec contexte JSON renseigné.
**Étapes** :

1. Cliquer une ligne d'alerte.
2. Panel latéral s'ouvre.

**Attendu observable** :

- Détail : timestamp ISO, payload JSON pretty-print, lien vers le tenant `/t/<id>`.
- Fermeture via Esc ou bouton.

**Couvre** : monitoring drill-down.

### MO4 — Manager refusé (UnauthorizedCard, pas FORBIDDEN raw) [à valider]

**Acteur** : KB Manager
**Pré-requis** : session manager active.
**Étapes** :

1. Naviguer manuellement vers `/monitoring`.

**Attendu observable** :

- `UnauthorizedCard` (« Réservé à l'équipe KitchenBoost »).
- Pas d'erreur Convex `FORBIDDEN` brute affichée.

**Couvre** : monitoring admin-only guard + UnauthorizedCard.

---

## T — Tenants

### T1 — Tenant switcher (manager voit ses restos + supervision pinned pour admin, switch met cookie)

**Acteur** : KB Admin (avec ≥ 2 tenants attachés) + KB Manager multi-tenants
**Pré-requis** : seeds avec admin multi-tenants + manager multi-tenants.
**Étapes** :

1. Login KB Admin, ouvrir le tenant switcher dans le header.
2. Vérifier la liste : « Supervision » en haut (pinned), puis tenants attachés.
3. Cliquer un tenant → URL `/t/<id>/menu`, cookie `kb_current_tenant=<id>` écrit.
4. Logout, login KB Manager multi-tenants.
5. Ouvrir le switcher → vérifier UNIQUEMENT les tenants accessibles (pas « Supervision »).
6. Switcher entre 2 tenants → cookie réécrit à chaque switch.

**Attendu observable** :

- Admin : supervision pinned en premier.
- Manager : pas de supervision, juste ses tenants.
- Cookie mis à jour à chaque switch (vérifiable via DevTools → Application → Cookies).

**Couvre** : #223 (cookie hint) ; tenant switcher RBAC.

### T1bis — Cookie stale : manager qui a perdu un resto retombe proprement sur le premier tenant

**Acteur** : KB Manager dont la rattache à un tenant a été révoquée.
**Pré-requis** : le compte a un cookie `kb_current_tenant=<tenant qu'il ne possède plus>` (résidu d'une session précédente). Le compte garde A et B accessibles.
**Étapes** :

1. (Setup BO) Retirer la rattache `userTenants` du tenant Z pour ce manager.
2. Le manager va sur `/`.

**Attendu observable** :

- Redirection vers `/t/<A>/menu` (premier tenant accessible).
- Pas d'écran « accès refusé ».
- Au prochain switch vers B, le cookie est réécrit (`kb_current_tenant=B`).

**Couvre** : #223 (branche cookie stale)

---

## P — Paramètres

### P1 — Identité visuelle (logo + color)

**Acteur** : KB Manager
**Pré-requis** : KB Manager loggué sur `/t/[tenantId]/parametres` ; tenant sans branding préalable.
**Étapes** :

1. Ouvrir la page Paramètres, section « Identité visuelle ».
2. Cliquer sur le placeholder de logo, sélectionner un PNG (~200 Ko). Vérifier la prévisualisation immédiate (avant save).
3. Choisir une couleur (`#E5A100`). Swatch reflète la couleur en LIVE.
4. Cliquer « Enregistrer ».
5. Recharger la page (F5).

**Attendu observable** :

- Toast vert « Identité visuelle enregistrée. ».
- Après reload : logo + nouvelle couleur visibles.
- Aucun toast d'erreur, aucune console error.

**Couvre** : #229 ; #168 (B-TENANT-LIFECYCLE, `tenant.updateSettings` exercée avec wrapper + audit log)

### P2 — Coordonnées

**Acteur** : KB Manager
**Pré-requis** : tenant actif, user kb_manager rattaché, loggué dans `/t/[tenantId]`.
**Étapes** :

1. `/t/<tenantId>/parametres`.
2. Section Coordonnées : adresse « 12 rue Neuve, 75002 Paris ».
3. Téléphone `06 12 34 56 78`.
4. Enregistrer.
5. Modifier UNIQUEMENT le téléphone (`07 88 99 00 11`), Enregistrer.

**Attendu observable** :

- Toast « Coordonnées enregistrées » après chaque save.
- Aucune erreur inline.
- Au 2e save, le patch envoyé ne contient QUE `phone` (diff-only, observable via Convex dashboard).

**Couvre** : #231

### P2bis — Validation téléphone FR + bouton désactivé

**Acteur** : KB Manager
**Pré-requis** : idem P2.
**Étapes** :

1. Section Coordonnées.
2. Saisir un téléphone invalide : `abcd` ou `0812345678` (08 = numéro spécial).
3. Observer le bouton Enregistrer.
4. Corriger en `06 12 34 56 78`, Enregistrer.

**Attendu observable** :

- Message inline rouge sous l'input.
- Bouton Enregistrer désactivé.
- Après correction, erreur disparaît, bouton réactivé, save passe avec toast succès.

**Couvre** : #231

### P2ter — Save isolé entre sections (régression #229)

**Acteur** : KB Manager
**Pré-requis** : idem.
**Étapes** :

1. Aller dans Paramètres.
2. Section Identité visuelle : commencer à modifier la couleur (NE PAS Enregistrer).
3. Section Coordonnées : nouvelle adresse + téléphone valide, Enregistrer.
4. Vérifier section Identité visuelle.

**Attendu observable** :

- Toast « Coordonnées enregistrées ».
- La couleur en cours de modification dans Identité visuelle est PRÉSERVÉE (`useForm` isolés).

**Couvre** : #231 + régression #229

### P3 — Modes acceptés

**Acteur** : KB Manager (gérant resto, connecté sur son tenant)
**Pré-requis** : Tenant `active` avec `acceptedModes = { delivery: true, clickAndCollect: true }`.
**Étapes** :

1. `/t/<tenantId>/parametres`.
2. Section « Modes acceptés » : désactiver le toggle « Click & Collect ».
3. Enregistrer → toast « Modes acceptés enregistrés. ».
4. Tenter de désactiver le toggle « Livraison » (seul restant actif).

**Attendu observable** :

- Toggle « Livraison » visuellement désactivé (curseur not-allowed) — clic sans effet.
- Message inline « Au moins un mode doit rester actif. ».
- Réactiver « Click & Collect » fait disparaître le message ET débloque Livraison.
- Reload : état persisté `{ delivery: true, clickAndCollect: false }` correctement lu.

**Couvre** : #234 ; #168 (backend D5 élargi)

### P4 — Horaires serviceHours

**Acteur** : KB Manager
**Pré-requis** : tenant actif sans horaires configurés.
**Étapes** :

1. `/t/<tenantId>/parametres`, section « Horaires de service ».
2. Configurer Lundi : 11h30–14h30, 18h30–22h30 (double créneau).
3. Configurer Dimanche : fermé.
4. Enregistrer.
5. Recharger.

**Attendu observable** :

- Toast « Horaires enregistrés ».
- Reload : horaires persistés correctement.
- Validation : pas de chevauchement, fin > début.

**Couvre** : #236

### P5 — Uber Direct read-only (info only)

**Acteur** : KB Manager
**Pré-requis** : tenant sans intégration Uber Direct active.
**Étapes** :

1. `/t/<tenantId>/parametres`, section « Uber Direct ».
2. Observer le rendu.

**Attendu observable** :

- Skeleton informationnel : description du service + statut « Non configuré » ou « À venir ».
- Pas de bouton actif (V1 read-only).
- Aucune erreur.

**Couvre** : #193 (skeleton Uber Direct)

---

## AC — Auth core

### AC1 — Invite admin (acceptInvite admin path) [à valider]

**Acteur** : KB Admin existant + futur KB Admin invité
**Pré-requis** : KB Admin loggué peut inviter un autre admin.
**Étapes** :

1. Login KB Admin, naviguer vers `/admin/team` (ou équivalent), cliquer « Inviter un admin ».
2. Saisir email du nouvel admin, envoyer.
3. Récupérer le magic-link Resend, l'ouvrir en incognito.
4. Compléter le `acceptInvite` (création de compte).

**Attendu observable** :

- Nouvelle row `userTenants` rôle `kb_admin` créée.
- Le nouvel admin atterrit sur `/monitoring` après login.
- Audit event `admin.invite.accept`.

**Couvre** : acceptInvite admin path.

### AC2 — Invite manager via wizard step 7

**Acteur** : KB Admin (envoi) + gérant invité (acceptation)
**Pré-requis** : prospect en phase `preparation`/`installation`/`operationnel` AVEC `tenantId` (step 1 fait) ; aucune ligne `managerInvites` n'existe encore pour ce tenant.
**Étapes** :

1. `/pipeline/<prospectId>/provision`, ouvrir le wizard, cliquer step 7 « Invitation ».
2. Vérifier que l'email gérant est pré-rempli (== `prospect.email`), READ-ONLY.
3. Cliquer « Envoyer l'invitation » sans toucher au nom.
4. Vérifier qu'une `managerInvites` row apparaît côté backend (Convex dashboard).
5. Badge « Invitation envoyée le DD/MM/YYYY à HH:MM » apparaît, warning « Sans invitation… » disparaît, bouton flippe sur « Renvoyer l'invitation ».
6. Le gérant reçoit l'email (Resend) — cliquer le lien magic, créer son compte → `userTenants` row `kb_manager` créé.
7. Revenir sur le wizard : step 7 dans le stepper coché (✓ complete).
8. Cliquer « Renvoyer l'invitation » → échec `ALREADY_INVITED` → toast erreur + message inline.

**Attendu observable** :

- Badge timestamp dans la timezone navigateur, format `DD/MM/YYYY à HH:MM`.
- Hook `useWizardState` flippe step 7 sur « complete » via la query `getLatestManagerInviteForTenant`.
- Email Resend avec `tenantName` snapshot.
- Bouton « Continuer » reste actif tout du long (step non-bloquant).

**Couvre** : #273 ; B-AUTH-4 (#204) ; B-AUTH-5 (#212) ; B-AUTH-6 (#230) ; useWizardState gate (#265)

### AC2bis — Step 7 non-bloquant : continuer vers step 8 sans envoyer + relance après expiration

**Acteur** : KB Admin
**Pré-requis** : prospect provisionné, step 1 fait ; aucune invite gérant envoyée.
**Étapes** :

1. Step 7, sans cliquer « Envoyer », vérifier warning « Sans invitation, le gérant ne pourra pas se connecter ».
2. Cliquer « Continuer » → navigue vers step 8.
3. Revenir manuellement sur step 7, envoyer l'invitation. Attendre expiration (ou patcher `expiresAt` à `Date.now() - 1` en DB).
4. Cliquer « Renvoyer l'invitation » → relance succède (backend supprime l'expirée + crée une fresh), badge timestamp à l'heure courante.

**Attendu observable** :

- Bouton « Continuer » jamais désactivé.
- Relance d'invite expirée : nouvelle row remplace l'ancienne (vérifiable en DB).
- Badge affiche le NOUVEAU timestamp.

**Couvre** : #273 ; B-AUTH-4 relance (#204)

---

## M — Menu

### M1 — Catégories CRUD [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant fraîchement provisionné, 0 catégorie.
**Étapes** :

1. `/t/<tenantId>/menu`, cliquer « + Catégorie ».
2. Saisir « Entrées », valider.
3. Renommer en « Mes Entrées » via inline edit.
4. Créer « Plats ». Supprimer « Mes Entrées ».

**Attendu observable** :

- Création / rename / delete propagent en live (Convex push).
- Aucune erreur si dernière catégorie supprimée.
- Validation : nom non vide.

**Couvre** : #200 ; #206

### M2 — Items list + toggle rupture

**Acteur** : KB Manager
**Pré-requis** : un tenant avec un menu publié contenant au moins une catégorie et un item « Smash Burger » disponible.
**Étapes** :

1. Ouvrir `/t/[tenantId]/menu` sur desktop.
2. Localiser la section « Smash Burger » sous sa catégorie.
3. Basculer le switch « Disponibilité de Smash Burger » à OFF (sans cliquer « Publier »).
4. Dans un onglet incognito, ouvrir l'URL publique de la PWA mangeur du même tenant.

**Attendu observable** :

- Sur la page menu admin, le switch passe immédiatement en OFF et un badge « Rupture » apparaît.
- Sur la PWA mangeur, le Smash Burger apparaît grisé / `available: false` IMMÉDIATEMENT, sans « Publier ».
- Aucun toast d'erreur côté admin.

**Couvre** : #211 (AC3 + AC4) ; ADR 0015 (toggle live indépendant de publication)

### M2bis — Réactivité multi-onglets (toggle apparaît dans un autre onglet)

**Acteur** : KB Manager (deux sessions ou un staff sur mobile + gérant sur desktop)
**Pré-requis** : même page menu ouverte dans deux onglets/devices différents pour le même tenant.
**Étapes** :

1. Onglet A : basculer le toggle de rupture d'un item.
2. Onglet B : observer la card de l'item sans refresh.

**Attendu observable** :

- Onglet B montre le nouveau state du toggle ET le badge « Rupture » apparaît/disparaît automatiquement en moins de 2s.
- Aucun refresh manuel requis.

**Couvre** : #211 (AC5 « Réactivité multi-onglets »)

### M3 — Modale item CRUD

**Acteur** : KB Manager
**Pré-requis** : tenant provisionné avec au moins 2 catégories (« Entrées », « Plats »).
**Étapes** :

1. Naviguer sur `/t/[tenantId]/menu/`.
2. Cliquer « + Item » sous la catégorie « Entrées ».
3. Saisir : nom « Smash Burger », description « Double steak, cheddar », prix « 12,90 », cocher allergens « gluten » + « lait ».
4. Cliquer « Créer » → la modale se ferme, l'item apparaît sous « Entrées » avec prix « 12,90 € » et toggle rupture activé.
5. Cliquer sur la card de l'item → la modale s'ouvre en mode édition, pré-remplie.
6. Changer le prix en « 13,50 » → attendre 1s (debounce 600 ms) → fermer la modale → rouvrir → le prix affiche bien 13,50 €.
7. Cocher « œufs » dans les allergens (autosave IMMÉDIATE, pas debounced).
8. Changer la catégorie via le picker A→B (« Entrées » → « Plats ») → l'item apparaît sous « Plats ».
9. Rouvrir la modale → cliquer « Supprimer » → confirmer → l'item disparaît.

**Attendu observable** :

- Création, édition (text debounce + allergens/catégorie immédiats), recatégorisation A→B et suppression fonctionnent.
- Le toggle rupture sur la card reste indépendant (cliquer dessus pendant le test ne ré-ouvre PAS la modale).

**Couvre** : #219 ; #211 (F-MENU-04 click-non-propagation toggle vs card)

### M3bis — Validation prix négatif (front + backend)

**Acteur** : KB Manager
**Pré-requis** : un item existant dans une catégorie quelconque.
**Étapes** :

1. Ouvrir la modale d'édition d'un item.
2. Remplacer le prix par « -5 » → message d'erreur en rouge sous l'input.
3. Vérifier que l'autosave ne se déclenche PAS (aucune requête `items.update`).
4. Saisir « abc » → message « Format de prix invalide… ».
5. Saisir « 12,505 » → message « max 2 décimales ».
6. Saisir « 12,50 » → message disparaît, autosave repart, prix sauvegardé.

**Attendu observable** :

- Le front bloque les saisies invalides AVANT de toucher au backend.
- Chemin secondaire de défense : un INVALID_PRICE backend déclencherait un toast d'erreur.

**Couvre** : #219 (validation locale + INVALID_PRICE backend)

### M4 — Upload photo (upload, remplacement, suppression, libération blob)

**Acteur** : KB Manager
**Pré-requis** : tenant activé avec au moins une catégorie et un item sans photo. Backend joignable.
**Étapes** :

1. Ouvrir `/t/<tenantId>/menu`, cliquer sur la card pour ouvrir la modale d'édition.
2. Section « Photo » → « Téléverser » → sélectionner une image PNG ou JPG.
3. Vérifier que le thumbnail de la modale affiche la nouvelle image en quelques secondes ; fermer la modale ; vérifier que le thumbnail de la card est à jour.
4. Rouvrir la modale ; « Remplacer » + nouvelle image ; côté Convex Dashboard → Storage, vérifier que l'ancien blob a disparu.
5. « Supprimer la photo » → disparition immédiate du thumbnail, placeholder revient ; vérifier la libération du blob côté Convex Storage.
6. Re-uploader une photo, puis supprimer l'item entier → vérifier la cascade (blob libéré).

**Attendu observable** :

- Thumbnail modale + card cohérents à chaque étape, < 2 s après chaque mutation.
- Aucun blob orphelin dans Convex Storage après remplacement ou suppression.

**Couvre** : #226

### M5 — DnD reorder items [à valider]

**Acteur** : KB Manager
**Pré-requis** : ≥ 1 catégorie avec ≥ 3 items.
**Étapes** :

1. `/t/<tenantId>/menu`, drag un item du milieu vers le haut.
2. Lâcher.
3. Recharger (F5).

**Attendu observable** :

- Reorder visible immédiatement (optimistic UI).
- Persistance après F5.
- Snapshot/publication non impacté tant que pas de Publier.

**Couvre** : #237

### M6 — DnD reorder catégories [à valider]

**Acteur** : KB Manager
**Pré-requis** : ≥ 3 catégories dans le menu.
**Étapes** :

1. `/t/<tenantId>/menu`, drag la 3e catégorie en position 1.
2. Lâcher.
3. F5.

**Attendu observable** :

- Reorder catégories persistant.
- Items dans chaque catégorie conservent leur ordre interne.

**Couvre** : #206

### M7 — CRUD groupes Personnalisations [à valider]

**Acteur** : KB Manager
**Pré-requis** : tenant sans groupe Personnalisations.
**Étapes** :

1. Section « Personnalisations » de la page Menu, cliquer « + Nouveau groupe ».
2. Saisir « Sauce », min=1, max=1, options « Ketchup » (0€) + « Mayo » (0€). Créer.
3. Renommer en « Sauces » (edit).
4. Ajouter une option « BBQ » (+0,50€).
5. Supprimer le groupe.

**Attendu observable** :

- CRUD complet sans erreur.
- Validation min ≤ max.
- Suppression bloquée si attaché à des items (avec warning).

**Couvre** : #242

### M8 — Attach/detach groupes (réutilisation cross-item + détachement isolé)

**Acteur** : KB Manager
**Pré-requis** : un groupe « Suppléments » (min=0, max=3, options Bacon/Œuf/Cheddar) ; deux items I1 et I2.
**Étapes** :

1. Ouvrir I1 → Personnalisations → picker « Ajouter un groupe existant » → « Suppléments ».
2. Fermer la modale.
3. Ouvrir I2 → attacher « Suppléments ».
4. Revenir sur I1 → « Détacher » sur la ligne « Suppléments ».
5. Ouvrir I2.

**Attendu observable** :

- I2 garde « Suppléments » attaché (détachement de I1 n'affecte PAS I2).
- Dans la section standalone Personnalisations, « Suppléments » existe toujours.

**Couvre** : #246 (a)(b) ; #242

### M8bis — Création inline d'un groupe Personnalisations depuis la modale item

**Acteur** : KB Manager
**Pré-requis** : un item I1 existe dans une catégorie ; aucun groupe Personnalisations dans le tenant.
**Étapes** :

1. Ouvrir le menu, cliquer sur I1 pour ouvrir la modale item.
2. Section « Personnalisations » → « Créer un nouveau groupe ».
3. Dans la modale groupe (par-dessus), taper « Sauce » (nom), min=1, max=1, options « Ketchup » (0€) + « Mayo » (0€).
4. Cliquer « Créer ».

**Attendu observable** :

- La modale groupe se ferme automatiquement.
- La modale item I1 reste ouverte ; la section « Personnalisations » liste « Sauce 1/1 · Ketchup, Mayo » avec bouton « Détacher ».
- Recharger la page : « Sauce » est toujours attaché à I1.

**Couvre** : #246 (c) ; #242 (F-MENU-08 réutilisé)

### M8ter — Idempotence attach (re-attach = no-op)

**Acteur** : KB Manager
**Pré-requis** : un item I1 ; un groupe G existe et est déjà attaché à I1.
**Étapes** :

1. Ouvrir I1 → section Personnalisations.
2. Vérifier que le picker « Ajouter un groupe existant » N'AFFICHE PAS G.

**Attendu observable** :

- Aucune erreur, aucun toast.
- Picker filtre G côté UI ; sécurité backend re-attach = no-op intacte.

**Couvre** : #246 (b)

### M9 — Publier + badge + Aperçu

**Acteur** : KB Manager
**Pré-requis** : tenant actif avec ≥ 1 catégorie, ≥ 1 item au prix P0 publié au moins une fois.
**Étapes** :

1. Ouvrir `/t/[tenantId]/menu`, badge « modifications non publiées » ABSENT, bouton Publier enabled.
2. Cliquer sur l'item, modifier le prix vers P1, fermer la modale.
3. Le badge « modifications non publiées » apparaît.
4. Cliquer « Aperçu » : nouvel onglet `/menu/preview`, item au prix **P1**.
5. Autre onglet : requête publique PWA / `getPublicMenu` → item au prix **P0**.
6. Revenir sur l'éditeur, cliquer « Publier ». Toast vert « Menu publié », badge disparaît.
7. Rafraîchir PWA / re-appeler `getPublicMenu` : prix **P1** désormais visible.

**Attendu observable** :

- Badge présent uniquement quand draft ≠ snapshot.
- Aperçu = brouillon, getPublicMenu = snapshot.
- Publish : toast success, badge disparaît, snapshot mis à jour.

**Couvre** : #254

### M9bis — Publish sur tenant fraîchement provisionné (pas de gate)

**Acteur** : KB Manager
**Pré-requis** : tenant fraîchement provisionné, **jamais publié**, 0 catégorie initialement.
**Étapes** :

1. Ouvrir `/t/[tenantId]/menu`. Pas de badge.
2. Créer une catégorie (« Plats »), créer un item (« Pizza », 12,00 €).
3. Le badge apparaît.
4. Cliquer « Publier » → toast vert « Menu publié », badge disparaît.
5. `getPublicMenu` retourne la catégorie + l'item.

**Attendu observable** :

- Aucune erreur de type « tenant doit être actif ».
- Snapshot publié visible côté PWA.

**Couvre** : #254 (AC tenant fraîchement provisionné)

### M9ter — Aperçu protégé par l'auth admin (lien direct, incognito)

**Acteur** : KB Manager (déjà loggé) + un onglet de navigation externe.
**Pré-requis** : tenant avec menu publié + modifs draft non publiées.
**Étapes** :

1. Récupérer l'URL `/t/[tenantId]/menu/preview` depuis l'onglet Aperçu.
2. Ouvrir cette URL dans un onglet **sans session** (incognito).
3. Le shell `(app)` redirige vers le login.
4. Une fois loggé en KB Manager, atterrir sur la preview, voir le brouillon.

**Attendu observable** :

- La preview n'est PAS publique (différence vs PWA mangeur).
- Un curieux qui chope l'URL ne voit pas le brouillon d'un autre resto.

**Couvre** : #254 (sécurité : preview en zone admin authentifiée)

---

## CMD — Commandes

### CMD1 — Page shell

**Acteur** : KB Manager
**Pré-requis** : tenant actif.
**Étapes** :

1. Sidebar → Commandes → `/t/<tenantId>/commandes`.
2. Vérifier le shell : header + table empty si pas de commandes.

**Attendu observable** :

- Page rend sans erreur.
- Header avec titre « Commandes » + bouton CSV (désactivé si vide).

**Couvre** : #222

### CMD2 — Table live Convex

**Acteur** : KB Manager
**Pré-requis** : tenant avec ≥ 1 commande.
**Étapes** :

1. `/t/<tenantId>/commandes`, observer la table.
2. Déclencher une nouvelle commande côté backend (script ou autre onglet).

**Attendu observable** :

- Table peuplée des commandes existantes.
- Nouvelle commande apparaît live (push Convex WebSocket) sans refresh.

**Couvre** : #227

### CMD3 — Filtres date + statut

**Acteur** : KB Manager
**Pré-requis** : tenant signé avec au moins ~10 commandes étalées sur > 30 jours, avec un mix de statuts.
**Étapes** :

1. Naviguer vers `/t/<tenantId>/commandes`.
2. Vérifier que le filtre par défaut est `Tout` + aucun statut + la table affiche tout.
3. Cliquer `Aujourd'hui` — table ne contient que les commandes du jour Paris courant.
4. Cliquer `7 jours` — table = today + 6 précédents.
5. Cliquer pills `nouvelle` + `en préparation` — table montre uniquement les cmds qui matchent ET la fenêtre 7j (AND date / OR statuts).
6. Cliquer `Tout` (date) puis désélectionner les statuts — état initial complet.
7. Pendant un filtre actif (`Aujourd'hui` + `nouvelle`), faire passer une cmd `en attente de paiement` → `nouvelle` côté backend → la nouvelle ligne apparaît instantanément (push Convex WebSocket).

**Attendu observable** :

- Re-render à chaque clic, sans fetch backend supplémentaire (Network panel).
- Filtres visibles sur les 3 branches (loading / vide / peuplée).
- Aucun query param URL (V1).

**Couvre** : #238 ; #227 (réactivité Convex)

### CMD4 — Modal détail

**Acteur** : KB Manager
**Pré-requis** : loggué sur `/t/<tenantId>/commandes` avec ≥ 1 commande payée (status `nouvelle` ou plus, `pricingSnapshot` rempli, ≥ 1 item, ≥ 2 events).
**Étapes** :

1. Cliquer une ligne de la table.
2. Vérifier que le modal s'ouvre avec « Détail de la commande ».
3. Vérifier les 3 sections : items (nom + qty + prix unitaire + modifiers), Pricing (Sous-total / Livraison / Total €), Historique (≥ 2 events horodatés FR).
4. Vérifier la section Meta : mode + source (`direct`).
5. Cliquer « Fermer » → modal fermé, table interactive.
6. Réouvrir la même ligne → même contenu sans clignotement (push Convex).

**Attendu observable** :

- Pas de bouton « Rembourser » (couvert par le test refund ci-dessous).
- Si `restaurantNote` présente, elle apparaît sous « Note pour le restaurant ».
- Events triés du plus ancien (haut) au plus récent (bas).

**Couvre** : #239 ; #227 (row click)

### CMD4bis — Détail d'une commande en attente de paiement (pricing absent)

**Acteur** : KB Manager
**Pré-requis** : ≥ 1 commande en status `en attente de paiement` (créée mais pas confirmée Stripe → `pricingSnapshot` absent).
**Étapes** :

1. Filtrer sur « en attente de paiement ».
2. Cliquer une ligne.

**Attendu observable** :

- Section « Pricing » ABSENTE (pas de tirets).
- Sections « Articles » et « Historique » restent affichées.
- Section « Meta » montre mode + source.

**Couvre** : #239 (branche `pricingSnapshot === undefined`)

### CMD4ter — Fermeture du modal détail (clavier + backdrop)

**Acteur** : KB Manager
**Pré-requis** : modal détail ouvert.
**Étapes** :

1. Appuyer sur `Esc` → modal fermé.
2. Rouvrir en cliquant une ligne.
3. Cliquer sur la zone grisée extérieure → modal fermé.

**Attendu observable** : focus revient sur la page, table interactive, pas de portail orphelin.

**Couvre** : #239 (close affordances)

### CMD5 — Refund

**Acteur** : KB Manager
**Pré-requis** : kb_manager sur `T1`. T1 a ≥ 1 commande payée (`paidAt` set, status `nouvelle` ou ultérieur), `pricingSnapshot.total` connu (ex. 27,50 €). Stripe sandbox + `stripeAccountId` sur le tenant.
**Étapes** :

1. Naviguer sur `/t/T1/commandes`.
2. Cliquer la ligne de la commande payée → modal s'ouvre.
3. Vérifier le bouton « Rembourser 27,50 € » en footer.
4. Cliquer → AlertDialog de confirmation + textarea « Raison (optionnelle) » (max 500 chars).
5. Saisir « test refund e2e ». Cliquer « Confirmer le remboursement ».

**Attendu observable** :

- Toast vert « Commande remboursée ».
- Modal se ferme automatiquement.
- La ligne passe en statut `refusée` SANS refresh manuel (réactivité Convex).
- PaymentIntent Stripe marqué `refunded` dans le dashboard Stripe.
- Notification client `refund_issued` queued côté backend.

**Couvre** : #243 ; #221 (end-to-end B-REFUND-PUBLIC-ACTION)

### CMD5bis — Staff ne voit PAS le bouton de remboursement

**Acteur** : staff
**Pré-requis** : staff sur T1. T1 a ≥ 1 commande payée.
**Étapes** :

1. Naviguer sur `/t/T1/commandes`.
2. Cliquer la ligne de la commande payée.

**Attendu observable** :

- Modal détail s'ouvre normalement (staff voit les détails).
- Aucun bouton « Rembourser » en footer.
- Seul « Fermer » est visible.

**Couvre** : #243 (RBAC mirror côté front)

### CMD5ter — Tentative de refund déjà effectué (CTA masqué)

**Acteur** : KB Manager
**Pré-requis** : kb_manager sur T1. T1 a une commande DÉJÀ en statut `refusée`.
**Étapes** :

1. Filtrer par statut `refusée`. Cliquer la ligne → modal s'ouvre.

**Attendu observable** :

- Aucun bouton « Rembourser » (gate `status !== "refusée"` masque le CTA).
- L'historique affiche bien la transition vers `refusée`.

**Couvre** : #243 (gate refundability front + défense en profondeur)

### CMD6 — Export CSV filtré reflète l'état UI

**Acteur** : KB Manager
**Pré-requis** : tenant avec ≥ 10 commandes mixtes (statuts variés, sur 30 derniers jours).
**Étapes** :

1. `/t/<tenantId>/commandes`.
2. Cliquer « 7 jours » dans les filtres date.
3. Sélectionner uniquement « nouvelle » et « livrée » dans les statuts.
4. Cliquer « Exporter CSV » dans le header.
5. Ouvrir le fichier dans Excel FR (ou LibreOffice Calc FR).

**Attendu observable** :

- Fichier nommé `commandes_<tenantSlug>_<YYYYMMDD>.csv`.
- Séparateur `;` interprété, accents OK (UTF-8 BOM).
- CSV contient uniquement les commandes cohérentes avec la table affichée.
- AUCUNE colonne `email`, `phone`, `name`, `adresse`, `lat`, `lng`.
- Colonnes attendues : `id`, `date`, `statut`, `mode`, `source`, `sous_total_centimes`, `frais_livraison_centimes`, `total_centimes`, `paye_le`, `refuse_le`.

**Couvre** : #244 ; #238 (filtres)

### CMD6bis — Bouton CSV désactivé sans données

**Acteur** : KB Manager
**Pré-requis** : tenant fraîchement provisionné, zéro commande.
**Étapes** :

1. `/t/<tenantId>/commandes`.
2. Observer le header.
3. Tenter de cliquer.

**Attendu observable** :

- Bouton « Exporter CSV » visible mais désactivé.
- Aucun téléchargement au clic.
- Table : « Aucune commande pour le moment. ».

**Couvre** : #244 (état empty)

---

## PR — Pricing

### PR1 — Liste règles + auto-priorité

**Acteur** : KB Manager (ou KB Admin en impersonation)
**Pré-requis** :

- Tenant A avec ≥ 2 règles (1 active, 1 inactive ; variétés d'actions : `livraison_offerte_resto`, `frais_livraison_part_resto_fixe`, `frais_livraison_part_resto_pourcentage_panier`).
- Tenant B vierge (0 règle).

**Étapes** :

1. Login KB Manager du tenant A → sidebar « Pricing » → page charge.
2. Vérifier bandeau « Quand plusieurs règles s'appliquent, KitchenBoost applique automatiquement celle qui est la plus avantageuse pour ton client. Pas d'ordre à gérer. ».
3. Vérifier chaque règle : résumé conditions FR + résumé action FR + badge « Active » / « Inactive ».
4. Ligne inactive visuellement grisée.
5. Switcher vers tenant B → sidebar « Pricing ».
6. État vide : bandeau toujours présent + message « Aucune règle pour l'instant. La règle KitchenBoost par défaut (10 % du panier absorbés par le resto) s'applique. ».
7. **Absence** de bouton « + Nouvelle règle » sur l'état vide (note : remplacé en PR2 ci-dessous).

**Attendu observable** :

- Bandeau auto-priorité sur les deux tenants.
- Aucun drag-handle, aucun numéro d'ordre/priorité visible.

**Couvre** : #241

### PR2 — Builder create

**Acteur** : KB Manager
**Pré-requis** : tenant sans règle ou avec règles existantes.
**Étapes** :

1. Cliquer « + Nouvelle règle » sur la page Pricing.
2. Modale builder : titre « Créer une règle ».
3. Ajouter condition `total_panier gte 25 EUR` + condition `premiere_commande true`.
4. Sélectionner action `livraison_offerte_resto`.
5. Cliquer « Créer la règle ».

**Attendu observable** :

- Modale ferme, règle apparaît dans la liste avec résumé FR.
- Réactivité Convex (apparition sans refresh).
- Validation : pas de save si conditions ou action manquantes.

**Couvre** : #245

### PR3 — Builder edit

**Acteur** : KB Manager
**Pré-requis** : ≥ 1 règle persistée (ex. `panier >= 25 EUR + premiere commande -> livraison offerte resto`).
**Étapes** :

1. Cliquer « Éditer » sur la ligne.
2. Vérifier modale ouverte avec titre « Modifier la règle », 2 conditions pré-remplies, action sélectionnée.
3. Modifier seuil panier 25 → 30 €. Cliquer « Enregistrer les modifications ».
4. Observer fermeture modale + ligne mise à jour (« Panier ≥ 30 € »).

**Attendu observable** :

- Titre = « Modifier la règle ».
- Champs prefilled aux valeurs persistées.
- Après save, liste à jour sans rafraîchissement manuel.

**Couvre** : #248 ; #245 (builder réutilisé) ; #241 (réactivité liste)

### PR3bis — Édition avec conditions contradictoires (erreur inline)

**Acteur** : KB Manager
**Pré-requis** : règle avec condition `total_panier gte 25 EUR`.
**Étapes** :

1. Cliquer « Éditer ».
2. Ajouter condition `total_panier lte 10 EUR` (contradictoire).
3. Cliquer « Enregistrer les modifications ».

**Attendu observable** :

- Backend rejette via `CONTRADICTORY_CONDITIONS`.
- Message FR INLINE sous le bouton submit (pas de toast).
- Modale reste OUVERTE, champs préservés.
- Recorriger à `lte 50 EUR` → save passe, modale ferme, liste à jour.

**Couvre** : #248 ; #245 (même UX en create)

### PR4 — Toggle active (drive `setActive` end-to-end + round-trip préserve la règle)

**Acteur** : KB Manager
**Pré-requis** : tenant avec ≥ 1 règle (conditions et action non triviales, ex. « Panier ≥ 25 € » + « Livraison offerte resto »).
**Étapes** :

1. `/t/<tenantId>/pricing`. Toggle ON, badge « Active », ligne en pleine opacité.
2. Cliquer le toggle. Toggle OFF, badge « Inactive », ligne grisée.
3. Recharger (F5). État OFF persiste.
4. Re-cliquer le toggle. Toggle ON, badge « Active ».
5. Cliquer « Éditer ». Modal pré-rempli avec EXACTEMENT les conditions + action d'origine.

**Attendu observable** :

- Le toggle drive bien `setActive` (persistance F5).
- Badge + opacité suivent l'état.
- Définition de la règle intacte après désactiver/réactiver.

**Couvre** : #249 ; #248 (pré-fill modal d'édition comme sonde de non-régression)

### PR4bis — Toggle pricing cross-tenant safe

**Acteur** : KB Manager
**Pré-requis** : Deux tenants A et B, chacun ≥ 1 règle. Manager rattaché à A uniquement.
**Étapes** :

1. Login manager A. `/t/A/pricing`. Toggle une règle. Confirmer persistance.
2. Tenter de naviguer manuellement sur `/t/B/pricing` (substitution URL).
3. `<TenantProvider/>` refuse l'accès (redirect ou 403).

**Attendu observable** :

- Aucune fuite : manager A ne voit aucune règle de B, ne peut pas en flipper l'`active`.

**Couvre** : #249 ; ADR 0010 / withTenant

### PR5 — Supprimer (confirmation 2 clics)

**Acteur** : KB Manager
**Pré-requis** : tenant actif avec ≥ 2 règles actives.
**Étapes** :

1. Login KB Manager, `/t/[tenantId]/pricing`.
2. Cliquer « Supprimer » sur la 1ère règle.
3. Vérifier dialog ouvert avec « Supprimer cette règle ? Cette action est irréversible. ».
4. Cliquer « Annuler » → dialog fermé, règle TOUJOURS présente.
5. Re-cliquer « Supprimer ». Cliquer « Supprimer » (rouge) dans le dialog.
6. Règle disparaît de la liste (réactivité Convex).

**Attendu observable** :

- Pas de toast (discipline « pas de toast technique »).
- Règle restante : toggle + boutons Éditer/Supprimer fonctionnels.
- F5 : règle supprimée n'est plus là.

**Couvre** : #251

---

## SUP — Support

### SUP1 — Composant partagé

**Acteur** : tout rôle (admin / manager / staff)
**Pré-requis** : un compte loggué.
**Étapes** :

1. Charger n'importe quelle route support (`/support` ou `/t/[id]/support`).
2. Inspecter le composant rendu.

**Attendu observable** :

- Le même composant `SupportPanel` (config statique : CSM + 4 cards) est rendu.
- Pas de duplication HTML entre les 2 routes.

**Couvre** : #210

### SUP2 — Route supervision `/support`

**Acteur** : KB Admin (root)
**Pré-requis** : KB Admin loggué (session.ready + isAdmin === true), shell `(app)` monté.
**Étapes** :

1. Naviguer manuellement à `https://<admin-host>/support`.
2. Observer le rendu.

**Attendu observable** :

- Page rend sans error boundary ni redirection.
- Bandeau CSM : « Alex Michelet », email `mailto:`, tel `tel:`, dispo « Lun–Ven, 9h–19h ».
- 4 cards ressources (FAQ KitchenBoost, Guide de démarrage, Vidéo tuto, Kit commercial) avec icône `ExternalLink` aria-hidden et liens `target="_blank"` + `rel="noopener noreferrer"`.

**Couvre** : #232 ; #210 (composant partagé utilisable depuis la route supervision)

### SUP3 — Route opérationnelle `/t/[tenantId]/support` (y compris tenant suspendu)

**Acteur** : KB Manager
**Pré-requis** : compte KB Manager attaché à `T1` actif, plus compte KB Manager attaché à `T2` en status `suspended`.
**Étapes** :

1. Login manager T1, `/t/T1/support`.
2. Vérifier bandeau CSM + 4 cards.
3. Cliquer « FAQ KitchenBoost » → lien externe nouvel onglet.
4. Logout, login manager T2 (suspendu), `/t/T2/support`.
5. Vérifier même contenu — le tenant suspendu n'empêche PAS l'accès à `/support`.

**Attendu observable** :

- T1 et T2 : même bandeau + mêmes 4 cards, liens fonctionnels.
- Aucune redirection ni erreur sur T2.

**Couvre** : #235 ; #150 (épique F-SUPPORT)

### SUP3bis — Parité supervision / opérationnelle (zero duplication)

**Acteur** : KB Admin
**Pré-requis** : compte KB Admin, ≥ 1 tenant `T1`.
**Étapes** :

1. Login KB Admin, `/support` (supervision).
2. Capturer visuellement le bandeau CSM + la grille.
3. Naviguer vers `/t/T1/support`.
4. Comparer visuellement.

**Attendu observable** :

- Mêmes textes, mêmes 4 cards, même ordre, même grid 1col mobile / 2cols desktop.
- Aucune divergence (indicerait une duplication de config).

**Couvre** : #235 (AC3) ; #210 (composant + config partagés)

---

## W — Wizard provisioning (10/10 steps)

### W1 — Skeleton + stepper

**Acteur** : KB Admin
**Pré-requis** : prospect en phase `preparation`.
**Étapes** :

1. `/pipeline/<prospectId>/provision` → wizard shell.
2. Observer le stepper (10 steps visibles : Provisioning / Domaine / Stripe KYC / Branding / Menu / QR / Invitation / Activation, etc.).

**Attendu observable** :

- Shell rend sans erreur.
- Stepper marque les étapes complete/current/pending selon `useWizardState`.
- Navigation step→step possible.

**Couvre** : #265

### W2 — Launcher button

**Acteur** : KB Admin
**Pré-requis** : prospect en phase `preparation`.
**Étapes** :

1. `/pipeline/<prospectId>` (fiche prospect).
2. Observer le bouton « Lancer le provisioning ».
3. Cliquer.

**Attendu observable** :

- Bouton visible uniquement sur prospects en phase `preparation`+ (selon RBAC).
- Clic ouvre `/pipeline/<prospectId>/provision`.

**Couvre** : #266

### W3 — Step 1 provisionTenant

**Acteur** : KB Admin
**Pré-requis** : prospect sans `tenantId`.
**Étapes** :

1. Wizard step 1, saisir nom du restaurant + slug suggéré.
2. Cliquer « Créer le tenant ».

**Attendu observable** :

- Tenant doc créé en DB avec status `pending`.
- Back-link `tenantId` posé sur le prospect.
- Step 1 passe `complete`, wizard avance vers step 2.

**Couvre** : #267

### W4 — Step 2 customDomain (débloqué par #358)

**Acteur** : KB Admin
**Pré-requis** : step 1 fait, tenantId créé.
**Étapes** :

1. Wizard step 2 « Domaine ».
2. Saisir `commande.monresto.fr`, lancer la vérification DNS.
3. Confirmer la propagation.

**Attendu observable** :

- Backend `setCustomDomain` (#358) appelé, DNS check OK.
- Step 2 passe `complete` une fois le domaine vérifié.
- L'URL publique du tenant utilise désormais le customDomain.

**Couvre** : #268 (débloqué) ; #358 (customDomain backend)

### W5 — Step 3 Stripe Connect KYC

**Acteur** : KB Admin
**Pré-requis** : step 1 fait, tenant sans `stripeAccountId`.
**Étapes** :

1. Wizard step 3 « Stripe KYC ».
2. Cliquer « Générer le lien Stripe Connect ».
3. Copier le lien (CTA copier), l'envoyer au gérant (manuellement).
4. Le gérant complète KYC dans son onglet.
5. Wizard step 3 : « Régénérer le lien » disponible si besoin.

**Attendu observable** :

- Lien Connect généré valide.
- Step 3 passe `complete` quand `stripeAccountId` + KYC validé côté Stripe.
- Webhook Stripe met à jour le statut KYC sur le tenant.

**Couvre** : #269

### W6 — Step 4 Branding (bout-en-bout)

**Acteur** : KB Admin
**Pré-requis** : prospect en phase `preparation` avec step 1 (provisioning) complété (tenantId back-link posé). Une image PNG/JPG (~200 Ko).
**Étapes** :

1. Ouvrir `/pipeline/<prospectId>/provision` ; naviguer jusqu'au step 4 « Branding ».
2. Section Identité visuelle : cliquer placeholder logo, sélectionner l'image, vérifier preview locale instantanée.
3. Couleur primaire `#E5A100` ; swatch live reflète immédiatement.
4. « Enregistrer » section Identité visuelle ; toast succès.
5. Section Coordonnées : adresse + téléphone `06 12 34 56 78` ; pas d'erreur inline. Enregistrer ; toast.
6. Section Modes acceptés : désactiver `Click & Collect` (livraison reste active) ; toggle livraison locked avec message « Au moins un mode doit rester actif. ». Enregistrer ; toast.
7. « Suivant » → step 5.
8. Revenir au step 4 via le stepper ; vérifier que TOUTES les valeurs sont pré-remplies.

**Attendu observable** :

- 3 toasts success consécutifs.
- Stepper marque step 4 `complete` après `branding.logoUrl` + `branding.primaryColor` posés.
- Tenant doc en DB porte `branding`, `address`, `phone`, `acceptedModes` aux valeurs saisies.
- Aucune erreur console.

**Couvre** : #270 (Step 4) ; #229 (BrandingEditor) ; #231 (CoordonneesEditor) ; #234 (ModesEditor) ; #168 (tenant.updateSettings D5)

### W6bis — Step 4 validation backend INVALID_HEX_COLOR

**Acteur** : KB Admin
**Pré-requis** : tenant déjà créé, step 4 accessible.
**Étapes** :

1. Ouvrir step 4. Modifier la valeur du color picker en bypassant l'UI (DevTools : `document.querySelector('[data-slot=parametres-branding-color-input]').value = '#XYZ'`) + fire `change` manuellement.
2. Cliquer « Enregistrer » section Identité visuelle.

**Attendu observable** :

- Toast erreur « Impossible d'enregistrer l'identité visuelle » + description `INVALID_HEX_COLOR ...`.
- Erreur inline dans le form (`parametres-branding-submit-error`).
- Aucune écriture en DB.

**Couvre** : #270 (gestion erreur backend) ; #228 (tenantSettingsValidation `isValidHexColor`)

### W7 — Step 5 Menu (publication requise + gate vers Step 6)

**Acteur** : KB Admin
**Pré-requis** : prospect en phase `preparation` avec tenant déjà provisionné (Step 1 OK). Aucune publication antérieure du menu.
**Étapes** :

1. `/pipeline/[prospectId]`, lancer le wizard.
2. Naviguer jusqu'à Step 5 (Menu).
3. Badge « Brouillon non publié » + bouton « Continuer » **désactivé** + texte d'aide « Publie ton menu au moins une fois avant de passer à l'impression du QR sticker. ».
4. Créer une catégorie (« + Catégorie »), badge reste « Brouillon non publié », Continuer reste désactivé.
5. Cliquer « Publier » dans le header. Toast succès « Menu publié ».
6. Badge passe à « Publié — [date dd/MM/yyyy HH:mm] », bouton « Continuer » **actif**.
7. « Continuer » → wizard avance vers Step 6 (QR).

**Attendu observable** :

- `getPublicMenu({ tenantId })` retourne `{ categories: [...] }` non vide après étape 5.
- Cursor wizard re-visite Step 5 reste sur Step 5 si publication mais pas d'autre step complet.
- Aucune navigation vers Step 6 possible tant que `lastPublishedAt === null`.

**Couvre** : #271 ; #176 (hasUnpublishedChanges) ; #155 (publishMenu) ; #160 (getPublicMenu) ; ADR 0015

### W8 — Step 6 QR sticker PDF

**Acteur** : KB Admin
**Pré-requis** : step 5 complete (menu publié au moins une fois).
**Étapes** :

1. Wizard step 6 « QR sticker ».
2. Vérifier preview du QR + sélecteur 3 formats (A4 / A5 / sticker carré).
3. Cliquer « Télécharger le PDF » pour chaque format.

**Attendu observable** :

- Preview rend le QR pointant vers l'URL publique du tenant.
- 3 PDF distincts téléchargés avec le bon format.
- Step 6 passe `complete` après premier téléchargement (ou navigation suivante).

**Couvre** : #272

### W9 — Step 7 Invitation gérant

Voir AC2 et AC2bis ci-dessus (couverture identique : #273 + B-AUTH-4/5/6).

### W10 — Step 8 Activation

**Acteur** : KB Admin
**Pré-requis** : steps 1-7 complets (ou au moins les bloquants).
**Étapes** :

1. Wizard step 8 « Activation ».
2. Vérifier le récap 6 blocs (Tenant / Domaine / Stripe KYC / Branding / Menu / QR + Invitation).
3. Cliquer « Activer le restaurant ».
4. Dialog 2 étapes : confirmer le slug définitif, puis cliquer « Activer ».

**Attendu observable** :

- Tenant passe `status: active` en DB.
- Phase prospect passe `operationnel`.
- Wizard se ferme ou affiche un écran de confirmation.
- Audit event `tenant.activated`.

**Couvre** : #274

---

## ⚠️ PRs sans tests E2E proposés

Les PRs suivantes n'ont pas inclus de section « Tests E2E proposés » exploitable dans leur body. La justification est rappelée quand explicite ; sinon, marquer comme dette à combler si le parcours utilisateur n'est pas déjà couvert par une E2E voisine listée ci-dessus.

| PR   | Ticket  | Domaine                                  | Justification / note                                                                                                                    |
| ---- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| #317 | #210    | F-SUPPORT                                | _Justifié_ : composant 100 % statique, sans fetch ni Convex. Premier E2E pertinent = #232 (route /support).                             |
| #319 | _(n/a)_ | _empty_                                  | Body vide (`@-`). À vérifier.                                                                                                           |
| #320 | _(n/a)_ | _empty_                                  | Body vide.                                                                                                                              |
| #322 | #221    | F-COMMANDES (backend)                    | Backend slice ; couvert end-to-end par l'E2E refund de #243.                                                                            |
| #323 | #222    | F-COMMANDES                              | _Justifié_ : scaffold placeholder, parcours significatif arrive en #227/#238/#239.                                                      |
| #325 | #224    | B-MENU-PUBLICATION (backend)             | _Justifié_ : invariants backend purs, couverts par 1211 tests convex-test.                                                              |
| #327 | #227    | F-COMMANDES                              | Pas de section E2E dans la PR (slice 2 — liste live). Parcours couvert par les E2E de #238 / #239.                                      |
| #329 | #230    | B-AUTH                                   | Pas de section E2E. Couvert end-to-end par l'E2E Step 7 wizard (#273).                                                                  |
| #332 | _(n/a)_ | _empty_                                  | Body vide.                                                                                                                              |
| #335 | _(n/a)_ | _empty_                                  | Body vide.                                                                                                                              |
| #336 | _(n/a)_ | _empty_                                  | Body vide.                                                                                                                              |
| #340 | #242    | F-MENU                                   | Pas de section E2E (CRUD groupes Personnalisations standalone). Parcours couvert par les E2E de #246.                                   |
| #343 | #245    | F-PRICING                                | Pas de section E2E (CREATE de règle). Parcours couvert indirectement par les E2E d'édition #248. À compléter pour le chemin CREATE pur. |
| #349 | #265    | F-WIZARD slice 1/10                      | Pas de section E2E (shell wizard). À couvrir via un test « full wizard cold start » à dériver.                                          |
| #350 | #266    | F-WIZARD slice 2/10                      | Pas de section E2E (launcher button visibility).                                                                                        |
| #351 | #267    | F-WIZARD slice 3/10 (Step 1)             | Pas de section E2E. À dériver depuis la story (création tenant pending + back-link).                                                    |
| #352 | #269    | F-WIZARD slice 4/10 (Step 3 Stripe KYC)  | Pas de section E2E. À couvrir (génération lien, copie, régénération).                                                                   |
| #355 | #272    | F-WIZARD slice 8/10 (Step 6 QR)          | Pas de section E2E. À couvrir (preview + 3 formats PDF + télécharger).                                                                  |
| #357 | #274    | F-WIZARD slice 10/10 (Step 8 Activation) | Pas de section E2E. À couvrir (récap 6 blocs + dialog 2 étapes slug + activate).                                                        |
