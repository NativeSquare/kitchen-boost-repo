---
status: accepted
date: 2026-05-27
deciders: Alex
---

# Shell KB Admin unique + scoping RBAC côté front (V1)

## Contexte

`apps/admin` ([PRD 70](../prd/70_kb_admin.md)) est l'**unique app web** du système, servie sur un domaine mono-tenant (`admin.kitchen-boost.fr`), à ne pas confondre avec `apps/web` (PWA mangeur, multi-domaine par hostname). Le scaffold existant est **root-only** : `AdminGuard` + `api.table.admin.currentAdmin` n'admettent que `role === "kb_admin"`, le groupe `(app)` est entièrement gardé, la sidebar est figée (Users/Team). Aucune surface KB Manager n'existe.

Le backend KB Admin (chantier 2.9) et les backends opérationnels 2.1–2.7 sont **mergés** : le front a une API Convex complète à brancher. Il restait à décider la **forme du shell** qui fait cohabiter, dans une seule codebase, la **vue root** (KB Admin : pipeline, CRM, contrats, monitoring, tous tenants) et la **vue KB Manager** (gérant : menu, commandes, clients, campagnes, pricing, scopée à son/ses tenants).

Socle hérité, non rediscuté : isolation **100 % applicative** côté backend (les wrappers `tenantQuery` / `kbAdminQuery` throw, [ADR 0010](0010-isolation-multi-tenant-convex-applicative.md)) ; identité via `getCurrentActor` ([ADR 0011](0011-convex-auth-v1-identite-encapsulee-workos-differe.md)) ; **rôle resto per-tenant** sur `userTenants` (le badge global `users.role` ne vaut que `kb_admin | customer` — un gérant porte globalement `customer` + N lignes `userTenants`).

## Décision

**Un seul shell visuel, scopé par RBAC applicatif côté front, le tenant courant porté par l'URL.** En détail :

1. **Un seul groupe de routes `(app)`, un seul shell visuel** (`SidebarProvider` + sidebar + header), façon `brain-analytics-platform`. **Pas** de groupes de routes séparés par rôle. La **sidebar et les surfaces s'adaptent au rôle** : KB Admin voit les liens supervision (pipeline / CRM / monitoring / tenants) **et** peut atteindre les surfaces resto ; KB Manager ne voit que les surfaces resto.

2. **Le gating front est de la navigation/UX, PAS la frontière de sécurité.** La frontière est backend ([ADR 0010](0010-isolation-multi-tenant-convex-applicative.md)) : si une route root « fuit » dans le bundle manager, les fonctions Convex refusent quand même. Le front _reflète_ ce que le backend autorise.

3. **Résolution de session par une requête de bootstrap** (à exposer : `getSession`) appelée au chargement, renvoyant `{ isAdmin, tenants: [{ tenantId, slug, name, role }] }`. Le garde admet l'entrée si `isAdmin` **ou** `tenants` non vide. La **classification d'un acteur** ne repose pas sur un badge global mais sur la liste : un gérant = personne avec ≥ 1 ligne `userTenants` active. Un pro authentifié sans tenant accessible (rattachements détachés, compte en cours de provisioning) → page « pas de resto rattaché ».

4. **Le tenant courant vit dans l'URL** : surfaces opérationnelles sous `/t/[tenantId]/...`. Le cookie `kb_current_tenant` n'est qu'un **indice de redirection** (dernier resto ouvert), pas la source de vérité. Le `tenantId` est un **argument explicite** de chaque appel Convex tenant-scopé (les wrappers le consomment) ; un hook `useTenantQuery` / `useTenantMutation` (wrapper mince par-dessus les `useQuery` / `useMutation` Convex, réactivité + `"skip"` + types préservés) **l'injecte automatiquement** depuis le segment d'URL pour qu'aucun écran ne l'oublie. C'est l'équivalent front de la règle backend `no-untenanted-query`.

