# F063: Product Closeout — Seven-Verb Default Surface, Verb Skills, Spec Status Header, Directory Consolidation

**Spec ID:** F063
**Status:** Reconciliation required
**Updated:** 2026-09-03
**Provenance:** `docs/quality/product-review-2026-09-02.md` §2/§5, reconciled with the
approved product map (2026-09-03) and the measured repository baseline. The product map is the
current product decision: Agent-native host entry is primary, CLI is the deterministic fallback,
canonical skills are one router plus four deep journeys, and bulk directory migration is P2-04.
**Depends on:** F019 (command tier registry and default-help projection — the mechanism this
feature re-tunes), ADR-0014 (deterministic routing advisor; no LLM routing), ADR-0001
(governance-first product boundary)
**Source review:** the product review's own evidence line — F049–F062 is a platform layer with no
user entry; the fix is entry-shape and placement, not new capability.

## Problem Statement

Three documents describe three different products (product review §1): SPEC.md says "draft v1",
README says ten-step lifecycle, CONTEXT.md carries 150+ enterprise terms. The 2026-09-02 product
review pinned the cause: a two-week trust-infrastructure wave (F049–F062) landed **without a user
entry**, and the entry surfaces still advertise it. Concretely, on the 2026-09-03 baseline:

1. **Default help is a wall of 35 commands.** `amber --help` projects every `journey`+`core`
   command (22 output lines, 323-char command list). A new user's first screen names
   `breakglass`, `retention`, `principal` alongside `init`. F019's tier machinery exists and is
   the single visibility source — but the tuning puts everything platform in `core`.
2. **The host entry must be useful before a user learns the CLI.** The canonical surface is one
   router plus four deep journeys. The router resolves intent and the journeys carry multi-step
   sequencing, evidence order, recovery, and approval boundaries; one-command aliases would
   duplicate the CLI and make the skill layer another shallow menu.
3. **SPEC.md answers "where is the project" wrongly.** Line 3 reads `Status: draft v1` while
   V1–V5.5 is implemented and 60 features are accepted. A reader concludes the project just
   started.
4. **Artifact ownership needs an explicit contract.** The layout cleanup is useful, but directory
   counts are not a user-success metric and a large migration in a dirty worktree is not a P0
   release gate. Lifecycle placement is P0; mechanical root/docs/output migration is P2-04.

No capability is missing. This feature re-tunes discovery and placement only.

## Solution

Four changes, no new subsystem, no execution capability, no LLM routing.

1. **P0-1 — Default CLI fallback projects seven verbs.** Re-tier `TIER_BY_COMMAND` so
   `DEFAULT_COMMANDS` (journey + core) is exactly `audit, init, doctor, next, plan, handoff,
   session`. Every other currently-`core` command becomes `expert` (visible only under `--all`,
   still fully callable, each keeping `amber <command> --help`). `usage()` gains a
   product-positioning header line and a pointer to `--all`, and stays ≤ 25 lines.
2. **P0-2 — Canonical Agent-native skill topology.** Keep exactly one `skills/amber` router and
   the four deep journeys (`amber-delivery`, `amber-diagnosis-adoption`,
   `amber-context-continuity`, `amber-continuous-improvement`). Do not add one-command aliases
   (`amber-start`, `amber-check`, or `amber-done`) as canonical skills. The router owns intent
   handoff/no-match recovery; deep journeys own process depth. `npm run gen:agents` regenerates
   host projections and `gen:agents:check` guards them.
3. **P0-3 — SPEC.md status header.** Three lines at the top answering where the project is:
   V1–V5.5 implemented; §4 command list superseded by `docs/CLI_REFERENCE.md`; §11 roadmap is
   historical. Body untouched.
4. **P0-4 — Artifact lifecycle and consumer independence.** Canonical documents, source skills,
   generated host projections, runtime state, scratch output, and promoted evidence each have one
   owner and placement rule. The packaged surface must run without any optional third-party skill
   pack. Mechanical directory moves are explicitly deferred to P2-04 and are not required for
   F063 acceptance.
