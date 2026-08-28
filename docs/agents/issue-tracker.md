# Issue tracker: GitHub for bugs, local tickets for everything else

The public GitHub tracker on `Bandersnatch0x/amber-protocol` carries **bug reports only**.
Specs, research questions, planning work, and wayfinder maps/tickets live as local markdown
tickets under `issues/` — gitignored, never published to the public tree.

## Bug reports (GitHub)

Use the `gh` CLI for all operations.

- **Create a bug**: `gh issue create --title "..." --body "..."` (bug template applies the `bug`/`triage` labels). Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone. If no remote is configured, pass `--repo Bandersnatch0x/amber-protocol` explicitly.

Do not open spec, research, or planning issues on GitHub. Triage labels are documented in `docs/agents/triage-labels.md`.

### Grandfathered tickets

Non-bug tickets opened before this policy (e.g. wayfinder maps #237, #260 and their sub-issues) stay on GitHub until they close naturally. Work them where they live; open no new non-bug tickets there.

## Local tickets (`issues/`)

- **File**: `issues/NNNN-<slug>.md` — zero-padded sequential id, next id = highest existing + 1.
- **Frontmatter**:

  ```yaml
  ---
  id: 0007
  type: map | spec | research | prototype | grilling | task
  status: open | closed
  assignee: ""
  part-of: ""        # map id for child tickets
  blocked-by: []     # ids that must close first
  created: 2026-08-28
  ---
  ```

- **Create**: write the file with frontmatter plus a body (problem statement / acceptance shape).
- **Read**: open the file; the body plus its appended log is the full ticket state.
- **Comment**: append a `## Log` entry with a date heading — never rewrite earlier entries.
- **Close**: set `status: closed` and append the resolution to the log.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a local ticket with child tickets beside it.

- **Map**: a ticket with `type: map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a ticket with `part-of: <map-id>` and a `type` of `research`/`prototype`/`grilling`/`task`. Once claimed, set `assignee`.
- **Blocking**: list blocker ids in `blocked-by`. A ticket is unblocked when every listed ticket has `status: closed`.
- **Frontier query**: open children of the map (`part-of` matches, `status: open`), drop any with an open blocker or a non-empty `assignee`; first in map order wins.
- **Claim**: set `assignee` — the session's first write.
- **Resolve**: append the answer to the ticket log, set `status: closed`, then record a context pointer in the map's Decisions-so-far.

## When a skill says "publish to the issue tracker"

- Bug → create a GitHub issue.
- Anything else (spec, research, map, ticket) → create a local ticket under `issues/`.

## When a skill says "fetch the relevant ticket"

- `#<n>` → `gh issue view <n> --comments` (GitHub bug or grandfathered ticket).
- `NNNN` → read `issues/NNNN-*.md`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.
