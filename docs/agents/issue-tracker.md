# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `NativeSquare/kitchen-boost-repo`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, fetching labels as needed.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with `--label` / `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

`gh` infers the repo from `git remote -v` when run inside the clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## KitchenBoost workflow conventions (see docs/contexts/_architecture/WORKFLOW.md)

- **Epic issues** = output of `/to-prd` (one PRD per chantier). Tag with `epic` + `ready-for-agent`.
- **Tracer bullets** = output of `/to-issues` (vertical slices of an epic). Each references the epic under `## Parent` and lists dependencies under `## Blocked by`. AFK slices tag `ready-for-agent`; HITL slices tag `ready-for-human`.
- The night AFK loop (`/work-all-agent-issues`) picks `ready-for-agent` issues whose blockers are closed, never picks `epic` issues, and forces `needs-schema-review` (HITL) on any PR touching `schema.ts`.
