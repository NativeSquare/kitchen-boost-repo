# KB Admin

Le contexte de **l'unique app web** `KitchenBoost Admin` qui couvre toutes les opérations business du système, scopée par **RBAC**. Un [[KB Admin]] (root) y voit tous les tenants et fait la supervision globale (pipeline onboarding, CRM, contrats, monitoring). Un [[KB Manager]] (gérant resto) y voit son ou ses tenants et fait la gestion opérationnelle (menu, cmds, clients masqués, campagnes, pricing, QR, paramètres). **Pas de Merchant Dashboard séparé** — la même app, scopée par rôle.

PRD : [70_kb_admin.md](../../prd/70_kb_admin.md)

> **Note de fusion** : ce contexte résulte du regroupement des anciens `kb-admin` (interne KB) et `merchant-dashboard` (resto-side). Une seule app, RBAC scope la vue.

## Language

**KitchenBoost Admin** (= **KB Admin app**) :
L'app web unique du système, accessible via `admin.kitchen-boost.com` (ou équivalent — Q70-Q12). 1 codebase, 1 login, 1 URL. Le RBAC scope les composants et les routes API ; l'isolation des données est **applicative Convex** ([ADR 0010](../../adr/0010-isolation-multi-tenant-convex-applicative.md)), **pas de RLS Postgres**.
_Avoid_: Backoffice (ambigu), Merchant Dashboard (terme aboli), Resto Dashboard (idem)

**KB Admin** (rôle) :
Rôle root, **interne KB** (Alex en V1, équipe ops/support V2). Voit tous les tenants, tous les users, fait pipeline onboarding, monitoring, impersonation, partage clients KB → resto. Pas d'attache à un tenant précis (accès illimité).
_Avoid_: Superuser, Root, Admin (générique)

**KB Manager** (rôle) :
Rôle du gérant resto. Attaché à 1 ou N tenants via [[user_tenants]]. Voit uniquement ses tenants. Le **switcher tenant** en header permet de naviguer entre ses tenants (cas Walid).
_Avoid_: Owner (anglicisme), Gérant (acceptable français informel)

**Staff** (V2) :
Rôle employé d'un tenant précis (cuisinier, caissier). Accès limité : consultation cmds + toggle out of stock items. V1 pas implémenté.
_Avoid_: Employee, Worker

**Impersonation** :
Action [[KB Admin]] pour assister un resto en agissant sur ses surfaces opérationnelles ([[Vue opérationnelle]]). **V1 = pas de plomberie dédiée** : le KB Admin ouvre simplement la vue opérationnelle d'un tenant (le root override des wrappers lui donne accès), signalé par un **bandeau côté KB Admin** ("Mode admin — tu consultes \<resto\>"). Le bandeau côté KB Manager ("KB est connecté à votre compte") + l'audit log = V2. Cf. [ADR 0014](../../adr/0014-shell-kb-admin-unique-scoping-rbac-front.md).
_Avoid_: Sudo, Login-as, Act-as

**Switcher tenant courant** :
Sélecteur **toujours présent** dans le header. Sa **valeur** = le contexte courant ; ses **options** s'adaptent au rôle. [[KB Manager]] → ses tenants (`session.tenants`) ; [[KB Admin]] → recherche sur **tous** les tenants + une entrée [[Mode supervision]]. Le tenant courant est porté par l'URL ; le cookie `kb_current_tenant` n'est qu'un indice du dernier resto ouvert. Cf. [ADR 0014](../../adr/0014-shell-kb-admin-unique-scoping-rbac-front.md).
_Avoid_: Tenant picker

**Mode supervision** :
État du [[KB Admin]] quand il opère "au-dessus de tous les tenants" (pipeline onboarding, CRM KB, monitoring, liste tenants) — aucun tenant précis n'est courant. S'oppose à la [[Vue opérationnelle]]. Le [[Switcher tenant courant]] affiche alors "Supervision".
_Avoid_: Vue globale, Dashboard admin

