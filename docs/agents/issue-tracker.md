# Work-item and specification sources

The public GitHub tracker on `Bandersnatch0x/amber-protocol` carries **new bug reports
only**. The repository separates canonical content, work records, and generated evidence;
the boundary is based on authority and lifecycle, not merely on which directory is local.

The canonical home for specification content is `docs/specs/`. This includes a specification
while it is `draft` or `proposed`, not only after acceptance. A local ticket is optional
coordination around a specification; it is not a second copy of the normative text.

## Placement and authority

Use this matrix before creating or moving a document:

| Content | Canonical home | Boundary |
| --- | --- | --- |
| Normative specification | `docs/specs/` | The only authoritative home for requirements, behavior, and protocol contracts. Keep lifecycle state in the spec metadata. |
| Architecture decision | `docs/adr/` | Records an architectural decision and its rationale; it does not replace the specification that describes the resulting behavior. |
| Implementation plan | `docs/plans/` | Describes sequencing and execution details; it is not normative and must not silently redefine a spec. |
| Research, question, prototype, map, or task | `issues/` | Local, gitignored work records. They may link to a spec, ADR, or plan but do not own its content. |
| Audit, migration, or provenance record | `docs/agents/` or `docs/reviews/` | Evidence about how a conclusion was reached; it does not become authoritative merely because it is detailed. |
| Raw Agent/MATT/workflow output | `.scratch/`, `.workflow/`, `.qoder/`, `agent-tools/`, or the owning tool directory | Generated process material. Do not cite a route, transcript, packet, or report as the specification without promoting a reviewed conclusion. |
| Feature catalog and implementation status | `feature_list.json` | An index of feature delivery state. It does not replace spec text or automatically change spec lifecycle state. |
| New defect report | GitHub | The public issue tracker is for bugs and their triage history. |

Existing tracked workflow history is preserved unless a separate cleanup decision is made;
the raw-output rule applies to new material and to promotion decisions.

### Specification lifecycle

1. **Draft or propose.** Put the normative body in `docs/specs/<stable-name>.md`. Every
   new or substantially changed spec must expose `spec_id`, `status`, `updated`, and
   `provenance`; add `owner` and `feature` when applicable. Use the repository's existing
   metadata style until a metadata migration is explicitly approved. Create an `issues/`
   ticket only when review, research, or implementation work needs a queue; link it to the
   spec instead of duplicating the body.
2. **Review or accept.** Keep review discussion in the local ticket, ADR, or review record.
   Update the canonical spec's lifecycle state after the decision and retain links to the
   evidence and source material. Update `feature_list.json` only for feature-catalog state.
3. **Change, supersede, or retire.** Make the relationship explicit with a `supersedes`,
   `superseded_by`, or retirement note. Preserve the prior spec and its provenance; do not
   delete or rewrite history just to make the current directory look clean.
4. **Migrate a legacy GitHub specification.** Read the issue body, comments, labels, and
   linked material; reconcile the normative content into `docs/specs/` (or the decision into
   `docs/adr/`); record the original issue URL/number and disposition in the migration
   `docs/agents/spec-source-migration.md` (and its machine-readable companion when used);
   record unresolved conflicts instead of guessing. Synchronization alone does not authorize
   deleting the GitHub record. Existing non-bug issues remain grandfathered below and may
   close naturally after the local authority is established.

A migration is complete only when a local canonical target exists, the source link and
disposition are recorded, and no conflict or uncertainty is silently omitted.

### Statuses are separate vocabularies

Do not infer one status from another. The spec status token uses the exact lowercase
vocabulary below; version numbers, review notes, and ADR links belong in separate metadata
or prose, not inside the status value:

- Spec status describes the authority lifecycle: `draft`, `proposed`, `accepted`,
  `superseded`, or `retired`.
- `feature_list.json` status describes the implementation/catalog lifecycle.
- A local ticket's `open`/`closed` status describes work tracking.

For example, an accepted feature may still point to a proposed spec during an intentional
transition, but that mismatch must be visible and audited; it is not permission to rewrite
the spec or catalog by assumption. Existing files with a missing or non-canonical status
require an evidence-backed normalization pass; do not fill them from `feature_list.json` by
mechanical inference.

### Agent and MATT artifacts

MATT/Agent-generated routes, packets, terminal transcripts, audit snapshots, and reports
are process evidence. Store raw output in the tool/workflow locations above. Promote only a
reviewed conclusion, and promote it to the correct authority layer: normative text to
`docs/specs/`, an architectural choice to `docs/adr/`, an implementation plan to
`docs/plans/`, and audit/provenance to `docs/agents/` or `docs/reviews/`. A generated report
may support a decision, but it must not be treated as the decision or as a spec by itself.

In this repository, `docs/agents/spec-source-migration.md`/`.json` are migration provenance,
`spec-compliance/` is a review-evidence package, and `.scratch/matt-workflow.route.json` is
workflow configuration. None of these is a canonical specification; each must point to a
reviewed target under the appropriate authority directory.

## Before writing: choose the destination

Ask what the content *is*, not which agent produced it:

1. If it states what the system must do, write `docs/specs/`.
2. If it records why an architectural choice was made, write `docs/adr/`.
3. If it sequences implementation work, write `docs/plans/`.
4. If it is an open question, investigation, prototype, map, or task, write an `issues/`
   ticket and link any canonical documents.
5. If it records an audit, migration, or source comparison, write `docs/agents/` or
   `docs/reviews/`.
6. If it is raw tool output, keep it in a generated/workflow location.
7. If it is a newly discovered defect, use GitHub.

## Bug reports (GitHub)

Use the `gh` CLI for all operations.

- **Create a bug**: `gh issue create --title "..." --body "..."` (bug template applies the `bug`/`triage` labels). Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone. If no remote is configured, pass `--repo Bandersnatch0x/amber-protocol` explicitly.

Do not open new spec, research, planning, map, or task issues on GitHub. Put normative spec
content in `docs/specs/`; if coordination is needed, create a local ticket under `issues/`.
Triage labels are documented in `docs/agents/triage-labels.md`.

### Grandfathered tickets

Non-bug tickets opened before this policy (e.g. wayfinder maps #237, #260 and their sub-issues)
stay on GitHub until they close naturally. Work them where they live, preserve their links
as provenance when migrating content, and open no new non-bug tickets there. Do not mass-delete
these records merely because their content has been synchronized locally; deletion requires a
separate explicit retention decision.

## Local work tickets (`issues/`)

- **Purpose**: coordination records for research, review, proposals, prototypes, maps, and
  tasks. A `type: spec` ticket tracks work on a canonical document under `docs/specs/`; it
  does not make the ticket body the specification.
- **File**: `issues/NNNN-<slug>.md` — zero-padded sequential id, next id = highest existing + 1.
- **Frontmatter**:

  ```yaml
  ---
  id: 0007
  type: map | spec | research | prototype | grilling | task
  status: open | closed
  assignee: ""
  spec: ""          # canonical docs/specs path when type is spec
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
- Normative specification → create or update `docs/specs/` and optionally create a linked
  local review/work ticket under `issues/`.
- Architecture decision → create or update `docs/adr/`.
- Implementation plan → create or update `docs/plans/`.
- Research, map, prototype, question, or task → create a local ticket under `issues/`.

## When a skill says "fetch the relevant ticket"

- `#<n>` → `gh issue view <n> --comments` (GitHub bug or grandfathered ticket).
- `NNNN` → read `issues/NNNN-*.md`.
- A path under `docs/specs/`, `docs/adr/`, or `docs/plans/` → read that canonical document
  directly and follow its linked work/provenance records.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.
