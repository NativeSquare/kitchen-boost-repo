# Multi-Tenant

Le contexte transverse de l'isolation des établissements et de la sécurité d'accès. **Tous** les contextes métier s'appuient sur ce socle : `tenant_id` sur tout objet métier, table `users` + liaison `user_tenants` N-N, RBAC à 3 rôles, RLS Postgres, domaine custom optionnel.

PRD : [50_multi_tenant_saas.md](../../prd/50_multi_tenant_saas.md)

## Language

**Tenant** (= **Établissement**) :
1 location physique d'un resto. Possède un `slug` unique, un sous-domaine `<slug>.kitchen-boost.fr` (optionnel : custom domain via CNAME), 1 compte Stripe Connect Express (potentiellement **partagé** entre tenants même SIRET — cf. ci-dessous), **1 compte Uber Direct** (toujours par tenant — adresse pickup unique), 1 menu, 1 contrat (ou avenant). Statuts : `active` / `pending` / `suspended` / `disabled`.
_Avoid_: Account, Workspace, Restaurant (acceptable français pour l'entité physique), Restaurateur (= terme business pour le gérant)

**Restaurateur** :
Terme business pour parler du gérant qui exploite 1 ou plusieurs Tenants. **Pas une entité DB séparée** (YAGNI — cf. PRD 50 §1). Synonyme du user [[KB Manager]] dans le système. Si Khan a 2 boutiques = 1 user `kb_manager` Khan + 2 lignes `user_tenants`.
_Avoid_: Owner, Account holder, Merchant (anglicisme)

**Slug** :
Identifiant URL-friendly unique du tenant (ex: `buns-bao`). Immuable après création. Sert à composer le sous-domaine. Doit matcher `[a-z0-9-]+`.
_Avoid_: ID, Handle

**Custom domain** :
Domaine personnalisé acheté par le resto (ex: `commander.bunsbao.fr`) pointant vers KB via CNAME Vercel. Optionnel V1. SSL Let's Encrypt auto. Fallback sur sous-domaine KB toujours actif.
_Avoid_: Vanity URL, Branded domain

**users (table)** :
Table d'identité auth du système. Colonnes : `id`, `email` (unique), `name`, `password_hash`, `role` (`kb_admin` / `kb_manager` / `staff`), `created_at`. 1 user = 1 login = 1 humain.
_Avoid_: accounts, profiles

**user_tenants (table N-N)** :
Table de liaison qui détermine quels tenants un user `kb_manager` (ou `staff` V2) peut accéder. Colonnes : `user_id`, `tenant_id`, `attached_at`, `attached_by`, `detached_at` (nullable). Un user `kb_admin` (root) n'a aucune ligne ici — accès illimité via role.
_Avoid_: user_restaurateurs, memberships

**RBAC** :
Role-Based Access Control à 3 rôles V1 :
- **`kb_admin`** (root) — voit tous tenants, fait pipeline / CRM KB / monitoring / impersonation
- **`kb_manager`** (resto-scoped) — voit ses tenants via `user_tenants`, gère menu / cmds / clients / campagnes / pricing
- **`staff`** (V2) — attaché à 1 tenant précis, accès limité (consult cmds + toggle out of stock)
_Avoid_: ACL, Permissions, Owner/Manager (utiliser les noms exacts ci-dessus)

**RLS** (Row-Level Security) :
Mécanisme Postgres qui filtre automatiquement les lignes selon `tenant_id = current_setting('app.tenant_id')`. Couche de défense en profondeur en plus du WHERE applicatif. Le `app.tenant_id` est settable selon le user : `kb_admin` n'importe quel tenant, `kb_manager` uniquement tenants présents dans son `user_tenants`.
_Avoid_: Filter, Sharding (différent)

**tenant_id** :
Colonne `uuid` indexée présente sur **toutes** les tables métier (menus, items, modifiers, orders, payments, customer_orders_per_tenant, push_subscriptions). Aucune query métier sans WHERE tenant_id.
_Avoid_: org_id, account_id

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

**Dev** : 4 couches. (1) JWT contient `user_id`, `role=kb_manager`, `tenant_ids=[buns-bao]`. (2) Header X-Tenant-Id de la requête doit être dans `tenant_ids`. Sinon 403. (3) Middleware applicatif vérifie le scope. (4) RLS Postgres re-filtre — si bug applicatif, la DB refuse quand même. Test automatisé V1 : 2 tenants créés, accès dashboard A vers B = 403.

**Alex** : Walid Thai Street. Il login. Combien il voit de tenants ?

**Dev** : 3 (ou plus, selon réalité). JWT `tenant_ids=[saint-michel, chatelet, bastille]`. Switcher en header. Au login, on tape par défaut sur le dernier sélectionné (cookie). Toutes les vues filtrent sur `X-Tenant-Id` = tenant courant. RLS Postgres bloque toute tentative de query un tenant non listé dans son JWT.

**Alex** : Walid a même SIRET pour ses 3 restos. Combien de Stripe Connect ?

**Dev** : Si SIRET unique → 1 seul Stripe Connect partagé. Les 3 rows tenants pointent vers le même `stripe_account_id`. On distingue par `metadata.tenant_id` sur chaque PaymentIntent pour reporting. Si Stripe refuse de créer 1 acct pour 3 boutiques distinctes même SIRET (Q50-Q7 à tester sandbox), on aura juste 1 acct shared d'office. Côté Uber Direct : 3 comptes obligatoires (1 par adresse pickup).

**Alex** : Et la base clients ?

**Dev** : Exception explicite. La table `customers` n'a PAS de `tenant_id`, c'est **global** = MOAT KB. La liaison se fait via `customer_orders_per_tenant`. Walid voit ses clients filtrés par les 3 tenant_ids de ses restos. Le customer record en lui-même appartient à KB cross-tenant.

**Alex** : Si je veux supporter Khan en dépannage ?

**Dev** : Impersonation depuis KB Admin. Tu cliques "Impersonate Khan" sur la page détail tenant. Audit log enregistre. Tu vois le dashboard avec ses yeux. Sortie = log fermeture. V2 on ajoute un banner visible côté Khan pour transparence.