**Vue opérationnelle** (resto) :
Les surfaces scopées à UN tenant (édition menu, commandes, vue "Mes clients", campagnes, pricing, QR, paramètres), vues par le [[KB Manager]] de ce tenant — ou par le [[KB Admin]] en assistance ([[Impersonation]]). Backend = wrappers `tenantQuery` ; le tenant courant vient de l'URL.
_Avoid_: Dashboard resto, Espace resto

**Pipeline onboarding** :
Vue Kanban / liste matérialisant le parcours d'un resto. **Source de vérité = DB de `KitchenBoost Admin`** (acté 2026-05-23). Le doc `project_onboarding_process.md` reste mais devient **narratif uniquement** (le pourquoi du process, pas l'état opérationnel par resto). Accessible côté rôle KB Admin uniquement. Structure à 2 niveaux : phases macro + milestones d'intégration (cf. [[Milestone]]).
_Avoid_: Funnel, Sales pipeline

**Phase pipeline** (Acquisition / Préparation / Installation / Opérationnel) :
4 valeurs énumérées de l'état d'un resto dans le pipeline (acté 2026-05-23).

- **Acquisition** = de la création du prospect jusqu'au [[Closing]]. Tous les milestones commerciaux (RDV, devis, contrat, docs).
- **Préparation** = post-Closing. Intégrations Stripe + Uber Direct + Hubrise + menu + packaging. Acteurs : KB Admin pilote, resto fournit infos / valide KYC.
- **Installation** = install physique sur place. Tablette, QR stickers, sticker packaging, création user KB Manager, 1ère cmd publique.
- **Opérationnel** = run post-1ère cmd. **Filtré du Kanban CRM par défaut** (sinon ingérable à terme), accessible via onglet "Clients actifs" séparé.

_Avoid_: A/B/B+/C/D (ancienne nomenclature, abandonnée 2026-05-23), Stage, Step

**Closing** :
**Événement** (et non une phase de durée) déclenchant la bascule auto Acquisition → Préparation. Composite de 4 milestones obligatoires + 1 conditionnel :

- Contrat signé (Odoo)
- KBIS reçu
- Pièce d'identité reçue
- RIB reçu
- (conditionnel si `tablette_mode=achat_kb`) Facture tablette payée
  Dès que tous les milestones applicables sont cochés, le resto bascule en Préparation automatiquement.
  _Avoid_: Phase Closing, Closed status

**Milestone** :
Unité élémentaire d'avancement dans le pipeline d'un resto. Soit binaire (`Contrat signé : oui/non`), soit composite (statut courant + historique horodaté, pour les intégrations Stripe / Uber Direct qui peuvent osciller : `pending → verified → rejected → pending → verified`). Affiché dans la page détail tenant.
_Avoid_: Step, Task, Checkpoint

**Checklist phase** :
Liste de prérequis cochables pour passer d'une phase à la suivante (ex: B+ exige contrat signé + 3 docs Uber + canal comm testé + liste articles + prix net + photos emballages). Affichée sur la page détail resto. Bypass possible V1 mais loggé (cf. Q70-Q10).
_Avoid_: Requirements, To-do

**Embed Stripe KYC** :
Module embarqué dans KB Admin qui affiche le statut Stripe KYC d'un tenant en temps réel (`pending` / `verified` / `rejected`). Évite d'ouvrir Stripe Dashboard manuellement. Implémenté via `account.retrieve` API + webhook `account.updated`, ou via Stripe Connect Embedded Components (Q70-Q6).
_Avoid_: Stripe widget (ambigu)

**Prospect** :
Un resto démarché ou identifié comme cible mais **pas encore signé**. Distinct de [[Tenant]] (signé, en phase B+ ou plus). Stocké en DB avec phase, source, score. Initial = `crm_prospects.csv` migré en DB au build V1.
_Avoid_: Lead, Suspect

**Contrat HTML** :
Document généré par `tools/generate_contract.py` (script Python existant), nourri par infos du prospect/tenant + sélection prestation A / B / A&B. Output HTML stocké dans KB, lien envoyé vers Odoo pour signature. **KB ne fait PAS la signature** — Odoo s'en charge.
_Avoid_: Contract template (= le markdown source), Contract PDF (= post-signature)

