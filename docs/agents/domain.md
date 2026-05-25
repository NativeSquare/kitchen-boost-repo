# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **multi-context** repo.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it lists the 10 bounded contexts, the transverse vocabulary, and points at one `CONTEXT.md` per context under `docs/contexts/<context>/`. Read each one relevant to the topic.
- **`CLAUDE.md`** at the repo root — business context for KitchenBoost.
- **`docs/contexts/_architecture/STACK.md`** — V1 technical decisions, code↔context mapping, key patterns (`withTenant`, webhook idempotence, envelope encryption), POCs.
- **`docs/contexts/_architecture/WORKFLOW.md`** — the production loop (active session / night coding / morning review), skills, labels.
- **`docs/adr/`** — system-wide architectural decisions (0001–0009). Read the ADRs that touch the area you're about to work in. Note: ADR 0001 is superseded by 0007.
- **`docs/prd/`** — product source of truth: `00_master.md`, per-context PRDs (`10`–`90`), `roadmap.md`. Read the PRD for the chantier you're working on.

If any file doesn't exist, **proceed silently** — don't flag its absence.

## File structure (multi-context)

```
/
├── CLAUDE.md                          ← business context
├── CONTEXT-MAP.md                     ← 10 bounded contexts + transverse vocabulary
├── docs/
│   ├── adr/                           ← system-wide decisions (0001–0009)
│   ├── prd/                           ← product source of truth (00_master, 10–90, roadmap)
│   ├── contexts/
│   │   ├── _architecture/             ← STACK.md, WORKFLOW.md
│   │   ├── multi-tenant/CONTEXT.md
│   │   ├── customer-data/CONTEXT.md
│   │   ├── client-ordering/CONTEXT.md
│   │   ├── payment/CONTEXT.md
│   │   ├── pricing/CONTEXT.md
│   │   ├── delivery/CONTEXT.md
│   │   ├── kb-orders/CONTEXT.md
│   │   ├── kb-admin/CONTEXT.md
│   │   ├── notifications/CONTEXT.md
│   │   └── marketplaces/CONTEXT.md
│   └── agents/                        ← this skill's output (issue-tracker, triage-labels, domain)
└── apps/ packages/                    ← code (template kitchen-boost-repo, do NOT restructure)
```

ADRs are system-wide (single `docs/adr/`); there are no context-scoped ADR folders.

## Use the glossary's vocabulary

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name), use the term as defined in the relevant `CONTEXT.md` and in CONTEXT-MAP.md's transverse vocabulary. Respect the "Avoid" lists and the "Termes bannis nus" table in CONTEXT-MAP.md — don't drift to banned synonyms (e.g. use `Tenant`/`Établissement`, never `Account`; `KB Manager`, never bare `Manager`).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0008 (customer identity cookie/device-only V1) — but worth reopening because…_
