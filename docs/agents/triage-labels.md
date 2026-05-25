# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker. All map 1:1 (the repo was set up with these exact names).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation (HITL)     |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Extended workflow states (KitchenBoost-specific)

Beyond the five canonical triage roles, the KitchenBoost production loop (see `docs/contexts/_architecture/WORKFLOW.md` §6) uses these lifecycle labels. The matt-pocock skills don't apply them — the custom AFK coding skills and the morning review do.

| Label | Meaning | Applied by |
| --- | --- | --- |
| `in-progress` | Agent currently coding this story | `/work-all-agent-issues` when it picks a story |
| `needs-review` | PR open, awaiting Alex review | AFK loop after a green PR is created |
| `needs-rework` | Review negative, story returns to the queue | Alex during morning review |
| `blocked` | Agent blocked; reason in a comment | AFK loop after 2 failed fix attempts |
| `needs-schema-review` | PR touches `schema.ts` — HITL forced | AFK loop (garde-fou) |
| `epic` | Parent PRD issue (output of `/to-prd`) | `/to-prd` |

### Category labels (one per issue)
`bug` / `enhancement` — GitHub defaults, reused as-is.

### Normal transitions
```
[unlabeled] → needs-triage
needs-triage → ready-for-agent | ready-for-human | needs-info | wontfix
needs-info → needs-triage (reporter responded)
ready-for-agent → in-progress (agent picks)
in-progress → needs-review (PR created) | blocked (failure)
needs-review → [closed via merge] | needs-rework
needs-rework → ready-for-agent (loop back)
blocked → needs-triage (after /diagnose)
```
