# CLI Reference

Complete command reference for Amber Protocol CLI.

Running `amber` or `amber --help` shows the journey and core governance projection.
Run `amber --all` to list every deprecated and expert compatibility command. Hidden commands
remain callable and retain `amber <command> --help`; F019 changes discovery, not command removal.
For agent-guided work, invoke the `amber` router skill, which selects one of four deep journeys.

## Global Options

```bash
--target <path>   # Project root directory
--json            # Output JSON format
--dry-run         # Preview without making changes where supported (init, wiki, plan, team install/update, loop run)
--help            # Show command help
```

Text-mode bypass output writes payload text to stdout and prefixes blocking diagnostics as
`ERROR:` / `WARNING:` on **stderr**. `--json` still prints the structured result (including
`errors`) on stdout.

## Feature & Plan Commands

The governed delivery flow starts here: register a feature, plan a slice, gate the plan, review it, then accept it after the session completes. `amber next` walks this lifecycle step by step.

### feature

Add, list, remove features in `feature_list.json`, record verification evidence, and book feature paths:

```bash
node scripts/amber.js feature add --id F001 --title "User login" --priority 1 --area auth --behavior "User logs in with email and receives a session token." --verify "npm test" --paths src/auth --target .
node scripts/amber.js feature list --target .
node scripts/amber.js feature remove --id F001 --target .
node scripts/amber.js feature verify --feature F001 --command "npm test" --result "42 passed" --target .
node scripts/amber.js feature evidence --feature F001 --target .
node scripts/amber.js feature paths --feature F001 --path src/auth/login.js --target .   # append-only, deduped; no --path lists current paths
```

`feature paths` is the completion-time way to book the files a feature touched — the post-accept
learning write-back checkpoint (`amber learnings`) detects its triggers from these paths.

### plan

Create a feature-linked vertical-slice plan from a registered feature (the scaffold includes the Context manifests section: implement/review knowledge-surface lists, gate-validated — missing paths, escaping paths, and code paths are errors; `amber review` echoes the curated lists):

```bash
node scripts/amber.js plan --target . --feature F001 --title "Small slice" [--dry-run]
```

**Options:**
- `--feature`: Feature id (e.g. F001) — must already exist in `feature_list.json` (required)
- `--title`: Short human-readable title for the plan (required)
- `--dry-run`: Preview without writing files

The scaffold includes a **Context manifests** section: `implement` and `review` role lists of
knowledge-surface paths (docs/specs contracts, wiki pages, ADRs, schema docs) each role needs.
Curate them at planning time — the gate validates both roles (missing paths and code paths are
errors; code belongs in the feature's booked paths), and `amber review` echoes the curated lists.

### gate

Validate that a plan is tied to feature state and has user confirmation, or confirm it:

```bash
node scripts/amber.js gate --target . --plan docs/plans/F001-small-slice.md            # gate-check
node scripts/amber.js gate --target . --plan docs/plans/F001-small-slice.md --confirm  # set User Confirmation
```

Plan-level and session-level approvals are two layers: `gate --confirm` edits the plan's User Confirmation field, while `session approve` records `gate_passed` in the session timeline. Both layers must be satisfied for `complete-check --strict` to pass.

### review

Review a plan against static Amber standards and release-readiness checks:

```bash
node scripts/amber.js review --target . --plan docs/plans/F001-small-slice.md
```

Review also runs a scope-discipline advisory: feature paths booked in `feature_list.json` that the plan's declared `Scope` bullet never mentions (exact path or directory prefix) surface as warnings, next to a four-question self-review checklist (uninvited tidying, speculative abstraction, files the acceptance criteria never named, caller-side workarounds). This check is advisory only — it never blocks the gate or release readiness.

### accept

Accept a reviewed plan and append an Amber evolution record:

```bash
node scripts/amber.js accept --target . --plan docs/plans/F001-small-slice.md
node scripts/amber.js accept --target . --plan docs/plans/F001-small-slice.md --session <session-id>
```

**Options:**
- `--plan`: Relative path to the plan to accept
- `--session`: Optional session id; prints completion-check status as a warning
- `--strict`: With `--session`, turn missing completion-check evidence into errors

With `--session`, the plan's `Feature:` header must match the session's feature — a definite mismatch blocks the accept.

### learnings

Inspect the post-accept learning write-back triggers for a feature, or book the learning review:

```bash
node scripts/amber.js learnings --target .
node scripts/amber.js learnings --target . --feature F001
node scripts/amber.js learnings --target . --feature F001 --reviewed --owner command --surface docs/specs/f001.md
```

**Options:**
- `--feature`: Feature to inspect (defaults to the current lifecycle focus)
- `--reviewed`: Book the learning review (requires `--feature`; overwrites any prior booking)
- `--owner`: Canonical durable owner ID (exactly one is required with `--reviewed`): `skill`, `hook`, `command`, `standard`, `script`, `workflow-pack`, `loop-contract`, or `ci`
- `--surface`: Knowledge surface the review was written to (repeatable; a single flag also accepts a comma-separated list)
- `--json`: Emit the machine-readable envelope

Inspection is read-only: it classifies the feature's booked paths into the `schema`, `contract`, and `infra` trigger categories, lists the matching paths with suggested knowledge surfaces, renders the complete owner catalog, and shows the current booking and owner state. `--reviewed` clears the checkpoint by writing `{ reviewed, date, surfaces, owner }` onto that feature's entry in `feature_list.json` — the only write the command performs. Re-booking replaces the date, surfaces, and owner. Missing, repeated, comma-separated, and unknown owners fail without changing the file.

Amber never infers the owner from paths or prose. Existing reviewed records without an owner remain complete and are reported as legacy bookings. Owner selection is distinct from F025 prevention-mechanism selection: the prevention mechanism says how recurrence is prevented; the owner says which Amber surface carries that behavior.

Boundary: Amber detects and reminds; it never writes knowledge docs itself. `workflow-pack` and `loop-contract` are declarative owner routes, not live scheduling or execution. `ci` means a check that actually runs on a protected repository event or pull-request gate.

Trigger rules, invariants, and the channels that surface this checkpoint (`amber next`, the breadcrumb, `amber handoff`) are specified in [docs/specs/2026-08-15-learning-writeback.md](specs/2026-08-15-learning-writeback.md). Owner decisions and route boundaries are documented in [docs/wiki/learning-owner-routing.md](wiki/learning-owner-routing.md).

### break-loop

Escalation path for RECURRING friction or defect classes — the same class coming back after a fix (recurrence ≥ 2, declared by the operator):

```bash
node scripts/amber.js break-loop --target . --issue 122 --title "Evidence dates drift UTC vs local" --recurrence 2
node scripts/amber.js break-loop validate --target . --file docs/quality/break-loops/2026-08-15-Evidence-dates-drift-UTC-vs-local.md
```

**Options:**
- `--issue <n>`: Reference number of the recurring issue (recorded only, no tracker access)
- `--title "<t>"`: Post-mortem title (becomes the filename slug)
- `--recurrence <n>`: How many times the class has come back; must be ≥ 2
- `--file <path>`: Post-mortem file to validate (validate action)
- `--json`: Emit the machine-readable envelope

The default action scaffolds `docs/quality/break-loops/<date>-<slug>.md` from a five-way root-cause taxonomy (`missing-contract`, `cross-layer-drift`, `change-propagation-failure`, `verification-gap`, `implicit-assumption`) and a prevention-mechanism menu (`contract-and-anchor`, `parity-guard`, `centralized-helper`, `checklist-item`), each entry mapped to its write-back surface. An existing file is never overwritten — the refusal names the file. `validate` refuses placeholder content: every section must be filled, exactly one primary category id and one mechanism id chosen, a write-back surface path and test anchor recorded, and a runnable verification command present.

Boundary: Amber scaffolds and validates — the analysis is the operator's. No issue-tracker access, no recurrence auto-detection, no execution.

The escalation trigger lives in the dogfood ritual's friction loop: [docs/dogfood-weekly.md](dogfood-weekly.md) §5.

## Session Commands

### session start

Start a new session:

```bash
node scripts/amber.js session start \
  --target . \
	--goal "implement user authentication" \
	--route feature-standard \
	[--budget 100000] \
	[--worktree] \
	--confirm
```

**Options:**
- `--goal`: Session objective (required)
- `--route`: Route ID (default: feature-standard)
- `--budget`: Token limit (default: from route)
- `--worktree`: Use git worktree isolation
- `--confirm`: Required before the typed mutation is executed.
- `--mode autonomous`: refused in V1 by ADR-0001/0005; use the default governed session flow.

### session status

Show session status:

```bash
node scripts/amber.js session status [<session-id>]
```

Shows current session if ID omitted.

### session list

List all sessions:

```bash
node scripts/amber.js session list --target .
```

Output:
```
abc123def [completed] feature-standard — implement auth
```

### session abort

Abort running session:

```bash
node scripts/amber.js session abort <session-id> --target .
```

### session continue

Continue paused session:

```bash
node scripts/amber.js session continue [<session-id>] --target .
```

Resumes from last checkpoint.

### session verify / approve / verify-ledger

Record human-run verification evidence and gate approvals, and verify the session's tamper-evident
ledger. `verify` and `approve` also mirror the event into a hash-chain ledger
(`.amber/sessions/<id>/ledger.jsonl`) so a later edit to a recorded result is detectable.

```bash
node scripts/amber.js session verify   --session <id> --command "npm test" --result pass  --target . --confirm
node scripts/amber.js session approve  --session <id> [--gate <gate-id>] --yes            --target .
node scripts/amber.js session verify-ledger --session <id>                                --target .
```

`verify-ledger` recomputes the session ledger's hash chain and reports `AMBER_E_LEDGER_TAMPERED` on
any broken link.

## Route Commands

### route list

List available routes:

```bash
node scripts/amber.js route list --target .
```

### route inspect

Show route details:

```bash
node scripts/amber.js route inspect <route-id> --target .
```

### route validate

Validate route file:

```bash
node scripts/amber.js route validate <route-file> --target .
```

### route test

Print a route's dry-run stage sequence, OR — since [ADR-0003](adr/0003-governance-gated-execution.md)
Phase 3 — execute one `command`-type stage under the four governance gates.

```bash
# dry-run stage sequence (default; no execution)
node scripts/amber.js route test feature-standard --target .

# governed execution of one command stage (needs a prior `route approve`; runs in an isolated worktree)
node scripts/amber.js route test feature-standard --execute --stage verify --target .
```

`--execute --stage <name>` runs only `command`-type stages' `target`, after the policy gate, an
unconsumed approval, git-worktree isolation, and a tamper-evident ledger entry. Non-`command` stages
refuse `--execute`.

### route approve / verify-ledger

Record a human approval authorizing ONE governed execution of a route stage, then verify the
route-scoped hash-chain ledger.

```bash
node scripts/amber.js route approve feature-standard --stage verify --reviewer your-name --target .
node scripts/amber.js route verify-ledger feature-standard --target .
```

## Governance Commands

### governance report

Score the repository's product delivery loop and emit structured next actions.

```bash
node scripts/amber.js governance report --target .
node scripts/amber.js governance report --target . --output docs/quality/amber-governance-report.md --confirm
```

The report covers the product loop `Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle`, with scores for governance, evidence, continuity, safety, and maintenance.

### governance docs

Generate governance documents:

```bash
node scripts/amber.js governance docs --target .
```

Creates:
- `.amber/governance/POLICY.md`
- `.amber/governance/BOUNDARIES.md`
- `.amber/governance/AUDIT_LOG.md`

### governance evidence

Export session evidence:

```bash
# Single session
node scripts/amber.js governance evidence \
  --session <id> \
  --output evidence.md \
  --target .

# Single execution
node scripts/amber.js governance evidence \
  --task <id> \
  --output execution-evidence.md \
  --target .
```

### governance policy

Inspect governance policy:

```bash
node scripts/amber.js governance policy --target .
```

Shows policy violations and recommendations.

### governance audit

Generate audit report:

```bash
node scripts/amber.js governance audit \
  --target . \
  [--since 2024-01-01] \
  --output audit-report.md
```

### governance standards

Honest, read-only coverage report of Amber's governance controls against the OWASP Top 10 for
Agentic Applications 2026 (ASI01–ASI10). Amber is a static layer, so most ASI risks are reported as
`out-of-scope` (runtime-only) rather than overclaimed as covered. Each risk's `present` flag reflects
whether its *specific* control is actually deployed in the target repo (a deny rule for ASI02, an
allow rule for ASI04, a non-empty hash-chain ledger for ASI06, an approval record for ASI09) — not
just a label.

The `init` subcommand scaffolds the declarative security-governance standard
(`standards/security-governance.json`) the report maps against — idempotent, it skips when the file
already exists. The starter ships via `templates/`, so it is written from the Amber install, not
read from the target's own `standards/`.

```bash
# scaffold the security-governance standard (idempotent; skips if present)
node scripts/amber.js governance standards init --target .

# read-only coverage report
node scripts/amber.js governance standards --target . --framework owasp-agentic
node scripts/amber.js governance standards --target . --json
```

### governance rules

Scaffold and inspect the declarative command policy (`.amber/governance/rules.json`) that the
governed-execution policy gate uses. All subcommands are read-only or idempotent scaffolding.

```bash
# write safe defaults (deny-wins / default-deny); skips if rules.json already exists
node scripts/amber.js governance rules init --target .

# show the active policy surface (rules.json, or built-in defaults if absent)
node scripts/amber.js governance rules inspect --target .

# try a command against the policy without executing it (read-only verdict)
node scripts/amber.js governance rules check --target . --command "rm -rf /tmp/x"
```

`rules check` uses the **same policy surface as `governed-runner`** (`evaluateGovernedPolicy`):
un-removable built-in denies for destructive commands and shell composition (`&&`, `|`, `;`,
file redirects, etc.) run **before** user `rules.json` allows. A prefix allow cannot smuggle a
composite tail past the dry-run check — the verdict matches what `--execute` would enforce.
Pure FD-to-FD redirects (`2>&1`, `1>&2`) are allowed; they rebind streams of the same process
and are not a second command.

**Per-context rules:** a loop contract's `governed` block and a route `command` stage may each
declare an extra `rules` array (same `{ id, action, match, pattern }` shape). These compose with
the global `rules.json` for that one command only — a context `allow` can supplement the global
policy, but **deny-wins is absolute**: no context `allow` can override a global or context `deny`
(or a built-in deny).

### artifact admit / show / list

Admit and read Canonical Planning Artifacts (F049; ADR-0023). Each revision binds a human-readable
Artifact Body (Markdown) to a machine-actionable Artifact Envelope in one atomic admission, settled
through durable prepared/committed/aborted journal records. Only committed revisions are visible;
history is append-only and immutable — there is no in-place mutation path for a committed revision.

Registered Artifact Types form a closed registry: **intent**, **spec**, **plan**, **decision**,
**gate**, and **policy**. The planning types each have a closed lifecycle of named transitions.
Admitting a revision without a transition carries the type's initial state (`draft`);
`--transition <name>` applies a registered transition — `accept` (intent: draft → accepted) or
`approve` (spec/plan: draft → approved) — as a **new revision** superseding the head. Gate and
Policy Contracts use `activate` (draft → active) and `retire` (active → retired). A transition that
is not registered fails closed as `AMBER_E_ARTIFACT_TRANSITION_UNKNOWN`; one that does not apply
from the current head's lifecycle state fails closed as `AMBER_E_ARTIFACT_TRANSITION_INVALID`. A
**decision** is different: it records a point-in-time authority act, so its lifecycle is the single
state `recorded` with no transitions — an amended Decision is a new revision of the same identity,
admitted fresh.

A Decision admission (F050) binds the acting **Principal**: `--decision-kind
<acceptance|approval|review>` and `--principal <id>` are required for `--type decision` and
rejected for every other type. The principal is verified against the Principal registry
(`amber principal`, below) at admission time — twice: pre-lock and again under the artifact
lock, so a revocation that lands in between still fails the admission. Acceptance and Approval
are human-only authority slots: binding a service principal fails closed as
`AMBER_E_DECISION_HUMAN_SLOT_REQUIRED`; only a Review may be carried by a service identity. The
verified principal snapshot is frozen into the Envelope (canonical admission content — the same
Body bound to a different principal is a different admission), and every Decision must `decide`
exactly one committed revision of a registered type via the `decides` trace
(`--trace decides:<type>:<identity>[@<revision>]` — the target type must be declared explicitly
because a Decision may record against any registered type).

Typed Trace lineage is a versioned registry: `refines` (spec → intent), `realizes` (plan → spec),
`supersedes` (any type → a different artifact of the same type), and `decides` (decision → any
registered type, target type declared explicitly), each with direction, scope, and cardinality.
Required planning lineage is enforced at admission: **a Spec must refine exactly
one accepted Intent revision and a Plan must realize exactly one approved Spec revision** —
omitting the required trace fails closed as `AMBER_E_ARTIFACT_TRACE_CARDINALITY`, a generic or
unregistered relation fails as `AMBER_E_ARTIFACT_TRACE_UNKNOWN` (it cannot satisfy required
lineage), a Plan realizing its Intent directly fails as `AMBER_E_ARTIFACT_TRACE_DIRECTION`
(omitted-Spec policy), a target that is missing or not yet in the required lifecycle state fails
as `AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND` / `AMBER_E_ARTIFACT_TRACE_TARGET_LIFECYCLE`, and a
trace crossing a scope boundary fails as `AMBER_E_ARTIFACT_TRACE_SCOPE` (source and target must
declare the same `--scope` tag; null counts as a scope). Trace revisions default to the target's
current committed head and are recorded resolved — traces bind revisions, not heads.

Artifact identity spelling is **exact**. `--id` accepts any identity that is a usable directory
name (empty and pure-dot segments are rejected as `AMBER_E_ARTIFACT_INVALID_IDENTITY`), and
identities differing only by letter case are distinct spellings, never one artifact: admission of
an identity that differs only by case from an existing artifact home fails closed as
`AMBER_E_ARTIFACT_IDENTITY_CASE_COLLISION` naming the stored spelling, and a read that names a
case-variant of a stored spelling (`artifact show`, or a `--trace` target) reports
`AMBER_E_ARTIFACT_NOT_FOUND` with the stored spelling in the message — never settlement
corruption. The check compares stored directory entries, so behavior is identical on
case-insensitive filesystems (Windows, default macOS) and case-sensitive ones (Linux): case never
decides whether two spellings alias.

```bash
# admit a new Intent revision (returns the admission receipt)
node scripts/amber.js artifact admit --target . --id intent/login-bug --body "# Intent: login bug" --json

# supersede the current head with new content (compare-and-swap on the expected head)
node scripts/amber.js artifact admit --target . --id intent/login-bug --body "..." --expected-head 1

# same as above, naming the superseded revision instead of the head
node scripts/amber.js artifact admit --target . --id intent/login-bug --body "..." --supersedes-revision 1

# accept the Intent: a NEW revision carrying the accepted state (never an in-place edit)
node scripts/amber.js artifact admit --target . --id intent/login-bug --body "..." --expected-head 1 --transition accept

# admit a Spec refining the accepted Intent (required planning lineage)
node scripts/amber.js artifact admit --target . --type spec --id spec/login-spec --body "..." --trace refines:intent/login-bug

# pin the traced revision explicitly; confine both endpoints to one scope
node scripts/amber.js artifact admit --target . --type spec --id spec/login-spec --body "..." --trace refines:intent/login-bug@2 --scope team-a

# approve the Spec, then admit a Plan realizing it
node scripts/amber.js artifact admit --target . --type spec --id spec/login-spec --body "..." --expected-head 1 --transition approve --trace refines:intent/login-bug
node scripts/amber.js artifact admit --target . --type plan --id plan/login-plan --body "..." --trace realizes:spec/login-spec

# attach caller retry metadata (optional; never determines identity)
node scripts/amber.js artifact admit --target . --id intent/login-bug --body "..." --idempotency-key op-123

# carry opaque extension data in a namespace (repeatable; a value parses as JSON when valid)
node scripts/amber.js artifact admit --target . --type spec --id spec/login-spec --body "..." --extension acme.weight=3 --extension acme.meta='{"a":1}'

# show the current or an explicit revision; list current revision of each artifact
node scripts/amber.js artifact show --target . --id intent/login-bug [--revision 1] --json
node scripts/amber.js artifact show --target . --type spec --id spec/login-spec --json
node scripts/amber.js artifact list --target . --json
```

`--trace <type>:<identity>[@<revision>]` is repeatable; the target type is derived from the
registered Trace contract (the CLI never names a type the registry contradicts). The revision is
strict (positive integer, never NaN) and defaults to the target's current committed head inside
the store. Identities containing `@` are supported: the revision is parsed from the **last** `@`
and only when what follows it is all digits — `refines:user@tenant` names the identity
`user@tenant` at its head, `refines:spec/login-spec@2` pins revision 2, and
`refines:user@tenant@3` pins revision 3 of `user@tenant`. The one spelling this grammar cannot
express is an identity that itself ends in `@<digits>` referenced *unpinned* (`user@123` would
parse as identity `user` at revision 123) — pin a revision explicitly (`user@123@2`) in that
case. Malformed flag values — a garbage revision (`@0`), a missing target, or one of this
command's value flags (including
`--target`) trailing at the end of the command line — fail closed as `AMBER_E_INVALID_ARG`, never
as a silently dropped precondition (an explicitly empty `--idempotency-key`, `--type`, or
`--target` fails the same way on all three actions — an empty `--target` never silently resolves
to the current working directory, and `list --type ""` reports `AMBER_E_INVALID_ARG` rather than
`AMBER_E_ARTIFACT_UNKNOWN_TYPE`; a non-artifact flag trailing on an artifact command is simply
ignored).

