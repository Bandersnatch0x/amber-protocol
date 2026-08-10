# PRD: Governed Context Knowledge Lifecycle and Quality Assurance

## Problem Statement

Amber Protocol can create provenance-backed Context Pages, verify source freshness, and assemble deterministic Loadouts. It cannot yet express what kind of knowledge a page contains, record that an accepted page replaces earlier knowledge, or distinguish current knowledge from retained history when building a Loadout. As a result, an agent can receive an older but mechanically healthy page after a newer conclusion has been accepted.

The Context layer also lacks one binding contract for derived indexes, rebuild behavior, quality benchmarks, optional external-source adapters, dependency boundaries, and retention. Existing metrics describe distillation activity, but they do not prove that a Loadout selected the right current pages. Without these rules, future indexing or connector work could create a second source of truth, hide partial failures, cross repository boundaries, or bypass the Distillation Contract and ingest gate.

The feature must be specified and implemented as an original Amber Protocol capability. Deliverables must not identify, link to, quote, or copy names, prose, code, schemas, fixtures, or distinctive identifiers from projects used during comparative research.

## Solution

Extend the governed Context lifecycle in three compatible phases:

1. Add optional knowledge classification, contract-authorized replacement lineage, and non-authoritative assurance metadata to Context Pages. Preserve every accepted page for audit, derive reverse lineage from a single forward relation, exclude superseded pages from new Loadouts, and never silently reactivate old knowledge when a replacement becomes unhealthy.
2. Define every index and report as a rebuildable projection of accepted Amber artifacts, add deterministic Loadout benchmarks, and enforce module dependency boundaries with the existing test stack.
3. Define an opt-in External Context Connector seam plus a Context threat model and report-only retention policy. Connectors may propose governed sources but may never write accepted pages, execute target-project commands, become a core dependency, or cross a target boundary.

All write-path changes continue to use `request -> agent generation -> ingest -> verify`. Amber owns the contract and gate; the host agent owns generation. Amber does not call a model, perform semantic ranking, run a daemon, or introduce an automatic knowledge-merging runtime.

## User Stories

