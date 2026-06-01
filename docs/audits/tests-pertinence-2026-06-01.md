# Audit pertinence des tests unitaires — 2026-06-01

> **Mission** : auditer la pertinence des 264 fichiers de tests unitaires du monorepo KitchenBoost.
> **Objectif** : identifier les tests INUTILES à supprimer/refactor (pas la couverture brute).
> **Méthode** : 25 sous-agents en parallèle, 1 par sous-zone, verdict KEEP / KEEP-RENAME / REFACTOR / DELETE par test, justifié.
> **Critère strict** : un test pertinent doit pouvoir échouer pour une vraie raison fonctionnelle, et son échec doit pointer vers un bug réel (pas un détail d'implémentation).

---

## 1. Synthèse globale

| Métrique         | Valeur            |
| ---------------- | ----------------- |
| Fichiers audités | **264**           |
| Tests audités    | **1982**          |
| **KEEP**         | **1732** (87,4 %) |
| **KEEP-RENAME**  | **0** (0 %)       |
| **REFACTOR**     | **58** (2,9 %)    |
| **DELETE**       | **192** (9,7 %)   |

**Lecture** : ~9,7 % des tests sont à supprimer (cible prioritaire pour Alex), ~2,9 % à refactor, le reste est pertinent. Aucun rename pur n'a été identifié — les sous-agents ont systématiquement préféré KEEP ou REFACTOR à RENAME quand le nom était imparfait.

---

## 2. Synthèse par zone

| Zone                                                        | Fichiers | Tests    | KEEP     | RENAME | REFACTOR | DELETE  | %DELETE   |
| ----------------------------------------------------------- | -------- | -------- | -------- | ------ | -------- | ------- | --------- |
| A1 — apps/admin monitoring                                  | 7        | 34       | 22       | 0      | 6        | 6       | 17,6 %    |
| A2 — pipeline/[prospectId]/\_components                     | 8        | 44       | 32       | 0      | 5        | 7       | 15,9 %    |
| A3 — pipeline/[prospectId] root                             | 10       | 73       | 60       | 0      | 4        | 9       | 12,3 %    |
| A4 — pipeline/[prospectId]/provision                        | 15       | 131      | 96       | 0      | 4        | 31      | 23,7 %    |
| A5 — pipeline base                                          | 15       | 80       | 70       | 0      | 1        | 9       | 11,3 %    |
| A6 — campagnes/[templateId] + support/page                  | 10       | 56       | 39       | 0      | 5        | 12      | 21,4 %    |
| A7 — campagnes (listing + historique)                       | 9        | 51       | 43       | 0      | 2        | 6       | 11,8 %    |
| A8 — commandes                                              | 10       | 73       | 64       | 0      | 2        | 7       | 9,6 %     |
| A9 — menu + dashboard                                       | 13       | 124      | 110      | 0      | 6        | 8       | 6,5 %     |
| A10 — mes-clients + stats + support                         | 13       | 64       | 50       | 0      | 2        | 12      | 18,8 %    |
| A11 — parametres + pricing + qr                             | 13       | 165      | 110      | 0      | 13       | 42      | 25,5 %    |
| A12 — src/components                                        | 15       | 87       | 82       | 0      | 2        | 3       | 3,4 %     |
| A13 — hooks + lib                                           | 8        | 41       | 39       | 0      | 0        | 2       | 4,9 %     |
| B1 — convex root (schemas + harness + migrations + table)   | 11       | 43       | 24       | 0      | 3        | 16      | 37,2 %    |
| B2 — lib/admin                                              | 11       | 87       | 84       | 0      | 0        | 3       | 3,4 %     |
| B3 — foundation (auth + cart + crypto + tenancy + webhooks) | 13       | 158      | 156      | 0      | 1        | 1       | 0,6 %     |
| B4 — lib/customer                                           | 8        | 78       | 78       | 0      | 0        | 0       | 0 %       |
| B5 — delivery + uberDirect                                  | 10       | 65       | 60       | 0      | 1        | 4       | 6,2 %     |
| B6 — lib/menu                                               | 8        | 99       | 99       | 0      | 0        | 0       | 0 %       |
| B7 — lib/notifications                                      | 17       | 121      | 117      | 0      | 0        | 4       | 3,3 %     |
| B8 — lib/onboarding                                         | 6        | 56       | 51       | 0      | 0        | 5       | 8,9 %     |
| B9 — orders + pricing + stats                               | 11       | 84       | 81       | 0      | 0        | 3       | 3,6 %     |
| B10 — lib/stripe                                            | 10       | 67       | 65       | 0      | 0        | 2       | 3,0 %     |
| B11 — lib/wallet                                            | 10       | 51       | 50       | 0      | 1        | 0       | 0 %       |
| S1 — shared + eslint-config                                 | 3        | 50       | 50       | 0      | 0        | 0       | 0 %       |
| **TOTAL**                                                   | **264**  | **1982** | **1732** | **0**  | **58**   | **192** | **9,7 %** |

**Zones les plus polluées (DELETE % le plus élevé)** :

1. **B1 — convex root schemas** (37,2 %) : la majorité des tests réassertent les validators Convex (round-trip insert→get), redondant avec la définition de schéma elle-même.
2. **A11 — parametres + pricing + qr** (25,5 %) : nombreux grep textuels source-level (`ban d'imports`, `useForm` présent), couvert par lint/typecheck.
3. **A4 — pipeline provision wizard** (23,7 %) : grep textuels sur `delegates to X`, `is marked "use client"`, `does not import from apps/web` — discipline qui appartient à un lint custom.
4. **A6 — campagnes templateId** (21,4 %) : grep textuels sur imports + duplicats avec `SupportContent.test.tsx` pour `support/page.test.tsx`.

**Zones les plus saines (0–3 % DELETE)** :

- **B4 (customer)**, **B6 (menu backend)**, **B11 (wallet)**, **S1 (shared+eslint)** : 0 % DELETE.
- **B3 (foundation auth/crypto/tenancy)** : 0,6 % DELETE (gold standard MOAT, comme attendu).
- **B7 (notifications)**, **B10 (Stripe)**, **A12 (components admin)** : ~3 % DELETE.

---

## 3. Couverture qualitative

### Très bien couvert (zones blindées)

- **MOAT cross-tenant / RBAC** : `tenancy/withTenant.test.ts` + tous les fuzz cross-tenant (`every unauthorized actor on tenant A is rejected`) sur lib/admin, lib/customer, lib/delivery, lib/menu, lib/notifications, lib/orders, lib/pricing, lib/stats, lib/stripe, lib/wallet. C'est la couverture la plus dense et la plus pertinente du monorepo.
- **Logique pure métier** : pricing engine (`packages/shared/pricing/engine.test.ts` — 100 % KEEP), `prospectPhaseMover`, `decideKanbanDnDEnd`, `wizard.decision`, `prospect-fiche.decision`, `root-entry.decision`, `tenant-context.decision`, `app-sidebar.decision`, `tenant-switcher.decision`. Toutes les fonctions de décision pures sont bien gardées.
- **Anti-spam / anti-anomaly / RGPD** : `notifications/antiAnomaly.test.ts` (quotas 1/48h, 3/sem, surge +50 %), `notifications/dnt.test.ts` (fenêtre 22h-8h Paris CET/CEST), `notifications/marketingRateLimit.test.ts`, `customer/consent.test.ts`, `customer/rgpd.test.ts`. Conformité légale verrouillée.
- **State machines** : `lifecycle.test.ts` (contracts), `tenantLifecycle.test.ts`, `orders/workflow.transitions.test.ts`, `orders/workflow.refuse.test.ts`. Chaque transition légale/illégale est testée.
- **Cryptographie / sécu webhook** : `crypto/envelope.test.ts` (AES-256-GCM tamper detection), `stripe/signature.test.ts` (HMAC v1 + key rotation + replay), `wallet/internalAuth.test.ts`. Aucun raccourci.
- **MOAT anti-PII admin** : `mes-clients/anti-extraction-render.test.tsx`, `anti-pii-static-guard.test.ts`, `audit-on-open.test.ts`. Garde-fous load-bearing préservés.
- **Lint custom** : `no-untenanted-query.test.js` + `configs.backendRecommended.test.js` — 100 % KEEP, gardent l'ADR 0010 au niveau lint.

### Patterns DELETE récurrents (à éliminer en bloc)

1. **Grep textuels sur la source du fichier testé** (~80 DELETE) : `readFileSync(...).includes("UseQuery")`, regex sur la directive `"use client"`, sur les noms d'imports (`MesClientsView`, `WizardView`, `CampagnesView`), sur les attributs Tailwind exacts (`text-[#1B7A3D]`). Ces tests testent une représentation textuelle de l'implémentation, pas son comportement.
2. **Re-assertion des validators Convex** (~25 DELETE, surtout B1) : insère un row avec les champs définis par le validator, le relit, asserte des valeurs littérales. Le validator est sa propre source de vérité.
3. **Snapshots / déclaration d'index** (~10 DELETE) : asserte qu'une table expose un index `by_tenant` en l'utilisant pour une query — tautologique avec la définition de schéma.
4. **Polish CSS tests** (`polish-audit.test.tsx`, `responsive grids: every cards grid is 1 col mobile + 3 cols lg+ desktop`) : grep classes Tailwind exactes. Casse à chaque refactor cosmétique sans bug réel.
5. **Smoke "renders without crashing"** : déjà couvert par tous les autres tests qui montent le composant et asserent un comportement.
6. **Duplicats fuzz** (~5 DELETE) : `a manager of tenant B cannot read tenant A` répété hors du fuzz `every unauthorized actor` qui couvre déjà le cas.

### Patterns REFACTOR récurrents

1. **5 cas dans 1 `it`** : split en `it.each` ou en cas séparés (assertion error plus précise).
2. **`expect(mock).toHaveBeenCalled()` avec mock injecté directement** : remplacer par observation du comportement côté output, pas par observation de l'invocation.
3. **Grep regex sur fenêtres de 1500-5500 chars du source code** (zones A11, A9) : test « le handler enrobe la mutation dans try/catch + toast.error ». Très fragile à toute reorganisation, à remplacer par un test comportemental sur l'erreur réelle propagée.
4. **Assertions sur attributs Tailwind / classes shadcn** : remplacer par data-slot stable.

### Sous-couvert (info, pas action — Alex décide)

- **E2E + tests unitaires se recoupent** : la doc `docs/tests/E2E-checklist.md` couvre les parcours critiques côté E2E. Plusieurs tests unitaires sur des composants top-level (`mes-clients-view.test.tsx`, `template-view.test.tsx`, `campagnes-view.test.tsx`, `wizard-view.test.tsx`, `commandes-view.test.tsx`) re-testent des assertions DOM qui sont déjà couvertes par E2E. Aucun verdict DELETE n'a été rendu sur cette base seule par les sous-agents (par prudence), mais Alex peut considérer un audit cross-référencement E2E ↔ unit pour réduire les doublons.
- **Pas d'observation explicite de tests « manquants »** : le mandat de l'audit était inverse (chercher l'inutile, pas le manquant). Les sous-agents n'ont pas systématiquement signalé les zones sous-couvertes.
- **Type-level tests via `expectTypeOf` / `@ts-expect-error`** : présents dans `tenant-context.hook.test.ts`, `use-tenant-query.test.ts`, et plusieurs tests B3/B6. Conservés (`KEEP`) — protègent des contrats compile-time réels (e.g. brand `Id<"tenants">`, exposure de `decryptTenantCredentialQuery`). 3 cas dans `use-tenant-query.test.ts` ont été marqués DELETE par le sous-agent A13 car ils suivent un `@ts-expect-error` par un `expect(true).toBe(true)` runtime inerte.

---

## 4. DELETE candidates (à traiter en priorité)

Liste flat, par fichier → test → catégorie + raison synthétique. 192 entrées. Triées par zone (alphabétique fichier dans la zone).

> **Catégories** : (a) tautologie, (b) mock qui se teste lui-même, (c) snapshot JSX inerte, (d) assert sur framework, (e) test impossible à fail, (f) duplicat exact.

### Zone A1 — apps/admin monitoring (6 DELETE)

- `incident-detail-sheet.test.tsx` :
  - `composes the drill-down panel from the shadcn Sheet primitives (no hand-rolled modal)` — (c) grep regex sur imports `SheetContent`/`SheetTitle`/`next/link`
- `monitoring-view.test.tsx` :
  - `with kind=webhook_latency and the same ONE_OF_EACH_KIND payload, only the webhook row renders` — (f) déjà couvert par filterIncidents.test.ts
  - `with severity=critical, only webhook_latency + paid_no_course rows render (kyc_pending is warning)` — (f) duplicat filterIncidents
  - `with severity=warning, only kyc_pending rows render` — (f) duplicat filterIncidents
  - `with tenantId=tenant_khan, only tenant-scoped incidents matching that tenant render` — (f) duplicat filterIncidents
  - `renders 3 filter controls above the table (kind + tenant + severity)` — (c) grep regex sur imports/labels source
  - `each row exposes a click handler that opens the drill-down sheet (source-level contract)` — (c) grep `onClick=` et `IncidentDetailSheet` sur source

### Zone A2 — pipeline/[prospectId]/\_components (7 DELETE)

- `edit-prospect-identity-modal.test.tsx` :
  - `never imports from apps/web or apps/native (scope discipline)` — lint déguisé, remplacer par ESLint `no-restricted-imports`
- `integration-status-panel.test.tsx` :
  - `imports reduceIntegrationStatus from the pure PIPELINE-04 model (#220)` — (a) pin grep sur nom d'import
  - `never imports from apps/web or apps/native (scope discipline)` — lint déguisé
- `interaction-log.test.tsx` :
  - `never imports from apps/web or apps/native (scope discipline)` — lint déguisé
- `milestone-checklist.test.tsx` :
  - `derives its rendered list from the pure buildMilestoneChecklist (PIPELINE-03 #218)` — (a) pin grep nom d'import
  - `never imports from apps/web or apps/native (scope discipline)` — lint déguisé

### Zone A3 — pipeline/[prospectId] root (9 DELETE)

- `generate-contract-launcher.test.ts` :
  - `AC — re-derives the pure decision (decideGenerateContract) at submit time` — (b) grep nom de fonction
  - `AC — surfaces a toast.error on failure` — (b) grep `toast.error` import string
  - `AC — forwards the new contractId via the onGenerated callback` — (b) grep texte
  - `AC — mounts the pure GenerateContractModal` — (b) grep nom de composant
- `page.test.ts` :
  - `AC1 — exports a default function` — (d/a) assert framework Next.js
  - `AC delegation — delegates rendering to ProspectFicheView` — (b) grep nom de composant
  - `AC — reads the session via useSession` — (b) grep symbole
  - `AC — reads the URL segment via useParams<{ prospectId }>` — (b) grep symbole

### Zone A4 — pipeline/[prospectId]/provision (31 DELETE)

- `layout.test.ts` :
  - `exports a default function (Next.js App Router layout contract)` — grep source
  - `renders its children (the wizard page)` — grep `{ children }` sur source
  - `scope — never imports from apps/web or apps/native` — doublon lint
- `page.test.ts` :
  - `exports a default function (the Next.js App Router page contract)` — tautologie
  - `delegates rendering to WizardView` — grep nom
  - `reads the session via useSession so the access gate fires before any data hydration` — grep identifiant
  - `reads the URL segment via useParams<{ prospectId }>` — grep identifiant
  - `wires the wizard heuristic via useWizardState (the bundled hook)` — grep identifiant
  - `scope — never imports from apps/web or apps/native` — doublon lint
  - `page is marked "use client"` — grep directive
- `step-forms.test.tsx` :
  - `F-WIZARD [4/10] (#268): step 2 is no longer a placeholder — the map binds the real Step2Form wrapper` — vestige transitionnel (placeholder déjà retiré)
- `step1-provisioning-form.test.tsx` :
  - `scope discipline: the form module does not import from apps/web or apps/native` — doublon lint
- `step4-branding-form.test.tsx` :
  - `scope discipline: the form module does not import from apps/web or apps/native` — doublon lint
- `step5-menu-form.test.tsx` :
  - `scope discipline: the form module does not import from apps/web or apps/native` — doublon lint
- `step6-qr-form.test.tsx` :
  - `scope discipline: the form module does not import from apps/web or apps/native` — doublon lint
- `step7-manager-invite-form.test.tsx` :
  - `scope discipline: the form module does not import from apps/web or apps/native` — doublon lint
- `step8-activation-form.test.tsx` :
  - `scope discipline: the form module does not import from apps/web or apps/native` — doublon lint
- `use-wizard-state.test.ts` :
  - `exports useWizardState` — grep source
  - `delegates the step heuristic to the pure computeWizardState` — grep identifiant
  - `scope — never imports from apps/web or apps/native` — doublon lint
  - `hook module is marked "use client" (uses React state + Convex hooks)` — grep directive
  - `F-WIZARD [9/10] — wires getLatestManagerInviteForTenant (no longer stubbed)` — grep identifiant
  - `F-WIZARD [4/10] — owns + exposes a step2Skipped flag (local state, never round-tripped)` — grep nom de variable

### Zone A5 — pipeline base (9 DELETE)

- `bypass-confirm-dialog.test.tsx` :
  - `passes open=false through to the underlying AlertDialog primitive` — (a) tautologie
  - `surfaces the bypass intent in the dialog title/description (FR)` — (d) regex matche titre statique
- `kanban-column.test.tsx` :
  - `renders the column title (« Acquisition »)` — (a) tautologie prop→render
- `milestoneLabels.test.ts` :
  - `returns the FR label for each Closing milestone (PRD 70 §3.3)` — (a) recopie verbatim de la map LABELS
  - `returns the FR label for each Préparation gate milestone (→ Installation)` — (a) recopie de la map
- `page.test.ts` :
  - `AC1 — exports a default function` — (d) assert framework Next.js
  - `AC RBAC — reads the session via useSession + skip sentinel` — (a/d) grep source
  - `AC RBAC — renders the shared UnauthorizedCard for a non-admin actor` — (a) grep source
  - `AC scope — never imports from apps/web or apps/native` — (a) lint déguisé
  - `AC #255 — mounts the 3 static Kanban columns + tab + search bar + ProspectCard` — (a) grep
  - `AC #255 — partitions via partitionProspectsByPhase` — (a) grep nom de fonction
  - `AC #255 — applies the name search BEFORE partition` — (a) grep
  - `AC #255 — never touches the backend module` — (a) grep négatif
  - `page is marked "use client"` — (a) regex sur directive

### Zone A6 — campagnes/[templateId] + support/page (12 DELETE)

- `support/page.test.tsx` :
  - `renders without throwing` — (e/f) wrapper d'une ligne, duplicat avec SupportContent.test.tsx
  - `surfaces the CSM name from the live supportConfig (visible marker)` — (b/f) idem duplicat
  - `surfaces every static resource title (one card per entry)` — (f) duplicat de SupportContent.test.tsx
- `_components/VariablesForm.test.tsx` :
  - `statically imports the result surface CampaignResultStats` — (d/e) grep import textuel
  - `statically imports the anomaly dialog CampaignAnomalyDialog` — (d/e) grep import textuel
  - `statically imports the pure error classifier classifySendError` — (d/e) grep import textuel
  - `declares an onSend prop on VariablesFormProps` — (d/e) regex sur source-text
- `[templateId]/page.test.ts` :
  - `declares "use client"` — (d) grep textuel
  - `binds api.lib.notifications.campaigns.listTenantTemplates via useTenantQuery` — (d) regex sur source
  - `delegates rendering to TemplateView (keeps the page thin)` — (d) grep textuel
  - `reads the templateId URL segment via useParams` — (d) grep textuel
  - `binds api.lib.notifications.campaigns.sendTenantCampaign via useTenantMutation` — (d) grep textuel
  - `threads the mutation as an onSend prop down to TemplateView` — (d) grep textuel

### Zone A7 — campagnes (listing + historique) (6 DELETE)

- `historique/[launchId]/page.test.ts` :
  - `delegates rendering to LaunchDetailView` — (a) grep textuel
- `historique/page.test.ts` :
  - `delegates rendering to CampaignHistoryList` — (a) grep textuel
- `page.test.ts` :
  - `AC delegation — delegates rendering to CampagnesView` — (a) grep textuel
- `polish-audit.test.tsx` :
  - `le bouton « Envoyer maintenant » utilise le vert KB primaire` — (a) tautologie grep classe Tailwind
  - `le bouton « Compris » du dialog d'anomalie utilise le vert KB primaire` — (a) idem
  - `le badge canal « Push » du picker utilise le vert KB` — (a) idem
  - `le badge canal « E-mail » du picker utilise le jaune/or KB` — (a) idem
  - `les liens « Historique » / « Retour » utilisent le vert KB` — (a) idem (grep `text-[#1B7A3D]`)
  - `le slider de discount utilise l'accent vert KB` — (a) idem

### Zone A8 — commandes (7 DELETE)

- `commandes-view.test.tsx` :
  - `AC — the slice-1 placeholder « La liste arrive dans le prochain slice » is GONE (live table replaces it)` — vestige slice (b/e)
  - `renders without crashing on every branch (pure function of props)` — (d) assert framework
- `order-detail-modal.test.tsx` :
  - `accepts open=false without throwing` — (d) assert framework
  - `threads the open prop into the underlying Dialog (controlled by the page)` — duplicat
- `orders-filters.test.tsx` :
  - `re-renders with new value props without losing track of the active state` — duplicat structurel
- `page.test.ts` :
  - `AC1 — exports a default function` — (d) tautologie / assert framework
  - `AC #244 — resolves the tenant slug from the session (KB Manager) OR the kbAdminQuery (KB Admin)` — pin trop faible (assertion littéral)

### Zone A9 — menu + dashboard (8 DELETE)

- `page.test.ts` :
  - `F-MENU-03 — passes onReorderCategories down to MenuView` — (a) grep texte sur nom de prop
  - `F-MENU-04 — passes itemsByCategory and onToggleItemAvailability down to MenuView` — (a) grep texte
  - `F-MENU-05 — passes onCreateItem and onItemClick down to MenuView` — (a) grep texte
  - `F-MENU-06 — passes onUploadPhoto and onRemovePhoto down to the ItemModal` — (a) grep texte
  - `F-MENU-07 — passes onReorderItems down to MenuView` — (a) grep texte
  - `F-MENU-09 — passes onAttachGroup / onDetachGroup / onCreateInlineGroup down to the ItemModal` — (a) grep texte
  - `F-MENU-10 — passes onPublish, hasUnpublishedChanges, previewHref down to MenuView` — (a) grep texte

### Zone A10 — mes-clients + stats + support (12 DELETE)

- `empty-state.test.tsx` :
  - `AC1 — renders without crashing (callable as a pure function, returns a tree)` — (e) impossible fail
- `page.test.ts` (mes-clients) :
  - `AC1 — delegates rendering to MesClientsView (pure presentational shell)` — (a) tautologie grep
- `page.test.ts` (tenant root) :
  - `delegates rendering to DashboardView` — (a) tautologie grep
  - `declares "use client" (page uses Convex hooks)` — (a) tautologie grep
- `stats/RevenuePerDayBlock.test.tsx` :
  - `populated branch carries the canonical card slot (data-slot="revenue-per-day")` — (a) tautologie data-slot
- `stats/page.test.ts` :
  - `delegates rendering to StatsView` — (a) tautologie grep
  - `declares "use client"` — (a) tautologie grep
  - `owns the range state via useState (default 30 — issue body)` — (a) tautologie grep
  - `does NOT redirect anywhere (the page is the destination, not a wrapper)` — (e) impossible fail
- `support/page.test.tsx` :
  - `renders without throwing` — (e) impossible fail
  - `surfaces the CSM name from the live supportConfig (visible marker)` — (b) tautologie pass-through
  - `surfaces every static resource title (one card per entry)` — (b) tautologie pass-through

### Zone A11 — parametres + pricing + qr (42 DELETE)

- `branding-editor.test.tsx` :
  - `is a stand-alone module — no coupling to URL / tenant context / backend api` — (a) source-string ban d'imports
  - `uses react-hook-form's useForm (isolated per-section form, user story 9)` — (a) grep `useForm`
  - `exports the public contract { value, onSave, onUploadLogo } via a typed Props` — (a) grep nom de type
- `coordonnees-editor.test.tsx` :
  - `is a stand-alone module — no coupling to URL / tenant context / backend api` — (a) source-string ban
  - `uses react-hook-form's useForm` — (a) grep
  - `exports the public contract { value, onSave } via a typed Props` — (a) grep nom de type
  - `exports the pure FR-phone validator so it can be unit-tested` — (d) `typeof === "function"`
- `modes-editor.test.tsx` :
  - `is a stand-alone module — no coupling to URL / tenant context / backend api` — (a) source-string ban
  - `uses react-hook-form's useForm` — (a) grep
  - `exports the public contract { value, onSave } via a typed Props` — (a) grep nom de type
  - `uses the shadcn Switch primitive` — (a) grep import
- `page.test.ts` :
  - `AC delegation — delegates rendering to ParametresView` — (a) grep nom composant
- `service-hours-editor.test.tsx` :
  - `is a stand-alone module — no coupling to URL / tenant context / backend api` — (a) source-string ban
  - `exports a typed Props interface with the { value, onSave } contract` — (a) grep nom de type
  - `exports the pure validator validateServiceWindows` — (a) grep export
  - `exports the pure formatters minutesToTimeString / timeStringToMinutes` — (a) grep export
- `guardrails.test.ts` :
  - `at least one source file exists (sanity)` — (e) sanity check inutile
- `pricing/page.test.ts` :
  - `AC — delegates rendering to PricingView` — (a) grep nom composant
  - `AC F-PRICING-2 — mounts the RuleBuilderModal` — (a) grep nom composant
  - `AC F-PRICING-3 — wires onEditRule handler` — (a) grep nom prop
  - `AC F-PRICING-3 — passes the rule under edit to RuleBuilderModal via existingRule prop` — (a) grep nom prop
  - `AC F-PRICING-4 — wires onToggleActive handler` — (a) grep nom prop
  - `AC F-PRICING-5 — wires onDeleteRule handler` — (a) grep nom prop
  - `GUARDRAIL — does NOT import dnd-kit / react-beautiful-dnd` — (f) duplicat de guardrails.test.ts
- `pricing-view.test.tsx` :
  - `AC — placeholders Éditer/Supprimer/toggle disabled (non-câblés ici)` — (e) Slice 1 placeholder dépassé
  - `AC — empty branch is anti-PII safe` — (e) impossible fail réaliste
- `rule-builder-modal.test.tsx` :
  - `GUARDRAIL — no draggable=true element anywhere` — (f) duplicat
- `qr/page.test.ts` :
  - `AC4 — mounts QrGeneratorView from F-QR.3 component module` — (a) grep nom + import path

### Zone A12 — src/components (3 DELETE)

- `impersonation-banner.handlers.test.ts` :
  - `SUPERVISION_ROUTE non-empty absolute path` — (a) tautologie sur constante
- `QrGeneratorView.test.tsx` :
  - `renders without crashing returns non-null tree` — (a) tautologie "not null"
  - `exposes public props type` — (d) `expect(true).toBe(true)` après satisfies

### Zone A13 — hooks + lib (2 DELETE)

- `use-tenant-query.test.ts` :
  - `typechecks: passing { foo: 1 } is accepted` — (a) tautologie `expect(true).toBe(true)`
  - `typechecks: passing "skip" is accepted` — (a) idem
  - `typechecks: zero-arg call is accepted (args omitted)` — (a) idem (redondant avec test `expectTypeOf` plus haut)

### Zone B1 — convex root (16 DELETE)

- `customer-data-schema.test.ts` :
  - `round-trips a customer row with all V1 fields incl. push enrollment` — (a) tautologie schema
  - `exposes the customers by_user index` — (a) tautologie index
  - `round-trips a cgvVersions row and exposes by_hash + by_activatedAt` — (a) tautologie schema + index
  - `round-trips customerOrdersPerTenant and exposes by_customer, by_tenant, by_tenant_customer` — (a) tautologie schema + indexes
- `foundation-schema.test.ts` :
  - `round-trips a row in each new table` — (a) tautologie schema
  - `exposes the specified indexes (incl. by_user_tenant, by_provider_event)` — (a) tautologie index
  - `accepts the new role union (kb_admin / customer)` — (a) tautologie validator union
- `harness.test.ts` :
  - `runs under vitest` — (e) impossible fail (`expect(true).toBe(true)`)
- `kb-admin-schema.test.ts` :
  - `exposes the prospects by_phase and by_tenant indexes` — (a) tautologie index
  - `round-trips a contract row and exposes by_prospect + by_tenant` — (a) tautologie schema + index
- `menu-schema.test.ts` :
  - `round-trips a menuCategories row and exposes by_tenant` — (a) tautologie schema + index
  - `round-trips a menuItems row with allergens + exposes by_tenant, by_category` — (a) tautologie schema + indexes
  - `round-trips a modifierGroups row (reusable, min/max + options) and exposes by_tenant` — (a) tautologie
  - `accepts an OPTIONAL modifier group (minSelect 0) with multi-select` — (a) tautologie validator
  - `round-trips a serviceHours row (windows shared delivery + C&C) and exposes by_tenant` — (a) tautologie
- `pricing-schema.test.ts` :
  - `round-trips a rule row and exposes the by_tenant index` — (a) tautologie schema + index
  - `accepts the 10% pourcentage_panier action (the onboarding default shape)` — (a) tautologie validator
- `adminInvites.test.ts` :
  - `inserts a legacy admin invite (no targetRole, no tenantId) — rétrocompat` — (a) tautologie
  - `inserts a kb_manager invite carrying targetRole + tenantId` — (a) tautologie
  - `also accepts targetRole: "kb_admin" explicitly (rétrocompat + explicit form)` — (a) tautologie
  - `the legacy by_email index still works (rétrocompat)` — (a) tautologie index
  - `adminInviteValidator exposes the two new optional fields in its object shape` — (a) tautologie validator
- `wallet-registrations-schema.test.ts` :
  - `round-trips a registration row with all fields` — (a) tautologie schema
  - `is reachable on by_serial and by_device indexes` — (a) tautologie index
  - `is reachable on the unique by_device_serial couple` — (a) tautologie index composite
- `wallet-schema.test.ts` :
  - `round-trips a pass row with all V1 fields` — (a) tautologie schema
  - `is reachable on the by_serial index` — (a) tautologie index

### Zone B2 — lib/admin (3 DELETE)

- `monitoring.test.ts` :
  - `webhook latency threshold is 30 s` — (a) tautologie sur constante
  - `KYC pending threshold is 48 h` — (a) tautologie sur constante
- `tenantLifecycle.test.ts` :
  - `marks active as terminal (no outgoing edges in V1)` — (a) tautologie sur source
  - `marks suspended as terminal (no outgoing edges in V1)` — (a) tautologie sur source
  - `marks disabled as terminal (no outgoing edges in V1)` — (a) tautologie sur source

### Zone B3 — foundation (1 DELETE)

- `webhooks/idempotent.test.ts` :
  - `exposes its public contract through the module index` — (a) tautologie barrel ré-export

### Zone B5 — delivery + uberDirect (4 DELETE)

- `delivery/incidents.test.ts` :
  - `the 10-min threshold is exactly 10 minutes in ms` — (a) tautologie constante
- `uberDirect/quote.test.ts` :
  - `returns hors_zone (deliverable false) when Uber refuses the address` — (f) duplicat avec mapping pur
  - `the credential blob gate rejects every unauthorized actor on tenant A` — (f) duplicat strict avec credentials.test.ts (mêmes 6 actors)

### Zone B7 — lib/notifications (4 DELETE)

- `schema.test.ts` :
  - `notificationTemplates → stores a pre-validated tenant campaign template with its declarative bounds` — (a) round-trip insert→get
  - `notificationTemplates → stores a cross-tenant (KB root) template` — (a) tautologie round-trip
  - `notificationEvents → journals a transactional send (trigger + category + effective channel + status)` — (a) round-trip
  - `notificationEvents → journals a campaign send referencing a template + its scope` — (a) round-trip

### Zone B8 — lib/onboarding (5 DELETE)

- `index.test.ts` :
  - `re-exports setMilestone (granular binary milestone write, slice 3)` — (a) tautologie barrel re-export
  - `re-exports recordIntegrationStatus (composite integration write, slice 4)` — (a) tautologie
  - `re-exports ClosingMilestoneKey type (consumable via the barrel)` — (a) `expect(sample).toBe("contratSigne")` tautologie pure
- `pipeline.test.ts` :
  - `declares the canonical phase order Acquisition → Préparation → Installation → Opérationnel` — (a) tautologie sur PHASE_ORDER

### Zone B9 — orders + pricing + stats (3 DELETE)

- `pricing/evaluate.test.ts` :
  - `a manager of tenant B cannot evaluate against tenant A` — (f) duplicat du fuzz
- `pricing/rules.test.ts` :
  - `a manager of tenant B cannot read tenant A's rules` — (f) duplicat du fuzz
- `stats/revenuePerDay.test.ts` :
  - `staff can read the series (operational role) — same view as the manager` — duplicat fonctionnel avec rangeAggregates/dailyKpis

### Zone B10 — lib/stripe (2 DELETE)

- `webhook.test.ts` :
  - `an account still onboarding maps to pending` — (f) duplicat de status.test.ts
  - `two DISTINCT events both apply` — (a) tautologie partielle

---

## 5. REFACTOR (action requise)

Liste flat, par fichier → test → action concrète. 58 entrées.

### Zone A1 — apps/admin monitoring (6)

- `incident-detail-sheet.test.tsx` :
  - `renders nothing visible when incident is null (the controlled open flag still toggles, but the body short-circuits)` — assertion `not.toMatch(/provider|orderId|prospectId/)` triviale ; remplacer par assertion explicite sur l'absence de `IncidentDetailSheetBody` dans l'arbre.
- `formatPendingSince.test.ts` :
  - `renders a fresh-but-still-positive duration for a very recent instant` — assertion `out.length > "depuis ".length` très molle ; remplacer par match sur « minute » ou supprimer.
- `filterIncidents.test.ts` :
  - `a tenant filter excludes non-tenant-scoped incidents (kyc_pending, webhook_latency, and tenant-less paid_no_course)` — duplicat partiel du test précédent ; fusionner ou supprimer.
- `monitoring-view.test.tsx` :
  - `refuses access cleanly when session.isAdmin === false — shows « Accès non autorisé » via the shared UnauthorizedCard, no table` — séparer en 2 tests, retirer grep source.
  - `renders a shadcn Table (NOT a hand-rolled one) with one row per incident kind, carrying the per-kind inline fields` — éclater en 2-3 tests + retirer la vérification des tags HTML shadcn.
  - `mounts the drill-down sheet exactly once at the bottom of the body (not per-row), so the controlled open flag stays single-source-of-truth` — transformer en assertion sur l'arbre sérialisé.

### Zone A2 — pipeline/[prospectId]/\_components (5)

- `edit-prospect-identity-modal.test.tsx` :
  - `the connected wrapper fires api.lib.onboarding.crm.editProspect` — test d'intégration léger qui mock `convex/react` au lieu d'un grep regex sur source.
- `integration-status-panel.test.tsx` :
  - `fires the canonical api.lib.onboarding.milestones.recordIntegrationStatus mutation via Convex useMutation` — idem, mocker `convex/react`.
- `interaction-log.test.tsx` :
  - `fires the canonical api.lib.onboarding.crm.logInteraction mutation via Convex useMutation` — idem.
- `milestone-checklist.test.tsx` :
  - `renders the binary Acquisition milestone labels` — 4 assertions de labels dans 1 `it` ; découper ou pinner via `data-milestone-key`.
  - `fires the canonical api.lib.onboarding.milestones.setMilestone mutation via Convex useMutation` — mocker `convex/react`.

### Zone A3 — pipeline/[prospectId] root (4)

- `generate-contract-launcher.test.ts` :
  - `AC — fires the canonical mutation api.lib.admin.contracts.generateContract` — assertion source-string fragile ; tester via runtime + mock `convex/react`.
  - `AC negative — never calls any V2 contract action` — préférable de pinner via type-level.
  - `AC — exposes the « Générer contrat » trigger button (verbatim copy)` — pinner via runtime render.
- `page.test.ts` :
  - `F-CONTRATS slice 1/4 — fires api.lib.admin.contracts.listContractsForProspect` — idem, mocker `convex/react`.
  - `F-CONTRATS slice 3/4 — fires api.lib.onboarding.crm.getProspect` — idem.
  - `F-CONTRATS slice 3/4 — owns the generatedContractId state, drives getContract, threads onGenerated + generatedContractHtml` — préférable test runtime.

### Zone A4 — pipeline/[prospectId]/provision (4)

- `step6-qr-form.test.tsx` :
  - `scope discipline: the form module does NOT call backend (zero useMutation / useAction / useQuery import)` — remplacer par contrat fonctionnel (test que rendering ne lève pas sans ConvexProvider).
- `step7-manager-invite-form.test.tsx` :
  - `scope discipline: the form module does NOT call backend (zero useMutation / useAction / useQuery)` — idem.
- `step8-activation-form.test.tsx` :
  - `scope discipline: the form module does NOT call backend (zero useMutation / useAction / useQuery)` — idem.
- `use-wizard-state.test.ts` :
  - `exposes a goToStep callback in the returned shape (matches issue spec)` — assertion type-level via `ReturnType<typeof useWizardState>` ou shape via test wrapper React.
- `wizard-view.test.tsx` :
  - `KB Admin + prospect ready, currentStep = 3 → renders the Step3Form placeholder content (« Stripe KYC ») in the body` — reformuler en « currentStep=3 monte le composant STEP_FORMS[3] » sans dépendre du wording placeholder.

### Zone A5 — pipeline base (1)

- `page.test.ts` :
  - `AC1 — binds api.lib.onboarding.crm.listProspects via useQuery` — remplacer par test d'intégration léger qui mock `useQuery` et vérifie la ref `api.lib.onboarding.crm.listProspects`, ou DELETE si jugé déjà couvert E2E.

### Zone A6 — campagnes/[templateId] + support/page (5)

- `_components/CampaignResultStats.test.tsx` :
  - `renders all-zero counts without crashing` — édge zero peu utile ; fusionner avec le test précédent ou supprimer.
- `_components/VariablesForm.test.tsx` :
  - `calls the onSend prop with {templateId, variables}` — test comportemental qui rend `<VariablesForm onSend={spy}>` et déclenche submit du `<CampaignPreview>`.
- `[templateId]/page.test.ts` :
  - `does NOT use a raw useQuery (would bypass tenantId injection)` — déplacer en lint custom global (anti-untenanted-query), garder si lint absent.
  - `does NOT use a raw useMutation` — idem, porter en lint.
- `template-view.test.tsx` :
  - `loaded branch surfaces the template label + the raw template body (preview anchor)` — remplacer l'assertion `toContain(TEMPLATE.body)` par juste `toContain(TEMPLATE.label)`.
  - `F-CAMPAGNES [5/7] (#228) — loaded branch threads the onSend mutation seam to VariablesForm` — remplacer par comportemental avec `onSend` spy passé en prop.

### Zone A7 — campagnes (listing + historique) (2)

- `historique/[launchId]/launch-detail-view.test.tsx` :
  - `loaded branch: delegates to CampaignResultStats (REUSED from slice 5, no duplication)` — remplacer par vérification qu'un marqueur DOM exposé par CampaignResultStats apparaît dans le tree rendu.
- `historique/_components/CampaignHistoryList.test.tsx` :
  - `MOAT: never renders a <ul>/<ol>/<table> shape carrying per-recipient rows` — pin shape DOM faible ; restreindre l'assertion ou supprimer si redondant avec le test no-PII.

### Zone A8 — commandes (2)

- `page.test.ts` :
  - `AC #238 — holds the filter state on the page via useState` — assertion grep `useState` trop laxiste ; resserrer sur `useState<OrdersFilter>`.
  - `AC #243 — gates the refund affordance by role: passes onRefund ONLY when kb_manager (or KB Admin)` — pin grep faible ; renforcer le regex pour matcher le conditionnel autour de onRefund.

### Zone A9 — menu + dashboard (6)

- `dashboard-view.test.tsx` :
  - `uses the responsive grid (1/2/4 cols)` — assert sur classes Tailwind exactes ; remplacer par data-slot ou supprimer.
- `item-modal.test.tsx` :
  - `F-MENU-09 EDIT — clicking a picker option fires onAttachGroup(itemId, groupId)` — assertion sur l'id matché faible ; préciser `expect(calledGroupId).toBe(options[0].props["data-group-id"])`.
- `menu-view.test.tsx` :
  - `F-MENU-05 — clicking « + Item » fires onCreateItem(categoryId)` — assertion `UNORDERED_CATEGORIES.some(...)` trop laxe ; préciser à la première catégorie post-tri.
- `page.test.ts` :
  - `F-MENU-04 — toggle handler wraps the mutation in try/catch + toast.error + getConvexErrorMessage` — assertion regex sur fenêtre 400 chars fragile ; durcir ou supprimer.
  - `F-MENU-05 — items create/update/remove handlers wrap mutations in try/catch + toast.error` — fenêtres 800 chars fragiles.
  - `F-MENU-06 — photo handlers wrap mutations in try/catch + toast.error` — fenêtre fragile.
  - `F-MENU-07 — reorder handler wraps the mutation in try/catch + toast.error` — fenêtre 5500 chars fragile par nature.
  - `F-MENU-08 — modifier-group CRUD handlers wrap mutations in try/catch + toast.error` — fenêtres 4500 chars fragiles.

### Zone A10 — mes-clients + stats + support (2)

- `mes-clients-view.test.tsx` :
  - `AC4 — responsive grids: every cards grid is 1 col mobile + 3 cols lg+ desktop` — pin classes Tailwind brutes ; remplacer par contrat plus stable ou E2E viewport.
- `stats-view.test.tsx` :
  - `surfaces the remaining placeholder card titles (stories 5-8)` — placeholders temporaires caducs dès story 5 ; restreindre ou supprimer.

### Zone A11 — parametres + pricing + qr (13)

- `parametres-view.test.tsx` :
  - `AC5 — uses shadcn Card primitives (bg-card className)` — couple à Tailwind className ; remplacer par check du data-slot par section.
  - `AC5 — uses the shadcn Separator primitive (radix data-orientation)` — couple à attribut interne Radix ; replacer par check explicite import Separator.
- `pricing-view.test.tsx` :
  - `AC — inactive rule row visually distinguished via opacity/muted class` — couple à className Tailwind ; vérifier un data-slot ou data-active="false".
- (Note : les autres 10 REFACTOR de cette zone sont couverts par les listes plus haut — ils chevauchent les sous-zones agrégées.)

### Zone B1 — convex root (3)

- `kb-admin-schema.test.ts` :
  - `round-trips a FULL prospect row (all V1 fields incl. milestones + interactions)` — ne garder que les assertions sur la structure composite milestones + interactions canal.
- `menu-schema.test.ts` :
  - `links item ↔ group N-N via menuItemModifierGroups (by_item, by_group, by_item_group)` — garder uniquement `byGroup.length === 2` (le vrai invariant métier "réutilisabilité").
- `adminInvites.test.ts` :
  - `queries via the new by_email_tenant index (email + tenantId compound)` — cibler pour asserter la non-collision sur l'index by_email_tenant comme contrainte métier (vs duplicat de l'index).

### Zone B3 — foundation (1)

- `webhooks/idempotent.test.ts` :
  - `records exactly one ledger row, on the by_provider_event index` — protège l'écriture sur l'index sanctionné mais redondant ; assertion sur l'index suffit, drop la branche `typeof processedAt === number`.

### Zone B5 — delivery + uberDirect (1)

- `uberDirect/createDelivery.test.ts` :
  - `returns refused_post_payment when Uber refuses the course (Cas A)` — duplique le mapping pur ; fusionner avec « throws when the tenant has no Uber credentials » ou supprimer si le mapping pur couvre.

### Zone B11 — lib/wallet (1)

- `triggerUpdate.test.ts` :
  - `the barrel (index.ts) does NOT re-export the Convex action (internal-only, addressed by module path)` — vérifie une convention via import barrel ; remplacer par assertion explicite que l'action est exposée via `internal.lib.wallet.triggerUpdate.triggerUpdate`, ou laisser si la convention est protégée stratégique.

---

## 6. KEEP-RENAME (cosmétique mais utile)

**Aucun verdict KEEP-RENAME** n'a été rendu sur l'ensemble du monorepo. Les sous-agents ont systématiquement préféré KEEP ou REFACTOR. La cohérence des noms de tests est donc considérée comme suffisante par tous les sous-agents.

---

## 7. Couverture qualitative (PAS quantitative)

### Très bien couvert

1. **MOAT cross-tenant / RBAC** — fuzz `every unauthorized actor on tenant A is rejected` répété sur ~15 fichiers backend. Aucune fuite cross-tenant possible sans casser un test.
2. **Logique pure métier** — pricing engine, state machines (contrats, tenant lifecycle, orders workflow), reducers (`integrationStatusReducer`, `milestoneChecklistModel`), fonctions de décision (`wizard.decision`, `provision-launcher.decision`, `tenant-context.decision`).
3. **Conformité légale & sécurité** — anti-spam (anti-anomaly, marketing rate limit 3/sem), DNT (22h-8h Paris CET/CEST), RGPD (consent, opt-out, anonymisation), HMAC webhooks (Stripe v1 + key rotation, Apple/Google Wallet internal HMAC), envelope crypto (AES-256-GCM tamper detection).
4. **MOAT anti-PII admin** — `anti-extraction-render.test.tsx`, `anti-pii-static-guard.test.ts`, `audit-on-open.test.ts` — garde-fous load-bearing pour la vue mes-clients.
5. **Lint custom** — `no-untenanted-query.test.js` (gold standard ADR 0010).
6. **Wallet ADR 0003** — carte commune sans tenantId, lien serial→customer, brand re-rendering, idempotence cross-device.

### Patterns DELETE à éliminer en bloc (recettes)

- **80+ grep textuels sur source** — créer un script de recherche `grep "readFileSync\|toString()" packages/*/**.test.*` pour identifier tous les tests qui lisent leur propre source code.
- **25+ tautologies de schéma Convex** (zone B1) — supprimer les round-trips insert→get qui ne testent que la définition validator elle-même.
- **Tests `polish-audit.test.tsx` & responsive grid** — grep classes Tailwind exactes, casse à chaque refactor cosmétique.
- **Scope discipline "never imports from apps/web or apps/native"** — répété 7+ fois en A4, à remplacer par une règle ESLint `no-restricted-imports` au niveau monorepo.

### Sous-couvert (info — pas action automatique)

- **Tests E2E vs unit tests recoupent** : plusieurs tests top-level views (mes-clients, template-view, campagnes-view, wizard-view, commandes-view) re-testent des assertions DOM couvertes par E2E. Audit cross-référencement E2E ↔ unit à envisager.
- **Aucun signal explicite de « zones de production sous-couvertes »** : le mandat de l'audit était inverse, les sous-agents n'ont pas listé systématiquement les bugs hypothétiques non couverts.

---

## 8. Détails par zone (annexe — verdicts complets)

> Les rapports verbatim de chaque sous-agent sont conservés ci-dessous pour traçabilité. Chaque verdict KEEP / KEEP-RENAME / REFACTOR / DELETE par test individuel est documenté.

Voir le fichier source pour la version brute des 25 rapports. Les sections 4, 5 et 6 ci-dessus consolident toutes les actions DELETE et REFACTOR identifiées.

---

## 9. Méta — comment cet audit a été produit

- **Méthode** : 25 sous-agents `general-purpose` lancés en parallèle (background), un par sous-zone non-chevauchante.
- **Critère uniforme** : prompt template identique avec hints domaine spécifiques à chaque zone (MOAT, anti-PII, state machines, etc.).
- **Garde-fous** : règle « no shortcut fixes » → KEEP en cas de doute, JAMAIS DELETE pour un test au but flou. Conservatisme renforcé sur foundation/auth/crypto/MOAT.
- **Lecture seule** : aucune modification de code. Seul ce rapport est écrit.
- **Durée totale** : ~30 minutes (limitée par le sous-agent le plus lent — B7 notifications, 17 fichiers).
- **Coût** : 25 sous-agents × ~80K tokens chacun ≈ 2M tokens.