`--extension <namespace>.<key>=<value>` is repeatable and carries opaque extension data inside the
Envelope's reserved `extensions` carrier (ticket 06): `--extension acme.weight=3`,
`--extension acme.meta={"a":1}`. The value is parsed as JSON when it is valid JSON (numbers,
booleans, null, objects, arrays) and carried verbatim as a string otherwise — extension data is
opaque to Amber, which applies no interpretation beyond the structural rules. The namespace/key
split is on the **first** dot of the name half, so extension keys may themselves contain dots; a
malformed flag value, or the same `namespace.key` declared twice, fails closed as
`AMBER_E_INVALID_ARG`. A namespace or per-namespace key that collides with — would shadow — a core
Envelope field (`type`, `identity`, `traces`, ...) fails closed as
`AMBER_E_ARTIFACT_EXTENSION_COLLISION`; unregistered namespaces are otherwise carried opaquely.
Extensions are canonical admission content, so the same Body with different extension data is a
different admission (an idempotency conflict), never a silent duplicate.

`--expected-head <n>` is the compare-and-swap precondition: the admission commits only if the
current committed head is exactly `<n>`, otherwise it fails closed as `AMBER_E_ARTIFACT_CONFLICT`
(the loser of two admissions racing on the same expected head never writes).
`--supersedes-revision <n>` declares the same precondition from the other side and must agree with
`--expected-head` when both are given.

Admission is bounded by size ceilings (ticket 06): a Body above 512 KiB (524,288 UTF-8 bytes) is
refused with `AMBER_E_ARTIFACT_SIZE_CEILING` before any durable state is touched — no artifact
home, no lock, no journal record — and an Envelope that serializes above 256 KiB (262,144 bytes)
is refused with the same code before the prepared record is appended (on failure the still-empty
lock-created home is removed again, so nothing remains). The boundaries are inclusive: a Body or
Envelope of exactly the ceiling admits. Both ceilings can be raised deliberately for a bigger
store via `AMBER_ARTIFACT_MAX_BODY_BYTES` / `AMBER_ARTIFACT_MAX_ENVELOPE_BYTES` (positive
integers; a set-but-garbage override — non-integer, zero, or negative — fails closed as
`AMBER_E_INVALID_ARG`, never a silent default).

Admission is idempotent on the **full canonical envelope content** (schema version, type, identity,
supersedes, bodyHash, provenance, and — since ticket 03 — the named transition, scope, and resolved
trace set, and — since ticket 06 — the extension namespaces; the lifecycle state itself is derived
from the transition and excluded like revision numbers). An exact-duplicate retry — same Body, same
provenance, same expected head, optionally
recognized by the same `--idempotency-key` — returns the original receipt (flagged as duplicate in
warnings) without creating a new revision, even if the revision was later superseded. Reusing an
idempotency key for different content, or presenting the same Body with different provenance at
the head, fails closed as `AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT`. Settlement state admission could
never have written — a double commit, a commit without its prepared record, a forked expected head,
a skipped revision slot, a committed record stripped of the settlement hashes its journal otherwise
carries, or a committed pair missing on disk — fails closed as `AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT`
at admission **and on every read**: `show` and `list` are verification reads that replay the
settlement journal, sweep and hash-verify both halves of every committed revision (a hole or a
broken binding at any revision, not just the head or the served one, is corruption — `list` never
silently drops an artifact whose pair is incomplete while `show` serves earlier revisions), and
cross-check the committed record's contentHash against the Envelope's bodyHash. One corrupt
artifact fails the whole listing — the listing is never a partial projection. Once a journal
carries settlement hashes anywhere
(`expectedHead`/`admissionHash`), hashless committed records are corruption; only pure ticket-01
journals with zero hash-bearing records read as legacy — and admission refuses to extend those in
place (re-admit the content as a fresh store). A filesystem failure during admission — creating
the artifact home or its admission lock, writing the pair, or appending a journal record —
surfaces as `AMBER_E_ARTIFACT_IO` instead of a raw filesystem error, and is never misreported as a
compare-and-swap conflict.
Reads verify both halves of the binding **at every committed revision they walk, not only the
served or head one**: a stored Body that lost its contentHash match reports
`AMBER_E_ARTIFACT_HASH_MISMATCH`, a stored Envelope that lost its envelopeHash match reports
`AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH`. The exact verification scope is per seam: `show`
hash-verifies every committed revision of the artifact read; `list` of every artifact in the
store; the transitive trace walk underlying show/list/rebuild verifies settlement and hashes of
every committed revision of each home it reaches; and admission's trace-target resolution
(`readCommittedRevision`) sweeps the target's **entire** committed history, so a Trace never binds
onto a target whose other revisions are holed or tampered. The Governance Graph projection seam
(`listArtifactRevisions` behind `projection rebuild/query/status`) applies the same per-revision
verification to the whole store. Reads also walk the committed trace graph: a cyclic
Trace chain (refines/realizes/supersedes edges that loop, including through superseded revisions)
fails closed as `AMBER_E_ARTIFACT_TRACE_CYCLE` — structurally impossible through admission, so
always hand-edited state.

Version negotiation is fail-closed in both directions (ticket 06): an Envelope whose
`schemaVersion` — or `traceContractVersion`, on an Envelope carrying Traces — is not a version this
reader supports is rejected with `AMBER_E_ARTIFACT_UNSUPPORTED_VERSION`, never silently
reinterpreted, and a stored Envelope carrying a top-level field outside the closed core field set
(written by a newer writer or hand-edited) is rejected with `AMBER_E_ARTIFACT_UNKNOWN_FIELD`, never
silently dropped — extension data belongs under the reserved `extensions` carrier, never at the top
level. Both verdicts apply at admission (a newer-schema writer is refused before any durable
state) and on every read — `show`, `list`, and the projection rebuild/query — where they run
**before** the binding-hash checks, so a stale hash can never mask or masquerade as a negotiation
verdict.

Crashed admissions settle deterministically (ticket 04): when the settling verification reads
(`artifact show` and `artifact list`) or an admission encounter a `prepared` record that never
received a committed or aborted outcome — and no live admission holds the lock — one `aborted`
record is appended to the journal, settling the attempt. The Governance Graph's projection read
(`listArtifactRevisions`, behind `projection rebuild/query/status`) deliberately never settles: it
is read-only and non-authoritative, so a store on which only projections run keeps a dangling
`prepared` record — invisible either way, since it never projects. Recovery is journal-only: it
never writes or rewrites a Body or Envelope, the aborted revision stays invisible to reads, and
its consumed revision slot is never reused. Nothing is repaired automatically beyond that
settlement record — restoring tampered artifact state is a version-control operation, never a
silent write.

Two timestamps leave different traces by design. The Envelope's `committedAt` is **prepare
time** — stamped when the pair is written between the prepared and committed journal records, and
covered by the envelopeHash, so it is fingerprint-relevant: Governance Graph nodes and the
projection seam surface it. The journal's committed record `at` is **commit time** — the
settlement instant a moment later — and is what `artifact show` and admission receipts surface.
Editing the journal timestamp changes nothing the projection checkpoints, while editing the
Envelope's `committedAt` breaks the envelopeHash and fails every verification read.

Committed revisions and their typed Traces project into the Governance Graph — see
`projection rebuild --type governance-graph` below.

### principal register / show / list / revoke

The Principal registry (F050) roots the humans and service identities that can act with authority
in this repository. Every Decision artifact binds its acting Principal, verified against this
registry at admission time: registered, unrevoked, and inside its validity window.

The registry is governed state, not incidental metadata: an append-only event ledger under
`.amber/principals/registry.jsonl` (registered and revoked events, each chained to its predecessor
by a tamper-evident hash — an in-place edit breaks the chain and fails every read closed as
`AMBER_E_PRINCIPAL_REGISTRY_CORRUPT`), fail-closed on corruption and unsupported schema versions,
with a size ceiling (`AMBER_PRINCIPAL_MAX_REGISTRY_BYTES`, default 1 MiB) checked before any
durable state is touched. Writers serialize through `.amber/principals/registry.lock`: a concurrent
register/revoke fails with `AMBER_E_PRINCIPAL_REGISTRY_LOCK` instead of racing (a crash-stale lock
is reclaimed automatically after 30 s). A principal id is registered at most once and revocation is
terminal — a revoked id cannot be re-registered, and re-revocation fails as
`AMBER_E_PRINCIPAL_ALREADY_REVOKED`.

`register` binds identity (`--id`), kind (`--kind human|service`), and the optional qualifications
`--role`, `--membership`, `--capability`, `--scope`, `--issuer`, and the half-open validity window
`--valid-from`/`--valid-to` (ISO-8601; a date-time must carry an explicit zone — `Z` or offset —
because a zoneless time would be machine-local). `show`/`list` derive the current status
(`active | revoked | expired | not-yet-valid`) against the read clock; the stored record never
carries a derived status.

```bash
# register a human principal
node scripts/amber.js principal register --target . --id alice@example.com --kind human --role tech-lead --json

# register a service principal with a bounded validity window
node scripts/amber.js principal register --target . --id ci-bot --kind service --capability deploy --valid-to 2027-01-01 --json

# inspect one principal / list all with derived statuses
node scripts/amber.js principal show --target . --id alice@example.com --json
node scripts/amber.js principal list --target . --json

# revoke terminally (a revoked principal can no longer bind new Decisions)
node scripts/amber.js principal revoke --target . --id alice@example.com --reason "left the team" --json
```

### evidence record / verify / show / list

Evidence receipts and the fixed four-level Assurance contract (F050): `unavailable | observed |
replayable | verified`. A receipt records what actually ran — identity, producer (a
registry-verified Principal snapshot, verified at record time exactly like a Decision's acting
Principal), scope, subject, inputs, tools, environment, time, status (`pass|fail`), and outputs —
so a reviewer can assess the claim, not just consume it.

The ledger is governed state, not incidental output: an append-only event ledger under
`.amber/evidence/receipts.jsonl` (recorded and verified events, each chained to its predecessor by
a tamper-evident hash — an in-place edit breaks the chain and fails every read closed as
`AMBER_E_EVIDENCE_REGISTRY_CORRUPT`), fail-closed on corruption and unsupported schema versions,
with a size ceiling (`AMBER_E_EVIDENCE_MAX_REGISTRY_BYTES`, default 1 MiB) checked before any
durable state is touched and re-checked under the write lock on the exact chained event. Writers
serialize through `.amber/evidence/receipts.lock`: a concurrent record/verify fails with
`AMBER_E_EVIDENCE_REGISTRY_LOCK` instead of racing (a crash-stale lock is reclaimed automatically
after 30 s). An evidence id is recorded exactly once — a re-run is a new receipt with a distinct id.

A claim can never impersonate verification: `--assurance verified` is refused as
`AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN` (a Runner can never award itself proof); only `verify`,
run by an independent registered Principal whose id differs from the producer's, appends a
verification event and promotes the **effective** assurance to `verified` — the producer naming
itself as verifier fails closed as `AMBER_E_EVIDENCE_SELF_VERIFICATION`, and the same verifier
verifying twice fails as `AMBER_E_EVIDENCE_ALREADY_VERIFIED` (a verification is recorded exactly
once per verifier; a different independent principal may still add its own). A `replayable`
receipt must name the deterministic definition it replayed via `--replay-of` (an Eval id, a
command definition, a suite version); a bare replayable claim, or `--replay-of` on any other
level, fails as `AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT`. Effective assurance and the verifier list
are derived at read time (`show`/`list` report `assurance`, `recordedAssurance`, and `verifiedBy`)
— a later verification changes what a read returns without rewriting any event.