1. As a maintainer, I want each new Context Page to declare a Knowledge Kind, so that Loadouts and reports can distinguish invariants, decisions, patterns, failures, rejected approaches, and external constraints without guessing from prose.
2. As a maintainer, I want legacy pages without a Knowledge Kind to remain valid as `unspecified`, so that schema evolution does not force unsafe inference or bulk rewrites.
3. As an agent, I want a Distillation Contract to authorize Knowledge Kind, so that a payload cannot grant itself a broader role during ingest.
4. As a maintainer, I want a new Context Page to declare which accepted pages it supersedes, so that knowledge evolution is explicit and auditable.
5. As a maintainer, I want supersession to be authorized by the matching Distillation Contract, so that generated payloads cannot silently retire accepted knowledge.
6. As an auditor, I want superseded pages retained unchanged, so that I can reconstruct what an agent knew and why a later conclusion replaced it.
7. As an auditor, I want reverse lineage to be derived from forward `supersedes` relations, so that there is only one writable source of truth.
8. As a maintainer, I want one page to supersede several pages and several pages to replace one broader page, so that split and consolidation changes remain representable.
9. As an operator, I want self-references, cycles, dangling references, invalid identifiers, and cross-target lineage rejected with explicit errors, so that the lineage graph remains trustworthy.
10. As an operator, I want ingest to validate request binding, scope, Knowledge Kind, and lineage before the no-change path, so that a repeated payload cannot bypass authority checks.
11. As an agent, I want new Loadouts to exclude superseded pages by default, so that retained history does not compete with current knowledge.
12. As an agent, I want an explicit request for a superseded page to fail with its current replacement identifiers, so that Amber never silently serves historical knowledge as current context.
13. As an operator, I want an unhealthy replacement to create a visible coverage gap instead of reactivating its predecessor, so that stale or tampered knowledge never becomes current by fallback.
14. As an auditor, I want explicit page inspection to remain available for superseded pages, so that historical evidence is still accessible without entering normal Loadouts.
15. As an operator, I want page listing, verification, and statistics to expose Knowledge Kind and lineage state separately from source health, so that `superseded` is not confused with `stale`, `tampered`, or `obsolete`.
16. As a maintainer, I want deletion refused when it would leave a lineage reference dangling, so that accepted knowledge history cannot be corrupted accidentally.
17. As an agent, I want optional Knowledge Kind filters on Context listing, Loadout assembly, and statistics, so that selection remains mechanical and task-scoped.
18. As a maintainer, I want absence of a Knowledge Kind filter to preserve existing selection order apart from the required supersession exclusion, so that the feature has a narrow compatibility surface.
19. As an auditor, I want page assurance observations to record confidence, maturity, and mechanical verification time without granting execution authority, so that knowledge quality is visible but cannot bypass governed execution.
20. As an operator, I want verification time derived from accepted verification evidence rather than authored page content, so that agents cannot self-attest mechanical freshness.
21. As a maintainer, I want Context Pages and accepted evidence to remain authoritative, so that an index, cache, or report can always be discarded and rebuilt.
22. As an operator, I want one controlled projection writer and content-hash drift detection, so that derived state cannot diverge through competing update paths.
23. As an operator, I want explicit projection status and rebuild operations with visible failure reasons, so that partial or corrupt derived state is never presented as a complete result.
24. As an agent, I want a deterministic benchmark fixture to state the task signal, eligible pages, expected pages, exclusions, Required Artifacts, Context Budget, and expected Loadout, so that selection quality is objectively testable.
25. As a maintainer, I want benchmark smoke cases to run independently from the full suite, so that regressions can be diagnosed without rerunning every scenario.
26. As an auditor, I want benchmark reports to record the Amber revision, fixture revision, configuration, command options, and result hash, so that results are reproducible.
27. As a maintainer, I want expected-page recall, selection precision, freshness exclusion, required coverage, budget efficiency, stability, warm-continuation cost, and correction rate reported separately, so that one aggregate score cannot hide a specific failure.
28. As a maintainer, I want identical benchmark inputs to produce byte-identical Loadouts, so that deterministic selection remains a product invariant.
29. As an operator, I want incorrect exclusions and missing Required Artifacts to fail a benchmark rather than lower an informational score, so that governance regressions fail closed.
30. As a contributor, I want repository dependency rules to enforce dispatcher-to-adapter-to-public-interface-to-core direction, so that Context internals and integrations do not leak into callers.
31. As a contributor, I want Web, host transcript, and connector code prevented from importing Context internals directly, so that all external data crosses one governed seam.
32. As a maintainer, I want dependency checks implemented with the existing test stack and no new runtime dependency, so that the repository's offline and minimal-dependency posture remains intact.
33. As an integrator, I want an optional External Context Connector interface that emits Source Bundle candidates with provenance and hashes, so that external knowledge can enter the existing contract-driven flow.
34. As an integrator, I want connector output treated as untrusted input and validated at the target boundary, so that malformed paths, identifiers, hashes, or content fail before persistence.
35. As a maintainer, I want connectors unable to write accepted Context Pages or alter Loadouts directly, so that they cannot bypass request, ingest, verification, or freshness gates.
36. As a repository owner, I want connectors disabled by default and isolated from Amber core installation, so that the core remains local, offline, and deterministic.
37. As a repository owner, I want connector data bound to one explicit target and prohibited from automatic cross-repository injection, so that knowledge cannot leak between projects.
38. As a privacy-conscious operator, I want raw transcripts excluded by default and accepted only through explicit source selection and existing redaction rules, so that sensitive conversation data is not silently retained.
39. As a security reviewer, I want a Context threat model covering untrusted content, prompt injection in sources, path escape, source tampering, projection poisoning, cross-target access, sensitive artifacts, and availability failure, so that controls and residual risks are visible in one place.
40. As an operator, I want retention reporting for requests, payloads, pages, verification evidence, Loadouts, and projections, so that I can see candidates without Amber deleting evidence automatically.
41. As an auditor, I want accepted pages and lineage evidence protected from automatic retention cleanup, so that historical reasoning remains verifiable.
42. As a release reviewer, I want source-isolation review to confirm that deliverables contain only independently expressed Amber concepts and repository-local evidence, so that comparative research does not leak into durable artifacts.

## Implementation Decisions