5. **Deux espaces d'URL distincts**, par contrat backend :
   - `/pipeline` + `/pipeline/[prospectId]` = **supervision / fiche** (KB Admin uniquement, `kbAdminQuery`). **Clé = prospect, pas tenant** (un prospect existe dès l'Acquisition, avant tout tenant — le `tenantId` est un back-link posé au provisioning) : la fiche couvre tout le cycle de vie ; une fois provisionné, elle affiche aussi le tenant + un bouton « Ouvrir la vue resto » → `/t/[tenantId]/...`. Couvre statuts intégrations, milestones pipeline, contrats, embed KYC, monitoring. **(Cf. Amendement 2026-05-27 ci-dessous.)**
   - `/t/[id]/...` = **opérationnel**, fonctions `tenantQuery`, accessible au gérant/staff du tenant **et** au KB Admin (root override). Un wrapper de layout **sans habillage** sous `/t/[id]` fournit + valide le tenant courant (cases limites : redirection vers resto par défaut si inaccessible au gérant, 404 si tenant bidon pour le root).

6. **L'impersonation V1 = navigation, pas de plomberie dédiée.** « Assister un resto » = le KB Admin ouvre `/t/[id]/...` (le root override des wrappers lui donne accès). Signalé par un **bandeau côté KB Admin** (« Mode admin — tu consultes \<resto\> »). Le bandeau côté gérant (« KB est connecté à votre compte ») reste V2.

7. **Switcher tenant toujours visible**, dans le header partagé. Sa **valeur** = le contexte courant (un resto précis, ou « Supervision » pour le KB Admin au-dessus de tout). Ses **options s'adaptent au rôle** : gérant = ses restos (`session.tenants`) ; KB Admin = sélecteur cherchable sur **tous** les tenants (query root) + une entrée « Supervision » qui sort vers l'espace root.

## Considered options

1. **Shell unique + scoping front + tenant-in-URL (retenu)** — une codebase, un habillage, le RBAC adapte la vue ; deep-linkable ; l'impersonation tombe « gratuitement » du root override.
2. **Groupes de routes `(root)` / `(manager)` séparés, layouts distincts** — séparation physique nette, mais duplication du chrome, l'impersonation devient « entrer dans l'autre arbre », et deux sous-apps là où le mandat produit dit « une seule app ». Rejeté.
3. **Tenant courant ambiant (cookie + état mémoire), URLs génériques `/menu`** — plus simple en façade, mais `/menu` est ambigu (quel resto ?), pas de lien partageable, perte de contexte au refresh, et n'unifie pas le drill-down root. Rejeté.
4. **Plomberie d'impersonation dédiée (session « act-as », token)** — inutile en V1 : le root override des wrappers donne déjà l'accès ; un bandeau suffit. Reporté (le besoin réel = l'audit + le bandeau côté gérant, V2).

## Pourquoi ce choix

- Le mandat produit est **« une seule app, le RBAC scope la vue »** (PRD 70, CONTEXT KB Admin). Un shell unique conditionnel le matérialise directement ; deux arbres le trahiraient.
- Comme l'isolation réelle est **backend** ([ADR 0010](0010-isolation-multi-tenant-convex-applicative.md)), cloisonner physiquement le front n'achète pas de sécurité — seulement de la clarté. On paie donc le coût minimal (un shell + du gating UX) plutôt que la duplication.
- **Le tenant dans l'URL** rend les surfaces deep-linkables, survit au refresh, et **unifie** trois cas sous un seul mécanisme : switcher du gérant, drill-down du root, et assistance/impersonation — tous « ouvrir `/t/[id]/...` ».
- Le **hook auto-tenant** supprime la classe de bugs « j'ai oublié de passer le tenantId » sans réinventer le transport Convex.
- La **classification par liste de tenants** (et non par badge) est la seule cohérente avec le multi-tenant-per-user (Walid : gérant sur 3 restos ; un même humain peut être manager ici et staff ailleurs — un badge global ne peut pas l'exprimer).

## Conséquences

- **Brique backend à ajouter** : la query `getSession` (rôle + liste des tenants accessibles joints nom/slug). Mince agrégateur sur des données existantes ; remplace l'usage root-only de `currentAdmin` comme garde.
- `AdminGuard` / `currentAdmin` (root-only) sont **remplacés** par un garde basé sur `getSession` qui admet aussi les gérants.
- La sidebar figée (Users/Team) devient **conditionnelle par rôle**.
- Le mode « tenant suspendu = lecture seule » n'est **pas** géré au niveau du shell : c'est un mode **par surface**, piloté par `tenant.status`, traité plus tard.
- L'audit de l'impersonation et le bandeau côté gérant restent **V2** (cohérent PRD 70 §1 + Q70-Q2).

## Hard to reverse pourquoi

Toutes les surfaces de `apps/admin` se construisent sur cette forme : l'arbre de routes (`/pipeline/[prospectId]` vs `/t/[tenantId]/...`), le contrat de session, et surtout le **hook auto-tenant** par lequel passe chaque appel tenant-scopé. Changer la source du tenant courant (URL → ambiant) ou refondre en deux arbres après coup = retoucher chaque écran resto et chaque appel de données. La décision conditionne le layout, le garde, le switcher, et le branchement Convex par rôle — c'est le socle du front KB Admin.

## Amendement 2026-05-27 — fiche de supervision clé-prospect

La rédaction initiale plaçait la fiche de supervision à `/tenants/[id]`. **Correction** : le **prospect précède le tenant** — un prospect existe dès l'Acquisition et le `tenantId` n'est qu'un **back-link** posé au provisioning ([`table/prospects.ts`](../../packages/backend/convex/table/prospects.ts)) ; les cartes du Kanban sont des prospects. La fiche de supervision est donc **clé par `prospectId`** (`/pipeline/[prospectId]`) et couvre tout le cycle de vie ; une fois provisionné, elle expose le tenant + le bouton « Ouvrir la vue resto » → `/t/[tenantId]/...`. `/t/[tenantId]/...` reste réservé à l'**opérationnel** (post-provisioning). Tout tenant naissant d'un prospect (`provisionTenant`), le prospect est la colonne vertébrale du cycle de vie. Le reste de la décision est inchangé.