5. **P0-5 — Product vocabulary boundary.** Product source, tests, active documentation, generated
   host projections, and new commit subjects use Amber-native vocabulary only. Development-time
   research may inform decisions, but external tool, author, and vendor identifiers stay outside
   the versionable product surface. Existing Git history is immutable and is not rewritten.

## User Stories

- As a **new user**, I run `amber --help` and see seven verbs with one line each of what they do;
  I can reach everything else through `--all` without being told it exists first.
- As an **Agent user**, I can invoke the `amber` router without first learning the CLI; it sends
  my intent to one of four process-bearing journeys, while the seven CLI verbs remain available
  as deterministic fallback commands.
- As a **reader of SPEC.md**, the third line tells me the project's real maturity and where the
  live command list lives.
- As a **contributor**, every artifact class has one documented lifecycle home; new temporary or
  vendor-specific output does not enter the repository root, while historical bulk moves remain
  a separately planned P2-04 migration.

## Implementation Decisions

| # | Decision | Rationale (traced to the review) |
| --- | --- | --- |
| 1 | Seven default verbs: `audit, init, doctor, next, plan, handoff, session` | Review §5 P0-1 verb list, verbatim. `session` carries the governed-work journey; `next` is the deterministic router (ADR-0014) that already projects the next safe step. |
| 2 | Demote-to-`expert` (not removal, not a new tier) | F019's contract: hidden commands remain callable with `--help`; the tier set `core/journey/deprecated/expert` is frozen and parity-tested (`command-registry-parity.test.js`). A new tier would break the frozen vocabulary for no benefit. |
| 3 | `usage()` adds a one-line product statement + `--all` pointer; ≤ 25 lines total | Review acceptance "输出不超过一屏". The statement matches `docs/wiki/product/overview.md`'s one-sentence value. |
| 4 | Canonical skills are exactly one router plus four deep journeys | The approved product map rejects one-command aliases as duplicate CLI menus. The router and journeys remain the host-neutral, process-bearing surface. |
| 5 | Seven verbs remain the CLI fallback/help projection | Agents should enter through the router/MCP surface; operators retain deterministic `audit, init, doctor, next, plan, handoff, session` commands for debugging and no-plugin environments. |
| 6 | SPEC.md gets a status header, body untouched | Review P0-3: "不重写正文". Three lines. `docs-boundary` tests that reference SPEC.md keep passing because the file stays at the root (it is a product-repo classification signal for `target-classification.js`). |
| 7 | Bulk directory migration is P2-04 | Directory counts and root Markdown budgets are maintenance signals, not P0 product acceptance. Any future move requires a clean worktree, a migration plan, reference graph check, and corpus regeneration. |
| 8 | Lifecycle placement rules are normative now | `docs/agents/dev-workflow.md` may define the rules, but F063 must not require moving every historical artifact to satisfy a line-count target. |
| 9 | Packaged-surface independence is a release gate | Scan the actual `npm pack --dry-run --json --ignore-scripts` file list; package/host manifests and canonical skills must contain no required optional third-party dependency. |
| 10 | Product vocabulary is Amber-native | Scan versionable product files and paths; reject external tool, author, and vendor identifiers. New commit subjects must use Amber-native wording; existing history is preserved. |

### Scope boundaries (measured against the review)

- **P1-1 (gate context-manifest suggestions)**, P1-2 (feature paths backfill), P1-3 (README two
  audiences), P1-4 (journeys 2–4 dogfood), P2-1…P2-3 are **out of scope** for F063. The review
  itself stages them: P0 is "不做这些，形态继续丢"; P1/P2 are separate work items. P2-3
  (UBIQUITOUS_LANGUAGE.md deletion) is additionally blocked by its own preconditions
  (grep-clean references).