- The feature extends the existing Context command adapter and Context public module boundary. It does not introduce a second top-level command family.
- The Context Page schema gains a new compatible version. Existing schema versions remain valid and are not rewritten merely to add optional lifecycle fields.
- `knowledgeKind` is optional and uses the fixed values `invariant`, `decision`, `pattern`, `failure`, `rejected-approach`, `external-constraint`, and `unspecified`. Missing legacy values behave as `unspecified`; Amber never infers a kind from a title, source, Scope Tag, or block text.
- Knowledge Kind and Scope Tag are orthogonal. Kind describes what the knowledge is; scope describes the Route or Feature for which it is relevant.
- The only persisted lineage direction is a page's `supersedes` list. Reverse `supersededBy` data and current/historical views are derived projections. No command writes both directions.
- A Distillation Contract binds the requested Knowledge Kind and complete supersession set. Ingest requires an exact match and performs binding checks before no-change detection.
- Supersession becomes effective only after the successor passes ingest. The predecessor remains immutable and inspectable but is excluded from new Loadouts.
- Supersession is many-to-many. Graph validation rejects self-reference, cycles, dangling page identifiers, malformed identifiers, and any reference outside the target repository.
- A successor becoming missing, stale, tampered, obsolete, or otherwise ineligible never reactivates a predecessor. Verification and Loadout assembly expose the resulting gap; required coverage fails closed.
- Source health and knowledge lifecycle are separate dimensions. Existing health meanings remain unchanged; supersession is not added as a freshness status or overloaded onto `obsolete`.
- Explicit historical inspection remains read-only. Explicit Loadout selection of a superseded page is refused and reports all directly derived successors.
- Page deletion is refused while the page participates in an incoming or outgoing lineage relation. Automatic cascade deletion and destructive retention are not introduced.
- Optional assurance metadata is observational. Knowledge confidence and maturity do not affect governed-execution confidence, approvals, policy decisions, or Loadout eligibility in this feature.
- Mechanical verification timestamps come from accepted verification evidence and derived reports, not from self-authored page claims.
- Existing Loadout tiering, Scope Tag matching, freshness gates, Required Artifact separation, Context Budget behavior, stable ordering, and exclusion accounting remain binding. Knowledge Kind filters narrow eligibility but do not add semantic ranking.
- Loadout output records the requested kind filters, supersession exclusions, and lineage-related coverage gaps with deterministic reason codes.
- Context Pages and accepted evidence are the only authoritative knowledge records. Any Markdown index, machine-readable index, cache, benchmark report, or connector state is a disposable projection.
- A projection contract owns schema version, source content hashes, last successful rebuild evidence, status, and rebuild semantics. Exactly one public projection service may write derived state.
- Projection consumers must validate completeness and hash agreement. An unavailable or invalid projection produces an explicit error or clearly marked unavailable result; partial data is never reported as complete.
- The first implementation need not add a search database, embeddings, semantic retrieval, or a daemon. The projection invariant applies to current indexes and future implementations.
- Benchmark fixtures are authored specifically for Amber Protocol and contain no imported datasets or copied scenarios. Each fixture declares inputs and exact expected behavior.
- The benchmark has smoke and full modes. Stages can be run independently and reuse only artifacts whose recorded input hash and configuration match.
- Deterministic fixtures require expected-page recall `1.0`, selection precision `1.0`, freshness exclusion `1.0`, Required Artifact coverage `1.0`, and byte-identical output across ten repeated runs. Budget efficiency, warm-continuation cost, and correction rate are reported initially without release thresholds.
- Benchmark failure is per metric and per fixture; there is no single blended score. Reports preserve configuration, revision identifiers, timings, word counts, hashes, exclusions, and failure reasons.
- Dependency rules follow the existing deep-module direction: command dispatcher -> command adapter -> public module interface -> internal/core -> optional integration adapter. Reverse imports and direct external-to-internal imports fail tests.
- Boundary enforcement uses the repository's current Node test runner and existing facade-test patterns. No new runtime dependency is added.
- The External Context Connector seam accepts explicit target context and returns untrusted Source Bundle candidates. It never returns an accepted page, mutates Feature State, writes a Loadout, or executes a target command.
- Core defines the connector contract and test fixture adapter only. Vendor-specific, networked, account-bearing, or background connector implementations are separate future work and remain opt-in.
- Connector input uses the same target-local path validation, provenance hashes, mutable/immutable source rules, redaction, and explicit failures as native sources.
- The threat model and retention matrix are binding documentation for Context artifacts. Retention support reports age, reachability, lineage participation, and eligibility; it does not delete or rewrite artifacts.
- Delivery is phased but must preserve one coherent public contract. Phase 1 is schema, contract binding, lineage validation, CLI visibility, and Loadout behavior. Phase 2 is projection rules, benchmarks, and dependency boundaries. Phase 3 is the connector contract, threat model, and retention reporting.
- Durable deliverables use only Amber Protocol terminology and evidence. They do not name or link comparative projects, copy external prose or code, reproduce distinctive external identifiers, or add attribution text that reintroduces a prohibited source name.

