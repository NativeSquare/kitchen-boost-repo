# Multi-Tenant

Le contexte transverse de l'isolation des établissements et de la sécurité d'accès. **Tous** les contextes métier s'appuient sur ce socle : `tenant_id` sur tout objet métier, table `users` + liaison `user_tenants` N-N, RBAC à 3 rôles, isolation applicative (helpers `withTenant` — pas de RLS, cf. [ADR 0010](../../adr/0010-isolation-multi-tenant-convex-applicative.md)), domaine custom optionnel.

PRD : [50_multi_tenant_saas.md](../../prd/50_multi_tenant_saas.md)

## Language

**Tenant** (= **Établissement**) :
1 location physique d'un resto. Possède un `slug` unique (→ sous-domaine `<slug>.kitchen-boost.fr` **technique de bootstrap**, jamais la face publique) et un **domaine de marque custom** (`customDomain`, ex. `bunsbao.fr` — **face publique, norme V1**), 1 compte Stripe Connect Express (potentiellement **partagé** entre tenants même SIRET — cf. ci-dessous), **1 compte Uber Direct** (toujours par tenant — adresse pickup unique), 1 menu, 1 contrat (ou avenant). Statuts : `active` / `pending` / `suspended` / `disabled`.
_Avoid_: Account, Workspace, Restaurant (acceptable français pour l'entité physique), Restaurateur (= terme business pour le gérant)

**Restaurateur** :
Terme business pour parler du gérant qui exploite 1 ou plusieurs Tenants. **Pas une entité DB séparée** (YAGNI — cf. PRD 50 §1). Synonyme du user [[KB Manager]] dans le système. Si Khan a 2 boutiques = 1 user `kb_manager` Khan + 2 lignes `user_tenants`.
_Avoid_: Owner, Account holder, Merchant (anglicisme)

**Slug** :
Identifiant URL-friendly unique du tenant (ex: `buns-bao`). Immuable après création. Sert à composer le sous-domaine. Doit matcher `[a-z0-9-]+`.
_Avoid_: ID, Handle

**Custom domain** :
Domaine de marque acheté par le resto (ex: `bunsbao.fr` / `commander.bunsbao.fr`) pointant vers KB via CNAME. **Face publique du resto = norme V1** (modèle Owner.com). SSL auto. Le sous-domaine `<slug>.kitchen-boost.fr` reste un **bootstrap technique** (URL Day-1 / preview), jamais exposé comme face publique. Résolution tenant : match hostname sur `customDomain`, fallback slug.
_Avoid_: Vanity URL, Branded domain

**users (table)** :
Table d'identité du système, fournie par **Convex Auth** (`authTables`) et étendue avec les champs métier KB. Les **credentials sont gérés par Convex Auth** (`authAccounts` / `authSessions`) — il n'y a **pas de `password_hash`** sur `users`. Champs KB : **`role` global (`kb_admin` | `customer`)** — les rôles resto (`kb_manager` / `staff`) sont **per-tenant** sur `userTenants`, pas ici —, `name`, `email` (+ champs Convex Auth). 1 user = 1 login = 1 humain.
_Avoid_: accounts, profiles, password_hash (Convex Auth possède les credentials)

**user_tenants (table N-N)** :
Table de liaison qui détermine quels tenants un user `kb_manager` ou `staff` peut accéder **et avec quel rôle**. Colonnes : `user_id`, `tenant_id`, **`role` (`kb_manager` | `staff`)**, `attached_at`, `attached_by`, `detached_at` (nullable). Le rôle resto est **per-tenant** (porté ici), pas global. Un user `kb_admin` (root) et un `customer` n'ont aucune ligne ici.
_Avoid_: user_restaurateurs, memberships

**RBAC** :
Role-Based Access Control à **4 rôles V1** :

- **`kb_admin`** (root) — voit tous tenants, fait pipeline / CRM KB / monitoring / impersonation. Rôle **global** porté par `users.role`. Aucune ligne `userTenants`.
- **`kb_manager`** (resto-scoped) — gère menu / cmds / clients / campagnes / pricing. Rôle **per-tenant** porté par `userTenants.role`.
- **`staff`** (resto-scoped, **opérationnel V1**) — attaché à 1+ tenants, accès limité (consult cmds + toggle out of stock), permissions différenciées vs `kb_manager`. Rôle **per-tenant** porté par `userTenants.role`.
- **`customer`** — client final mangeur (user anonyme Convex Auth). Rôle **global** porté par `users.role`. Aucune ligne `userTenants` (lié aux tenants via `customer_orders_per_tenant`).

Résolution : `getCurrentActor(ctx, tenantId?)` lit `users.role` pour kb*admin/customer, sinon résout le rôle effectif via `userTenants.role` du tenant courant. Cf. [ADR 0011](../../adr/0011-convex-auth-v1-identite-encapsulee-workos-differe.md).
\_Avoid*: ACL, Permissions, Owner/Manager (utiliser les noms exacts ci-dessus)

**Isolation tenant (applicative)** :
Convex n'a **pas de RLS** Postgres. L'isolation repose sur de la **discipline applicative** : toute query/mutation métier passe par un helper `tenantQuery` / `tenantMutation` qui throw si le `tenantId` demandé n'est pas dans les tenants accessibles du user (via `user_tenants` ; accès illimité si `kb_admin`). 3 couches : (1) helpers typés obligatoires, (2) règle ESLint `no-untenanted-query` interdisant `ctx.db.query()` brut, (3) suite Vitest fuzz cross-tenant. Cf. [ADR 0010](../../adr/0010-isolation-multi-tenant-convex-applicative.md).
_Avoid_: RLS (mécanisme Postgres, n'existe pas dans Convex), Filter, Sharding (différent)

**tenant_id** :
Colonne `uuid` indexée présente sur **toutes** les tables métier (menus, items, modifiers, orders, payments, customer*orders_per_tenant, push_subscriptions). Aucune query métier sans WHERE tenant_id.
\_Avoid*: org_id, account_id

**Cross-tenant** :
Qualifie une donnée ou un flux qui traverse plusieurs tenants. **Interdit par défaut** (test automatisé V1 : 0 fuite). Exceptions explicites :

- Table `customers` GLOBAL = MOAT (cf. [[Customer Data]])
- Stripe Customer cross-tenant pour carte sauvegardée client final (V1 subject to Q14)
- Stripe Connect partagé entre tenants même SIRET (cf. ci-dessous)
  _Avoid_: Multi-tenant query, Shared (trop vague)

**Stripe Connect partagé** (cas SIRET commun) :
Si plusieurs tenants partagent le même SIRET (cas Walid Thai Street potentiellement), ils peuvent partager le **même** `stripe_account_id`. La colonne `tenants.stripe_account_id` est **non-unique**. Reporting par boutique vient des `metadata.tenant_id` sur PaymentIntents. Si SIRET distincts → 1 Stripe Connect par tenant standard (cas Khan + futur 2ᵉ resto SAS distincte).
_Avoid_: Shared account, Master Stripe

**Uber Direct par tenant** :
Toujours 1 compte Uber Direct par tenant — non négociable (adresse pickup unique par compte Uber Direct). Aucun partage possible même si SIRET commun.
_Avoid_: Shared Uber

**Switcher tenant courant** :
Sélecteur UI dans [[KB Admin]] header et [[KB Orders]] header pour un user attaché à N tenants. Sélection persistée par device (cookie `kb_current_tenant`). Header HTTP `X-Tenant-Id` envoyé sur chaque API request.
_Avoid_: Tenant picker

**Provisioning** :
Création d'un nouveau tenant via wizard dans [[KB Admin]] (V1) : crée la row `tenants`, optionnellement crée le user `kb_manager` + la liaison `user_tenants`, génère sous-domaine, configure Stripe (créer ou rattacher), prépare Uber Direct credentials, génère QR PDF. < 30 min.
_Avoid_: Setup, Onboarding (peut être confondu avec onboarding resto vers Stripe)

**SSO** (Single Sign-On) :
Un seul compte par user, utilisable sur [[KB Admin]] (web) et [[KB Orders]] (app native). Token JWT partagé, refresh régulier.
_Avoid_: Cross-app login, Federation

**Impersonation** :
Capacité d'un `kb_admin` à "se mettre dans la peau" d'un `kb_manager` pour assister/debug. Audit log obligatoire. Visible côté KB Manager sous forme de banner V2.
_Avoid_: Sudo, Login-as

## Example dialogue

**Alex** : Quand un client tape `commander.bunsbao.fr`, comment on retrouve le tenant ?

**Dev** : DNS → CNAME Vercel → match `custom_domain` en DB tenants → on récupère `tenant_id`. Si match échoue, fallback `<slug>.kitchen-boost.fr`. Le `tenant_id` est injecté dans le contexte de chaque requête backend, et tout WHERE métier filtre dessus. PWA client = pas de user authentifié, scope unique par domain match.

**Alex** : Khan login KB Admin. Comment on s'assure qu'il voit que son tenant Buns & Bao ?

**Dev** : 3 couches **applicatives** (Convex n'a pas de RLS). (1) Le helper `tenantQuery`/`tenantMutation` reçoit le `tenantId` en argument et throw si Khan n'y a pas accès (résolu via `user_tenants` au moment de l'appel ; `kb_admin` = accès illimité). (2) La règle ESLint `no-untenanted-query` empêche tout `ctx.db.query()` brut qui contournerait le helper. (3) La suite Vitest fuzz cross-tenant rejoue chaque mutation avec un `tenantId` non autorisé et exige un throw. Test V1 : 2 tenants créés, accès A→B = erreur Forbidden.

**Alex** : Walid Thai Street. Il login. Combien il voit de tenants ?

**Dev** : 3 (ou plus, selon réalité). Walid a 3 lignes `user_tenants` (saint-michel, chatelet, bastille). Switcher de tenant courant persisté par device (cookie `kb_current_tenant`). Chaque query passe le `tenantId` courant ; le helper vérifie qu'il est bien dans les `user_tenants` de Walid, sinon throw. Toute tentative de query un tenant non listé est rejetée côté helper.

**Alex** : Walid a même SIRET pour ses 3 restos. Combien de Stripe Connect ?

**Dev** : Si SIRET unique → 1 seul Stripe Connect partagé. Les 3 rows tenants pointent vers le même `stripe_account_id`. On distingue par `metadata.tenant_id` sur chaque PaymentIntent pour reporting. Si Stripe refuse de créer 1 acct pour 3 boutiques distinctes même SIRET (Q50-Q7 à tester sandbox), on aura juste 1 acct shared d'office. Côté Uber Direct : 3 comptes obligatoires (1 par adresse pickup).

**Alex** : Et la base clients ?

**Dev** : Exception explicite. La table `customers` n'a PAS de `tenant_id`, c'est **global** = MOAT KB. La liaison se fait via `customer_orders_per_tenant`. Walid voit ses clients filtrés par les 3 tenant_ids de ses restos. Le customer record en lui-même appartient à KB cross-tenant.

**Alex** : Si je veux supporter Khan en dépannage ?

**Dev** : Impersonation depuis KB Admin. Tu cliques "Impersonate Khan" sur la page détail tenant. Audit log enregistre. Tu vois le dashboard avec ses yeux. Sortie = log fermeture. V2 on ajoute un banner visible côté Khan pour transparence.
