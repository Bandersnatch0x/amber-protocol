# Changelog

All notable changes to Amber Protocol will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-09-29

### Added

- docs-a11y: bring the light theme to axe serious/critical = 0 (issues/0157)
- docs-verify: implement 0020 Layer-1 rows 7 & 10 as real browser gates (issues/0063)
- docs-verify: make 0020 Layer-1 rows 8 & 9 real mechanical gates (issues/0063)
- governance: migrate continuous-improvement live state to .amber/ (issues/0156, closes 0153 D1)
- governance: structured governance ledger — schema, chain-hashed jsonl, gate (issues/0155)
- harness: own governed-execution handles and cancel truthfully (F081)
- harness: deliver the bounded H7 maintenance runtime (F080)
- harness: make execution terminate an explicit refusal (F078)
- harness: bind canonical eval results to validation receipts (F077)
- harness: land §52 legacy dispositions + H5-lineage cross-run diff (F075, F076)
- harness: land H6 control plane — five read-only subverbs over the shared core (F074)
- harness: land H5 eval & replay — ValidationReceipt, drift detection, regression proposals (F073)
- harness: land H4 runtime lifecycle — first-class attempts, run-scoped checkpoints, the unified lifecycle view (F072)
- harness: wire the firewall verdict into the real context load — grants cited, denials excluded (F071 H3b)
- harness: land H2b governed-runner wiring — prepared workspaces, per-mutation observation, growing fold (F070)
- harness: land H3a context grants, the deterministic report-first firewall check, and context events (F069)
- harness: land H2a execution contracts, boundary adapters, and comparable three-boundary records (F068)
- harness: land H1 tool declarations, report-only checks, and run tool snapshots (F067)
- harness: admit runs from real loop approvals and bind real outcomes (F066)
- governance: measure the contract registry, validate it, and expose it as a command
- governance: rebuild the distributed-governance contract registry
- harness: land Harness H0 (Contract, Run, Event) behind an expert-tier CLI
- governance: measure the contract registry, validate it, and expose it as a command
- governance: rebuild the distributed-governance contract registry
- docs: preserve the in-flight public documentation site under apps/docs
- F064: accept Improvement Suggestions and record verification evidence
- governance: complete the spec-completeness residuals (audit follow-up)
- trusted-control: implement governance contract slices G-1..G-11 (B10)
- trusted-control: implement context-runtime Slice E — Research adapter (B9-E)
- trusted-control: implement context/runtime contract slices A-D, F-G (B9)
- trusted-control: implement run contract slices 1-7 (B8)
- trusted-control: land tickets 0044-0060 packet
- F063: land product closeout surface with Trusted Continuation home
- upper-shell: MVP agent loop consuming Amber MCP (S1-S7)
- F064: improvement suggestions from host transcript friction
- F063: close the default product surface
- add optional F049/F050 doctor integrity checks
- F062 route stage verbs and named governed commands (ADR-0029)
- docs: replace generic floral background with 3D Amber crystal and resin particles
- docs: integrate AMBER // PROTOCOL full-screen hero and dynamic data flow card
- docs: implement public documentation site and verification seam (ticket 0024)
- knowledge: read-time document index with three planes (0009)
- core: chainWording as a closed factory extension (#307)
- core: preLink hook and per-ledger ceiling wording as closed factory extensions (#306)
- core: register F061 as passing with landing evidence (F061 T4)
- core: add the defineLedgerFamily factory skeleton (#299)
- knowledge: register F060 as passing with landing evidence (F060 P5)
- knowledge: folded-by-default map with per-feature expansion, shared-foundation super-node, pierce search, and analytics surfacing (F060 P4)
- knowledge: deterministic read-time analytics — per-layer p99 god nodes, Louvain communities, two anomaly detectors (F060 P2)
- knowledge: admit schema v2 through the web seam; the LLM layer stays document-scale (F060 P3a)
- knowledge: schema v2 code layer — Code Nodes, imports/anchors verbs, deterministic TS extraction (F060 P1)
- mcp: close full-scope review finding SP-2 — surface external/breakglass as approval-required
- artifact: close full-scope review finding SP-1 — reject secrets before canonical storage
- breakglass: no-force semantics, MCP non-execution & boundary integrity for F057 #295
- breakglass: outcome settlement linkage & mandatory post-review for F057 #294
- breakglass: atomic one-use consumption bound to the underlying admission for F057 #293
- breakglass: grant registry with human-only emergency authorization for F057 #292
- external: compensation effects, MCP non-execution & transport isolation for F056 #291
- external: adapter execution, settlement & credential boundary for F056 #290
- external: request proposals & drift-bound authorization for F056 #289
- external: effect contract registry with pinned Adapter contracts for F056 #288
- retention: coordinated settlement, Deletion Proof & tombstones for F055 #286
- retention: deletion candidates, Holder registry & bounded approval for F055 #285
- retention: Legal Hold registry with human-only lifecycle for F055 #284
- retention: governed retention classes & deterministic expiry for F055 #283
- maintain: staleness, Eval write-back & deterministic rollups for F054 #282
- maintain: owner triage & governed Intent re-entry for F054 #281
- maintain: Trigger Proposals with cooldown dedup for F054 #280
- maintain: Control Band detectors & deterministic Findings for F054 #279
- release: receipts, status projection & MCP boundary for F053 #277
- release: deployment & rollback execution binding for F053 #276
- release: staging & production authorization for F053 #275
- release: release candidate preparation for F053 #274
- runner: execution settlement, receipts & assurance separation for F052 #258
- runner: environment profiles & boundaries for F052 #257
- web: warn before an unfocused question overflows the QA context (F059 #267)
- runner: execution requests & policy-derived risk for F052 #256
- runner: controlled Runner & capability registry for F052 #255
- adapter: explicit cutover and rollback for F051 #236
- adapter: add shadow comparison coverage
- adapter: add explicit migration candidate states
- knowledge: unify graph through context projection (F059 #253)
- eval: scan QA contract surface for model independence (F059 #252)
- knowledge: add cited QA over deterministic graph (F059 #251)
- adapter: add read-only Adapter registry for F051 #233
- strict-query: add staleness receipts and strict projection reads for F050 #231
- knowledge: add read-time semantic layer (F059 #250)
- eval: admit canonical Eval artifacts for F050 #232
- knowledge: add recent drift feed with real links (F059 #249)
- knowledge: wire web map to live graph data (F059 #248)
- policy: add deny-wins policy evaluation for F050 #230
- knowledge: deterministic knowledge-graph parser + `knowledge graph` CLI (F059 #247)
- gates: add Gate Contracts and deterministic evaluation for F050 #228
- web: knowledge map round-2 — real-data fixture, local jump links, context graph (#240)
- approval: add Approval records with atomic consumption for F050 #229
- web: knowledge map prototype — #238 DTO fixture, force layout, drift panel (#240)
- web: redesign app shell — amber-gold accent, obsidian dark theme, command palette
- evidence: add Evidence receipts and Assurance levels for F050 #227
- governance: add Principal registry and Decision artifacts for F050 #226
- artifacts: add version negotiation, extension namespaces, and resource ceilings for F049 #223
- eval: add instruction-surface Eval suite (F058 #224)
- artifacts: governance graph projection of artifact revisions for F049 #222
- artifacts: fail-closed integrity hardening for F049 #221
- artifacts: add Spec/Plan types and typed trace lineage for F049 #220
- artifacts: add compare-and-swap and idempotent admission for F049 #219
- add Intent admission tracer bullet for Canonical Planning Artifacts
- hooks: close the apps/web pre-commit prettier coverage gap (F048)
- governance: accept F048 prettier pre-commit coverage fix
- web: upgrade apps/web build chain (F046, issue #207 batch 4)
- web: upgrade apps/web to React 19 (F045, issue #207 batch 3)
- web: upgrade apps/web to tRPC 11 and TanStack Query 5 (F044, issue #207 batch 2)
- web: upgrade apps/web eslint to 10 with a flat config (F043, issue #207 batch 1)
- sync: governed local commit for sync transport, ADR-0020 Stage A (F041)
- sync: publish the transport report as a structured schema-governed contract (F040)
- cli: add defineCommand and migrate hooks to it (F039 S1)
- state: add statePath/statePathForCreate path verbs to the resolver
- governance: fixture runner exercises deployment profiles + adversarial refusal (issue #160)
- nightly: host scenario with machine-judge Governance Console (issue #129) (#198)
- phase: Phase 0-4 gate evidence, promotion, rollback harness (issue #168) (#197)
- viz: Visualization Workbench projections (issue #164) (#196)
- audit: Organization Profile audit + policy tracer (issue #167) (#195)
- knowledge: Governed Knowledge Base lifecycle (issue #163) (#194)
- graph: Governance Graph projection + query contract + read receipts (issue #162) (#193)
- sync: conflict preservation + idempotent replay (issue #165) (#191)
- projection: rebuildable read-only projections (Stage 4) (#189)
- sync: sync session orchestration — pull/validate/push pipeline (Stage 3) (#188)
- sync: envelope pack/unpack/compat/validate — Team Hub transport (Stage 3) (#187)
- profile: amber profile deployment — Personal Node profile (Stage 2) (#186)
- identity: hybrid Personal Node identity bootstrap (ADR-0019 D4) (#185)
- governance: Stage 1 ADR amendments + sync envelope + structural identity schemas (#184)
- fixtures: team-hub + organization deployment profile tracers (#160 M2) (#182)
- fixtures: runner integration + full fixture family (#160 M1) (#181)
- fixtures: deterministic governance fixture family M0 (#160) (#160)
- e2e: promote governance-loop verify to a failing command (#178)
- memory: F034 T1/T2 write-back trigger mounting — nomination contracts at completion and accept
- memory: F033 Governed Memory Layer batch A — five-verb surface, registry, doctor rules
- web: live activity feed for running sessions
- web: complete governance closure, transcript timeline & format gate
- learnings: add durable owner routing
- planning: role-scoped context manifests and a memory usage creed (F027)
- governance: finish-time dirty-path classification and scope-discipline review checks (F026)
- break-loop: post-mortem scaffold for recurring defect classes (F025)
- learnings: add post-accept learning write-back checkpoint (F023)
- hooks: add opt-in per-turn workflow-state breadcrumb (F022)

### Fixed

- web: re-anchor the home-visual contract to the renamed console title
- knowledge: re-sync the corpus from LF line endings
- harness: read a defunct pid as gone, not alive
- tests: scope the Scenario-1 seam test to Scenario 1 (the root test job has no build)
- tests: restore the temp-fixture ownership migration (temp-leak-fix re-application)
- harness: address the independent review of 3425a1c (F081 round-6 findings)
- harness: require cancellation-record binding fields and check them unconditionally (F081 round-5 P1)
- harness: verify cancellation records before citing them (F081 round-4 P1)
- harness: make cancellation settle without the volatile handle and never delete a winner's record (F081 round-3 P1s)
- harness: make a stranded cancellation request settleable (F081 review P1)
- harness: close the four code-review findings (F081 cancellation + test-runner temp ownership)
- docs: reconcile landing CSS, define command-block tokens, fix theme/footer/nature; add integrity gates (issues/0063, 0157)
- cli: complete the agent/team/adoption removal on the surfaces the review found (issues/0068)
- tests: sweep leaked amber-* fixture dirs from Temp after each run
- harness: contracts list re-hashes records and flags tombstones (T3 — aligned with the F067 tool-list semantics)
- governance: accepted-state short-circuit for next, git-narrative handoff, unified confirmation evidence (J7)
- decide plan recency from the evolution log, not file mtimes
- stop same-millisecond Propose runs overwriting a proposal record
- governance: drop the duplicated apps/web/output ignore rule
- docs: stop publishing an external framework name in the C-layer deny list
- docs: make the search gate and the install page tell the truth
- docs: give the first governed workflow a step 4 that can succeed
- docs: assert the boundary claim, not a sentence
- governance: root-anchor the personal-state ignore patterns
- docs: accept the CommandBlock nature values the pages actually use
- docs: restore the pages the gitignore rules were silently swallowing
- lint: drop the dead gitExec require from the scaffold git adapter
- validity: refuse the Windows registry alias on every platform
- web: accept the CLI blocked status and the 11 governed-run event types
- format: restore prettier across the web viewer sources
- lint: repair no-useless-assignment errors and restore prettier formatting
- trusted-control: close out 0044-0060 follow-up backlog (B7)
- e2e: use hex-valid completed fixture session id
- ts7: adapt code-graph for TypeScript 7.0.2 classic-API split
- restore legacy session lookup, AGENTS.md verb literals, knowledge corpus
- F062: harden session identity boundaries
- web-e2e: reinject F001/F007 standing dead anchors for knowledge map
- CI regressions from aa82509 — duplicate flag key, drift-dependent web test
- configurable verification budget for session verify --execute (#315)
- F062 compliance-audit fixes — settle hardening, lease reacquisition, web verb guard
- knowledge: rank search planes by scarcity so --limit shows them (0009)
- cli: scope the profile deprecation to its legacy inspect surface (#273)
- core: rename profile gate labels to declared-valid semantics (#273)
- tests: pass root-relative test paths so worktree runs survive the Windows 32K spawn limit
- mcp: admit external/breakglass into the action-type command enum
- breakglass: close full-scope review findings SP-3/SP-5 — release join proof and injected clocks
- retention: close full-scope review findings CP-1/CP-2 — tombstone reads fail closed
- knowledge: admit ADR-0026 and ADR-0027 into the corpus census (46 rows)
- core: close acceptance-review finding S3 — leak-check maintain/retention free text
- breakglass: close acceptance-review findings P7/P8 for F057
- external: close acceptance-review findings P5/P6b for F056
- retention: close acceptance-review findings P4/P6a for F055
- maintain: close acceptance-review findings P1/P2/P3/P9 for F054
- knowledge: close 0007 two-axis review findings on the census single source
- knowledge: the committed manifest becomes the census's single source of truth (0007)
- knowledge: admit ADR-0025 into the corpus census (44 rows)
- knowledge: close the review's three gaps in the #267 batch
- profile: close review findings for the compliance fix batch (#268)
- lint: clear pre-existing repo-lint errors blocking commits
- web: status dots, cobalt accent, tooltip copy and dead code in the map (F059 #267)
- lint: clear the two errors blocking the repo-wide lint gate
- knowledge: cite the line that names the target, keep every declaring site, digest by byte order (F059 #267)
- phase: align the profile gate with the profile validator (#270)
- profile: fail closed on malformed deployment profile declarations (#269)
- web: stop the layered layout from stacking layers, and cover the geometry (F059 #267)
- web: make the typecheck gate real and clear the 46 errors it was hiding
- web: P0 correctness batch for the knowledge map (F059 #267)
- web: re-anchor home-visual contracts to the obsidian shell (F059 #254)
- features: correct F059 evidence drift attribution note (F059 #254)
- web: seed committed knowledge corpus into the e2e fixture root (F059 #254)
- web: route knowledge surfaces through the web-adapter seam (F059 #253)
- knowledge: allowlist committed corpus in IP-hygiene scan (F059 #253)
- knowledge: fix git-archive test extraction on Windows (F059 #253)
- knowledge: restore projection/tree parity on clean archive (F059 #253)
- knowledge: close T7 review findings (F059 #253)
- eval: close QA scan review findings (F059 #252)
- knowledge: close T5 review findings (F059 #251)
- adapter: close F051 #233 review findings
- strict-query: close F050 #231 review findings
- knowledge: close T4 review findings (F059 #250)
- eval: close F050 #232 review findings
- knowledge: close T3 review findings (F059 #249)
- policy: close F050 #230 review findings
- knowledge: close T2 review findings (F059 #248)
- knowledge: preserve parallel F050 shared-file state
- knowledge: resolve T1 review findings F-1..F-6 (F059 #247)
- gates: align version comparator registry semantics
- gates: close F050 #228 review findings
- approval: close F050 #229 review findings — dominating ceiling probe, window contract, fold fixtures
- web: two-axis review fixes for knowledge map prototype (#240)
- evidence: close F050 #227 review findings — nested-hash chain, null seam, verify idempotency
- governance: close F050 #226 review findings — registry lock, hash chain, scope, docs
- eval: close F058 grill/review findings — scan counts, model-independence regex, registry failure handling (#224)
- artifacts: close F049 full-review findings — identity case policy, verification scope, I/O classification, golden vector
- artifacts: close F049 #222 review findings — canonical determinism of projection output and recovery docs
- artifacts: close F049 #220 review findings — commit contracts module, body-half fail-closed, empty-type and trailing-target guards
- artifacts: close F049 #218 review findings F1/F2/F4 — envelope hash verification, dot-identity guard, docs
- hooks: complete F048 review fixes — catch-all web glob, metadata, guard test
- web: re-anchor the dark-palette E2E contract to rendered sRGB channels
- cli: fail loudly when the typed-mutation seam blocks a command
- state: read sessions surfaces through the state-dir resolver (F036 S1)
- catalog: register seven legacy error codes in the error catalog
- catalog: register F035 ledger-corruption codes in the error catalog
- sync: make transport preparation report-only (F035 S4)
- sync: admit envelopes against structural identity (F035 S3)
- web: remove resting shadow-sm from gate inputs (F035 S6)
- knowledge: fail closed on corrupt ledgers with typed errors (F035 S5)
- sync: make sync-envelope schema the single structural validator (F035 S2)
- sync: enforce canonical artifact paths and admission allowlist (F035 S1)
- review: close remaining judgement findings from second-pass review
- review: close second-pass two-axis findings on refactor range
- tests: harden amber-mcp RPC driver against full-suite load flakes
- ci: accept GitHub squash-merge author in identity gate
- governance: close two-axis review findings since v1.6.0
- mcp: remove dangling context/load capability registration (#179)
- cli: send default bypass diagnostics to stderr
- mcp: close spec 15.1 context/load dangling registration
- web: scope the Live badge E2E assertion to the badge element
- web: kill the whole process group on budget timeouts; pin prettier to match CI resolution
- keep approval gates distinct from session completion
- clarify no-trigger learning review wording
- plugin: use host-compatible skill paths
- ci: validate GitHub merge commit identities safely
- claude-settings: repair the breadcrumb hook entry to the loadable matcher+hooks shape
- governance: dogfood friction batch #118/#119/#121 (F024)

### Changed

- **BREAKING** cli: remove the agent, team, and adoption command families (issues/0068)
- packages: check out full history so the provenance suite can run
- plans: bring the F081 plan up to the plan contract so it can be accepted (F081)
- quality: promote the 0020 Layer-2 trial protocol and add a pilot intake brief (issues/0062, 0137)
- docs: lock narrow-screen section navigation (issues/0063 O7)
- search: prefer the matched heading path on suggestions (issues/0063 O5)
- site: reconcile the two 5-step lifecycle models (issues/0063 R3)
- docs: clear remaining UI/UX review items R6/O1/O6/O8 + stabilize the a11y gate (issues/0063)
- docs: clear UI/UX review Optional/Nit findings (issues/0063)
- docs-a11y: harden the browser gate — baseUrl + badge coverage (issues/0063, 0157)
- review: address two-axis review findings (issues/0063, 0156)
- specs: materialize the Public Documentation Site spec as a docs/specs file (issues/0024)
- wiki: make glossary.md a local summary pointing at CONTEXT.md (issues/0152)
- governance: settle physical-boundary dispositions D2-D5; defer the .workflow live-state move (issues/0153)
- governance: drop the banned 'coding-harness' literal from a comment (issues/0155 follow-up)
- spec: record the owner's early-execution waiver and HITL basis for the removal (issues/0068)
- spec: record the two-axis verification of the removal completeness clause (issues/0068)
- governance: sync branch-protection fact in governance contract (issues/0154)
- governance: record confirmed master branch protection (issues/0154 item 4)
- governance: land the adjudicated documentation governance contract, owner routes, and rule precedence (issues/0151, 0154)
- sources: one canonical knowledge plan, a corpus freshness gate, and a registry-option gate for the CLI reference (issues/0150)
- docs: make the wiki gate real and the doctor cover the product-repo wiki (issues/0149)
- quality: record the T5 continuation measurement (issues/0141 stream)
- policy: diagnose the pre-migration provenance prerequisite (issues/0140)
- reference: document the phase command; guard top-level coverage (issues/0139)
- product: correct the pilot's status after publishing
- reference: document the F072-F081 harness surface; guard it (issues/0138)
- product: add the external pilot protocol (issues/0137)
- web: bound the vitest test timeout explicitly (issues/0136)
- agents: require delivery evidence at stage 7; align the console title (F082 follow-up)
- product: flip the first screen to Governed Agent Harness (F082)
- governance: authorize bounded H7 maintenance runtime (F079)
- harness: graduate H6 — the F074 control-plane spec (accepted via 0120) and plan
- harness: graduate H5 — the F073 eval & replay spec (accepted via 0115) and plan
- harness: graduate H4 — the F072 runtime-lifecycle spec (accepted via 0110) and plan
- harness: graduate H3b — the F071 firewall verdict wiring spec (accepted via 0105) and plan
- harness: graduate H2b — the F070 governed-runner wiring spec (accepted via 0100) and plan
- quality: fix the three remaining T4 review candidates as protocol upgrades — inclusive commit-count notation, successor must execute one read-only action from T5, judge-input/recorder-note separation
- quality: adjudicate the T4 dual-axis review — 7 in-place fixes (T0 denominator note, residual-artifact cell, TTC sample rationale, Activation bookkeeping, goals-calibration disambiguation), 3 disclosed as candidates
- quality: record T4 — 4/4 pass at high confidence, judged by an independent judge agent (month 4-attempt acceptance complete)
- quality: record T3 — 4/4 pass at high confidence (Recent commits as the leading narrative)
- quality: record T2 — the first passing dogfood continuation (4/4 after the J7 fixes)
- quality: record T1 — the first counted dogfood continuation attempt (2/4, new failure facets)
- docs: regenerate the public CLI reference for F069
- harness: accept the F069 context-firewall spec
- harness: graduate H3a (F069 context-firewall spec draft; tickets 0093-0098)
- harness: accept the F068 execution-boundary spec
- docs: regenerate the public CLI reference for F068
- harness: graduate H2a (F068 execution-boundary spec draft; tickets 0087-0092)
- docs: regenerate the public CLI reference for F067
- harness: accept the F067 tool/capability boundary spec
- harness: graduate H1 (F067 tool/capability boundary spec draft; tickets 0081-0086)
- docs: regenerate the public CLI reference for F066
- harness: accept the F066 vertical-slice spec
- agents: require delivery evidence before closing an issue as complete
- harness: graduate the F066 vertical slice (spec draft; tickets 0075-0080)
- docs: regenerate the knowledge corpus and CLI reference for F065; accept F065
- harness: decide Harness H0 via ADR-0100/0101/0102 and accept the F065 spec
- quality: record the continuation dry-run ledger (T0 2/4)
- agents: require delivery evidence before closing an issue as complete
- governance: accept the four trusted-control packet plans
- remove orphaned amber-protocol-cover.png
- let the image helper audit a committed re-encode
- losslessly re-compress tracked PNG assets
- add a lossless image re-compression helper
- docs: regenerate the CLI reference after master brought new commands
- docs: skip the seam in jobs that have no site build
- docs: regenerate the CLI reference after merging master
- ci: format the docs job change in ci.yml
- lint: drop the unused RULES_DERIVER_BLOCK import (the block was removed when the rules deriver was unblocked)
- readme: prettier formatting for the positioning-drift fixes
- readme: close the positioning drift named by the secondary audit
- deps: bump prettier
- memory: book the repaired f043 eslint-dependency lesson (user-directed)
- memory: book the context-runtime and governance T1 lessons (B9/B10)
- memory: book two T1 write-back entries (B7/B8 lessons)
- governance: land G-9 row 11 — governed-runner worktree split
- skills: add validate-amber-setup host-side validation helper
- agents: record spec source migration provenance index
- agents: record F013-F014 historical provenance recovery
- deps: batch minor and patch updates within declared ranges
- ignore .codex/ local tool state
- anonymize external eval tool mentions in charter
- prettier-format README homepage tables
- restore loop recommend expert path on EN README homepage
- add Team Replication Layer charter and converge README homepages
- raise spawnSync maxBuffer for knowledge graph CLI output
- deps: bump lint-staged from 16.4.0 to 17.4.1
- deps: bump globals in the npm-minor-and-patch group
- clean up fixture temp dirs at exit; unpin corpus counts
- prettier doctor-f049-artifacts-health test
- CI hygiene — prettier format:check + fast-uri audit bump (#314)
- F062 lifecycle closeout — accept into the evolution log
- fetch full history for the jobs that run the whole test suite
- context: use underscore emphasis in the Governed Memory term
- adr: align ADR-0020 record vocabulary with the implementation (#296)
- dsh-bundle: budget npm pack as a hang guard, not a perf assertion (#302)
- context: add the Governed Memory and Knowledge Graph terms (0011)
- knowledge: fold the binary probe into the content read (0009 review)
- drop stray NUL bytes from the knowledge-index sort key
- feature: record F061 follow-up migration landing evidence
- feature: record F061 follow-up migration landing evidence
- wiki: correct stale schema-validation-layer and graph verb surface (0010 closeout)
- harden F061 golden fixture evidence
- wiki: add genuine declarer references to isolated knowledge pages
- core: assemble the policy outcome ledger through defineLedgerFamily (#313)
- deps: bump web globals to 17
- deps: regenerate routeTree with updated router-plugin import ordering
- deps: update web dependencies and pin graphology-types
- remove unused imports and destructures flagged by eslint
- track the machine-maintained context index and ignore web output artifacts
- fix prettier formatting in principal-ledger-bytes test and KnowledgeMapPage
- core: assemble the gate outcome ledger through defineLedgerFamily (#312)
- core: assemble the release ledgers through defineLedgerFamily (#311)
- core: assemble the runner ledgers through defineLedgerFamily (#310)
- core: assemble the adapter ledgers through defineLedgerFamily (#309)
- core: assemble the evidence ledger through defineLedgerFamily (#308)
- core: assemble the approval registry through defineLedgerFamily (#307)
- core: assemble the principal registry through defineLedgerFamily (#306)
- adr: ADR-0028 amendment — preLink hook and ceiling wording as closed extensions (#306 re-open ruling)
- core: assemble the retention ledgers through defineLedgerFamily (#305)
- core: assemble the maintain ledgers through defineLedgerFamily (#304)
- core: assemble the external ledgers through defineLedgerFamily (#303)
- features: accept F061 under the continued batch ruling (59/59 accepted)
- name defineLedgerFamily as the family admission path (F061 T4)
- core: assemble the breakglass ledger through defineLedgerFamily (#300)
- knowledge: admit ADR-0028 into the census count (47 rows)
- core: single-source the Decision primitives (#298)
- spec: F061 — ledger family factory & decision primitives (ADR-0028)
- features: record the F060 learning write-back review (owner: command)
- adr: precision note on the ADR-0019 D1 carrier claim (#273 deferral)
- features: accept the 21-feature batch under the standing HITL ruling
- knowledge: resync the committed corpus after the #273 doc edits (#273)
- clean up profile naming, D1 labels, ADR-0003 links, envelope vocabulary (#273)
- spec: add the deployment-profile declaration contract (#273)
- core: centralize the invalid-profile-declaration reading (#273)
- features: register F049-F057 retroactively and close out F058 as passing
- knowledge: close two-axis review findings ST-2/ST-4/ST-6 — one document-scale predicate, shared LAYER_ORDER, no dead toolchain fallback
- knowledge: real-tree population invariants for the code layer (F060 P3b)
- close full-scope review findings ST-3/ST-4 — README examples, agents map, glossary admissions
- tests: close full-scope review finding ST-9 — one harness for the four registry suites
- specs: close full-scope review findings CP-3/CP-4/SP-4 — align spec text with the shipped contracts
- core: close full-scope review findings ST-5/ST-6/ST-8/ST-2 — read-side dedup and cohesive extraction
- cli: close full-scope review findings ST-1/ST-7/ST-10/SP-6 — seam dedup round two
- core: drop unused quotedList imports left by the S1 migration
- core: close acceptance-review findings S1/S2 — one shared validator vocabulary
- format: clear the web app's two-file prettier drift blocking CI
- format: clear the three-file prettier drift failing CI's format gate
- spec: F060 — knowledge map v2, code graph & interaction upgrade
- readme: hero front page with condensed quick start; fix zh-CN drift
- meta: link npm package to GitHub and align keywords with repo topics
- agents: add dev-workflow pipeline with post-test two-axis acceptance stage
- visibility: internalize the research and design archives; GitHub tracker carries bugs only
- web: let the mini graph consume its own viewBox constants
- web: follow the subtitle's deterministic-edge wording in e2e (F059 #267)
- lint: fix pre-existing errors blocking the pre-commit gate
- governance: adjudicate transport attempt semantics and close audit drift (#271, #272)
- knowledge: record the knowledge-map review, spec compliance and v2 decisions
- web: dedupe e2e helpers and deepen zh /knowledge coverage (F059 #254)
- web: cover /knowledge en/zh i18n and dual theme in e2e (F059 #254)
- features: register F059 in feature_list.json (F059 #254)
- policy: clarify delegation boundaries in policy help
- knowledge: strengthen F001 browser assertions (F059 #248)
- specs: add F059 Knowledge & Decision Map spec and program registration (#246)
- research: graph rendering library choice for Knowledge Map (#242)
- design: v10 design-system upgrade — token frontmatter, refined prompts, showcase
- web: two-axis review fixes for knowledge map round-2 (#240)
- design: sync design system v10 and knowledge-map screen prompt (#240)
- program: add F049-F057 specs and ADR-0021..0024 (program authority documents)
- artifacts: document extension namespace, version negotiation, and ceilings for F049 #223
- eval: fix prettier drift in F058 files
- artifacts: pin projection status envelope code seam (F049 full-review finding 3)
- extend governance vocabulary for canonical artifacts and gating
- isolate session-commands fixtures in per-test temp dirs
- fix all second-round two-axis review findings
- deps: bump eslint to 10.9.1 and globals to 17.11.0
- make the legacy ledger auto-bundle fixture deterministic
- web: prettier-format theme-provider after the F047 lazy-init change
- web: clear the six deferred react-hooks production warnings (F047)
- schema: generalize Ajv adapters into one schema-contract seam (F042)
- memory: book the seam-adoption ritual pattern (T1 write-back)
- governance: record the F039 evolution entry
- adr: accept ADR-0020 and record the five transport adjudications
- governance: accept F039 and close session 0893942b
- cli: migrate context, feature, workflow-assessment, and governance to defineCommand (F039 S4)
- cli: migrate projection and sync to defineCommand (F039 S3)
- cli: migrate org-audit, knowledge, phase, and memory to defineCommand (F039 S2)
- governance: accept F037/F038 records and close session 3f42529a
- ledger: dedupe the fail-closed ritual and guard error-code literals (F038)
- governance: accept F037 and close out session a4b43c97
- git: unify git invocation behind the git-exec seam (F037)
- governance: accept F036 and close out session 6916783e
- governance: record F036 evidence and slice completion in the plan
- lint: drop path imports left unused by the state-dir migration
- state: migrate all hardcoded .amber joins behind the state-dir seam (F036 S2)
- architecture: archive the deepening-opportunities survey
- adr: propose ADR-0020 governed live git transport for the sync runtime
- governance: name the sync envelope contract surface on the F035 learnings booking
- specs: add sync envelope contract for the F035 admission pipeline
- memory: book F035 delivery invariants into MEMORY.md
- governance: book F035 learning review with owner script
- governance: accept F035 and close out session 87c57090
- governance: satisfy F035 evidence schema and phase-boundary review checks
- review: resolve the two retained judgement findings
- seam-guard: drop stale regex-blanker JSDoc left over from the lexer swap
- dispatcher: remove sync leftovers + unused import from decomposition
- dispatcher: extract six domain command modules (architecture review #1, slice 2)
- lint cleanup from architecture review refactors
- dispatcher: extract feature-attribution domain reads (architecture review #1, slice 1)
- cli: shape-driven renderer registry (architecture review #2)
- seam-guard: replace regex comment-blanker with a real lexer (architecture review #8)
- memory: extract policy into memory-policy.js (architecture review #5)
- harness: shared fixture builders, migrate 10 unit suites (architecture review #3)
- core: one append-only JSONL primitive (architecture review #4)
- core: one canonical-pages reader in context-store (architecture review #7)
- core: consolidate sha256 into context-hash (architecture review #6)
- mcp: pick newest session in one pass instead of sorting all of them
- security: patch apps/web advisories and close CI audit blind spot
- mcp: surface spawn channels on flaky session-start assertion
- wiki: track wiki scaffold additions (agent/architecture/features/product pages, engineering docs, glossary, knowledge plan yaml)
- gitignore session-commands test scratch repo
- e2e: Team Hub synchronization tracer (issue #166) (#192)
- e2e: Personal Node offline tracer (issue #161) (#190)
- adr: ADR-0019 distributed governance Stage 1 decisions (#183)
- cli: assert ERROR: prefix on invalid breadcrumb print stderr
- memory: book first governed memory entry - npm ci lesson
- install with npm ci for reproducible dependency resolution
- governance: close F033 lifecycle — Governed Memory Layer batch A accepted
- governance: close F031 lifecycle — lockstep feature accepted
- tooling: scope pre-commit formatting to staged files; align AGENTS template frontmatter
- governance: distributed governance baseline and CONTEXT language expansion
- add ADR-0018 and Governed Memory Layer spec
- web-adapter: add seam guard and fold session-state-machine into adapter (#130)
- add retroactive tracer-bullet tickets 06-10 and evidence index
- governance: close external reference audit signals
- governance: guard external reference provenance
- governance: close F027 lifecycle — P3 complete
- governance: close F026 lifecycle
- governance: close F025 lifecycle with the first real break-loop record
- governance: close F024 lifecycle — accept, self-dogfooded feature paths
- governance: close F023 lifecycle — accept, book learnings for F022 and F023
- governance: close F022 lifecycle — accept, dogfood-install breadcrumb, book friction

### Other

- Align tip MEMORY.md to ## Entries + ### claim shape
- memory: close F034 two-axis review findings — shared mount helper, explicit strict gate, deviation table

## [1.6.0] - 2026-08-14

### Added

- release: lockstep-publish dsh-amber-protocol on stable tags

### Fixed

- release: fail closed when release existence cannot be determined
- release: gate DSH publish on npm visibility and release idempotency
- web: drop at-rest shadows and blur from viewer surfaces
- governance: remediate v1.5.1 review findings
- web: share settings and tighten viewer a11y

### Changed

- clean up the MCP junction-fixture target directory
- web: keep settings persistence and query defaults pure
- align F020 feature paths with the actual change surface
- document target-local route reads in CLAUDE.md
- governance: reuse realPathForPotential in inspectRoutes
- test: share target-route fixtures across integration suites
- web: dedupe provider logic and split session-event hook
- release: skip GitHub Packages publish on prerelease tags
- dispatcher: extract shapeResult + requireSessionId, fix CI npm publish

## [1.5.1] - 2026-08-14

### Added

- `.gitattributes` enforces LF line endings cross-platform (`* text=auto eol=lf`) with a binary-file allowlist.
- `.github/CODEOWNERS` routes review by directory.
- CI runs `npm run lint` and `npm run format:check` before tests; the opt-in `pre-commit` hook runs the same two gates after identity validation.
- Add the installable `dsh-amber-protocol` bundle for native DeepSeek Harness profile setup. The bundle resolves `amber-protocol` from its own installed location, exposes `amberBundlePaths` to later rows, and inserts a stdio MCP client + dedicated skill-filesystem instance.
- Add `scripts/lib/subcommand-dispatcher.js` — a deep dispatch module that takes an action table + envelope shaper and returns a unified dispatcher, collapsing the duplicated if-chain pattern across adapters.
- Add `tests/integration/dsh-bundle.test.js` — manifest contract, pack dry-run, and runtime path-resolution tests.
- Add `tests/integration/capability-helpers.test.js` — unit tests for `deriveCapabilityFromAction` and `toCapability` parity.
- Add `dsh/LICENSE` (MIT) to the bundle artifact.

### Changed

- Ship the MCP Action and Function registries in the `amber-protocol` npm artifact so external adapters can start the governed stdio server.
- Centralize `ACTIVE_SESSION_STATUSES`, `loadAndValidateManifest`, `manifestProjection`, `readSessionSummary`, and `readSessionsForConcurrency` in `session-manifest.js` — eliminating duplicated manifest read/validate/project sequences across `mcp-action-runtime.js` and `mcp-functions.js`.
- Wire `deriveCapabilityFromAction` into `validateActionContract` so JSON→capability derivation has one shape, not inline per field.
- Add `toCapability` helper to `context/action-registry.js` — unifies the context capability shape with `COMMAND_CAPABILITIES` entries in `classifyCliInvocation`.
- Migrate `contextDispatch` from a 14-branch if-chain to a `HANDLERS` map; migrate `maintenanceDispatch` to `createSubcommandDispatcher` with an envelope shaper.
- Fix `resolveTargetOverride` TOCTOU: stat→realpath→re-verify in one try block, consistent with `canonicalizeDirectory`.
- Fix `handleWorkflow` `--output-dir` guard ordering: reject before dispatch, not after.
- Fix `handleIngest` payload guard: require `--payload` unconditionally, not only when `--json` is absent.
- Unify `failOnStartupError: true` across all dsh patch files (bundle + overlay).
- Rewrite `README.md`, `README.zh-CN.md`, `docs/README.md`, `dsh/README.md` to lead with `dsh plugin --profile web add dsh-amber-protocol`; overlay patches retained as unpublished-checkout fallback.
- Document the pnpm `overrides` workaround for unpublished local tarball installation in `dsh/README.md`.
- Apply Prettier across the repository against `.prettierrc.json` (tabs, double quotes, trailing commas, 100-col width, LF).

## [1.5.0] - 2026-08-10

### Added

- **Governed Context knowledge lifecycle (F017)**: classify knowledge by kind,
  validate forward supersession lineage, and assemble current-only Loadouts and
  derived projections without introducing a second writable source of truth.
- Add deterministic Context benchmarks, opt-in source adapters, report-only
  retention metrics, and dependency-boundary checks for external integrations.

### Changed

- Extend Context schemas, CLI help and output, verification errors, architecture
  guidance, and lifecycle documentation for the new assurance capabilities.
- Reconcile F016/F017 governance evidence: F016 remains accepted; F017 remains
  passing because its implementation predates a governed plan and Session.

## [1.4.1] - 2026-08-08

### Fixed

- Centralize CLI Command definitions, public order, help/output policy, and handler
  binding in `command-help.js`; dispatcher owns runtime dispatch only.
- Derive Context Page index status from page health at the store boundary (no
  blank `statusMap` defaulting every page to `ok`).
- Fail-closed session execution evidence for malformed JSON (including JSON
  `null`) and ledger/evidence coordinate mismatches; governance reports mark
  unavailable evidence explicitly instead of looking empty.
- Encoding validation skips tracked files deleted from the working tree.
- Align agent/wiki docs with the new registry and evidence paths.

### Changed

- Remove `command-handler-families.js`; assessment consumers degrade at their
  boundary when the shared evidence reader throws.

## [1.4.0] - 2026-08-08

### Added

- **Context layer — contract-driven distillation (ADR-0009)**: new `amber context`
  command family (`request` / `ingest` / `verify` / `list` / `show` / `refresh` /
  `stats` / `delete`) closes the write path between session evidence and project
  knowledge. Amber emits hash-bearing distillation contracts; a host agent executes
  them; Amber judges the result (schema, citation completeness, payload-to-request
  binding, source freshness) and persists provenance-backed pages under
  `.amber/context/pages/`, indexed by `docs/wiki/context-index.md`. Amber never
  calls a model — zero new runtime dependencies beyond `ajv`/`ajv-formats`.
  - Dual raw/normalized hashing absorbs cosmetic source changes silently;
    `{"outcome":"no-change"}` rebases hashes without touching page content.
  - Immutable sources (ledgers, ADRs, archived sessions) are excerpt-snapshotted
    into pages; tamper and page-corruption detection included (D5a).
  - Seven new `AMBER_E_CONTEXT_*` error codes; `doctor` gains an aggregate
    context-pages finding.
  - `stats` reports filter rate, pass rate, no-change rate, unknown-block share,
    and mean sources per block, with an optional `--window` for trend regression.
  - `amber-context` skill (mirrored to Claude Code, Codex/Cursor, Gemini) teaches
    host agents how to run the loop.
- **Context Loadouts (ADR-0010)**: deterministic, budgeted context selection now
  produces auditable Loadout artifacts with required, priority, and optional tiers.
  The Operating Manual, selected Route manifest, and Loadout Definition are pinned
  as target-local Required Artifacts and verified fail-closed.
- **Governance metadata and advisors (ADR-0011–0014)**: add explicit confidence
  bands, machine-readable dispatch approval requirements, protocol/schema version
  metadata, execution-routing taxonomy, artifact migration backfill, session-scoped
  no-progress findings, and objective-driven `amber next` route advice.

### Fixed

- Enforce lexical and real-path target confinement across Context sources, Pages,
  requests, payloads, and Loadouts; bind every ingest outcome to an existing request
  and reject stale or mismatched source snapshots.
- Verify the execution ledger hash chain before policy evaluation, require an
  explicit valid policy, preserve deny-wins behavior, and permit real execution
  only at high confidence after all governance gates pass.
- Require approval for every multi-worker dispatch and degrade low-confidence swarm
  requests to a single bounded loop instead of parallel execution.
- Make migration discover only recognized artifacts across `.amber/`, `routes/`,
  and `workflow-packs/`; scope routing and no-progress evidence to the target and
  active Session; retain fail-closed task/session/plan coordinate validation.

### Changed

- Split dispatch policy, validation, and persistence responsibilities into focused
  modules while preserving the public handoff and workflow-assessment facades.
- Align CLI, ADR, wiki, migration, and generated-agent guidance with the corrected
  governance contracts, including explicit `migrate state` legacy conversion.

## [1.3.12] - 2026-08-04

### Added

- **Loop no-progress reporting (F015)**: `loop status --ledger` now accepts a
  single ledger JSON file or a directory of recorded history. Directory reads
  retain valid records when individual files are corrupt, deterministically
  analyze at most the newest 100 files, and report conservative
  `insufficient-history`, `progressing`, or `stalled` outcomes with explicit
  repeated-observation, empty-evidence, stop-reason, and budget signals. Status
  remains read-only and reports execution, scheduling, and external-call flags
  as false.
- **Knowledge Plan deep module (F013)**: read-only (`inspect`/`report`/`validate`)
  and write-capable (`scaffold`/`build`/`plan`) use cases now cross a root facade
  (`scripts/lib/knowledge-plan`) and Governance Console command adapter
  (`scripts/lib/knowledge-plan/adapters/command`). Parsing, schema validation,
  lookup precedence, report mechanics, page materialization, and proposal
  inspection live behind an internal seam (`scripts/lib/knowledge-plan/internal`).
  An interface contract test prevents production modules and ordinary tests from
  importing internals directly.
- **Maintenance focused evidence outcome (F014-M1)**: a root facade
  (`scripts/lib/maintenance`) exposes a read-only `evidence` outcome for Amber
  Evolution findings and Regression Proposals. Workflow Effectiveness consumes
  it instead of raw Maintenance collectors, with no Team Distribution registry
  dependency. Corrupt or unreadable evidence records are skipped, retained valid
  records are preserved, the outcome is marked `partial`, and redacted warnings
  are emitted (warning-only; never a blocking error).
- **Maintenance partial-state propagation (F014-M2)**: full Maintenance
  inspection now composes the focused evidence outcome, and partial evidence
  warnings propagate as redacted non-blocking warnings through Governance Report
  and Adoption Report while retained valid data keeps both reports on their
  normal completion paths. Amber Evolution collectors move to
  `scripts/lib/core/evolution-findings.js` for shared use without circular
  requires.
- **Unified Maintenance command adapter (F014-M3)**: all ten Maintenance
  subcommands (inspect, propose, stale-docs, wiki-lint, pack-drift,
  upgrade-preview, evolution-rollup, regression-proposals, scaffold-drift,
  distill) route through one Governance Console command adapter
  (`scripts/lib/maintenance/adapters/command`); the outer handler no longer
  owns subcommand knowledge. Aliases, envelopes, registry-path closure, and
  unknown-action guidance are unchanged.
- **Maintenance interface seal (F014-M4)**: Governance Report, Adoption Report,
  and wiki drift consume the root facade (`inspect` / `evidence` / `staleDocs`
  outcomes); Workflow Effectiveness already used `evidence`; the Governance
  Console uses the command adapter. No production caller imports raw
  Maintenance helpers, delegation tests no longer monkey-patch exported
  bindings, and an interface contract prevents importing
  `maintenance/internal` directly. The legacy `core/maintenance.js` surface
  remains a documented forwarding compatibility adapter for one deprecation
  cycle, with removal deferred to a declared major release.
- **Pre-push pi-rewind checkpoint guard (F012)**: the repository pre-push hook
  refuses to push `refs/pi-checkpoints/*` refs, the local-only per-turn undo
  snapshots written by pi-rewind. A `git push --mirror` or explicit push of
  those refs would leak full working-tree snapshots (including captured
  untracked files) to the remote; normal branch and tag pushes are unaffected.
  Hook behavior is covered by unit tests.

### Fixed

- **Review standard labels**: `amber review` now gives JSON standards without an
  explicit `id` a deterministic filename-based identifier and labels the list
  as loaded standards. Human output no longer renders a blank standard between
  `amber-delivery` and `security-governance`.
- **Release documentation links**: correct two ADR-0003 links in the CLI
  reference and replace a stale `error-recovery.js` implementation link with
  the actual boundary: retry settings are governance metadata and never imply
  autonomous target-command retries.
- **Dependency security**: bump transitive `brace-expansion` 5.0.8 -> 5.0.9 in
  the lockfile, resolving HIGH advisory GHSA-rgw5-rvv9-x895 without changing
  the parent dependency graph.
- **Dependency security**: bump transitive `fast-uri` 3.1.4 -> 3.1.5 in the
  lockfile, resolving advisory GHSA-7p8r-x3mc-p8w7 without changing the parent
  dependency graph.

### Deprecated

- **Legacy Knowledge Plan CommonJS surface** (`scripts/lib/core/knowledge-plan.js`):
  retained helper exports (`loadKnowledgePlan`, `buildKnowledgeReport`, parser,
  serializer, and related helpers) are forwarded for one deprecation cycle.
  New code must use the root facade or command adapter. Removal is deferred to a
  declared major release; no runtime import warnings are emitted.

## [1.3.11] - 2026-07-31

### Changed

- workflow-assessment: single facade with internal seams

## [1.3.10] - 2026-07-31

### Fixed

- **workflow-assessment CI regression**: privacy assertion (`!json.includes(homedir())`) failed on Linux CI where checkout path lives under `/home/runner`. Now checks `~/.claude` root paths in both native and JSON-escaped forms, which catches real claude-home leaks while tolerating legitimate target paths under homedir
- **workflow-assessment M1**: `collectAgentAssets` dedupes by `realpathSync.native` (Windows case-insensitive filesystems no longer report phantom `AGENTS.md` + `Agents.md` duplicates of the same on-disk file)
- **workflow-assessment M2**: removed dead `vc-3` fail branch (check only observes capability; defect detection is `ld-4`'s job)
- **workflow-assessment M3**: `MAX_TRANSCRIPT_FILES=20` cap (mtime newest-first); `claudeHome` injection through `buildReport` → `listProviders`; two tests now use injected `claudeHome` instead of writing real `~/.claude`
- **workflow-assessment M4**: `summarizeTranscript` requires at least one positive cwd match (lossy directory name alone no longer binds; prevents transcript trust on lossy path encoding collisions)
- **workflow-assessment L1**: `collectMergedSessionObservations` comment updated to accurately describe no cross-provider dedup (amber-native and claude observe different planes)
- **workflow-assessment L2**: `foreignSessionUnsupported` noted as test-only (claude declared supported in P2b, codex/cursor unavailable until P3)
- **workflow-assessment L3**: `--target "\${target}"` quoted in draft templates (paths with spaces now render correctly)

### Performance

- **workflow-assessment suite**: 8.6s → 2.7s (MAX_TRANSCRIPT_FILES cap reduces unbounded transcript scans from 119MB to newest 20 files)
- **assess stdout**: 84.5KB → 18.3KB (108→17 observations; 105 claude transcripts capped to 14)

### Added

- **workflow-assessment tests**: cap regression (25 files → 20), no-cwd negative case, case-insensitive dedup regression

### Notes

- All 1295 tests pass; workflow-assessment coverage unchanged (cap only reduces historical noise, not signal)
- `realpathSync.native` required for case dedup — JS implementation preserves caller casing and misses Windows on-disk truth

## [1.3.9] - 2026-07-27

### Added

- **pi harness compatibility**: publish `skills/` in the npm package and declare a `pi` manifest (`{"skills": ["./skills"]}`) plus the `pi-package` keyword, so `pi install npm:amber-protocol` resolves all 10 Amber skills and the package is indexed by the [pi.dev package catalog](https://pi.dev/packages)

### Fixed

- **skill command prefix**: skill bodies now call `amber <cmd>` and carry an explicit prefix note — `node scripts/amber.js` in an Amber checkout, `npx -p amber-protocol amber` when Amber is installed as a package. Package-installed agents previously followed a checkout-only path that does not exist for them. Repo-local slash commands (`.claude/commands`, `.gemini/commands`) keep the checkout path via the unchanged `x-amber-json` frontmatter.

### Notes

- Repo-local pi support already worked without changes: pi reads `AGENTS.md`/`CLAUDE.md` as context files and discovers `.agents/skills/` (generated by `npm run gen:agents`) natively. The `x-amber-json` frontmatter key is ignored by pi's Agent Skills validator, so skills load unmodified.
- `npx amber-protocol` alone cannot resolve a bin (the package ships two: `amber` and `coding-harness`); `npx -p amber-protocol amber` is the working form.

## [1.3.8] - 2026-07-22

### Fixed

- **deps**: bump transitive `fast-uri` to 3.1.4 (via lockfile) clearing high advisories GHSA-4c8g-83qw-93j6 / GHSA-v2hh-gcrm-f6hx that failed the CI Security job after the 1.3.7 tag
- **docs boundary test**: allow `docs/architecture/session-lifecycle.md` to document refused autonomous session mode (refusal note, not product advertising)

### Notes

- Completes the interrupted `v1.3.7` ship path: tag CI failed before Publish / GitHub Release; do not retag `v1.3.7` — publish from `v1.3.8` instead.

## [1.3.7] - 2026-07-22

### Fixed

- **governance rules check**: dry-run uses `evaluateGovernedPolicy` (same built-in denies as governed-runner) so shell composites past a prefix allow no longer report false ALLOW
- **policy**: pure FD redirects (`2>&1`, `1>&2`) no longer trip shell-composition deny; default `allow-npm-checks` accepts optional trailing FD redirects (`npm test 2>&1`)
- **handoff**: free-text string evidence in `feature_list.json` renders correctly (no more `(none)` from string-spread); stamp `Last Updated`; reuse `getRepoSnapshot` for dirty labeling
- **governance audit / evidence / readiness**: count live `stage_completed` / `verification_failed` with `data.command` (phantom `command_executed`-only counting under-reported real dogfood sessions)
- **execution readiness**: stop requiring root-level `autonomous-policy.json` (wrong path + removed execution model); key off `.amber/governance/rules.json` with built-in defaults; strict mode requires on-disk rules.json
- **web EventStore**: compare SSE `since` against timestamps as epoch ms so ISO CLI timelines resume correctly
- **web gate-reader**: remove invalid `status !== 'all'` compare (not a `GateStatus`)
- **web lifecycle**: import `CompletionStatusResult` for completion helper typing
- **web timeline**: label `verification_failed` / `checkpoint_created`; show command/stage/exit details on stage and gate events
- **team registry**: reject malformed catalog entries; validate maintenance consumers; handle invalid registries
- **deps**: clear brace-expansion high advisory (GHSA-3jxr-9vmj-r5cp)

### Added

- **status**: `dirty (untracked only)` when the tree has only `??`/`!!` noise (e.g. local `.scratch/`)
- **ci**: guard commit identity; home visual e2e coverage
- **web**: realign home as data-first operator console

### Changed

- architecture docs: align governance model and session-lifecycle with live policy surfaces (`evaluateGovernedPolicy` / `session-timeline`) and removed autonomous executor
- readiness ACTION_LIBRARY: stop promoting “increase agent autonomy” for leftover policy findings
- BACKLOG: Phase C e2e is in CI; Phase D SSE auth + server-side error forwarding marked implemented for the local viewer boundary
- dogfood-weekly §7 candidates refreshed for empty `next-up` queues
- Phase B wiki task list: note `timeline-writer` superseded by `session-timeline.js`

## [1.3.6] - 2026-07-15

### Fixed

- session-lock: eliminate TOCTOU race in `acquireLock` via atomic `link(2)` (old `existsSync`+`writeFileSync` let concurrent acquirers all succeed; verified 10/10 → 1)
- web session-control: `resume` is pause-only (`paused → executing`); `routed → executing` stays `start`, not `resume`
- sync: artifact-unavailable note no longer falls through to misleading "none detected" (product-repo / non-git now report `n/a`)

### Changed

- remove unused nodemailer dependency
- remove 7.4M legacy `.harness` backup directory
- use `structuredClone` instead of hand-rolled `JSON.parse(JSON.stringify())` deep clone
- collapse `walkFiles` into `collectFilesBySuffix`
- command layer: dedupe `unknownAction`/`resolveTarget`; governance `requireTarget` SSOT
- architecture deepening (Batch A+B):
  - maintenance owns `runMaintenanceAction`; `registry` → `registryPath` at the seam
  - governance owns `governanceDispatch` + `runGuarded`
  - feature owns `runFeatureAction` presentation (structured fns stay exported)
  - extract `core/syncProject` for scaffold/artifact/refresh orchestration
  - web adapter seam (`scripts/lib/web-adapter.js` + `.d.ts`); ADR-0007 Consequences updated
  - session transition SSOT (`isLegalTransition` / `legalTargets` / `isFinal`); web drops `ALLOWED_TRANSITIONS`

## [1.3.5] - 2026-07-14

### Added

- wiki: add declarative Knowledge Plan capability with tests

### Fixed

- regenerate agent commands after amber-wiki SKILL change

### Changed

- clear lint warnings, sync README version, ignore local IDE dirs
- add lint/format tooling, leak guard, and dogfood feature_list

## [1.3.4] - 2026-07-14

### Fixed

- session: writeSessionManifest uses monotonic timestamp too (#58)
- session: monotonic createdAt + deterministic sort tiebreak (#58)

### Changed

- quality: mark G1/G2 post-adjudication closures (#59)

## [1.3.3] - 2026-07-14

### Added

- changelog: detect BREAKING CHANGE in commit body footer (#52)
- cli: add npm run orient for session-start orientation (dogfood amber status) (#48)
- release: add zero-dependency changelog generator + release process automation for #47

### Fixed

- changelog: breaking flag requires ! or body footer, not subject text
- changelog: use full history (empty range) on null getLatestStableTag; robust parser for first-release (#53)
- release: terminal release assertion — catch local-only tags and registry ghosts (#46)

### Changed

- add regression tests for complete-check --strict rejecting init-scaffold/template handoff (G2, #56)
- verify apps/web E2E succeeds on Windows local (127.0.0.1 + NO_PROXY; stale 'proxy trap' memory resolved)
- update e2e-governance-loop-verify.md with #54 target-repo dogfood results (G1/G2 closed on external target; outcome A)
- refresh dogfood-weekly.md §7 candidate list to point at live open next-up (G1/G2 target-repo verification from adjudication gaps)
- verify amber next last-mile closed at HEAD (STEPS + strict + inferNextStep); drop G1 weakness from dogfood-weekly.md (closes #50)
- correct G2 evidence honesty section after verifying complete-check rejects template handoff at code layer (closes #51)
- dogfood: define weekly self-dogfood ritual and first-round candidates

## [1.3.2] - 2026-07-13

### Added — Closed-loop governance lifecycle

The full 11-step lifecycle (audit→init→feature→plan→gate→session→verify→approve→complete→accept→handoff) now works end-to-end. Wayfinder maps #14/#27/#35.

- `session start --feature <id>` binds the feature into the manifest; `session complete` is the governance terminal state (all non-terminal states may transition).
- `session verify --execute` refluxes real execution evidence back to `feature_list.json` — claim-only verify does NOT reflux.
- `accept` evidence gate — refuses a plan whose feature has no evidence (`AMBER_E_FEATURE_NO_EVIDENCE`; `--force` bypasses with a ledger warning), and validates the plan's feature matches the session's feature (#37).
- **`governance standards init`** — scaffolds `standards/security-governance.json` so the missing-security-standard remediation actually clears the finding (#44).
- `handoff` regenerates from live repo state (not template); bundle distinguishes `structureValid` vs `deliveryReady` and surfaces bounded `failedVerifications` (legacy `.harness` repos included).
- **ADR-0007** — web console boundary: supervised action viewer with an explicit allow-list (session start/pause/resume/abort, runVerification) vs CLI-only (approve/complete/accept/handoff/feature management).
- Redesigned web session console: SessionCompletionWorkbench, lifecycleRouter endpoints (next/completionCheck/runVerification), i18n, runner ACK persistence.
- Web artifact-store — centralizes TS artifact path resolution and JSON reading, traversal-guarded, skip-corrupt (TS twin of `core/fs-utils`).
- `scripts/demo/acceptance-demo.sh` — idempotent full-lifecycle acceptance demo.

### Security — verify-surface hardening (#36, #40–#44)

- `evaluateVerifyPolicy`: un-removable built-in denies (destructive patterns + quote-aware shell-composition operators) applied before user rules — a custom `verify-rules.json` can no longer drop destructive protection, and an allow-listed head can no longer smuggle chained commands (`pytest && rm -rf`, `pytest | sh`).
- Closed case-sensitivity bypass (`RM -RF`, `DROP TABLE`, …) and variant bypass (`rm -fr`, `rm -r -f`, `git push … --force` at line end) on the built-in destructive check.
- Governed surface (`loop run --execute`) aligned with the same built-in denies.
- Target-safe lifecycle remedies: `shellQuote` on target/plan/command paths; session verify/approve/complete-check/complete carry `--target` (#41).
- Verify command is discovered from disk (package.json `scripts.test` → `npm test`, else toolchain candidate, else explicit placeholder) — never a silent `npm test` for an unknown toolchain (#42).
- `audit` is strictly read-only: no `.amber/last-audit.json` stamp written to the target (#43).

### Fixed

- `ledger verify-anchoring` surfaces its domain error instead of printing `undefined`.
- `next` last-mile: guides session terminal steps (handoff → complete-check → complete); strict completion rejects init-scaffold handoff; audit-before-init for existing repos.
- `buildContext` honors the strict flag instead of hardcoding strict evaluation.
- governed-runner captures the error tail and normalizes the timeout exit code.
- standards loader distinguishes a corrupt framework file from an unknown framework.
- Cross-language event parity: web event types aligned with the CLI state machine, guarded by parity tests (schema, SessionStatusSchema, command registry).
- `verification_failed` events carry stderr.

### Deprecated

- `profile`, `task`, `result`, `agent`, `team`, `adoption` commands now emit runtime deprecation warnings and are marked DEPRECATED in help and CLI reference (#26).

### Changed

- timeline-event and session-manifest deepened into single modules; session write concern extracted from session-reader; resume-reject ACK envelope and ledger verify outcome single-sourced; web session control unified behind a shared `runControlledTransition` pipeline; orphan loop-contract schema validator dropped.

Full suite 1134 passing (CLI) + web Vitest green; manifests/doctor/gen:agents green.

## [1.3.1] - 2026-07-05

### Added — Artifact-first evidence layer, Phase 1

Three boundary-safe, zero-new-dependency commands that make Amber's drift detection CI-deployable and its tamper-evident ledger SIEM-consumable and git-anchored. Design: `docs/legacy/specs/2026-07-05-amber-artifact-first-evidence-layer-design.md`.

- **`amber drift`** — CI-native drift gate aggregating the artifact / wiki / scaffold detectors into one exit code (`0` clean / `1` any actionable drift). Supports `--scope`, `--format gh-annotations` (GitHub Actions `::warning` lines), and `--no-fail` for informational CI steps. Read-only, Verification-layer (same shape as `doctor`).
- **`amber ledger export`** — SIEM/compliance bridge. Walks every `ledger.jsonl` (loops / routes / sessions) via `walkLedgers`, verifies each chain, and emits `json` (default), `csv`, or `otlp-json` (valid OTLP JSON encoding — no protobuf, no dependency). A broken chain is exported as `intact:false` and counted in `brokenCount` rather than refused.
- **`amber ledger seal` + `amber ledger verify-anchoring`** — anchors each ledger's tail hash into an annotated git tag (`amber-ledger-seal-<head-sha>`), so forging a ledger then requires rewriting git tag history too. Closes the gap ADR-0003 and `loop-ledger.js` both self-admit ("hash chain detects tampering but does not prevent a full-file rewrite"). Human-triggered; no push, no scheduling. Ed25519 signing deliberately deferred until key management is real.
- New CLI flags (`--scope`, `--format`, `--home`, `--out`, `--no-fail`) registered in the `parseArgs` `FLAG_SPECS` table, with a regression guard in `tests/unit/parse-args.test.js`.
- CI dogfoods `amber drift` (non-blocking) on every build.

Adds 17 tests (5 drift, 5 ledger-export, 4 ledger-seal, 2 git-exec, 1 parse-args guard); full suite 1053 passing, zero regressions.

## [1.3.0] - 2026-07-04

### Changed — Direct core imports, facade removed (#4, PR2)

- All facade consumers (`command-dispatcher`, 8 entry scripts, 12 tests) now import directly from `scripts/lib/core/*`; `grep` once again equals the dependency graph.
- Removed `scripts/lib/amber-core.js` (322-line zero-logic re-export facade) and `scripts/lib/harness-core.js` (its alias).
- New permanent guard `tests/unit/no-facade-reintroduction.test.js` prevents the facade/backdoor from returning (the old `lint` echo-shell enforced nothing).
- `templates/feature_list.json` F001 verification now points to `node scripts/amber.js doctor`.

### Removed — Zombie execution platform & experimental scope (#4, PR1)

- Five execution-platform peripheral modules (`scripts/lib/{daemon,notifier,health-checker,budget-tracker,error-recovery}.js`) and their unit tests — zero production references, kept alive only by self-tests.
- `amber daemon <status|stop>` CLI command — hidden command with no help/docs/start path; removal is bug-equivalent (minor).
- `src/experimental/execution/` and `tests/experimental/` — the cold-stored execution engine was unreachable, broken-chained (5+ dangling requires incl. `checkpoint-manager`), `test:experimental` failed 3/5, yet shipped to every installer via `files:["src/"]`. See ADR-0005.
- `test:experimental` npm script.

### Fixed

- `session start --mode autonomous` now refuses at the gate (exit 1, no manifest written), matching ADR-0002's stated intent. Previously it accepted the mode and only `session continue` refused — leaving an unreachable autonomous manifest behind.

## [1.2.0] - 2026-07-04

### Added — State-aware drift detection (`amber status` + `amber sync`)

- **`amber status`** — a curated state front-door: repo? / initialised? / fresh?, plus three drift surfaces in one glance. Read-only; does not duplicate `doctor` (validity) or `maintenance inspect` (full dump).
- **Scaffold-version drift (SP1)** — `.amber/provenance.json` (per-file sha256 + ownership tier; hash strips YAML `updated:`) and a four-class classifier (fresh / stale / customized / ambiguous / missing). `amber sync --execute` and `init --refresh-amber-owned` overwrite only `controlled + stale` files (after a `.bak` backup); `customized`/`ambiguous` controlled files are cached as proposals, never clobbered.
- **Artifact-vs-reality drift (SP2)** — optional per-feature `paths` field (`feature add --paths`) and a git-anchored `detectArtifactDrift` with six classes (drifted / aligned + skipped: no-evidence / untracked / path-unknown / anchor-invalid). Comparison is timezone-homogeneous (`Date.parse` ms); an empty pathspec is surfaced as `path-unknown` rather than swallowed into `aligned`.
- **Wiki drift (SP3)** — `detectWikiDrift` aggregates stale docs (`Last Reviewed` marker), missing required wiki pages, and controlled-wiki template drift. Surfaced in `amber status`; non-git projects are NOT skipped (wiki drift is marker/file/provenance based, not git-anchored).
- **`amber sync`** — standalone scaffold-drift resolution (dry-run by default; `--execute` applies).

### Added — Evidence-grade sessions

- **`session verify --execute`** runs the verification command in the working copy behind the policy gate and records its real exit code to the session hash-chain ledger (`verification_passed/failed/denied`).
- **`session approve`** identity gate — records who approved (interactive TTY prompt or `--yes`); the agent must not self-approve.
- **Honest `completion-check`** — `hasWorkEvidence` excludes `.amber/`/`.harness/` bookkeeping and compares the latest commit to `createdAt` at ms precision; `--strict` requires executed verification.
- Evidence ledger records now persist `stdoutTail`/`stderrTail` (passed/failed; denied omits them).
- Verification uses a dedicated `governance/verify-rules.json` allow-list (absent → built-in defaults; unparseable → stderr warn) — widening the global `rules.json` can no longer relax verification.

### Changed

- `maintenance inspect` now includes artifact drift alongside scaffold drift.
- `loadPolicyRules` now stderr-warns on an unparseable/shape-invalid `rules.json` instead of silently falling back (was a diagnostic trap).

### Fixed

- GitHub Packages publish workflow is now idempotent — a re-pointed tag or a re-run skips an already-published version instead of failing with `E409 Cannot publish over existing version`.

Baseline tests 1038 → 1136 (+98), zero regressions.

## [1.1.0] - 2026-06-30

### Added — Governed Loop Execution (GLX)

- **Governed execution of loop contract commands** via `amber loop run --execute`. A command declared in a contract's `governed` block runs behind four gates: a declarative policy check (`.amber/governance/rules.json`, deny-wins / default-deny), an explicit `amber loop approve` (one approval authorises one run), an isolated git worktree, and a tamper-evident hash-chain ledger. Default `loop run` is still dry-run; `--execute` needs an approval. (#ADR-0003)
- **Extracted reusable governed runner** (`runGovernedCommand` primitive) — the four gates are one call site, shared by loops AND route command-stages.
- **Governed route-stage execution** via `amber route test <route> --execute --stage <name>`. A route `command`-type stage's `target` can be governed-executed with the same four gates, recorded in a route-scoped ledger. Non-`command` stages refuse `--execute`.
- **Session hash-chain ledger** — `amber session verify` and `amber session approve` mirror governance-critical events (verify result, gate approval) into `.amber/sessions/<id>/ledger.jsonl` alongside the timeline. `amber session verify-ledger` detects tampering.
- **Per-context rules** — a loop contract's `governed` block and a route `command` stage may declare additional fixed-predicate rules composed with the global `rules.json`. Deny-wins is absolute: a context `allow` can never override any `deny`.
- **Declarative command policy** (`.amber/governance/rules.json`) with `governance rules init` (scaffold safe defaults), `governance rules inspect`, and `governance rules check --command "..."` (trial verdict, read-only).
- **Honest OWASP ASI coverage report** via `amber governance standards`. Each ASI01–ASI10 risk is honestly labelled `governance` / `partial` / `out-of-scope` (runtime-only risks are never falsely claimed as covered). The `present` flag reflects actual deployed controls in the target repo, not cosmetic labels.
- **Governance readiness** now inspects GLX state: missing or unsafe `rules.json` triggers a warning / block; tampered hash-chain ledgers trigger a hard block.
- **New CLI subcommands**: `loop approve` / `loop verify-ledger`, `route approve` / `route verify-ledger`, `session verify-ledger`, `governance rules <init|inspect|check>`, `governance standards`.
- New error codes: `AMBER_E_POLICY_DENY`, `AMBER_E_LOOP_NOT_APPROVED`, `AMBER_E_LEDGER_TAMPERED`.
- 27 new tests; baseline 978→1038, zero regressions.

### Changed

- Refactored README.md and README.zh-CN.md for adopter-first clarity (388→134 lines, −65%)
- Amended `README.md` / `SPEC.md` / `CLAUDE.md` non-goal sections: the blanket "no execution" is replaced by the precise ADR-0003 statement (governance-gated, human-triggered, loop/route command-stages only).
- Added `docs/adr/0003-governance-gated-execution.md` (with Phase 3 addendum for route stages).
- Approvals in hash-chain ledgers unified under the `approvalKey` / `consumedApprovalKey` field pair (was `approvalId`).

### Fixed

- Corrected `docs/README.md` path reference: `guides/getting-started.md` → `user-guide/getting-started.md`

### Added

- Banner regeneration prompt at `assets/readme/BANNER_PROMPT.md`

## [1.0.0] - 2026-06-22

### Added

- Core Amber Protocol engine (init, audit, doctor, adoption)
- Route definitions for feature/bugfix/refactor workflows
- Session lifecycle management with checkpoints and timelines
- Web viewer (beta, local-only)
- Comprehensive test suite (900+ assertions, 281 web tests)
- CI/CD pipeline with quality gates (coverage, security, performance)

### Changed

- Rebranded from Coding Harness to Amber Protocol
- Reorganized documentation by functional topics (removed phase concept)

### Documentation

- Getting started guide
- Architecture documentation (route engine, session lifecycle, governance)
- Adoption workflow for existing projects
- API reference

### Security

- Path traversal protection in session/gate readers
- Secret redaction in client error reports
- Upgraded Nodemailer to 9.0.1 to resolve GHSA-p6gq-j5cr-w38f

## [1.0.0-rc.1] - 2026-06-21

### Added

- Release candidate for community testing
- Release checklist documentation for quality assurance
- Docker isolation testing for npm package
- GPG-signed release tags
- RC validation report template

---

[Unreleased]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.12...v1.4.0
[1.3.12]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.11...v1.3.12
[1.3.11]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.10...v1.3.11
[1.3.10]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.9...v1.3.10
[1.3.9]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.8...v1.3.9
[1.3.8]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.7...v1.3.8
[1.3.7]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.6...v1.3.7
[1.3.6]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.0.0
[1.0.0-rc.1]: https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.0.0-rc.1