## Testing Decisions

- The primary testing seam is the public `amber context` CLI because it exercises argument handling, Distillation Contract binding, schema validation, persistence, verification, Loadout assembly, statistics, and error behavior as users observe them.
- CLI integration tests cover request and ingest round trips for Knowledge Kind and supersession; mismatch refusal; checks before no-change; legacy-page compatibility; graph validation; historical inspection; deletion refusal; list and statistics output; kind filters; default supersession exclusion; explicit historical selection refusal; unhealthy-successor gaps; and target escape rejection.
- Schema tests cover the new version, every Knowledge Kind, unique supersession identifiers, optional legacy fields, invalid identifiers, and assurance field shape. Cross-page graph rules are tested at the service and CLI seams rather than encoded only as single-document schema rules.
- Loadout tests extend existing allocator coverage. They assert unchanged tier ordering, deterministic exclusions, Required Artifact separation, Scope Tag behavior, Context Budget behavior, and freshness rules while adding kind filtering and lineage cases.
- Verification tests assert health and lifecycle are reported separately and that a broken successor never causes predecessor resurrection.
- Projection tests build from authoritative fixtures, detect source-hash drift, reject incomplete or corrupt state, rebuild byte-identical output, and expose permanent and retryable failures without swallowing errors.
- Benchmark tests use repository-authored fixtures and compare exact expected references, exclusions, Required Artifacts, reason codes, hashes, and report metrics. The normal suite runs smoke fixtures; the full benchmark remains an explicit affected-build check.
- Dependency tests scan production imports through the existing facade-test mechanism and include representative forbidden edges for command, Web, transcript, connector, public interface, and internal/core layers.
- Connector contract tests use a local fixture adapter only. They cover malformed output, target escape, missing provenance, hash mismatch, redaction, transcript opt-in, cross-target rejection, and proof that no connector can write an accepted page.
- Threat-model and retention tests validate documentation structure and report behavior where the repository already uses document or schema validators. Retention tests prove report-only behavior and protection of lineage-participating pages.
- Source-isolation validation reviews the complete change set for external names, repository URLs, copied identifiers, imported fixtures, and non-original prose or code before acceptance. The forbidden source vocabulary is not persisted in production code merely to implement this check.
- Narrow checks run first, followed by the repository's required test, manifest, doctor, generated-skill drift, and wiki validation gates when affected.

## Out of Scope

- Calling an LLM, embedding content, semantic ranking, vector search, or replacing host-agent retrieval.
- Automatic page generation, automatic knowledge merging, automatic conflict resolution, or background reflection.
- A daemon, scheduler, watcher, automatic pull request, external notification, or live agent dispatch.
- Rewriting legacy pages to infer Knowledge Kind, assurance, or lineage.
- Automatically deleting accepted Context Pages, lineage evidence, requests, or verification records.
- Automatically falling back from an unhealthy successor to superseded knowledge.
- Using knowledge assurance to authorize governed execution or weaken approval, policy, isolation, or evidence gates.
- Shipping a vendor-specific connector, network client, account-bearing CLI integration, transcript harvester, or cross-repository knowledge service.
- Adding a search database or new runtime dependency solely for this feature.
- Importing third-party benchmarks, fixtures, schemas, code, prose, branded terms, or repository references.
- Changing the existing meanings of source health, Required Artifact, Scope Tag, Context Budget, Route, Feature, or Loadout.

## Further Notes

- The binding architectural inputs are Amber Protocol's accepted governance-first, contract-driven Context, Context Loadout, evidence-grade verification, and target-local fail-closed decisions.
- The critical invariant is: accepted Context Pages and evidence are authoritative; lineage has one persisted direction; every index and report is derived and rebuildable; every external input re-enters through the Distillation Contract and ingest gate.
- The critical failure behavior is: retain history, exclude superseded knowledge, expose gaps, and never silently resurrect or fabricate a successful result.
- The PRD is intentionally phased so an agent can land the schema and lifecycle invariant before optional projection, benchmark, connector, and policy surfaces, while keeping the final interfaces compatible across phases.
