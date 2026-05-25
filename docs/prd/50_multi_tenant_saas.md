# 50 — Multi-tenant SaaS

**Statut** : 🟡 Squelette · **Version** : 0.3 · **Dernière mise à jour** : 2026-05-23
**Lié au master** : [00_master.md § 5 bloc 6](00_master.md#5-surface-fonctionnelle-macro-vue-doiseau)

> **v0.3** : Refonte sémantique. **`users` + `user_tenants` (N-N) dès V1** pour le cas Walid Thai Street (1 KB Manager → 3 tenants). Pas de table `restaurateurs` séparée (YAGNI — le "Restaurateur" est un terme business synonyme du user KB Manager). Stripe Connect peut être **partagé entre tenants** si même SIRET (`tenants.stripe_account_id` non-unique). Uber Direct toujours 1-par-tenant (imposé par adresse pickup). Rôles : **KB Admin** (root) / **KB Manager** (resto) / **Staff** (V2).

> **v0.2** : Scope V1 étendu suite révision master v2.0. **RBAC dès V1**. **Wizard onboarding outillé dès V1**.

---

## Scope

| Horizon | Inclus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | Modèle de données multi-tenant (`tenant_id` sur tous les objets métier). **Table `users`** (identité auth) + **table `user_tenants` (N-N)** : un user peut être attaché à 1 ou N tenants (cas Walid). **RBAC** à 3 rôles : `KB Admin` (root, voit tous tenants) / `KB Manager` (resto-scoped, accès aux tenants listés dans `user_tenants`) / `Staff` (V2). Wizard onboarding via [70 KB Admin](70_kb_admin.md) pour provisioning rapide (< 30 min). Sous-domaine auto `<slug>.kitchen-boost.fr`, custom domain CNAME Vercel. Isolation données stricte via WHERE `tenant_id` + RLS Postgres. Branding minimal par tenant (logo + couleur). SSO unifié [70 KB Admin](70_kb_admin.md) + [20 KB Orders](20_kb_orders.md). **Stripe Connect partageable** entre tenants si même SIRET (`tenants.stripe_account_id` non-unique). **Uber Direct toujours 1-par-tenant** (adresse pickup unique). |
| **V2**  | Multi-utilisateur par tenant (owner + staff cuisine + staff caisse + manager), invites equipe, branding étendu (multi-couleurs, fonts, hero), backups isolés par tenant, self-serve onboarding resto (form public + validation KB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **V3**  | Multi-langue par tenant, multi-pays (TVA, devises), sharding DB si scale (>1000 tenants), audit log RGPD complet par tenant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Hors scope

- Self-service signup public (un resto qui s'inscrirait seul). Onboarding KB reste sales-led en V1/V2.
- Marketplace KB ou page "tous les restos KB". Chaque tenant a son URL propre.
- Plans tarifaires différenciés par tenant (V1 = tout le monde paie 2€/cmd flat).

## Personas concernés

- **Restaurateur** (utilise un tenant qui lui est dédié)
- **Admin KB interne** (créé, supervise, debug les tenants — cf. [70](70_kb_admin.md))
- **Client final mangeur** (utilise la PWA du tenant — isolation invisible pour lui)

## Surface fonctionnelle (sections à remplir)

### 1. Modèle de données multi-tenant

#### 1.1 Tables principales

- **`tenants`** : `id`, `slug` (unique), `name`, `siret`, `custom_domain` (nullable), `status` (`active` / `pending` / `suspended` / `disabled`), `branding` (logo_url, primary_color), `stripe_account_id` (FK Stripe Connect, **non-unique** — peut être partagé si même SIRET), `uber_customer_id` (unique — 1 par tenant), `uber_credentials_encrypted`, `created_at`
- **`users`** : `id`, `email` (unique), `name`, `password_hash`, `role` (`kb_admin` / `kb_manager` / `staff`), `created_at`
- **`user_tenants`** (table de liaison N-N) : `user_id`, `tenant_id`, `attached_at`, `attached_by` (qui a fait l'attache, audit). Un user `kb_manager` peut avoir 1 à N lignes ici. Un `kb_admin` (root) n'a aucune ligne ici (accès illimité via role).
- Toutes les tables métier (`menus`, `items`, `modifiers`, `orders`, `payments`, `push_subscriptions`, `customer_orders_per_tenant`) ont une colonne `tenant_id` indexée.
- **`customers`** reste **GLOBAL** (pas scopé par tenant, c'est le moat KB — cf. [90](90_donnees_clients_crm.md)). Liaison via `customer_orders_per_tenant`.

#### 1.2 RLS Postgres

> ⚠️ **Périmé (2026-05-25)** — Stack = Convex, **pas de RLS Postgres**. Isolation 100 % applicative via helpers `withTenant`. Cf. [ADR 0010](../adr/0010-isolation-multi-tenant-convex-applicative.md). Le mapping des droits par rôle ci-dessous reste valide (qui accède à quel tenant), mais l'enforcement est applicatif (helper qui throw), pas DB.

- `tenant_id = current_setting('app.tenant_id')` sur tables métier
- Le `app.tenant_id` du contexte est settable selon le user :
  - `KB Admin` : peut set n'importe quel tenant_id (root)
  - `KB Manager` : peut set uniquement un tenant_id présent dans son `user_tenants`
  - `Staff` (V2) : peut set uniquement son tenant attaché

#### 1.3 Cas Walid (3 tenants partagés)

- 1 ligne `users` : Walid (`role=kb_manager`)
- 3 lignes `tenants` : Thai Street Saint Michel, Thai Street Châtelet, Thai Street Bastille (slugs distincts, sub-domains distincts, menus distincts, sous-domaines distincts)
- 3 lignes `user_tenants` (Walid_id × tenant_id × `attached_at`)
- **Stripe** : si les 3 tenants ont le **même SIRET**, ils peuvent partager `stripe_account_id`. La distinction par boutique vient des `metadata.tenant_id` sur chaque PaymentIntent.
- **Uber Direct** : 3 comptes Uber Direct distincts (1 par tenant — adresses pickup différentes obligatoires).

### 2. Provisioning d'un tenant (V1 = CLI/script)

- Input : slug, name, contact email, adresse resto
- Action :
  1. INSERT row dans `tenants` (`slug` + `customDomain?`)
  2. Génération sous-domaine bootstrap `<slug>.kitchen-boost.fr` via Vercel API (URL technique Day-1)
  3. Rattachement du **domaine de marque custom** = face publique (CNAME, cf. §3) — peut être configuré dès l'onboarding ou juste après
  4. Génération lien onboarding Stripe Connect Express (cf. [30](30_paiement_stripe_connect.md))
  5. Création repo de config tenant dans `clients/<slug>/` (suivi git)
- Output : URL admin tenant + lien Stripe à envoyer au resto

### 3. Domaine de marque custom (CNAME) — face publique, **norme V1**

**Le domaine de marque du resto EST la face publique (norme V1, modèle Owner.com).** Le sous-domaine `<slug>.kitchen-boost.fr` n'est qu'un **bootstrap technique** (URL Day-1 / preview), jamais exposé comme face publique.

- Resto achète son domaine (ex: `bunsbao.fr` / `commander.bunsbao.fr`) chez OVH/Gandi/etc.
- Configure CNAME vers `<slug>.kitchen-boost.fr.cdn.vercel-dns.com`
- KB ajoute le domaine au tenant (champ `customDomain`) via API Vercel
- SSL auto-provisionné
- Le sous-domaine KB reste actif en parallèle **comme bootstrap technique** (jamais la face publique). Résolution tenant : match hostname sur `customDomain`, fallback slug.

### 4. Branding par tenant (V1 minimal)

- Logo (PNG/SVG, upload via admin)
- Couleur primaire (hex)
- Stocké en DB `tenants.branding`
- Reflété en PWA via CSS variables paramétrées

### 5. Routing & extraction du tenant_id

#### 5.1 Côté PWA client ([10](10_pwa_client_commande.md))

- Tenant extrait de `window.location.hostname` : **match `customDomain` en DB tenants d'abord** (face publique), fallback slug du sous-domaine bootstrap
- Backend API : `Host` header validé contre DB tenants → `tenant_id` injecté dans contexte
- Middleware refuse les requêtes non-scopées

#### 5.2 Côté KB Admin / KB Orders (user authentifié)

- JWT contient : `user_id`, `role`, `tenant_ids` (liste vide si `kb_admin` root, ou liste des tenants accessibles si `kb_manager`)
- Header HTTP `X-Tenant-Id` ou query param `?tenant=<id>` indique le **tenant courant** sélectionné (cas Walid switcher)
- Middleware vérifie : `tenant_id` demandé ∈ `tenant_ids` du JWT (ou role = kb_admin)
- Si invalide → 403 Forbidden, log audit

#### 5.3 Persistance du tenant courant

- Cookie HttpOnly `kb_current_tenant=<tenant_id>` sur le device user
- Resetté au switch via UI ou si suspension du tenant courant
- Si user a 1 seul tenant : aucune persistance nécessaire, c'est implicite

### 6. Isolation des données

- Aucune query métier sans scope `tenant_id` (via helpers `withTenant` — pas de RLS, cf. [ADR 0010](../adr/0010-isolation-multi-tenant-convex-applicative.md))
- Tests automatisés : créer 2 tenants, vérifier qu'aucune fuite cross-tenant n'est possible via API
- Logs scopés par tenant (Sentry tags, etc.)

### 7. Onboarding back-office (V2)

- Wizard admin pour créer un tenant en < 30 min
- Form Stripe Connect, génération domain, import menu (CSV ou Uber Eats Manager), génération QR sticker imprimable PDF, activation 1-click

### 8. Backups & disaster recovery

- Backup quotidien géré par **Convex** (plateforme ; pas de Postgres/Supabase)
- Restauration possible par tenant (V2)
- Plan DR : RTO 4h, RPO 24h en V1, plus strict en V2

### 9. Monitoring & observabilité

- Sentry : errors taggés par tenant
- UptimeRobot : check PWA + KDS chaque 5 min
- Dashboard ops : statut Stripe / Uber Direct / Vercel par tenant
- Alertes Slack ops sur incident

### 10. Scaling considerations

- V1 : 5-10 tenants → 1 backend, 1 DB. Trivial.
- V2 : 30-50 tenants → 1 backend, 1 DB (caching agressif), CDN PWA.
- V3 : 100+ tenants → évaluer sharding par région / cluster.

## Flows nominaux

1. **Création tenant Buns & Bao + KB Manager Khan** : Alex utilise wizard [70 KB Admin](70_kb_admin.md) → renseigne infos → row DB `tenants` créée + sous-domaine + Stripe Connect → row `users` Khan créée (role=`kb_manager`) → row `user_tenants` (Khan × Buns & Bao) → lien magique envoyé à Khan via WhatsApp → Khan login → voit son seul tenant.
2. **Ajout d'un 2ᵉ tenant à Walid (déjà KB Manager pour 2 restos)** : Alex ouvre [70 KB Admin](70_kb_admin.md) → "Nouveau tenant pour user existant" → wizard avec `user_id` pré-rempli sur Walid → soit nouveau Stripe Connect (SIRET différent), soit rattachement au Stripe existant de Walid (même SIRET) → 1 nouveau compte Uber Direct créé obligatoirement → row `user_tenants` ajoutée (Walid × Thai Street Bastille) → contrat ou avenant signé.
3. **Custom domain setup** : Khan achète `bunsbao-direct.fr` chez OVH → Alex ajoute le domaine au tenant via [70 KB Admin](70_kb_admin.md) → Khan configure CNAME chez OVH → propagation → SSL auto Vercel → custom domain actif (fallback sous-domaine KB reste actif).
4. **Client final commande chez Buns & Bao** : client tape `commander.bunsbao.fr` → DNS → Vercel → match `custom_domain` en DB → `tenant_id = buns-bao` → PWA affiche menu Buns & Bao.
5. **Walid switche entre ses 3 restos dans KB Orders / KB Admin** : login → sélecteur header affiche "Thai Street Saint Michel" → tap → choisit "Thai Street Châtelet" → header X-Tenant-Id changé → contexte rechargé → toutes vues filtrées sur tenant Châtelet.

## Edge cases

- **2 restos veulent le même slug** : refus, slug unique. Suggérer variantes.
- **Resto change de nom** : slug reste stable (URL ne change pas pour les clients existants). Branding change.
- **Resto résilie** : tenant passe en status `suspended`, data conservée 3 ans (Art 2 bis.2 RGPD), base clients reste KB. Si user `kb_manager` n'a plus aucun tenant actif → login désactivé, message d'explication.
- **Custom domain expire chez resto** : fallback sur sous-domaine KB. Notif resto.
- **Resto change d'IBAN Stripe** : géré dans Stripe Dashboard, KB pas impacté.
- **Compromission credentials Uber Direct d'un tenant** : rotation manuelle, notif Slack ops, audit log.
- **Suspension Stripe Connect d'un tenant** : tenant passe en `disabled`, PWA bloque checkout, KB Orders affiche bannière "tenant suspendu".
- **Walid SIRET unique pour 3 tenants** : 1 seul Stripe Connect partagé, `tenants.stripe_account_id` pointe vers le même acct_xxx pour les 3 lignes. Reporting par boutique via `metadata.tenant_id` sur PaymentIntents.
- **Walid SIRET différents pour 3 tenants** : 3 Stripe Connect distincts (cas standard). Auto-géré par le wizard onboarding.
- **Suppression d'un attachement `user_tenants`** : Walid n'est plus KB Manager du tenant Châtelet (cession, fermeture). Soft delete recommandé (col `detached_at`) pour préserver l'audit log de qui a accédé quand. Le tenant lui reste actif s'il a un autre KB Manager.
- **User sans aucun tenant attaché** (cas erreur ou nouveau user pas encore lié) : login OK mais redirection vers page "Aucun tenant — contactez KB".
- **KB Admin (root) qui tente d'accéder à un tenant suspendu** : OK, accès en lecture seule pour debug, action `réactiver` disponible.
- **Switcher tenant courant : user clique sur un tenant qu'il n'a plus (révoqué après login)** : 403 Forbidden, force re-login pour refresh JWT.

## Critères de succès / acceptation

### V1

- [ ] Création tenant via wizard [70 KB Admin](70_kb_admin.md) en < 30 min.
- [ ] Test cross-tenant fuite : 2 tenants créés, audit manuel + automatisé prouvent 0 fuite (data + API + DB).
- [ ] Custom domain Buns & Bao actif avec SSL.
- [ ] Branding logo + couleur reflétés en PWA.
- [ ] Sentry monitoring opérationnel avec tags tenant.
- [ ] Cas Walid : 1 user `kb_manager` attaché à 3 tenants, switch entre les 3 dans KB Orders et KB Admin testé.
- [ ] Stripe Connect partagé entre 2 tenants même SIRET fonctionne (PaymentIntents avec `metadata.tenant_id` distinguent les boutiques).
- [ ] RBAC strict : KB Manager A ne peut JAMAIS accéder à tenant de KB Manager B (test automatisé).
- [ ] SSO unifié KB Admin web + KB Orders mobile (1 login, 2 surfaces).

### V2

- [ ] Multi-utilisateur par tenant (Staff cuisine + caisse).
- [ ] Restauration backup d'un tenant en < 4 h en cas d'incident.

## Dépendances

| Dépendance                                                                                             | Type    | Bloque quoi                                         |
| ------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------- |
| Convex (source de vérité unique, [ADR 0010](../adr/0010-isolation-multi-tenant-convex-applicative.md)) | Externe | Toute la base de données (pas de Postgres/Supabase) |
| Vercel API (domains, edge functions)                                                                   | Externe | Sections 2, 3                                       |
| Tous les sous-PRDs (10/20/30/40/80/90)                                                                 | Interne | Doivent respecter tenant_id                         |
| [30_paiement_stripe_connect.md](30_paiement_stripe_connect.md)                                         | Interne | Stripe account par tenant                           |
| [40_livraison_uber_direct.md](40_livraison_uber_direct.md)                                             | Interne | Uber credentials par tenant                         |
| [70_kb_admin.md](70_kb_admin.md)                                                                       | Interne | UI provisioning V2                                  |

## Open questions

| Q      | Question                                                                                                                                                                                                               | Deadline | Owner                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| 50-Q1  | ~~DB Postgres self-hosted ou Supabase managed ?~~ ✅ **Résolu : Convex** (ADR 0010)                                                                                                                                    | V1 S0    | Dev lead                |
| 50-Q2  | ~~RLS Postgres ou enforcement applicatif uniquement ?~~ ✅ **Résolu : applicatif (helpers `withTenant`)** (ADR 0010)                                                                                                   | V1 S1    | Dev lead                |
| 50-Q3  | Custom domain : KB propose un achat groupé `.shop` ou laisse resto acheter ? (Q7 master)                                                                                                                               | V1       | Alex                    |
| 50-Q4  | Politique de suppression data si resto résilie (Article 2 bis.2 contrat : 3 ans post-résil) — comment matérialiser techniquement ?                                                                                     | V2       | Dev + legal             |
| 50-Q5  | Backups : Supabase point-in-time recovery suffit-il ou besoin de backups offsite (S3) ?                                                                                                                                | V2       | Dev lead                |
| 50-Q6  | ~~Multi-utilisateur par tenant (Staff cuisine + caisse) en V1 ou V2 ?~~ ✅ **Résolu : `staff` opérationnel V1** (rôle per-tenant sur `userTenants`). Élargit le scope V1 (invites équipe + permissions différenciées). | V1       | Alex                    |
| 50-Q7  | Stripe Connect partagé entre tenants même SIRET : Stripe va-t-il refuser de créer 2 acct distincts pour le même SIRET ? À tester avec un sandbox. Si oui, partage obligatoire ; si non, choix wizard.                  | V1 S1    | Dev lead (test sandbox) |
| 50-Q8  | Cas Walid Thai Street : combien de tenants ? Quels SIRET (même ou différents pour ses N restos) ? Pour calibrer le wizard "ajouter un tenant à un user existant".                                                      | V1 S0    | Alex (call Walid)       |
| 50-Q9  | Switcher tenant UX dans KB Admin web + KB Orders mobile : sélecteur header, sidebar, ou bottom sheet ? Cohérence entre web et mobile.                                                                                  | V1       | Produit                 |
| 50-Q10 | Tenant courant en URL (`?tenant=<slug>`) ou en cookie seulement ? URL = partageable mais peut leak ; cookie = caché mais friction si copy URL.                                                                         | V1       | Dev lead                |

## Notes / décisions actées

- **Tenant = 1 établissement physique signé** = 1 location, 1 contrat (ou avenant), 1 Uber Direct, 1 menu, 1 domaine de marque custom (face publique) + 1 sous-domaine bootstrap. Pas de tenant pour des prospects.
- **Pas de table `restaurateurs` séparée (YAGNI)**. Le "Restaurateur" est un terme business synonyme du user KB Manager. Si Khan a 2 boutiques, c'est 2 tenants + 1 user `kb_manager` Khan avec 2 lignes `user_tenants`.
- **Multi-tenant per user dès V1** (cas Walid Thai Street). Switcher dans header de KB Admin + KB Orders. Cas typique reste 1-tenant (Khan).
- **Stripe Connect partageable** entre tenants même SIRET (`tenants.stripe_account_id` non-unique). Reporting par boutique via `metadata.tenant_id`. Si SIRET distincts → 1 Stripe Connect par tenant standard.
- **Uber Direct toujours 1-par-tenant** (adresse pickup unique par compte). Pas négociable.
- **4 rôles V1** : `kb_admin` (root, global) / `customer` (client final, global) — sur `users.role` ; `kb_manager` + `staff` (**per-tenant**, sur `userTenants.role`). `staff` est **opérationnel V1** (décision 2026-05-25, cf. 50-Q6) — multi-utilisateur par tenant inclus en V1.
- **Customers reste global** (cross-tenant) — moat KB. Cf. [90](90_donnees_clients_crm.md) et [feedback_db_clients_moat](../../.claude/memory/feedback_db_clients_moat.md).
- **Domaine de marque custom = norme V1** (face publique de chaque resto, modèle Owner.com). Le sous-domaine `<slug>.kitchen-boost.fr` est un **bootstrap technique** (URL Day-1 / preview), jamais la face publique. Résolution tenant = match `customDomain`, fallback slug ([décision 2026-05-25](../adr/0008-identite-customer-cookie-device-only-v1.md)).
- **Pas de plan tarifaire différencié V1** (tout le monde paie 2€/cmd).
- **Cf. [feedback_uber_account_strategy](../../.claude/memory/feedback_uber_account_strategy.md)** : possiblement 1 compte Uber Manager dédié par tenant pour préserver crédits pub Uber (à confirmer call AM).

## Changelog

| Date       | Version | Auteur            | Notes                                                                                                                                                                                                                                                      |
| ---------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | 0.1     | Alex (via Claude) | Création squelette.                                                                                                                                                                                                                                        |
| 2026-05-23 | 0.2     | Alex (via Claude) | Extension scope V1 : RBAC formalisé, wizard onboarding admin KB V1, SSO dashboard/app native.                                                                                                                                                              |
| 2026-05-23 | 0.3     | Alex (via Claude) | Refonte sémantique : `users` + `user_tenants` (N-N) V1 pour multi-tenant per user (cas Walid). Pas de table `restaurateurs` (YAGNI). Stripe Connect partageable si même SIRET. Uber Direct toujours 1-par-tenant. 3 rôles : kb_admin / kb_manager / staff. |