```bash
# record a replayable receipt with full provenance
node scripts/amber.js evidence record --target . --id evidence/run-42 --producer ci-runner \
  --assurance replayable --replay-of eval.instruction-surface --subject eval.instruction-surface \
  --status pass --input "npm test" --tool node --env os=linux --outputs "all evals pass" --json

# an independent principal promotes effective assurance to verified
node scripts/amber.js evidence verify --target . --id evidence/run-42 --verifier reviewer-alice --json

# read the derived record / every receipt in first-recorded order
node scripts/amber.js evidence show --target . --id evidence/run-42 --json
node scripts/amber.js evidence list --target . --json
```

`--env` entries are `key=value` (one flag per entry; a duplicated key or a missing `=` fails as
`AMBER_E_INVALID_ARG`); the accumulators `--input`, `--tool`, and `--outputs` may repeat.

### approval grant / revoke / consume / show / list

Approval records (F050): the human authorizations a Decision settles under — scoped, expiring,
revocable, and single-use. A `grant` binds the acting human (a registry-verified Principal snapshot
frozen at grant time — an Approval is a human-only authorization slot, so a service principal is
refused as `AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED`), the confinement scope, the subject that may be
decided, and the half-open validity window `[validAt, validUntil)`; `validUntil` is an ISO-8601 date
or zoned date-time, and the window is evaluated with no clock-skew tolerance (the recorded time is
authoritative — at exactly `validUntil` the authorization is already expired).