- Wiki changes land only where the review's §8 already placed content (`overview.md`,
  `user-scenarios.md`, `feature-map.md` are already written; F063 does not rewrite them).
- No command is removed, renamed, or given a new subcommand. No schema changes. No MCP surface
  changes. The tier registry is data re-tuning, not mechanism.

## Normative Contracts

### N1 — Default CLI visibility set

`DEFAULT_COMMANDS` MUST equal, in order, `["audit", "init", "doctor", "next", "plan", "handoff",
"session"]`. The parity test's invariant (`DEFAULT_COMMANDS == COMMANDS.filter(tier in
{journey,core})`) MUST hold unchanged — the implementation is a `TIER_BY_COMMAND` re-tune, not a
special case. `--all` MUST project every registered command (`COMMANDS.length`, currently 54),
and tests MUST derive the expected count from the registry rather than hard-code the historical
38. Every demoted command MUST remain dispatchable and keep its `--help`.

### N2 — Canonical Agent-native skills

The canonical source set MUST contain exactly one router (`skills/amber/SKILL.md`) and the four
deep journeys. Each deep journey must retain multi-step process value (multiple Amber primitives,
failure recovery, evidence ordering, or approval boundaries). One-command aliases are not
canonical F063 skills; if an operator wants a short command, use CLI/help projection. Generated
outputs in `.claude/`, `.gemini/`, and `.agents/` are projections only and must be regenerated.

### N3 — SPEC.md status header

A status block of at most five lines at the top of SPEC.md stating: implementation status
V1–V5.5; §4's command list is superseded by `docs/CLI_REFERENCE.md`; §11's roadmap is historical.
No other semantic edits are allowed; neutralizing a forbidden external identifier is allowed only
when it preserves the contract and meaning of the surrounding text.

### N4 — Artifact lifecycle invariants

Canonical product/architecture content, canonical skill sources, generated host projections,
runtime governance state, temporary/external output, and promoted quality evidence each MUST have
one documented home. Product source, tests, active docs, generated projections, and product paths
MUST use Amber-native vocabulary and MUST NOT contain external tool, author, or vendor identifiers.
New temporary or vendor-named files MUST not be added at the repository root; directory counts and
`.gitignore` line counts are maintenance signals, not F063 release gates.

### N4.1 — Deferred P2-04 layout migration

Bulk moves from the review remain planned as P2-04. `ROADMAP.md`, `PRODUCT.md`, and
`UBIQUITOUS_LANGUAGE.md` stay where current consumers expect them until dedicated tickets prove
the reference and classification impact. Existing staged moves are historical/worktree state and
must not be treated as proof that F063's P0 product contract is complete.

### N5 — Reference integrity after moves

Every tracked move updates referencing files (CLAUDE.md, README.md, README.zh-CN.md, CHANGELOG
entries are history and stay; tests that pin paths — `legacy-references.test.js` allowlist,
`target-classification.js` product-repo signature — are updated so the moved files stay
reachable). Historical ADRs and corpus pages that cite pre-move locations keep their text
(immutable history) — the corpus manifest is regenerated so live paths resolve.

### N6 — Consumer and package independence

The installable package, canonical skills, generated host manifests, and runtime code MUST NOT
require an optional third-party skill pack. The independence gate scans the actual `npm pack
--dry-run --json --ignore-scripts` file list, checks package/host manifests, and verifies canonical
skills invoke only Amber command IDs or typed MCP tools.

### N7 — Product vocabulary boundary

The versionable product surface includes source, tests, active documentation, generated host
projections, package metadata, and product paths. Those files MUST NOT contain external tool,
author, vendor, or optional-skill identifiers. Development-time research is kept out of that
surface or rewritten as a neutral, independently authored summary. Existing Git commit subjects
are historical evidence and MUST NOT be rewritten; future commit subjects MUST use Amber-native
wording.

## Tickets

- **T1 — Seven-verb default help** (no blockers): `TIER_BY_COMMAND` re-tune, `usage()` header +
  `--all` pointer, parity/help tests updated, CLI_REFERENCE intro paragraph updated, AGENTS.md
  "Core commands" section re-projected around the seven verbs.
- **T2 — Agent-native skills** (depends on T1 only for CLI/help wording): preserve one router and
  four deep journeys; no one-command alias skills; generated host projections and F031 lockstep
  expectations remain verified.
- **T3 — SPEC.md status header** (no blockers): the three-line header; `docs-boundary`-adjacent
  tests verified green.
- **T4 — Artifact contract** (no blockers): adopt lifecycle placement rules and the package
  independence gate. Bulk root/docs/output migration is deferred to P2-04 and tracked separately.
- **T5 — Landing** (blocked by T1–T4): feature_list registration with evidence, evolution-log
  entry, learnings review booked, handoff regenerated.

T3 may proceed in parallel with T1 at any time; T4 is independent but sequenced last so the
review's per-move reference updates ride one atomic, inspectable change set.

## Testing Decisions

| Case | Layer | Traces to |
| --- | --- | --- |
| `DEFAULT_COMMANDS` equals the seven verbs in order; parity invariant still derives it from tiers | unit `command-registry-parity` | N1, decision 1–2 |
| Demoted commands: dispatchable, `--help` intact, listed under `--all` | unit + integration | N1 |
| `amber --help` output ≤ 25 lines and contains the `--all` pointer; `--all` count equals `COMMANDS.length` (currently 54) | integration (spawn `scripts/amber.js`) | decision 3 |
| Exactly one router plus four deep journeys; no one-command alias is required; generated outputs are current | unit `agent-commands` + `gen:agents:check` | N2, decision 4–5 |
| Router and journeys retain process/recovery value; canonical sources are the only editable skill files | unit `agent-commands` | N2 |
| SPEC.md top answers status; body length unchanged apart from header | unit docs-anchored test | N3 |
| Lifecycle homes are explicit; no new root temporary/vendor artifacts | unit placement-invariant test | N4 |
| Packaged surface has no required optional third-party skill dependency; canonical skills call only Amber commands/MCP tools | packaged-surface independence gate | N6 |
| Product source, tests, active docs, generated projections, and paths contain no external identifiers | `external-reference-ip-hygiene` | N7 |
| Knowledge graph anchors remain valid when a future P2-04 move is attempted; corpus regenerated | integration `knowledge graph --json` | N5/P2-04 |
| legacy-references / target-classification / doctor-remedy suites green after path updates | existing suites, edited only where they pin moved paths | N5 |

Standard gates per ticket: `npm test` (full log written to disk and read whole), `npm run
manifests`, `npm run doctor`, `npm run gen:agents:check`; wiki changes add
`node scripts/validate-wiki.js --target .`.

## Out of Scope

- Review P1-1/P1-2/P1-3/P1-4 and P2-1/P2-2/P2-3 (staged separately by the review itself).
- Any command removal, renaming, or new subcommands; any schema or MCP surface change.
- The docs site (issues/0012–0024 line) — publishes from the consolidated tree later.
- Web viewer changes (apps/web untouched).
- Compressing CONTEXT.md vocabulary (P2-1) or moving PRODUCT.md (P2-2) — separate tickets.

## Further Notes

- The product review document (`docs/quality/product-review-2026-09-02.md`) and its three wiki
  siblings are **input provenance**, already on disk; F063 implements, it does not re-litigate
  the review.
- The review's §7 reader analysis explicitly frames this as "分发与入口设计问题，不是架构问题"
  — which is why the entire feature is data re-tuning, docs, and moves; no architectural seam
  changes.
- `session` stays in the default seven because the product's unit of governed work is a session;
  hiding it would hide the audit trail entry point the one-sentence value proposition sells.