**Statut contrat** :
État cycle de vie du contrat lié à un tenant : `draft` → `sent` → `signed` → `expired`. Mis à jour via webhook Odoo si dispo, sinon check manuel.
_Avoid_: Contract state

**CRM (KB interne)** :
Outil de gestion des [[Prospect]] et tenants côté commercial. Source initiale = `crm_prospects.csv`. Volontairement minimaliste : pas de pipeline opportunités $$, pas de séquences auto, pas d'email tracking.
_Avoid_: CRM (ambigu avec [[Customer Data]] qui concerne les clients finaux mangeurs). Préfixer "CRM KB" si ambigu.

**Wizard tenant** :
UI multi-step (9 étapes) pour provisionner un nouveau tenant en < 30 min : infos resto → slug → domain → Stripe (créer ou rattacher) → branding → import menu → QR PDF → créer/rattacher KB Manager → activation.
_Avoid_: Setup wizard, Tenant creation form

**Édition menu** :
Surface [[Vue opérationnelle]] (KB Manager, ou KB Admin en [[Impersonation]]) pour gérer le catalogue d'un tenant : **Catégories** (groupes éditoriaux **à plat** — pas de sous-catégories V1) → **Items** → **[[Personnalisations]]** (groupes réutilisables attachés). CRUD complet + photos + dispo (out of stock) + plages de service. L'édition se fait en **brouillon autosauvé** ; la PWA ne voit le menu qu'après [[Publication menu]]. Le modèle de menu **appartient à Client Ordering** (PRD 10 §6, backend `api.lib.menu.*`) ; l'édition menu n'est que sa surface côté admin.
_Avoid_: Menu builder, Catalog edit, Arborescence (trompeur — les personnalisations ne sont pas une branche de l'item, ce sont des groupes réutilisables liés N-N)

**Publication menu** :
Action [[KB Manager]] (ou [[KB Admin]] en assistance) qui rend public le menu en brouillon. **Globale et atomique** : un seul « Publier » reconstruit l'**instantané publié** du tenant — ce que lit la PWA ([[Client Ordering]]) ; **pas** de publication par item. Le brouillon = les tables menu live (autosave) ; l'aperçu lit le brouillon. Un tenant tant qu'il n'a jamais publié = pas de menu public. « Annuler » / versioning = V2. Cf. [ADR 0015](../../adr/0015-edition-menu-brouillon-publication-globale-atomique.md).
_Avoid_: Save menu, Go live, Mise en ligne

**Personnalisations** (= **Modifiers**) :
Groupes de choix **réutilisables** attachés aux items (sauces, suppléments, cuisson). Même concept que [[Modifier]] (cf. [Client Ordering](../client-ordering/CONTEXT.md)) — le mot business côté édition. **Réutilisables** (modèle Uber Eats) : un groupe créé une fois, attaché à N items (lien N-N), édité une fois → répercuté partout ; détacher d'un item laisse le groupe + les autres items intacts. Un groupe porte `minSelect`/`maxSelect` (0 = optionnel / ≥1 = obligatoire ; 1 = choix unique / >1 = multi). **Chaque option = label + prix delta** (centimes, **≥ 0** — supplément ou gratuit, jamais de remise V1). **V1 : une option ne peut PAS référencer un item** (pas de "plat comme option" / combo lié — reporté V2). Pas de "suggestions cross-sell" séparées V1.
_Avoid_: Upsell (ambigu — désigne l'effet business, pas la feature ; à réserver pour parler de KPI panier moyen), Options (générique)

**Upsell** :
Terme **business** désignant l'objectif d'augmenter le ticket moyen via les [[Personnalisations]] payantes (suppléments avec prix delta positif). Pas une feature dans l'UI. À utiliser uniquement pour parler de l'impact sur le CA, pas pour désigner un mécanisme produit.
_Avoid_: Le confondre avec une feature séparée (erreur initiale 2026-05-23, corrigée)

**Vue "Mes clients"** :
Page paginée listant les clients du tenant courant (ses propres + ceux partagés par KB). Coordonnées masquées. Pas d'export CSV. Anti-scraping (cf. [[Customer Data]]).
_Avoid_: Customer list, CRM (ambigu)

**Partage KB → resto** :
Action [[KB Admin]] qui rend visible à un tenant certains clients de la base globale KB (filtrés par position géo, segment). Côté KB Manager, tag "Source : partagé par KB". Coordonnées toujours masquées.
_Avoid_: Customer share, Lead transfer

**Campagne** :
Envoi de push ou email marketing par le KB Manager vers un segment de clients via [[Notifications]]. KB envoie en proxy — KB Manager ne voit jamais les coordonnées brutes. Stats : envoyés / ouverts / cliqués / convertis.
_Avoid_: Broadcast, Marketing blast

**QR Generator** :
Outil de génération d'un PDF imprimable contenant le QR code de la PWA du tenant. Formats : sticker rond 50 mm, A6, A4. Branding tenant. À imprimer et coller dans les sacs livraison.
_Avoid_: QR maker, Sticker generator

**Audit log** :
Trace de chaque action sensible (qui, quoi, quand). V1 = basique (login, suspension tenant, refund manuel, impersonation, partage clients). V2 = exhaustif. Conservation 3 ans (RGPD).
_Avoid_: Activity log, History

**Monitoring incidents** :
Dashboard ops temps réel : statut Stripe / Uber Direct / Vercel / DB / Hubrise par tenant. Alertes Slack ops V1 sur incidents (webhook latence, 5xx récurrent, KYC pending > 48 h, cmd payée sans course Uber).
_Avoid_: Health check, Observabilité

**Stack admin** :
Q70-Q1 : Retool / Forest Admin / custom Next.js. Décision dev lead, hors scope PRD.
_Avoid_: Back-office stack

## Example dialogue

**Alex** : Khan login. Walid login. Ils voient la même app ?

**Dev** : Oui, **même app web `KitchenBoost Admin`**. Le RBAC scope les composants. Khan voit son seul tenant Buns & Bao directement (pas de switcher si 1-tenant). Walid voit un switcher en header avec ses 3 tenants Thai Street. Toi (rôle KB Admin), tu vois tous les tenants + des modules de supervision (CRM KB, pipeline, monitoring) que Khan et Walid ne voient pas.

**Alex** : Et l'édition de menu ?

**Dev** : KB Manager (Khan ou Walid) ouvre "Menu" depuis l'app → arborescence Catégories → Items → Modifiers → CRUD complet → publication propage en PWA client sous 30 sec. Toi (KB Admin), tu peux aussi accéder à l'édition menu via impersonation (audit log obligatoire) si Khan te demande de l'aide.

**Alex** : Je veux faire avancer un prospect dans le pipeline.

**Dev** : Ouvre `KitchenBoost Admin` → onglet CRM KB → carte du prospect → click → page détail. Tu vois la checklist de sa phase courante. Coche au fur et à mesure. Bouton "Passer en phase B" actif quand la checklist est complète (ou bypass loggé si tu shortcut).

**Alex** : Et la génération du contrat ?

**Dev** : Sur la page détail, bouton "Générer contrat" — sélecteur Prestation A/B/A&B → preview HTML (équivalent CLI `generate_contract.py`) → bouton "Envoyer Odoo". Tu copies le lien Odoo vers le resto via WhatsApp en 1 clic (deep-link `wa.me`). Statut passe à `sent`. Webhook Odoo MAJ vers `signed`.

**Alex** : Stripe webhook latence pète, comment je vois ?

**Dev** : Alerte Slack ops immédiate. Tu ouvres KB Admin → vois tenant impacté (ou tenants si large incident) → drill dans Sentry. Pas de fix one-click V1, mais infos < 5 sec.

**Alex** : Si Khan demande explicitement de pouvoir exporter sa base clients ?

**Dev** : Refus systématique. Article 2 ter contrat. Pas de bouton "Export CSV" dans le code. Khan voit ses clients dans la vue (masqués), mais ne peut pas les extraire. Anti-scraping front + audit log + RLS DB.