The registry is an append-only event ledger under `.amber/approvals/registry.jsonl` (granted,
revoked, and consumed events; no in-place mutation path) protected by a tamper-evident hash chain —
an in-place edit breaks the chain and fails every read closed as
`AMBER_E_APPROVAL_REGISTRY_CORRUPT` — with a size ceiling
(`AMBER_APPROVAL_MAX_REGISTRY_BYTES`, default 1 MiB) and a short-lived write lock (a second writer
in flight fails closed as `AMBER_E_APPROVAL_REGISTRY_LOCK`; a lock older than 30 s is reclaimed as
a crashed holder's leftover). An approval id is granted exactly once; a duplicate grant fails as
`AMBER_E_APPROVAL_ALREADY_GRANTED`.

Consumption is atomic with the authorized Decision's settlement: `consume` takes the approvals
lock, re-verifies every lifecycle invariant under it (granted, not revoked, not consumed, inside
the window at the evaluation clock), admits the Decision artifact (`decisionKind "approval"`,
principal = the approval's frozen approver; the caller passes no `--principal`), and only then
appends the single-use `consumed` event binding the Decision's identity and revision from the
admission receipt. A failed admission leaves the authorization unconsumed; one authorization can
never be replayed — a second consumer fails closed with `AMBER_E_APPROVAL_ALREADY_CONSUMED`.
Revocation is terminal too: a revoked approval cannot be consumed (`AMBER_E_APPROVAL_REVOKED`),
and a consumed one cannot be revoked afterwards. The effective status
(`granted | revoked | consumed | expired`) is derived at read time against the reader's clock —
"expired" is a verdict about the present, never a frozen fact. When the approval carries a scope,
the Decision is admitted with that same scope (a conflicting `--scope` is an argument error).

```bash
# grant a scoped, expiring authorization (approver must be a registered human)
node scripts/amber.js approval grant --target . --id approval/login-42 \
  --approver alice@example.com --subject spec/login@2 --valid-until 2027-08-01 --scope F050 --json

# revoke it (revoker must also be a registered human)
node scripts/amber.js approval revoke --target . --id approval/login-42 \
  --revoker bob@example.com --json

# settle the authorized Decision atomically with the consumption
node scripts/amber.js approval consume --target . --id approval/login-42 \
  --decision-identity decision/login-approved --body "# Decision: login intent approved" \
  --trace decides:intent:intent/login@1 --json

# read the derived record / every approval in grant order
node scripts/amber.js approval show --target . --id approval/login-42 --json
node scripts/amber.js approval list --target . --json
```

The `--trace decides:<type>:<identity>[@<revision>]` grammar is the artifact surface's (one parser,
shared). Every event records its clock source (`injected` when the caller injected a clock,
`system` otherwise) and the fixed skew policy `no-tolerance`. Two boundary notes: the `consumed`
event's `at` is the caller's evaluation clock while the settled Decision's own `committedAt`
reflects the artifact store's write clock — they are recorded independently and may diverge under
an injected clock; and the approver is re-verified against the Principal registry at consumption,
so an approver whose registration is later revoked or expired leaves the authorization
un-consumable (fail-closed) — though it can still be revoked by another registered human, since
revocation verifies the revoker, not the approver.

### gate evaluate / show / list

Gate Contracts and deterministic evaluation (F050): admission through a Gate is decided by a
reviewable contract — never by hidden weights or model confidence. A Gate Contract is a canonical
artifact of the registered `gate` type, admitted through the existing artifact surface (lifecycle
`draft -> active` via `--transition activate`, `active -> retired` via `--transition retire`); its
machine-actionable content rides the Envelope's `extensions` carrier under the `gate` namespace.
The evaluator is that content's first shape consumer — the artifact surface carries extensions
opaquely by design, so a malformed contract is an evaluation-time verdict, not an admission error.

Contract keys: `gate.require` (required — a non-empty array of requirement objects
`{ evidenceType, subject?, assurance?, threshold?, maxAgeMs? }`), `gate.anyOf` (bounded explicit
alternatives: at most 8 sets of at most 8 entries; at least one set must be fully satisfied when
declared), `gate.owners`, `gate.expires`, `gate.dependsOn`, `gate.maxEvidenceAgeMs`, and
`gate.failBehavior` (v1 is deny-only: `"deny"`; anything else is refused). A requirement is
satisfied only by an Evidence receipt that joins on the receipt's `subject` (the requirement's
`evidenceType`, scoped to the evaluation subject or the requirement's own subject override), has
status `pass`, carries effective Assurance at or above the required level
(`unavailable < observed < replayable < verified`), is fresh at the evaluation clock
(`age <= maxAgeMs` — the requirement's `maxAgeMs`, else the gate's `maxEvidenceAgeMs`; no bound
means always fresh; a stale receipt is listed in the outcome, never hidden), and — when a
`threshold` `{ value, comparator }` is declared — whose LAST output parses and compares true
(numeric `eq/ne/lt/le/gt/ge` over a strict base-10 decimal string; string `eq/ne/contains`
exact; version ordering `lt/le/gt/ge` dot-numerically, where `"1.2" < "1.10"` and missing
segments pad to zero; `eq/ne` on string values are exact, so `"1.2"` is not equal to
`"1.2.0"`). An expired gate
refuses to run: `AMBER_E_GATE_EXPIRED`, no outcome appended.

Every completed evaluation appends one immutable `evaluated` event to the hash-chained outcome
ledger under `.amber/gates/outcomes.jsonl` — a pass is never silently revised, and a FAIL verdict
is a completed evaluation, not a command error (exit code 0; the record is the audit trail). An
in-place edit breaks the chain and fails every read closed as
`AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT`. The ledger serializes through `.amber/gates/outcomes.lock`
(`AMBER_E_GATE_OUTCOME_REGISTRY_LOCK`; a lock older than 30 s is reclaimed as stale) with a size
ceiling (`AMBER_GATE_MAX_OUTCOME_BYTES`, default 1 MiB) checked before the append. Every outcome
records its clock source (`injected` with `--now`, `system` otherwise) and the fixed skew policy
`no-tolerance`.

The legacy plan gate keeps its surface under the same command name: a bare
`amber gate --plan <path> [--confirm]` (no `evaluate`/`show`/`list` action) routes to the plan
gate-check unchanged.

```bash
# admit a Gate Contract through the artifact surface (contract keys ride --extension flags)
node scripts/amber.js artifact admit --type gate --id gate/login-gate \
  --body "# Gate: login readiness" \
  --extension gate.require='[{"evidenceType":"spec/login@2","assurance":"observed","threshold":{"value":80,"comparator":"ge"}}]' \
  --extension gate.owners='["alice@example.com"]' --target . --json

# evaluate deterministically (appends one immutable outcome; a fail verdict is still exit 0)
node scripts/amber.js gate evaluate --target . --gate gate/login-gate --subject spec/login@2 --json
node scripts/amber.js gate evaluate --target . --gate gate/login-gate --subject spec/login@2 \
  --revision 1 --now 2027-06-01T09:00:00Z --json

# read outcomes: by 0-based ledger line, or the latest matching a gate (optionally narrowed by subject)
node scripts/amber.js gate show --target . --index 0 --json
node scripts/amber.js gate show --target . --gate gate/login-gate --subject spec/login@2 --json
node scripts/amber.js gate list --target . [--gate <id>] [--subject <s>] [--verdict pass|fail] --json
```

Error codes: `AMBER_E_GATE_NOT_FOUND`, `AMBER_E_GATE_CONTRACT_INVALID`,
`AMBER_E_GATE_EXPIRED`, `AMBER_E_GATE_UNSUPPORTED_COMPARATOR`,
`AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED`, `AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT`,
`AMBER_E_GATE_OUTCOME_SIZE_CEILING`, `AMBER_E_GATE_OUTCOME_REGISTRY_LOCK`.

### policy evaluate / show / list

Policy Contracts and deny-wins strict consumption (F050): organization and tenant Policy are the
non-relaxable ceiling, and optional repository, Play, and Gate policies may only tighten that
ceiling. A Policy Contract is a canonical artifact of type `policy` (lifecycle `draft -> active` via
`--transition activate`, `active -> retired` via `--transition retire`) whose machine-actionable
content rides under `extensions.policy`. The policy evaluator is the first shape consumer; invalid,
stale, unsupported, missing, or conflicting policy refuses before any outcome is appended.

Contract keys: `policyVersion` (v1), `layer` (`org|tenant|repo|play|gate`), optional
`validUntil`, optional `maxPolicyAgeMs`, `rules`, and `delegations`. Rules are deny-only:
`denyPrincipals`, `denyCapabilities`, `denyScopes`, and `requireSeparationOfDuties: true`. Lower
layers cannot relax the ceiling; unsupported allow/relax keys and
`requireSeparationOfDuties: false` fail closed. Delegations are direct only, may be declared only by
org/tenant policies, and must match the named delegator, delegate, exact capability, exact
subject/scope, and half-open validity window. The delegator principal itself must carry that same
capability and scope; chains are never followed.

A completed evaluation appends one immutable `evaluated` event to
`.amber/policies/outcomes.jsonl`, binding the active policy revisions and policy content hashes, the
consumed Approval, the passing Gate Outcome hash, subject, submitter, capability, delegation (if
any), verdict (`pass|deny`), and reasons. Missing/stale/unsupported/conflicting policy refuses with
no append. A policy denial (deny rule, non-consumed Approval, non-passing Gate, separation-of-duties
violation, or missing delegation) appends a deny outcome and exits non-zero with the specific code.

```bash
# admit and activate policy contracts through the artifact surface
node scripts/amber.js artifact admit --target . --type policy --id policy/org \
  --body "# Org policy" --extension policy.policyVersion=1 --extension policy.layer=org --json
node scripts/amber.js artifact admit --target . --type policy --id policy/org \
  --body "# Org policy" --extension policy.policyVersion=1 --extension policy.layer=org \
  --expected-head 1 --transition activate --json

# evaluate strict consumption against org/tenant plus optional tighter layers
node scripts/amber.js policy evaluate --target . \
  --org-policy policy/org --tenant-policy policy/tenant --repo-policy policy/repo \
  --subject spec/login@2 --submitter dev@example.com --capability release \
  --approval approval/login-42 --gate-outcome-index 0 --json

node scripts/amber.js policy show --target . --index 0 --json
node scripts/amber.js policy list --target . [--subject <s>] [--submitter <id>] \
  [--capability <capability>] [--verdict pass|deny] --json
```

Error codes: `AMBER_E_POLICY_MISSING`, `AMBER_E_POLICY_INVALID`,
`AMBER_E_POLICY_UNSUPPORTED_VERSION`, `AMBER_E_POLICY_STALE`, `AMBER_E_POLICY_CONFLICT`,
`AMBER_E_POLICY_DENIED`, `AMBER_E_POLICY_SEPARATION_OF_DUTIES`,
`AMBER_E_POLICY_DELEGATION_REQUIRED`, `AMBER_E_POLICY_OUTCOME_NOT_FOUND`,
`AMBER_E_POLICY_OUTCOME_REGISTRY_CORRUPT`, `AMBER_E_POLICY_OUTCOME_SIZE_CEILING`,
`AMBER_E_POLICY_OUTCOME_REGISTRY_LOCK`.

### projection rebuild / status / query (Governance Graph of artifact revisions)

The Governance Graph is the only graph projection (ADR-0021) and is never a write authority: the
artifact store remains the sole writer, and the graph is a rebuildable read-only projection of
committed state. `projection rebuild --type governance-graph` derives the graph from canonical
context pages **and** every committed Canonical Artifact revision: one node per fully committed
Intent/Spec/Plan revision and one typed edge per resolved Trace (`refines`, `realizes`,
`supersedes`), so the Intent → Spec → Plan planning lineage is queryable directly.

- Artifact-layer node ids are `<type>/<identity>@<revision>` (e.g. `spec/spec/login-spec@2`). A node
  carries only read-only references — artifact type, identity, revision, lifecycle, scope, binding
  hashes, and provenance; a lifecycle change is always a new committed revision (a new node), never
  an in-place status edit.
- Rebuild is deterministic: identical committed state produces the identical result hash. The
  receipt (the manifest under `.amber/projections/governance-graph.json`) records the source
  checkpoint (`rebuild_checkpoint`/`sourceHash` — a digest of the pages plus the committed revision
  references with their Envelope hashes), the projection rule and Trace contract versions
  (`projection_rule_versions`; the artifact-layer rules are at version 2, whose node `committedAt`
  now derives from the hash-covered Envelope field), the schema version, the result hash
  (`outputHash`), and the Amber protocol version.
- `projection status --type governance-graph` certifies currency against the same checkpoint:
  committing a new artifact revision drifts the projection until it is rebuilt.
- `projection query` keeps the existing bounded-read contract: an exact scope resolves one node
  (page id or artifact revision id) plus its edge neighborhood, an unknown scope is denied as
  `AMBER_E_GRAPH_DENY`, and unscoped reads are capped (`--limit`, default 50) with a `truncated`
  flag. Every query records an immutable read receipt.
- `projection strict-query` is the strict Gate-safe read contract: it requires exact `--scope`,
  `--checkpoint <sha256>`, `--projection-version 1`, bounded `--limit`, `--sort id`, `--depth 0|1`,
  and, for partial pages, the unedited expiring `--cursor` returned by the previous page. A
  checkpoint mismatch, expired/edited cursor, unknown scope, or scoped staleness receipt fails
  closed; truncated pages are explicit (`gateSatisfiable:false`) and cannot satisfy strict Gates.
- `projection invalidate --subject <scope> --dependency <type:identity[@revision]> --reason <text>`
  appends a staleness receipt under `.amber/staleness/receipts.jsonl`. History is never rewritten;
  strict queries fail only for affected subjects, so dependency-scoped invalidation does not poison
  unrelated bindings.
- Only fully committed revisions are projected; prepared and aborted revisions are invisible. A
  corrupt artifact store fails the rebuild and the query closed with the typed artifact corruption
  code (e.g. `AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH`) — or, when a stored Envelope declares an
  unsupported version, carries an unknown top-level field, or violates the extension namespace
  contract, with the negotiation verdict `AMBER_E_ARTIFACT_UNSUPPORTED_VERSION` /
  `AMBER_E_ARTIFACT_UNKNOWN_FIELD` / `AMBER_E_ARTIFACT_EXTENSION_COLLISION` — never a partial
  projection — and the projection itself never writes or repairs Canonical Artifacts.
- Resource ceilings bound the build (ticket 06): a rebuild — or a query, which builds the graph
  first — that would exceed 20,000 nodes / 200,000 edges (defaults) fails closed as
  `AMBER_E_PROJECTION_RESOURCE_CEILING` instead of emitting a truncated graph as if it were
  complete, and a refused rebuild writes nothing. Raise the bounds deliberately for a bigger store
  via `AMBER_PROJECTION_MAX_NODES` / `AMBER_PROJECTION_MAX_EDGES` (positive integers; a
  set-but-garbage override fails closed as `AMBER_E_INVALID_ARG`, never a silent default).

```bash
# project the committed planning lineage and inspect the rebuild receipt
node scripts/amber.js projection rebuild --type governance-graph --target . --json

# query one revision plus its refines/realizes neighborhood (bounded, receipted)
node scripts/amber.js projection query --scope spec/spec/login-spec@2 --target . --json

# strict Gate-safe query at an exact checkpoint; truncated pages return an expiring cursor
node scripts/amber.js projection strict-query --scope spec/spec/login-spec@2 \
  --checkpoint sha256:<current-source-checkpoint> --projection-version 1 \
  --limit 50 --sort id --depth 1 --target . --json

# append dependency-scoped staleness without rewriting historical outcomes
node scripts/amber.js projection invalidate --subject spec/spec/login-spec@2 \
  --dependency evidence:evidence/run-42 --reason "evidence hash changed" --target . --json

# currency: drifts when a new artifact revision is committed, current again after rebuild
node scripts/amber.js projection status --type governance-graph --target . --json
```

### adapter register / read / candidate / compare / comparisons / cutover / rollback / cutovers / show / list / receipts

Read-only Adapters (F051) let Amber inspect legacy or external records before Cutover without
mutating either the source or Canonical Artifacts. An Adapter registration declares source owner,
supported record type/version, exact scope, identity mapping, freshness, and read-only permissions.
`adapter read` reads one source file under the target root and appends an immutable read receipt
under `.amber/adapters/read-receipts.jsonl` with adapter id/version, record id/type/version, scope,
source path, exact source bytes (base64), source byte length, raw-byte digest, expected source hash
when supplied, status (`fresh|stale|unavailable|conflict|unmapped`), state reason, timestamp, and
provenance. Missing sources append an `unavailable` receipt; old sources append a `stale` receipt and
return `AMBER_E_ADAPTER_STALE`; changed expected hashes append a `conflict` receipt and return
`AMBER_E_ADAPTER_CONFLICT`. The external source remains authoritative until a later explicit Cutover
Decision.

The Adapter registry, read-receipt ledger, and shadow-comparison ledger are hash-chained and fail
closed on in-place edits. `adapter read` never calls Canonical Artifact admission; receipts are
governance observations only. `adapter candidate` reads the same source, extracts a deterministic
migration candidate, and returns a normal Canonical Artifact admission payload for a separate
`artifact admit` call. The source JSON is either one record object or `{ "records": [ ... ] }`; each
record may use `id` or `recordId`, optional `scope` (or `tenant` when identical), and either an
`artifact` object or equivalent flat `artifactType`, `artifactIdentity`, `artifactScope`, `body`,
`traces`, `extensions`, `transition`, `idempotencyKey`, `expectedHead`, and `supersedes` fields.
Unknown fields and unknown shapes append `unmapped` receipts; duplicate identities, contradictory
aliases, cross-scope records, and contradictory records append `conflict` receipts.

`adapter compare` takes a bounded JSON fixture with `fixtureId`, `expectedTotal`, optional `scope`, and
`items`. Each item declares `recordId`, `source`, optional `recordType`/`recordVersion`/
`expectedSourceHash`, an optional canonical `target` (`type`, `identity`, and explicit `revision`),
and a required `disposition` when no target is declared. A comparison receipt records source and
target set hashes, coverage counts (`mapped|unmapped|stale|conflict|unavailable`), per-item
source/target hashes, and a deterministic `comparisonHash`. `adapter comparisons` lists the immutable
receipts.

`adapter cutover` records the explicit Cutover Decision that transfers canonical ownership for one
adapter, artifact type, scope, and generation. It binds a resolved shadow comparison (no stale,
conflict, or unavailable coverage, and mapping at least one target of the claimed artifact type), a
committed human `acceptance`/`approval` Decision artifact
(`--decision-identity` + `--revision`, scoped to the cutover's scope), independent source-owner
confirmation (`--confirmed-by` must be the adapter's declared owner, must resolve as an active
registered human Principal, and must differ from the deciding principal), and named rollback
evidence (`--rollback-evidence` and rollback `--evidence` must name recorded F050 Evidence
receipts). One active cutover per adapter/type/scope/generation; the hash-chained ledger under
`.amber/adapters/cutovers.jsonl` is append-only. After cutover, an `adapter read` or `adapter
candidate` that observes source bytes diverging from the bound comparison hash — or a readable
legacy source the bound evidence never covered — appends an immutable divergence Finding, returns
`AMBER_E_ADAPTER_CUTOVER_DIVERGED`, and degrades every contradicted cutover (`cut → degraded`) —
divergence never restores legacy authority or auto-syncs canonical state.
`adapter rollback` is a new governed Decision (it cannot reuse the cutover's Decision) with its own
confirmation and evidence; history stays immutable and `adapter cutovers` lists every record with
derived status (`cut|degraded|rolled-back`).

```bash
node scripts/amber.js adapter register --target . --id adapter/legacy \
  --adapter-owner legacy-team --record-type legacy-ticket --record-version v1 \
  --scope F051 --identity-map path --freshness-ms 86400000 --allow-path legacy --json

node scripts/amber.js adapter read --target . --id adapter/legacy \
  --source legacy/item.json --record-id legacy-1 --record-version v1 \
  --expected-source-hash sha256:<64-hex-chars> --json
node scripts/amber.js adapter candidate --target . --id adapter/legacy \
  --source legacy/item.json --record-id legacy-1 --record-version v1 --json
node scripts/amber.js adapter compare --target . --id adapter/legacy \
  --fixture fixtures/adapter-shadow.json --json
node scripts/amber.js adapter comparisons --target . --id adapter/legacy --json
node scripts/amber.js adapter cutover --target . --id adapter/legacy \
  --cutover-id cutover/legacy-gen-1 --artifact-type intent --generation gen-1 \
  --comparison-index 0 --decision-identity decision/cutover-legacy --revision 1 \
  --confirmed-by legacy-team --rollback-evidence evidence/rollback-plan --json
node scripts/amber.js adapter rollback --target . --cutover-id cutover/legacy-gen-1 \
  --decision-identity decision/rollback-legacy --revision 1 \
  --confirmed-by legacy-team --evidence evidence/rollback-run --json
node scripts/amber.js adapter cutovers --target . --id adapter/legacy --json
node scripts/amber.js adapter show --target . --id adapter/legacy --json
node scripts/amber.js adapter list --target . --json
node scripts/amber.js adapter receipts --target . --id adapter/legacy --json
```

Error codes: `AMBER_E_ADAPTER_INVALID`, `AMBER_E_ADAPTER_NOT_FOUND`,
`AMBER_E_ADAPTER_READ_FORBIDDEN`, `AMBER_E_ADAPTER_SOURCE_MISSING`, `AMBER_E_ADAPTER_STALE`,
`AMBER_E_ADAPTER_CONFLICT`, `AMBER_E_ADAPTER_UNMAPPED`, `AMBER_E_ADAPTER_REGISTRY_CORRUPT`,
`AMBER_E_ADAPTER_REGISTRY_LOCK`, `AMBER_E_ADAPTER_SIZE_CEILING`,
`AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT`, `AMBER_E_ADAPTER_READ_RECEIPT_LOCK`,
`AMBER_E_ADAPTER_READ_RECEIPT_SIZE_CEILING`, `AMBER_E_ADAPTER_COMPARISON_INVALID`,
`AMBER_E_ADAPTER_COMPARISON_COVERAGE_MISSING`, `AMBER_E_ADAPTER_COMPARISON_CORRUPT`,
`AMBER_E_ADAPTER_COMPARISON_LOCK`, `AMBER_E_ADAPTER_COMPARISON_SIZE_CEILING`,
`AMBER_E_ADAPTER_CUTOVER_INVALID`, `AMBER_E_ADAPTER_CUTOVER_EXISTS`,
`AMBER_E_ADAPTER_CUTOVER_NOT_FOUND`, `AMBER_E_ADAPTER_CUTOVER_OWNER_SEPARATION`,
`AMBER_E_ADAPTER_CUTOVER_DIVERGED`, `AMBER_E_ADAPTER_CUTOVER_ROLLED_BACK`,
`AMBER_E_ADAPTER_CUTOVER_CORRUPT`, `AMBER_E_ADAPTER_CUTOVER_LOCK`,
`AMBER_E_ADAPTER_CUTOVER_SIZE_CEILING`.

### runner register / capability / request / authorize / requests / prepare / settle / abort / rolled-back / executions / show / list

Register controlled Runners and their closed operation capabilities (F052). A Runner is an
EXTERNAL executor identity — id, version, integrity digest, and owner — and Amber never spawns
anything (ADR-0022): the registry defines who may execute and what, not an execution path. Each
capability is a closed record (registered name, versioned contract, declared effects from the
closed vocabulary `read|prepare|diagnose|write-target|deploy|rollback`, optional path-prefix scope
shape, timeout bound, credential requirement `none|scoped`, rollback declaration) — there is no
command field anywhere, so callers can never smuggle shell text through the registry.

Registration is a human-approved governance mutation: every event binds a committed, unscoped
human `acceptance`/`approval` Decision (`--decision-identity` + `--revision`, principal verified
against the Principal registry), and a registration Decision is single-use across the ledger.
Events append to the hash-chained ledger under `.amber/runner/registry.jsonl`; a runner id/version
pair registers at most once, and each capability binds one registered runner version
(runnerId/runnerVersion/name/capabilityVersion registers at most once), so every registered Runner
version declares its own closed capability set. Reads
fail closed on tamper, and runner resolution distinguishes unknown id, version drift, and
integrity-digest mismatch — an unverified executor holds no execution identity.

```bash
node scripts/amber.js runner register --target . --id runner/ci \
  --runner-version 1.0.0 --integrity sha256:<64-hex-chars> \
  --runner-owner platform-team --decision-identity decision/runner-ci --revision 1 --json
node scripts/amber.js runner capability --target . --id runner/ci \
  --runner-version 1.0.0 --capability deploy.staging-web --capability-version 1 \
  --effect deploy --path-prefix deploy/staging --timeout-ms 600000 --credential scoped \
  --rollback runbook/staging-rollback --decision-identity decision/cap-deploy --revision 1 --json
node scripts/amber.js runner show --target . --id runner/ci --json
node scripts/amber.js runner list --target . --json
```

`runner request` declares one intended execution of one registered capability (F052 T2) into the
hash-chained ledger `.amber/runner/requests.jsonl`. The closed request binds the capability pin
(runnerId/runnerVersion/name/capabilityVersion), exact target repository and paths, scope,
environment (`development|staging|production`), input hashes, timeout, expected effects,
credential requirement, and rollback declaration into a canonical `requestHash`. Risk classifies
the registered capability's FULL declared effect set through the versioned pinned risk policy —
the request contract carries no risk field and requesting a subset of effects never lowers the
class, so a caller can never classify its own operation. A shape-valid request that names an
unregistered runner/version/capability, or tries to widen the registered capability (undeclared
effect, timeout above the bound, different credential class, path outside the declared prefixes),
is recorded as an immutable `denied` event — no attempt disappears.

Versioned environment profiles gate what each environment may even be asked (the profile version
is bound into the `requestHash`, so a changed profile makes stale approvals unusable):
development requires an isolated non-null scope and admits no deploy/rollback; staging admits
allowlisted deploy/rollback capabilities only with rollback rehearsal Evidence
(`--rehearsal <evidence-id>`, resolved against the F050 Evidence ledger); production grants no
generic target-write — preparation, diagnosis, and `runbook.*`-registered capabilities only.
When the registered capability requires a scoped credential, the request declares an OPAQUE
short-lived handle (`--credential-handle`, `--credential-purpose`, `--credential-scope`,
`--credential-expires`) — the closed field set means no secret value can ride in a ledger or
receipt; a handle may live at most 24 hours, and an over-long or expired handle refuses at
submission and again at authorization. A staging deploy/rollback capability registered without a
scoped credential requirement is not admissible in staging at all.

`runner authorize` consumes a single-use F050 Approval whose subject is
exactly the request's `approvalBinding` (`runner-request:<environment>:<requestHash>`), settling
the human Decision atomically; replay, an already-authorized request, and drift (a stale risk
policy or environment profile version, an unresolvable capability or rehearsal, an expired
credential handle) fail closed, and the rehearsing party can never approve its own rehearsal
(`AMBER_E_RUNNER_REQUEST_SEPARATION`). `runner requests` lists every attempt
(`requested|authorized|denied`) in append order.

Execution settles durably in the hash-chained journal `.amber/runner/executions.jsonl` — Amber
never spawns anything (ADR-0022); the registered EXTERNAL Runner executes and submits one result
receipt. `runner prepare` binds one registered executor to one authorized request: the presented
runner must BE the runner the request named (id + version), must still resolve against the
registry (unknown identity, version drift, integrity mismatch fail closed), and one request hash
settles at most one execution — a concurrent prepare refuses. `runner settle` takes the runner's
result receipt (a bounded JSON file: executor pin, exit code/signal/timeout, timings, outputs
digest, touched scope, sandbox + credential assurance claims) and AMBER derives the outcome —
timeout, signal, non-zero exit, and any repository/path outside the authorized target all record
their explicit non-committed outcome and return its stable code, so execution never reports fake
success and no attempt disappears. Sandbox assurance and credential assurance are runner-claimed
fields from the F050 recordable vocabulary (`verified` is never recordable at settlement), while
`resultIntegrity: receipt-bound` binds a canonical hash of the exact receipt into the journal —
three separate fields, three independent Gate inputs (the `executionGateInputs`
read seam projects them per settlement; Gate-contract wiring rides the F053 release surface).
The authorized timeout bound is enforced at settlement — a receipt running past
`timeoutMs` settles `timed-out` even when the runner claims otherwise. `runner abort` terminally records an
execution that will never produce a receipt (outcome stays `attempted`), and `runner rolled-back`
records that a committed execution was reverted, binding the rollback-run Evidence — history never
rewrites. `runner executions` lists settlements by outcome
(`attempted|timed-out|failed|committed|rolled-back`).

```bash
node scripts/amber.js runner request --target . --id runner/ci \
  --runner-version 1.0.0 --capability deploy.staging-web --capability-version 1 \
  --repository repo/main --path deploy/staging/web --environment staging \
  --input-hash sha256:<64-hex-chars> --timeout-ms 300000 --effect deploy \
  --credential scoped --credential-handle cred-7f3a --credential-purpose staging-deploy \
  --credential-scope deploy/staging --credential-expires 2027-01-01T00:00:00.000Z \
  --rehearsal evidence/rehearsal-1 --rollback runbook/staging-rollback --json
node scripts/amber.js approval grant --target . --id approval/deploy-42 \
  --approver bob@example.com --subject "runner-request:staging:sha256:<64-hex-chars>" \
  --valid-until 2027-01-01T00:00:00.000Z --json
node scripts/amber.js runner authorize --target . --request-hash sha256:<64-hex-chars> \
  --approval approval/deploy-42 --decision-identity decision/deploy-42 \
  --body "# Authorize staging deploy" --trace decides:intent:intent/deploy --json
node scripts/amber.js runner requests --target . --environment staging --json
node scripts/amber.js runner prepare --target . --request-hash sha256:<64-hex-chars> \
  --id runner/ci --runner-version 1.0.0 --integrity sha256:<64-hex-chars> --json
node scripts/amber.js runner settle --target . --request-hash sha256:<64-hex-chars> \
  --receipt receipts/deploy-42.json --json
node scripts/amber.js runner abort --target . --request-hash sha256:<64-hex-chars> \
  --reason "runner lost; no result receipt" --json
node scripts/amber.js runner rolled-back --target . --request-hash sha256:<64-hex-chars> \
  --evidence evidence/rollback-run --reason "staging deploy reverted" --json
node scripts/amber.js runner executions --target . --status committed --json
```

Error codes: `AMBER_E_RUNNER_INVALID`, `AMBER_E_RUNNER_EXISTS`, `AMBER_E_RUNNER_NOT_FOUND`,
`AMBER_E_RUNNER_VERSION_DRIFT`, `AMBER_E_RUNNER_INTEGRITY_MISMATCH`,
`AMBER_E_RUNNER_CAPABILITY_EXISTS`, `AMBER_E_RUNNER_CAPABILITY_NOT_FOUND`,
`AMBER_E_RUNNER_REGISTRY_CORRUPT`, `AMBER_E_RUNNER_REGISTRY_LOCK`,
`AMBER_E_RUNNER_REGISTRY_SIZE_CEILING`, `AMBER_E_RUNNER_REQUEST_INVALID`,
`AMBER_E_RUNNER_REQUEST_EXISTS`, `AMBER_E_RUNNER_REQUEST_NOT_FOUND`,
`AMBER_E_RUNNER_REQUEST_DENIED`, `AMBER_E_RUNNER_REQUEST_DRIFT`,
`AMBER_E_RUNNER_REQUEST_APPROVAL_MISMATCH`, `AMBER_E_RUNNER_REQUEST_SEPARATION`,
`AMBER_E_RUNNER_REQUEST_CORRUPT`, `AMBER_E_RUNNER_REQUEST_LOCK`,
`AMBER_E_RUNNER_REQUEST_SIZE_CEILING`, `AMBER_E_RUNNER_EXECUTION_INVALID`,
`AMBER_E_RUNNER_EXECUTION_EXISTS`, `AMBER_E_RUNNER_EXECUTION_NOT_FOUND`,
`AMBER_E_RUNNER_EXECUTION_STATE`, `AMBER_E_RUNNER_EXECUTION_TIMEOUT`,
`AMBER_E_RUNNER_EXECUTION_FAILED`, `AMBER_E_RUNNER_EXECUTION_SCOPE`,
`AMBER_E_RUNNER_EXECUTION_CORRUPT`, `AMBER_E_RUNNER_EXECUTION_LOCK`,
`AMBER_E_RUNNER_EXECUTION_SIZE_CEILING`.

### release prepare / authorize / deploy / rollback / transactions / status / receipts / show / list

Prepare governed release candidates (F053 T1). A candidate immutably binds one exact Change — a
40-hex commit sha plus committed Canonical Artifact revisions — together with recorded F050
Evidence, per-axis Review findings (`logic`, `security`, `specCompliance`: each a recorded
Evidence receipt reference, structurally never an approval — AI review supplements code ownership,
it never replaces it), the target environment, a versioned release Policy artifact revision, one
registered F052 Runner capability pin, the credentials class, and a rollback plan Evidence
reference. Every reference must resolve fail-closed before it becomes releasable material, the
closed content hashes into a canonical `releaseHash` (so any drift invalidates downstream
authorization instead of silently retargeting it), and one releaseId prepares at most once into
the hash-chained ledger `.amber/release/candidates.jsonl`. Preparation is a governance write: it
never deploys and touches no git state.

```bash
node scripts/amber.js release prepare --target . --id release/web-42 \
  --commit <40-hex-sha> --change-artifact spec:spec/login@2 \
  --evidence-item evidence/test-run --review-logic evidence/review-logic \
  --review-security evidence/review-security --review-spec evidence/review-spec \
  --environment staging --release-policy policy/release@1 \
  --runner runner/ci --runner-version 1.0.0 --capability deploy.staging-web \
  --capability-version 1 --credential scoped --rollback evidence/rollback-plan --json
node scripts/amber.js release show --target . --id release/web-42 --json
node scripts/amber.js release list --target . --environment staging --json
```

`release authorize` is per-environment, separate from execution, and always human (F053 T2), into
the hash-chained ledger `.amber/release/authorizations.jsonl` (one authorization per release).
Stale authority never authorizes: the candidate must re-derive to its recorded `releaseHash`, its
capability must still resolve, and a newer committed revision of the pinned release Policy
invalidates the candidate (`AMBER_E_RELEASE_DRIFT`). Staging consumes one named single-use F050
Approval whose subject is exactly `release:staging:<releaseHash>` (settling the human Decision
atomically) plus a rollback rehearsal Evidence receipt whose producer is not the approver.
Production binds branch-protection Evidence, TWO distinct committed human Decisions (code owner
and release manager — neither may have produced any Evidence the release binds: the submitting
side never satisfies a required approval), passing release and environment Gate outcomes from the
F050 gate ledger, a `runbook.*` capability pin, and the scoped credentials class; the two
Decisions are single-use across the authorization ledger.

```bash
node scripts/amber.js release authorize --target . --id release/web-42 \
  --approval approval/rel-1 --decision-identity decision/rel-1 \
  --body "# Authorize staging release" --trace decides:intent:intent/release \
  --rehearsal evidence/rehearsal-run --json
node scripts/amber.js release authorize --target . --id release/prod-7 \
  --branch-protection evidence/branch-protection --code-owner decision/code-owner@1 \
  --release-manager decision/release-manager@1 --release-gate-index 0 \
  --environment-gate-index 1 --json
```

`release deploy` and `release rollback` are separate target-write transactions executed ONLY
through the F052 controlled-runner surface (F053 T3), recorded in the hash-chained ledger
`.amber/release/transactions.jsonl`. A transaction binds one AUTHORIZED release (drift re-checked)
to one AUTHORIZED F052 request whose pins must equal the candidate's — same capability quadruple,
same environment, same credentials class (`AMBER_E_RELEASE_TX_MISMATCH`). One deploy per release,
one transaction per request (a concurrent second use refuses); rollback follows deployment on the
SAME releaseHash and must ride its own request, never the deployment's. The transaction's outcome
is a read-time projection of the F052 settlement journal (`pending` until settled, then
`attempted|timed-out|failed|committed|rolled-back`) — a failed or partial deployment reads as
exactly that, never as success. Transaction records carry only ids and hashes: no credential value
and no git surface can ride in them.

```bash
node scripts/amber.js release deploy --target . --id release/web-42 \
  --request-hash sha256:<64-hex-chars> --json
node scripts/amber.js release rollback --target . --id release/web-42 \
  --request-hash sha256:<64-hex-chars> --json
node scripts/amber.js release transactions --target . --id release/web-42 --json
node scripts/amber.js release status --target . --id release/web-42 --json
node scripts/amber.js release receipts --target . --id release/web-42 --json
```

`release status` derives one lifecycle state per release across every ledger
(`prepared|authorized|deploying|deployed|aborted|rolled-back`) — a rollback counts only once its
own execution committed, and any settled-but-uncommitted execution reads as aborted. `release receipts` assembles
the verifiable audit projection read-only: exact inputs (releaseHash, commit, policy and
capability pins, environment), the authorization bindings, and per-operation the real executor
identity, timestamps, settlement outcome, output digest, assurance fields, and the credential
BOUNDARY (purpose/scope/expiry — deliberately never the handle, so no receipt field can carry or
leak a credential value); any missing or tampered link fails closed through its ledger's typed
code. The MCP capability registry carries no release verb, so deploy and rollback can only ever be
approval-required submissions (F053 T4).

Error codes: `AMBER_E_RELEASE_INVALID`, `AMBER_E_RELEASE_EXISTS`, `AMBER_E_RELEASE_NOT_FOUND`,
`AMBER_E_RELEASE_CORRUPT`, `AMBER_E_RELEASE_LOCK`, `AMBER_E_RELEASE_SIZE_CEILING`,
`AMBER_E_RELEASE_DRIFT`, `AMBER_E_RELEASE_SEPARATION`, `AMBER_E_RELEASE_APPROVAL_MISMATCH`,
`AMBER_E_RELEASE_GATE`, `AMBER_E_RELEASE_AUTH_CORRUPT`, `AMBER_E_RELEASE_AUTH_LOCK`,
`AMBER_E_RELEASE_AUTH_SIZE_CEILING`, `AMBER_E_RELEASE_TX_STATE`, `AMBER_E_RELEASE_TX_MISMATCH`,
`AMBER_E_RELEASE_TX_CORRUPT`, `AMBER_E_RELEASE_TX_LOCK`, `AMBER_E_RELEASE_TX_SIZE_CEILING`.

### maintain register-detector / detect / propose / triage / complete / rollup / detectors / findings / proposals

Register Control Band detectors, record deterministic Findings (F054 T1), derive Trigger
Proposals (F054 T2), triage them (F054 T3), and close the loop with completion records and
bounded rollups (F054 T4). A detector is a versioned, model-independent Control Band definition —
metric, source, numeric baseline, closed comparator rules
(`ge|gt|le|lt`, the last matching rule wins), evaluation window, scope, cooldown, observation
ceiling, and the one permitted output type (`finding`) — registered into the hash-chained ledger
`.amber/maintain/detectors.jsonl` behind a single-use committed human acceptance/approval Decision
(mirroring the F052 registry contract). Registered versions are immutable: a changed definition
registers a new version, never an overwrite.

`detect` is target-read-only and model-independent: it evaluates one declared observation fixture
(subject, window, value, input hash) against one registered detector version — the verdict is a
pure function of the definition and the observation. An in-band verdict returns without writing
anything (it re-derives reproducibly on demand from the definition plus the observation, so
recording it would only add noise); an out-of-band verdict appends one immutable Finding to
`.amber/maintain/findings.jsonl` carrying the detector version, the observation's `inputHash`, the
definition's `baselineHash` (baseline + rules, so a changed definition is a visibly different
basis), the deterministic tier verdict, and a stable fingerprint derived from subject + rule
version + scope + window (keyed by detector id so two detectors sharing scope and version can
never collide) — repeated observations of the same condition correlate on one fingerprint instead
of multiplying. Detection never mutates the target, never touches canonical artifacts, and never
promotes anything; a window wider than the detector declares refuses. Both ledgers fail every read
closed on tamper.

`propose` derives one immutable Trigger Proposal from one recorded out-of-band Finding — never
from caller input: every proposal field copies from the Finding and the registered detector
version it names (the closed event sets carry identities, hashes, times, and Finding references
only, so no field can smuggle an admission payload — a proposal is a maintain-ledger record in
`.amber/maintain/proposals.jsonl`, structurally never a canonical artifact, and automation cannot
start work unilaterally). One open proposal per fingerprint: a repeated observation inside the
detector's declared cooldown (measured observation-to-observation) appends its Finding reference
onto the open proposal instead of duplicating it, and re-referencing the same Finding refuses;
outside cooldown the open proposal must be triaged before a new one may open, so an untriaged
condition escalates to a human instead of multiplying. Proposals are immutable and append-only;
the ledger fails every read closed on tamper.

`triage` binds one open proposal to one committed human acceptance/approval Decision
(registry-verified principal — the service owner) under the closed vocabulary
`fix|schedule|dismiss`. `schedule` and `dismiss` must carry preserved reasons and close the
proposal reviewably (it stays listable with its outcome, reason, and owner identity); a triaged
fingerprint is unblocked, so the next out-of-band observation opens a fresh proposal. Only `fix`
returns a CANDIDATE Intent admission payload — a prepare-only input mirroring F051 migration
candidates that carries the detector, subject, scope, tier, fingerprint, and referenced Finding
evidence — and triage itself never mutates canonical state: the candidate must still pass normal
canonical Intent admission, scope, Policy, and Acceptance, so nothing is ever auto-admitted.
Triage Decisions are single-use across the maintain ledgers (a Decision spent on a detector
registration or an earlier triage refuses), triage of a closed proposal refuses, and validly
re-chained forgeries against the closed-proposal or single-use invariants fail every read closed.

Staleness is derived at read time, never edited in place: `findings` and `proposals` listings
carry `stale`/`staleReasons` — `detector-superseded` when the entry's detector version is no
longer the newest registered version of that detector id, `observation-superseded` when a later
Finding re-presents the same fingerprint with a different input hash — so prior results become
stale rather than silently reinterpreted. `complete` closes a fix-triaged proposal by appending
one immutable record binding fingerprint → committed candidate Intent revision → committed `eval`
and `eval-result` artifact pins (F058 types), so a shipped fix becomes a regression signal; the
intent pin must be the fingerprint-derived candidate identity (`intent/maintain/<16-hex>`), every
pin must resolve to a committed revision of the exact type, and the pinned `eval-result` must
record the pinned `eval` as its definition (the F058 extensions carrier) — anything unresolved or
unlinked refuses, and a proposal completes at most once. How recent the pinned Eval revisions are
is the completer's judgment, reviewed at Acceptance; the record pins the exact revisions so that
judgment is auditable. `rollup` is a read-only deterministic aggregation within a
declared `--limit`: counts by tier, status, and derived staleness over the first N entries of each
ledger in append order, with an explicit `truncated` marker — never hidden truncation — and
stable, sorted key ordering.

```bash
node scripts/amber.js maintain register-detector --target . --id detector/error-rate \
  --detector-version 1 --metric http-5xx-rate --source observability/api \
  --baseline 10 --rule warn:ge:100 --rule page:ge:500 --window-ms 3600000 \
  --scope service/api --cooldown-ms 3600000 --max-observations 100 \
  --decision-identity decision/detector-error-rate --revision 1 --json
node scripts/amber.js maintain detect --target . --id detector/error-rate \
  --detector-version 1 --subject service/api \
  --window-from 2026-08-29T00:00:00.000Z --window-to 2026-08-29T01:00:00.000Z \
  --value 120 --observation-hash sha256:<64-hex-chars> --json
node scripts/amber.js maintain propose --target . --finding-index 0 --json
node scripts/amber.js maintain triage --target . --fingerprint sha256:<64-hex-chars> \
  --outcome schedule --reason "next sprint" \
  --decision-identity decision/triage-1 --revision 1 --json
node scripts/amber.js maintain triage --target . --fingerprint sha256:<64-hex-chars> \
  --outcome fix --decision-identity decision/triage-2 --revision 1 --json
node scripts/amber.js maintain complete --target . --fingerprint sha256:<64-hex-chars> \
  --intent intent/maintain-x@1 --eval eval/maintain-check@1 \
  --eval-result eval-result/maintain-check-run@1 --json
node scripts/amber.js maintain rollup --target . --limit 100 --json
node scripts/amber.js maintain detectors --target . --json
node scripts/amber.js maintain findings --target . --id detector/error-rate --json
node scripts/amber.js maintain findings --target . --fingerprint sha256:<64-hex-chars> --json
node scripts/amber.js maintain proposals --target . --fingerprint sha256:<64-hex-chars> --json
```

Error codes: `AMBER_E_MAINTAIN_INVALID`, `AMBER_E_MAINTAIN_EXISTS`, `AMBER_E_MAINTAIN_NOT_FOUND`,
`AMBER_E_MAINTAIN_CORRUPT`, `AMBER_E_MAINTAIN_LOCK`, `AMBER_E_MAINTAIN_SIZE_CEILING`,
`AMBER_E_MAINTAIN_FINDING_CORRUPT`, `AMBER_E_MAINTAIN_FINDING_LOCK`,
`AMBER_E_MAINTAIN_FINDING_SIZE_CEILING`, `AMBER_E_MAINTAIN_PROPOSAL_EXISTS`,
`AMBER_E_MAINTAIN_PROPOSAL_CORRUPT`, `AMBER_E_MAINTAIN_PROPOSAL_LOCK`,
`AMBER_E_MAINTAIN_PROPOSAL_SIZE_CEILING`.

### retention classify / evaluate / classifications / hold / release / holds / holder / holders / candidate / authorize / candidates / execute / settle / status / proof

Classify records into governed retention classes, evaluate expiry deterministically (F055 T1),
govern Legal Holds (F055 T2), review deletion candidates with bounded authorization (F055 T3),
and settle coordinated deletion with a minimal Proof (F055 T4). A classification binds one
committed canonical record
(`<type>:<identity>@<revision>`) to a
protocol-defined retention class — `ephemeral|operational|governance|audit`, fixed semantics —
whose TTL and legal basis resolve at classification time from a committed, versioned tenant
retention Policy artifact: the Policy revision's extensions carrier declares
`{ retention: { classes: { <class>: { ttlMs, legalBasis } } } }`, and a pin that does not declare
the class refuses. Classifications are immutable events in the hash-chained ledger
`.amber/retention/classifications.jsonl` — re-classification appends a new event and the latest
classification per record is effective; nothing is ever edited in place. T1 deliberately classifies
committed canonical records only; ledger subjects (evidence receipts, adapter read receipts, and
the other raw-byte holders) enter the surface with the T3 deletion-candidate enumeration and its
Holder registry.

Declared secret or personal content refuses classification unless an explicit `--minimized` marker
rides the event (and the marker without declared sensitivity refuses): deletion is not the first
privacy control, and unsafe raw content never enters a ledger — a validly re-chained forged event
carrying extra content fields fails the closed field set.

`evaluate` is deterministic and read-only: each record's `expired-eligible|retained` verdict is a
pure function of its latest recorded classification (`classifiedAt + ttlMs`, half-open — expiry at
exactly `expiresAt`) and the injected `--now` clock. Report-only: evaluation never writes and
nothing is deleted (deletion execution is F055 T3/T4, behind its own governance).

A Legal Hold binds scope — one exact record pin OR one subject identity (every revision of that
identity, deliberately type-agnostic: over-matching is fail-safe for a hold, which can only ever
retain more) — a preserved reason, and the issuer (the verified principal of a single-use committed
human acceptance/approval Decision) with its effective time into the hash-chained ledger
`.amber/retention/holds.jsonl`. Holds have priority over TTL: evaluation reports a held record as
`retained-by-hold` naming the holds in `heldBy`, regardless of expiry. Release is a second
single-use human Decision (double-release and ghost-release refuse; a validly re-chained second
release fails the read closed), and a released hold stays listable forever — a hold can end, but it
can never disappear, so Legal Hold never becomes an invisible permanent exception.

A registered Holder declares one copy-holding surface —
`canonical-body|raw-output|cache|index|export|subscription|external` — with its registered F051
Adapter pin (id + version, both verified) behind a single-use committed human Decision, immutable
per version, in `.amber/retention/holders.jsonl`. A deletion `candidate` is a governance-write
only: it enumerates the exact expired-eligible records at a declared clock with their full
retention basis, names the Legal Hold exclusions (`excludedHeld` with `heldBy`), lists every
registered Holder, and proposes the per-Holder `delete` effects — content is never touched, zero
eligible records or zero registered Holders refuse (a transaction with no Holders could
"complete" without deleting anywhere), and the closed content hashes into a canonical
`candidateHash`. `authorize` consumes one single-use Approval whose subject is
`retention-deletion:<candidateHash>` after re-deriving the candidate content at its recorded
clock — changed records, holds, Holders, or effects refuse with `AMBER_E_RETENTION_DRIFT`, and the
consumption settles the human Decision atomically. Execution and settlement are F055 T4, behind
their own governance.

`execute` opens exactly one deletion transaction per AUTHORIZED candidate in the hash-chained
ledger `.amber/retention/transactions.jsonl`, snapshotting the reviewed Holder coverage — a merely
prepared candidate and duplicate execution both refuse. Every covered Holder settles independently
(`settle`, closed statuses `settled|refused|failed|unavailable`, with the reviewed adapter pin
recorded as provenance and a declared `receiptHash`): the transaction reads `deletion-pending`
while ANY Holder is unsettled — Amber cannot overclaim completion — a settled Holder refuses
re-settlement in any status (a validly re-chained repeat fails the read closed), and a retry
targets only unsettled Holders. `proof` derives the minimal Deletion Proof read-only and ONLY from
full settled coverage: transaction identity, declared coverage (records with their retention
class, legal basis, and policy pins; Holders with surfaces), per-Holder receipts, the consumed
authorization, settlement time, and a controlled proof fingerprint salted with the ledger-internal
execution hash — never a reconstructable public content hash, and no deleted content in any field.
Deleted records project as tombstones (stable identity + transaction reference,
`deleted|deletion-pending`), and a tombstoned subject refuses Gate evaluation with
`AMBER_E_RETENTION_TOMBSTONE`: historical existence is not current proof, so a deleted record can
never satisfy content, replay, or freshness Gates.

```bash
node scripts/amber.js retention classify --target . --record spec:spec/login@2 \
  --retention-class operational --policy policy/tenant-retention@1 --json
node scripts/amber.js retention classify --target . --record eval-result:eval-result/session-raw@1 \
  --retention-class ephemeral --policy policy/tenant-retention@1 \
  --sensitivity personal --minimized --json
node scripts/amber.js retention evaluate --target . --now 2026-08-29T00:00:00.000Z --json
node scripts/amber.js retention classifications --target . --type spec --json
node scripts/amber.js retention hold --target . --id hold/litigation-42 \
  --subject spec/login --reason "litigation hold" \
  --decision-identity decision/hold-42 --revision 1 --json
node scripts/amber.js retention release --target . --id hold/litigation-42 \
  --decision-identity decision/release-42 --revision 1 --json
node scripts/amber.js retention holds --target . --status active --json
node scripts/amber.js retention holder --target . --id holder/canonical-body \
  --holder-version 1 --surface canonical-body --adapter adapter/store --adapter-version 1 \
  --decision-identity decision/holder-1 --revision 1 --json
node scripts/amber.js retention candidate --target . --id deletion/2026-08 \
  --now 2026-08-29T00:00:00.000Z --json
node scripts/amber.js retention authorize --target . --id deletion/2026-08 \
  --approval approval/deletion-42 --decision-identity decision/deletion-42 \
  --body "# Authorize deletion" --trace decides:intent:intent/retention --json
node scripts/amber.js retention candidates --target . --status prepared --json
node scripts/amber.js retention execute --target . --id deletion-tx/2026-08 \
  --candidate deletion/2026-08 --json
node scripts/amber.js retention settle --target . --id deletion-tx/2026-08 \
  --holder holder/canonical-body --holder-version 1 --status settled \
  --receipt-hash sha256:<64-hex-chars> --json
node scripts/amber.js retention status --target . --id deletion-tx/2026-08 --json
node scripts/amber.js retention proof --target . --id deletion-tx/2026-08 --json
```

Error codes: `AMBER_E_RETENTION_INVALID`, `AMBER_E_RETENTION_NOT_FOUND`,
`AMBER_E_RETENTION_CORRUPT`, `AMBER_E_RETENTION_LOCK`, `AMBER_E_RETENTION_SIZE_CEILING`,
`AMBER_E_RETENTION_HOLD_CORRUPT`, `AMBER_E_RETENTION_HOLD_LOCK`,
`AMBER_E_RETENTION_HOLD_SIZE_CEILING`, `AMBER_E_RETENTION_HOLDER_CORRUPT`,
`AMBER_E_RETENTION_HOLDER_LOCK`, `AMBER_E_RETENTION_HOLDER_SIZE_CEILING`,
`AMBER_E_RETENTION_CANDIDATE_CORRUPT`, `AMBER_E_RETENTION_CANDIDATE_LOCK`,
`AMBER_E_RETENTION_CANDIDATE_SIZE_CEILING`, `AMBER_E_RETENTION_DRIFT`,
`AMBER_E_RETENTION_TX_CORRUPT`, `AMBER_E_RETENTION_TX_LOCK`,
`AMBER_E_RETENTION_TX_SIZE_CEILING`, `AMBER_E_RETENTION_TOMBSTONE`.

### external register / effects / propose / authorize / proposals / execute / settle / reconcile / status / compensate / transactions

Register External Effect contracts, propose exact requests, authorize them drift-bound, settle
governed executions, and compensate committed effects (F056 T1-T4). Amber forbids arbitrary
account-bearing external operations: the
only thing that can
ever execute externally is a registered effect contract. Each contract declares the external
`--owner`, one closed system type
(`ticketing|code-review|notification|deployment|storage`), one registered operation name (lowercase
dotted, never a command line), the exact external `--external-target` and `--scope`, idempotency
behavior (`idempotent|at-most-once`), a credentials class (`none|scoped`), the receipt fields the
external system must return (`--receipt-field`, repeatable, at least one), a compensation
declaration — exactly one of a named compensating effect (`--compensation-effect`) or an explicit
`--irreversible` marker — a bounded `--timeout-ms` (at most 24h), and the one registered F051
Adapter pin (`--adapter` + `--adapter-version`, verified against the Adapter registry at
registration) that owns the API.

Registration settles behind a single-use committed human Decision — `acceptance|approval` with a
verified principal snapshot, unscoped, mirroring the F052/F055 authority contract; a reused
Decision refuses — into the hash-chained append-only ledger `.amber/external/effects.jsonl`, and
is immutable per effect `id@version`: changed external semantics register a new version, and stale
pins refuse downstream. No contract field can carry a command, executable, or remote URL: every
external-facing name — including the effect version and each receipt field name — is a closed slug
(no whitespace, no URL scheme, no shell metacharacters, no `..` traversal segments), so free-form
execution vectors refuse by construction, and a validly re-chained forged event carrying
a smuggled field fails the closed event shape. `effects` is a read-only projection (optionally
filtered by `--system`) that fails closed on a corrupt ledger.

Review binds exactly what will happen (T2): `propose` is a governance-write into the hash-chained
ledger `.amber/external/proposals.jsonl` that binds one registered effect version (which must be
the contract's current head), the contract's exact target and scope, the canonical
`--payload-hash` (`sha256:<64-hex>` of the exact payload under review — the payload itself never
enters the ledger), the credentials class, and the declared compensation into a canonical
`requestHash`. Idempotency binds external owner + effect + target + scope + payloadHash: an
identical request refuses naming the existing proposal, so a retry can never create a duplicate
external record. `authorize` consumes one single-use Approval whose subject binds
`external-effect:<requestHash>` and settles the human Decision atomically with the consumption
(a failed admission leaves the authorization unconsumed and the proposal proposed); re-derivation
against the current registries refuses `AMBER_E_EXTERNAL_DRIFT` when a newer effect version was
registered or the contract's Adapter pin no longer matches — a stale authorization can never ride
changed external semantics. `proposals` lists the requests read-only (optionally filtered by
`--status proposed|authorized`).

Missing output never means success, and no credential material ever rides a record (T3):
`execute` prepares one execution for an AUTHORIZED request into the hash-chained ledger
`.amber/external/executions.jsonl` — the operation, target, scope, and Adapter pin come only from
the reviewed contract snapshot (caller input can never supply a command, executable, or URL; the
request re-derives one last time so post-authorization drift refuses), and a scoped-credentials
contract binds a short-lived credential boundary (`--credential-purpose` + `--credential-scope` +
`--credential-expires`, expiry bounded by the contract's `timeoutMs`, which the execution
snapshots so the fold re-validates the same bound) whose stored shape carries
purpose/scope/expiry ONLY — no handle or value field exists, and token-shaped material in any
field refuses with `AMBER_E_EXTERNAL_CREDENTIAL_LEAK` at write time and fails the read closed on
a validly re-chained forgery. One execution is open per request at a
time; a committed request never re-executes, and an unconfirmed (`attempted|unknown`) outcome
retries only under a contract declared `idempotent` (at-most-once reconciles instead). `settle`
records the Adapter's declared result receipt — real external record id, request/response digests
(`sha256:<64-hex>`), declared status (`committed|failed|denied|unknown`) — and Amber, never the
adapter, derives the terminal outcome (`denied|attempted|committed|failed|unknown`): committed
requires the record id AND response digest (missing output reads as its refusal, never success),
a claimed failure/denial without the response digest that proves the interpretation downgrades to
`attempted`, a record id on a non-committed declaration refuses, settled outcomes never
re-settle, and the fold re-derives every stored outcome so a validly re-chained rewritten verdict
fails the read closed. `reconcile` is the only path from `unknown` to `committed`: it binds a
recorded Evidence receipt whose producer is independent of the authorizing approver plus the real
external record id, and refuses while another execution for the same request is open or already
committed — a request commits at most once. `status` reads one execution with its settlement and
reconciliation. Nothing
under this command executes an external operation — the external Adapter performs the operation
outside Amber and submits the declared receipt.

External state history stays complete (T4): compensation is a NEW governed effect, never a
rewrite. `compensate` opens a fresh proposal for one committed (or failed-partial) execution — it
rides exactly the compensation the ORIGINAL contract declared (an irreversible contract refuses
outright; an undeclared/unregistered compensating contract refuses), records the original
execution id as its `compensates` linkage, enforces one compensation lineage per original, and
then goes through its own authorization, execution, and receipt like any request. The original
outcome is never rewritten: `transactions` is the read-time projection joining every execution
with its compensation lineage, and `compensated` flips only when a compensating execution
actually committed. The external surface opens no ungoverned door: no MCP capability resolves to
the `external` command (external writes are approval-required submissions, never spawned), and
the ADR-0020 self-owned git transport exception stays isolated — the external registry shares no
transport-specific module, code, or state path with the sync transport and never spawns a process
(both test-pinned).

```bash
node scripts/amber.js external register --target . --id effect/ticket-comment \
  --effect-version 1 --owner platform-team --system ticketing --operation comment.create \
  --external-target tracker/amber-protocol --scope issues --idempotency idempotent \
  --credential scoped --receipt-field commentId \
  --compensation-effect effect/ticket-comment-delete --timeout-ms 30000 \
  --adapter adapter/tracker --adapter-version 1 \
  --decision-identity decision/effect-1 --revision 1 --json
node scripts/amber.js external register --target . --id effect/announce \
  --effect-version 1 --owner platform-team --system notification --operation message.post \
  --external-target chat/eng-releases --scope announcements --idempotency at-most-once \
  --credential scoped --receipt-field messageId --irreversible --timeout-ms 30000 \
  --adapter adapter/tracker --adapter-version 1 \
  --decision-identity decision/effect-2 --revision 1 --json
node scripts/amber.js external effects --target . --system ticketing --json
node scripts/amber.js external propose --target . --id request/ticket-comment-288 \
  --effect effect/ticket-comment@1 --payload-hash sha256:<64-hex> --json
node scripts/amber.js external authorize --target . --id request/ticket-comment-288 \
  --approval approval/external-42 --decision-identity decision/external-42 \
  --body "# Authorize external effect" --trace decides:intent:intent/external --json
node scripts/amber.js external proposals --target . --status proposed --json
node scripts/amber.js external execute --target . --id execution/ticket-comment-1 \
  --request request/ticket-comment-288 --credential-purpose comment.create \
  --credential-scope tracker/amber-protocol --credential-expires 2026-08-29T00:00:30.000Z --json
node scripts/amber.js external settle --target . --id execution/ticket-comment-1 \
  --external-record TRACK-1234 --request-digest sha256:<64-hex> \
  --response-digest sha256:<64-hex> --status committed --json
node scripts/amber.js external reconcile --target . --id execution/ticket-comment-1 \
  --evidence evidence/reconcile-1 --external-record TRACK-1234 --json
node scripts/amber.js external status --target . --id execution/ticket-comment-1 --json
node scripts/amber.js external compensate --target . --id request/undo-ticket-comment-1 \
  --execution execution/ticket-comment-1 --payload-hash sha256:<64-hex> --json
node scripts/amber.js external transactions --target . --request request/ticket-comment-288 --json
```

Error codes: `AMBER_E_EXTERNAL_INVALID`, `AMBER_E_EXTERNAL_CORRUPT`, `AMBER_E_EXTERNAL_LOCK`,
`AMBER_E_EXTERNAL_SIZE_CEILING`, `AMBER_E_EXTERNAL_NOT_FOUND`, `AMBER_E_EXTERNAL_DRIFT`,
`AMBER_E_EXTERNAL_PROPOSAL_CORRUPT`, `AMBER_E_EXTERNAL_PROPOSAL_LOCK`,
`AMBER_E_EXTERNAL_PROPOSAL_SIZE_CEILING`, `AMBER_E_EXTERNAL_EXEC_CORRUPT`,
`AMBER_E_EXTERNAL_EXEC_LOCK`, `AMBER_E_EXTERNAL_EXEC_SIZE_CEILING`,
`AMBER_E_EXTERNAL_CREDENTIAL_LEAK`.

## Handoff Commands

### handoff

Regenerate `session-handoff.md` from live repository state.

```bash
node scripts/amber.js handoff --target .
```

When the worktree is dirty with non-managed changes, the regenerated handoff includes a "Dirty worktree" classification: Amber-managed churn (`.amber/`, legacy `.harness/`, `*.amber-backup`) is summarized as an ignored count, the focus feature's booked uncommitted work carries a commit-before-finishing bail-back line, and every other dirty path gets a one-time FYI as parallel or unbooked work. The classification is read-only — handoff never stages, commits, or prompts — and clean or managed-only trees render no section.

### handoff bundle / validate

Produce and validate the portable continuation artifact set.

```bash
node scripts/amber.js handoff bundle --target .
node scripts/amber.js handoff bundle --target . --output-dir .amber/handoff/latest
node scripts/amber.js handoff validate --target .
node scripts/amber.js handoff validate --target . --bundle-dir .amber/handoff/latest
```

The bundle contains `README.md`, `session-summary.md`, `verification-evidence.md`, `next-actions.md`, `risks.md`, `recovery-commands.md`, and `manifest.json`.

## Maintenance Commands

### maintenance inspect

Detect maintenance needs:

```bash
node scripts/amber.js maintenance inspect --target .
```

Reports:
- Stale documentation
- Wiki lint issues
- Rule pack drift
- Upgrade opportunities

### maintenance propose

Generate maintenance proposal:

```bash
node scripts/amber.js maintenance propose \
  --target . \
  --output maintenance-plan.md
```

## Execution Commands

### execution validate-integration

Validate integration contract:

```bash
node scripts/amber.js execution validate-integration \
  --contract integration.json \
  --target .
```

### execution readiness

Check execution readiness:

```bash
node scripts/amber.js execution readiness \
  --plan docs/plans/feature.md \
  --target .
```

## Daemon Boundary

Amber V1 has no daemon command surface. Do not use Amber as a background autonomous worker. Use explicit, human-triggered commands such as:

```bash
node scripts/amber.js doctor --target .
node scripts/amber.js governance report --target .
node scripts/amber.js handoff validate --target . --bundle-dir .amber/handoff/latest
```

## Utility Commands

### init

Initialize Amber structure:

```bash
node scripts/amber.js init --target . [--dry-run]
```

Creates `.amber/` directory with starter files.

### audit

Audit project structure:

```bash
node scripts/amber.js audit --target . [--summary] [--json]
```

### doctor

Run diagnostic checks:

```bash
node scripts/amber.js doctor --target .
```

Reports:
- Missing files
- Configuration issues
- Compatibility warnings

Failing checks carry an actionable `→ fix:` remedy (e.g. missing harness files → `amber init`).

### next

Infer the repo's position in the Amber lifecycle and print the single next command to run
(read-only — never executes anything):

```bash
node scripts/amber.js next --target .                 # auto-select a focus
node scripts/amber.js next --target . --feature F001  # focus a feature
node scripts/amber.js next --target . --session <id>  # focus a session
node scripts/amber.js next --target . --objective "fix login timeout" # match a target-local Route
node scripts/amber.js next --target . --json          # machine-readable envelope
```

Lifecycle: `[audit on existing repos] → init → feature → plan → gate → verify → approve → handoff → complete-check → session complete → accept → learnings` (handoff may refresh after accept; the learnings checkpoint applies only when write-back triggers matched). With no
`--feature`/`--session`, `next` auto-selects (active session → most-recent plan's feature → first
unstarted feature) and reports the chosen focus plus how many other items are pending. Session
completion evaluation matches `complete-check --strict` (executed verification + live handoff, not
the init scaffold). Approve remedies include the concrete `--gate <id>` from the session route.
Existing non-empty targets get a read-only `amber audit` first; audit writes no target file, so
`next` advances straight to `init` (audit is a non-blocking advisory).

With `--objective`, `next` resolves Route manifests and Workflow Packs from the target repository,
not Amber's installation directory. A matching Route selects the governed path for that objective;
when no Route matches, the recommendation remains behind the plan gate instead of guessing an
execution path.

### migrate

Migrate from Harness to Amber:

```bash
# Merge legacy state into .amber without overwriting existing files
node scripts/amber.js migrate state --target .

# After a clean merge, rename .harness to a timestamped backup to remove coexistence
node scripts/amber.js migrate state --target . --archive-legacy

# Migrate wiki
node scripts/amber.js migrate wiki --target .

# Migrate session manifest schemas and backfill ADR-0012 version fields
node scripts/amber.js migrate manifests --target .

# Preview both manifest migration and version-field backfill without writing
node scripts/amber.js migrate manifests --target . --dry-run
```

`migrate` with no subcommand is equivalent to `migrate manifests`. It updates Session manifest
schemas and backfills missing ADR-0012 version fields in recognized JSON artifacts under `.amber/`,
`routes/`, and `workflow-packs/`; existing version fields are never overwritten. Unknown JSON is
left untouched, and Workflow Pack containers migrate only their recognized `loopContracts[]`.
Before the first write to each changed JSON file, Amber keeps a sibling `.backup` copy and preserves
that original backup on later runs.

### wiki

Create missing Wiki starter files, skip existing files, then validate links (idempotent):

```bash
node scripts/amber.js wiki --target . [--dry-run]
```

Knowledge Plan subcommands (declarative plan + structured knowledge base):

```bash
node scripts/amber.js wiki knowledge plan --target .      # pre-flight inspection + propose or update the plan
node scripts/amber.js wiki knowledge scaffold --target .  # scaffold docs/wiki/knowledge-plan.json (or --yaml)
node scripts/amber.js wiki knowledge inspect --target .   # dump the loaded plan
node scripts/amber.js wiki knowledge report --target .    # coverage report against declared documents
node scripts/amber.js wiki knowledge validate --target .  # schema validation of the plan
node scripts/amber.js wiki knowledge build --target .     # materialize pages under docs/wiki/knowledge/
```

### status

Show a curated one-line overview of repo state: git branch, Amber init status, install freshness, and scaffold/artifact/wiki drift counts. Read-only thin front-door — does not duplicate `doctor` or `maintenance inspect`:

```bash
node scripts/amber.js status --target . [--json]
```

### sync

Detect scaffold and artifact drift between installed files and shipped templates. Dry-run by default (no changes made); with `--execute`, refreshes stale Amber-owned scaffold files and caches customized/ambiguous proposals:

```bash
node scripts/amber.js sync --target .
node scripts/amber.js sync --target . --execute
```

### clean

Remove amber-generated files from the target repository (reverse of `init`):

```bash
node scripts/amber.js clean --target . [--dry-run]
```

### security audit

Run security governance checks in report-only mode (never mutates target code):

```bash
node scripts/amber.js security audit --target .
node scripts/amber.js security audit --target . --output docs/security-audit.md
```

## Advanced Commands

### pack inspect

Inspect workflow pack:

```bash
node scripts/amber.js pack inspect \
  --file workflow-packs/safe-amber-bootstrap.pack.json
```

### pack readiness

Check pack readiness:

```bash
node scripts/amber.js pack readiness \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --json
```

### profile inspect
> ⚠️ **DEPRECATED** — will be removed in v2. Use `amber governance policy` instead.

Inspect project profile:

```bash
node scripts/amber.js profile inspect \
  --file profiles/default.profile.json
```

### loop validate-loop

Validate a loop contract file (read-only):

```bash
node scripts/amber.js loop validate-loop \
  --contract loop.json \
  --target .
```

### loop recommend

Select the safest local loop contract for a maintenance goal. This command is read-only and
returns a `nextCommand`; it never schedules work or executes workflow steps.

```bash
node scripts/amber.js loop recommend \
  --target . \
  --goal "continuous improvement" \
  --json
```

For the default project packs, continuous improvement recommends `daily-amber-triage` and a
dry-run command like:

```bash
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --dry-run \
  --json
```

### loop inspect

Inspect one loop contract and its readiness without writing a ledger:

```bash
node scripts/amber.js loop inspect \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --json
```

### loop run

Build a ledger preview for a loop contract (default, requires `--dry-run`), OR — since
[ADR-0003](adr/0003-governance-gated-execution.md) — execute the contract's `governed.command`
under governance gates with `--execute`. Live scheduling is disabled by product boundary; `--execute`
is a human-triggered one-shot (with approval), not scheduled or unattended work.

```bash
# dry-run preview (default; nothing executes)
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --dry-run --json

# governed execution (needs a prior `loop approve`; runs in an isolated worktree)
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract amber-doctor-check \
  --execute
```

`--execute` runs only if all gates pass: the contract declares a `governed.command`, that command
passes the policy gate (`.amber/governance/rules.json`, deny-wins / default-deny), an unconsumed
approval exists, the target is a git repo (worktree isolation), and the attempt is appended to the
tamper-evident ledger.

### loop approve

Record an explicit human approval authorizing ONE governed execution. One approval is consumed by one
`loop run --execute`; re-running requires re-approval.

```bash
node scripts/amber.js loop approve \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract amber-doctor-check \
  --reviewer your-name
```

### loop verify-ledger

Recompute the hash chain of a contract's execution ledger and report any tampering.

```bash
node scripts/amber.js loop verify-ledger --contract amber-doctor-check --json
```

### loop record / status

Record caller-supplied manual loop evidence, then inspect the resulting ledger. These commands
do not execute workflow steps; they only write or read review artifacts supplied by the caller.
`loop status --ledger` accepts either one ledger JSON file or a directory containing ledger
JSON records. Directory status considers at most the newest 100 files by modification time,
retains valid records when individual files are corrupt, orders loaded records chronologically,
and reports `insufficient-history`, `progressing`, or `stalled` with explicit no-progress signals
and remedies. Status never executes commands, schedules jobs, calls external systems, or rewrites
the supplied ledger history.

```bash
node scripts/amber.js loop record \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --trigger-source manual \
  --stop-reason reviewer-gate-required \
  --output .amber/loops/daily-amber-triage/manual-ledger.json \
  --json

node scripts/amber.js loop status \
  --ledger .amber/loops/daily-amber-triage/manual-ledger.json \
  --json

# assess bounded no-progress signals from recorded history
node scripts/amber.js loop status \
  --ledger .amber/loops/daily-amber-triage/history \
  --json
```

### task prepare
> ⚠️ **DEPRECATED** — will be removed in v2.

Prepare task execution:

```bash
node scripts/amber.js task prepare \
  --target . \
  --plan docs/plans/feature.md \
  --task task-1 \
  --session <id>
```

The execution ledger and evidence always bind to a target-local, non-terminal Session. Amber validates
an explicit `--session`; when it is omitted, Amber uses the most recent incomplete Session. The command
fails before creating execution or worktree directories when no valid Session can be resolved.

### result inspect
> ⚠️ **DEPRECATED** — will be removed in v2.

Inspect task result:

```bash
node scripts/amber.js result inspect \
  --target . \
  --task task-1
```

### agent
> ⚠️ **DEPRECATED** — will be removed in v2.

Create and control auditable worker/reviewer dispatch records without executing agent work:

```bash
node scripts/amber.js agent dispatch --target . --task task-1 --worker worker-a --reviewer reviewer-b
node scripts/amber.js agent stop --target . --task task-1
node scripts/amber.js agent resume --target . --task task-1
node scripts/amber.js agent review --target . --task task-1
```

### team
> ⚠️ **DEPRECATED** — will be removed in v2.

Inspect, install, pin, update, and roll back local team distribution metadata. Use `install --dry-run` to preview `.amber/team` metadata writes before creating local state:

```bash
node scripts/amber.js team inspect --target .
node scripts/amber.js team install --target . --version 1.0.0 --preset safe-bootstrap --dry-run --json
```

### adoption
> ⚠️ **DEPRECATED** — will be removed in v2. Use `amber governance audit` instead.

Generate, list, or index safe adoption report artifacts without modifying target repositories:

```bash
node scripts/amber.js adoption report --target . --output-dir docs/examples/adoptions
node scripts/amber.js adoption gate --reports-dir docs/examples/adoptions
```

## Examples

### Start Simple Session

```bash
node scripts/amber.js session start \
  --target . \
	--goal "fix login timeout bug" \
	--route bugfix-quick \
	--confirm
```

### Autonomous Mode Boundary

`--mode autonomous` is intentionally refused in V1. Use governed sessions, explicit approvals, and handoff validation instead.

### Continue After Budget Exceeded

```bash
# Edit .amber/autonomous-policy.json to increase budget
# Then:
node scripts/amber.js session continue --target .
```

### Check Session Status

```bash
node scripts/amber.js session status --target .
```

### List All Sessions

```bash
node scripts/amber.js session list --target .
```

### Generate Governance Audit

```bash
node scripts/amber.js governance audit \
  --target . \
  --since 2024-01-01 \
  --output audit-2024.md
```

### Check System Health

```bash
node scripts/amber.js maintenance inspect --target .
```

## Exit Codes

- `0`: Success
- `1`: Failure
- `2`: Paused (autonomous mode, budget exceeded)

## Environment Variables

```bash
# Email notifications
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@email.com
EMAIL_PASS=app-password

# Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Debugging
DEBUG=amber:*
```

## JSON Output Format

All commands support `--json` for machine-readable output:

```bash
node scripts/amber.js session status --target . --json
```

Output:
```json
{
  "sessionId": "abc123def",
  "status": "completed",
  "goal": "implement auth",
  "route": "feature-standard",
  "tokensUsed": 45230,
  "duration": "15m 23s"
}
```

## Configuration Files

### .amber/autonomous-policy.json

Session execution policy:
```json
{
  "gates": { "auto": "approve", "user-approval": "block", "step-confirm": "block" },
  "retry": { "maxAttempts": 3 },
  "budget": { "maxTokens": 100000 }
}
```

### routes/*.route.json

Route definitions with stages and gates.

### schemas/*.schema.json

JSON schemas for validation.

## Directory Structure

```
project/
├── .amber/
│   ├── sessions/           # Session data
│   ├── governance/         # Governance docs
│   ├── logs/               # System logs
│   ├── autonomous-policy.json
│   └── daemon.pid
├── routes/                 # Route definitions
│   ├── feature-standard.route.json
│   ├── bugfix-quick.route.json
│   └── refactor-safe.route.json
└── schemas/                # JSON schemas
    ├── route.schema.json
    └── session-manifest.schema.json
```

## Tips

### Faster Commands

Use shorter route names:
```bash
--route bugfix-quick  # Instead of feature-standard
```

### Debug Mode

Enable verbose logging:
```bash
DEBUG=amber:* node scripts/amber.js session start ...
```

### Batch Operations

Process multiple sessions:
```bash
for session in $(node scripts/amber.js session list --json | jq -r '.[] | select(.status=="paused") | .sessionId'); do
  node scripts/amber.js session continue $session --target .
done
```

### Monitor Long Sessions

Watch timeline in real-time:
```bash
tail -f .amber/sessions/<session-id>/timeline.jsonl
```

## Enforcement Commands (opt-in)

The `hooks` command manages an opt-in git `pre-commit` guard. It reads governance **metadata only**
and never runs target-project build/test commands. It is never installed automatically.

### hooks install

```bash
node scripts/amber.js hooks install --target .
node scripts/amber.js hooks install --target . --warn-only   # surface findings, never block
node scripts/amber.js hooks install --target . --force       # overwrite a foreign pre-commit hook
```

Writes `.git/hooks/pre-commit` (a portable `#!/bin/sh` shim, marked `# amber-managed-hook`). An
existing non-Amber hook is backed up to `pre-commit.amber-backup` unless `--force` is given.

### hooks check

```bash
node scripts/amber.js hooks check --target .
```

Runs the governance checks now (this is what the hook invokes). Exits non-zero on a violation.
Default check: a feature with status `passing`/`accepted`/`done` must not have an empty `evidence`
array (`AMBER_E_FEATURE_NO_EVIDENCE`). Bypass once with `AMBER_SKIP_HOOKS=1 git commit ...`.

### hooks status / uninstall

```bash
node scripts/amber.js hooks status --target .      # installed (blocking|warn-only) / not installed
node scripts/amber.js hooks uninstall --target .   # removes the Amber guard; restores any backup
```

### hooks breadcrumb

An opt-in per-turn agent hook. When the host fires its prompt hook, `breadcrumb print` renders a
read-only `<amber-workflow-state>` block — current focus, session status and pending gates, and the
single required next step (same source as `amber next`) — and injects it into the agent turn as
context.

```bash
node scripts/amber.js hooks breadcrumb print --target .                # JSON envelope (default)
node scripts/amber.js hooks breadcrumb print --target . --format text  # bare block
node scripts/amber.js hooks breadcrumb install --target .   # merge into .claude/settings.json (opt-in)
node scripts/amber.js hooks breadcrumb status --target .    # installed / not installed (echoes the entry)
node scripts/amber.js hooks breadcrumb uninstall --target . # removes the Amber entry only
```

`print` reads governance metadata from disk only: it writes nothing, never runs target-project
commands, and never dispatches agents — context injection, not execution. Like the pre-commit guard,
the breadcrumb is never installed automatically (`amber init` does not add it), and
`AMBER_SKIP_HOOKS=1` silences it. Printed blocks carry `Binding: amber-breadcrumb-v1 <hex>`; only a
binding that matches the current lifecycle snapshot is authentic. Blocking errors from every `hooks`
subcommand go to **stderr** (`ERROR:` lines); `--json` still prints the structured result on stdout.
Mechanism and invariants live in
[docs/specs/2026-08-15-workflow-state-breadcrumb.md](specs/2026-08-15-workflow-state-breadcrumb.md).

## Eval Commands

`amber eval` replays deterministic instruction-surface Evals (F050 Evidence; F058). Suite version 2
contains four Evals covering MCP tool descriptions, QA contract-surface model independence, the
Context quote boundary, and breadcrumb authenticity. `eval run` remains report-only: it does not
write, does not call a model, and exits 0 only when every Eval passes. `eval admit` is the explicit
F050 admission path: it replays the same suite, admits an active `eval` definition artifact plus a
recorded `eval-result` artifact, then records replayable Evidence through the normal
`.amber/evidence/` receipt path. Eval artifacts are not Approval, do not consume Approval, do not
bind a Decision principal, and cannot widen execution authority.

```bash
node scripts/amber.js eval run --target . --json
node scripts/amber.js eval admit --target . --producer ci-runner --evidence-id evidence/eval-run --yes --json
node scripts/amber.js eval list --target .
node scripts/amber.js eval show --id eval.instruction-surface.mcp-tool-description --target .
```

`eval admit` uses the registered producer Principal exactly like `evidence record`; the Evidence
receipt is recorded with assurance `replayable`, `subject` defaults to `eval.instruction-surface`,
and `replayOf` points at the admitted `eval-result:<identity>@<revision>`. Independent verification
through `amber evidence verify` is still required before the receipt's effective Assurance becomes
`verified`. Exit 0 when every Eval in the suite passes; exit 1 when any report-only `eval run` has
findings. Spec:
[docs/specs/F058-instruction-surface-adversarial-evals.md](specs/F058-instruction-surface-adversarial-evals.md).

### Eval result contract

Each Eval result carries `{evalId, version, status, assurance, scanned, findings}`. The `scanned`
field is the population census the result was earned over: `actionTypes`, `functions`, and
`modelScanFiles` for the MCP Eval; `qaModelScanFiles` and `qaModelScanPaths` for the QA contract-surface
Eval; `loadouts` and `requests` for the Context Eval; `pages` for the Breadcrumb Eval. Target-local
stores legitimately scan as zero on a fresh target; a pass is never vacuous:

- An empty tool registry (zero Action Types and Functions scanned) fails the suite with
  `AMBER_E_EVAL_EMPTY_SCAN` instead of passing with zero findings; the same code fires when the
  model-independence scan covers zero files.
- A registry that cannot be loaded (missing directory, invalid JSON, schema violation) fails the
  affected Eval with `AMBER_E_EVAL_REGISTRY_UNREADABLE`, delivered through the normal JSON result
  envelope — the remaining Evals still run, `overall` reflects the failure, and the CLI never dies
  with a bare stack trace on a broken registry.

The model-independence scan covers the four fixed Eval sources: `scripts/lib/mcp-tool-description.js`,
`scripts/lib/mcp-tool-surface.js`, `scripts/lib/eval-commands.js`, and the suite module itself
(`scripts/lib/core/instruction-surface-evals.js`, whose client-name pattern is assembled from
fragments so it cannot self-flag). It detects model providers and HTTP clients by bare name
(OpenAI, OpenRouter, Anthropic, @ai-sdk, axios, node-fetch, undici), by module specifier
(`require("got")` / `require("ky")` / `require("request")`), by call form (`fetch("https://…")`,
`got(…)`, `ky(…)`, `request(…)`), and by Node core member calls (`https.get(…)`,
`http.request(…)`). Ordinary identifiers and prose (`const request = …`, `handleRequest(…)`) do
not match. The scan is a lexical tripwire over that fixed file set, not a proof of independence;
`modelIndependent: true` means "no known model/network client reference in the scanned sources".

The separate QA contract-surface Eval scans exactly `apps/web/server/lib/knowledge-qa.ts`,
`apps/web/server/routers/knowledge.ts`, and `apps/web/src/lib/knowledge-dto.ts`. These files ship in
the npm package so an installed CLI evaluates the same default population as a source checkout.
`apps/web/server/lib/knowledge-llm.ts` is the provider adapter and remains deliberately outside both
the QA census and the package allowlist.

All Eval finding codes (the `AMBER_E_EVAL_*` family) are registered in the consolidated error
catalog (`scripts/lib/core/error-catalog.js`) and are explainable with
`amber explain <code>`. Findings are Evidence, not CLI errors: a failing suite still prints its
JSON envelope on stdout with exit 1.

## Drift Commands

`amber drift` is a CI-native drift gate. It aggregates the artifact, wiki, and scaffold drift
detectors into one exit code: `0` if no actionable drift, `1` if any. Read-only; no execution.

```bash
node scripts/amber.js drift --target .                           # human text, exit 0/1
node scripts/amber.js drift --target . --json                    # machine envelope (exitCode field)
node scripts/amber.js drift --target . --format gh-annotations   # GitHub Actions ::warning lines
node scripts/amber.js drift --target . --scope artifact          # one scope only
node scripts/amber.js drift --target . --no-fail                 # always exit 0 (informational CI step)
```

GitHub Actions snippet (add as a step in any workflow that runs on PRs):

```yaml
- name: Amber drift gate
  run: |
    npm install -g amber-protocol
    amber drift --target . --format gh-annotations --no-fail
```

## Workflow Commands

`amber workflow` is the ADR-0008 workflow-effectiveness assessment surface. Read-only by default:
`assess` builds a report from repository evidence plus session observations (amber-native sessions
and cwd-bound Claude host transcripts, capped to the newest 20 transcript files) unless
`--no-sessions`; `findings` / `plan` / `compare` operate on prior report files. `assess` writes a
report file only when `--output-dir` is given. Diagnostics go to **stderr**; stdout stays
parser-safe JSON (or Markdown for assess).

```bash
# Build a report (stdout JSON by default)
node scripts/amber.js workflow assess --target .
node scripts/amber.js workflow assess --target . --format markdown
node scripts/amber.js workflow assess --target . --output-dir .amber/workflow-reports
node scripts/amber.js workflow assess --target . --no-sessions   # repository-only baseline

# Extract findings from a prior report
node scripts/amber.js workflow findings --target . --report path/to/report.json

# Dry-run plan draft for one finding (never mutates the target)
node scripts/amber.js workflow plan --target . --report path/to/report.json --finding ca-1-feature-observable

# Longitudinal compare of two reports
node scripts/amber.js workflow compare --target . --baseline path/to/old.json --current path/to/new.json
```

Subcommands:

| Action | Purpose | Key flags |
|--------|---------|-----------|
| `assess` | Score dimensions + findings from live repo evidence | `--format json\|markdown`, `--output-dir`, `--no-sessions` |
| `findings` | List findings from a saved report | `--report` (required) |
| `plan` | Dry-run plan draft for one finding | `--report`, `--finding` (required) |
| `compare` | Diff baseline vs current report | `--baseline`, `--current` (required) |

Only `assess` accepts `--output-dir`. `findings` / `plan` / `compare` reject it with exit code 1
and an empty stdout. No action schedules work or executes target-project commands.

## Ledger Commands

`amber ledger` exports, seals, or verifies the anchoring of Amber's tamper-evident ledgers.

```bash
# SIEM/compliance export (JSON default; csv and otlp-json — the latter is valid OTLP JSON)
node scripts/amber.js ledger export --target . --format json                  # pipe to your collector
node scripts/amber.js ledger export --target . --format csv --out audits/ledger.csv
node scripts/amber.js ledger export --target . --format otlp-json
node scripts/amber.js ledger export --target . --home sessions                # one ledger home

# Git-anchor ledger tail hashes (closes the ADR-0003 full-rewrite gap)
node scripts/amber.js ledger seal --target . --reviewer <name>
node scripts/amber.js ledger verify-anchoring --target .     # exit 1 if any ledger changed since the last seal
```

`export` emits a broken chain as `intact:false` (data, not refusal) and counts it in `brokenCount`.
`seal` writes an annotated git tag `amber-ledger-seal-<head-sha>` carrying each ledger's tail hash,
so forging a ledger then requires rewriting git tag history. No Ed25519 signing yet — deferred per
the Phase 1 spec until key management (HSM / OS keystore) is a real capability rather than a key in
the repo.

## Context Commands

`amber context` is the ADR-0009 contract-driven distillation surface. **Amber never calls a model**:
`request` writes a hash-bearing distillation contract; a host agent executes it; `ingest` judges the
result (schema, citation completeness, payload-to-request binding, source freshness) and persists
provenance-backed pages under `.amber/context/pages/`, indexed by `docs/wiki/context-index.md`.
Run `amber context --help` for the full subcommand reference; `skills/amber-context-continuity/SKILL.md` is the
agent-facing loop.

```bash
# Contract + gate
node scripts/amber.js context request --target . --page governed-execution --title "Governed execution" --source docs/adr/0003-....md
node scripts/amber.js context ingest  --target . --request kd-2026-08-07-a3f1 --payload out.json --confirm
node scripts/amber.js context ingest  --target . --request <id> --payload no-change.json --confirm  # {"outcome":"no-change"} rebases hashes

# Health and maintenance
node scripts/amber.js context verify --target . --json
node scripts/amber.js context list   --target .
node scripts/amber.js context list   --target . --knowledge-kind decision
node scripts/amber.js context show   --target . --page <id>
node scripts/amber.js context refresh --target .          # absorbs cosmetic changes; requests real ones
node scripts/amber.js context delete --target . --page <id>

# Task-scoped Loadout
node scripts/amber.js context load --target . --route feature-standard
node scripts/amber.js context load --target . --route feature-standard --feature F016 --budget 4000 --page governed-execution
node scripts/amber.js context verify --target . --loadout .amber/context/loadouts/feature-standard-F016.json

# Rebuildable projections and deterministic quality checks
node scripts/amber.js context projection status --target .
node scripts/amber.js context projection rebuild --target .
node scripts/amber.js context benchmark --target . --fixture fixtures/context-benchmark.json --mode smoke

# Opt-in source candidates and report-only retention
node scripts/amber.js context source-adapter --target . --fixture fixtures/context-source.json --enable
node scripts/amber.js context source-adapter --target . --fixture fixtures/context-source.json --enable --allow-transcript
node scripts/amber.js context retention --target . --older-than-days 90

# Observability
node scripts/amber.js context stats --target .            # lifetime
node scripts/amber.js context stats --target . --window 50   # last 50 events
node scripts/amber.js context stats --target . --knowledge-kind decision
```

Sources are mutable by default (raw+normalized hash; cosmetic changes absorbed silently) and
immutable under `.amber/`, `docs/adr/`, and `docs/decisions/` (excerpt-snapshotted; tamper detected). A payload must
reproduce the request's bundled source hashes verbatim — re-bundling is rejected as stale.
Failures carry the `AMBER_E_CONTEXT_*` codes (see `amber explain`).

Loadouts use `schemaVersion: 1.0.0`. `artifacts.required[]` always records and budgets the
target-local Operating Manual (`docs/wiki/agent/amber.md`), selected Route manifest, and Loadout
Definition (`docs/wiki/agent/context-loadout.md`); Context Page accounting remains in `references`.
Missing, escaped, or hash-changed Required Artifacts fail closed. `verify --loadout` rechecks them
and any required-tier Pages immediately before the host agent loads the artifact.

Context lifecycle metadata is observational. `knowledgeKind`, supersession lineage, assurance
confidence, and maturity are displayed independently from source health. Successful ingest writes
hash-bound verification evidence under `.amber/context/verification/`; mechanical verification time
is derived from that evidence and becomes unavailable when the accepted page no longer matches it.
Assurance never grants execution authority and does not weaken policy, approval, isolation, evidence,
freshness, Required Artifact, or Loadout budget checks.

`source-adapter` is disabled unless `--enable` is present and only returns unaccepted Source Bundle
candidates. It never writes Context Pages or Loadouts. Transcript sources additionally require
`--allow-transcript` and are redacted before being returned. Every returned bundle carries a hashed
target binding; if a fixture declares `target`, the binding must match the selected Target Repository.
`retention` is report-only: it identifies
age and eligibility but does not delete or rewrite requests, payloads, pages, verification evidence,
Loadouts, or projections. See the [Context threat model](architecture/context-threat-model.md).

## Knowledge Graph Commands

`amber knowledge` is the F059 deterministic knowledge-graph surface. The production read path uses
a committed corpus at `docs/knowledge-corpus/` (tracked in git) so `amber knowledge graph` succeeds
on a clean clone without any prior mutation to `.amber/`.

**Intentional census gate, single-sourced:** the committed manifest at
`docs/knowledge-corpus/knowledge-context-manifest.json` is the census's one source of truth.
Adding or removing any document under `docs/adr/`, `docs/wiki/knowledge/`, or
`docs/architecture/` makes reads fail closed with the offending paths named — in both
directions (a tree document not yet admitted; a census row whose file vanished) — until a fresh
`context-sync` run is committed. Admission is deliberate by construction: the reviewed artifact
is the regenerated manifest diff in your commit, not a constant in code.

```bash
# Deterministic knowledge graph (reads committed docs/knowledge-corpus/)
node scripts/amber.js knowledge graph --target . --json

# Render the tree-derived manifest and validate it against the committed census
node scripts/amber.js knowledge context-manifest --target . --json

# Build / refresh the committed corpus (writes docs/knowledge-corpus/ — then commit the changes)
node scripts/amber.js knowledge context-sync   --target .             # create/skip unchanged pages
node scripts/amber.js knowledge context-sync   --target . --refresh   # force re-ingest every page

# Prepare HITL review sample (6 pages spanning all three categories — requires human review before close)
node scripts/amber.js knowledge context-review-sample --target . --output .scratch/review-sample.json

# Other knowledge base subcommands
node scripts/amber.js knowledge admit  --target . --page <id> --auth <approval-id>
node scripts/amber.js knowledge list   --target .
node scripts/amber.js knowledge status --target . --id <id>
node scripts/amber.js knowledge retire --target . --id <id> --reason "<reason>"
node scripts/amber.js knowledge query  --target . --scope <scope>
```

The `context-sync` command writes `.amber/context/pages/knowledge-*.json` (ADR-0009 pipeline)
**and** `docs/knowledge-corpus/` (committed production corpus). Commit the updated
`docs/knowledge-corpus/` files after every `context-sync` run that changes the corpus. Pages are
generated with `maturity: "provisional"` — they require human review before the maturity can be
advanced to `reviewed`.

See `scripts/lib/core/knowledge-projection.js` and `docs/specs/F059-knowledge-decision-map.md`.

## Memory Commands

`amber memory` is the ADR-0018 Governed Memory Layer surface: a governed write-back pipeline for
MEMORY.md nominations. **Amber never writes MEMORY.md** — humans curate the surface; Amber admits,
approves, registers, and audits. `request` nominates entries (T1/T2 write-back triggers or the human
escape hatch); `ingest` is the mechanical all-or-nothing admission gate (schema → source binding →
signal → α budget → γ rate limit); `approve` is the single human, entry-level gate; `book` registers
the MEMORY.md surface hash and promotes entries to active; `abandon` is the explicit terminal
marker; `status` is a read-only three-section projection (entries / gamma / alpha). Doctor owns the
judgment rules (ledger consistency, source health, surface drift, budget compliance).

`request`/`ingest`/`book` inline the identity gate (non-TTY without `--yes` is refused);
`approve`/`abandon` are typed-seam mutations and require `--yes`/`--confirm`.

```bash
# Nominate + admit + approve + register (the governed chain)
node scripts/amber.js memory request --target . --payload mem-request.json --yes
node scripts/amber.js memory ingest  --target . --request mreq-... --yes
node scripts/amber.js memory approve --target . --entry-id sha256:... --decision approve --yes
node scripts/amber.js memory book    --target . --entry-id sha256:... --yes

# Human escape hatch + explicit terminal marker
node scripts/amber.js memory abandon --target . --entry sha256:... --yes

# Ratify a human direct edit of MEMORY.md (no request/ingest/approve, γ-free)
node scripts/amber.js memory book --target . --ratify --claim "<entry heading>" --yes

# Read-only projection (also exposed as the amber.memory.status MCP tool)
node scripts/amber.js memory status --target . --json
```

Run `amber memory --help` for the full subcommand reference; the design contract is
`docs/specs/2026-08-21-governed-memory-layer.md`.

## Error Codes

### explain

Look up Amber error codes, or regenerate the troubleshooting reference:

```bash
node scripts/amber.js explain                                  # list every code with its layer
node scripts/amber.js explain AMBER_E_FEATURE_NO_EVIDENCE      # cause + fix for one code
node scripts/amber.js explain feature_no_evidence             # bare suffix also works
node scripts/amber.js explain --markdown docs/ERROR_CODES.md  # write a standalone reference table
```

Blocking errors render with their stable code inline (`<message> [CODE] → fix: <remedy>`). The
catalog is the single source of truth. `--markdown` writes a standalone reference file (don't point
it at a doc with hand-written front-matter — it writes only the generated table).

## Governance loop e2e

The product-repo command that proves the isolated Console loop (success, rejection,
verify-fail recovery, cross-session handoff) on a fresh non-Amber git target:

```bash
npm run test:governance-loop
node scripts/demo/e2e-governance-loop-verify.js --output /tmp/loop.json
```

It is read-only against this repository. A regression or a leaked product-repo session
exits non-zero. CI runs it on pull requests and as a nightly dispatch job. Details:
[docs/quality/e2e-governance-loop-verify.md](quality/e2e-governance-loop-verify.md).

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Review [Policy Configuration](POLICY_CONFIGURATION.md)
- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
