# Governance Graph Capability Baseline

Last reviewed: 2026-08-19

## Scope and evidence standard

This note establishes a capability baseline for adding a governance graph, durable knowledge base, visual exploration, and sync-runtime projection to Amber Protocol. It compares Amber at commit [`78e1d57`](https://github.com/Bandersnatch0x/amber-protocol/tree/78e1d57e66cd17646fb9adce6bfd3066f9a1984d) with Semantica at commit [`e6b159e5`](https://github.com/semantica-agi/semantica/tree/e6b159e5c586bbd974a34037128afc739efd2a1c).

Evidence grades used below:

- **Verified code**: the default-branch source contains a concrete implementation, usually with tests or an executable route.
- **Documented**: first-party documentation describes the behavior, but this review did not establish the full runtime path.
- **Not established**: bounded source inspection did not find a platform-wide implementation. This is not proof that no partial implementation exists.

The external repository was inspected from its pinned source tree. Its test files were read as implementation evidence, but its test suite and live enterprise connectors were not executed. W3C Recommendations are used only to define interoperability standards, not to infer implementation quality.

## Executive conclusion

Semantica is credible evidence that a graph-native accountability product can combine first-class decisions, explicit causal links, W3C provenance, deterministic rule engines, multiple graph stores, and a browser workbench. The core is not merely a README claim: the pinned source contains concrete decision, provenance, reasoning, storage, integration, and Explorer implementations. Maturity is uneven, however. For example, the dedicated SHACL path invokes `pyshacl`, while the general-purpose `OntologyValidator` still labels consistency and satisfiability checks as placeholder logic and returns `True` for its generic constraint check.

Amber already owns the harder trust boundary for its domain: typed Action contracts, configured-repository confinement, approval-required mutation, fail-closed MCP execution, Session manifests and timelines, accepted Context Pages with hashes and assurance, knowledge-plan materialization, learning write-back checkpoints, and hash-chained ledgers with external anchoring. It should not become a general-purpose semantic data platform.

The recommended direction is therefore:

> Build an **Amber Governance Graph** as a disposable, queryable projection of authoritative Amber and repository artifacts. Add first-class decision and causal records where Amber lacks them, preserve provenance on every projected node and edge, and let the sync runtime replicate events and rebuild projections. Keep authored files, accepted Context Pages, Session evidence, approvals, and ledgers authoritative.

This direction supports the three agreed product shapes with one protocol and data model:

- **Personal self-maintained**: local event journal, embedded projection, local knowledge base, timeline and mind-map views.
- **Team shared**: repository-scoped sync hub, shared review state, conflict visibility, subscriptions, and a team projection.
- **Organization tenant**: tenant identity on every event/node/edge, policy and retention controls, cross-repository read models, and auditable isolation. The protocol carries tenant scope from the first version; hosted multi-tenant operations can arrive later.

## Capability comparison

| Capability | Semantica evidence | Amber baseline | Recommendation |
|---|---|---|---|
| Context graph | **Verified code.** `ContextGraph` stores graph-native context and exposes analytics, causal, policy, and hybrid search paths. The README's broad claim is supported by a substantial implementation, though "everything an agent knows or reasons" is a product aspiration rather than an auditable completeness property. | Amber has typed but separate artifacts: Sessions, timeline events, Context Pages, Loadouts, Actions, Functions, approvals, evidence, and ledgers. `amber.object.query` dispatches only to fixed object projections for session, route, context, ledger, and loop. | **Adopt a governance-specific projection**, not an unrestricted agent-memory graph. |
| Decisions and causality | **Verified code.** `Decision` carries id, category, scenario, reasoning, outcome, confidence, timestamp, maker, embeddings, and metadata. `ContextGraph` records decisions and validates explicit `CAUSED`, `INFLUENCED`, and `PRECEDENT_FOR` edges. Query and analyzer modules implement precedent search, multi-hop paths, and upstream/downstream causal chains; regression tests cover explicit causal edges. | Session decisions are distributed across gate records, approvals, timeline events, plans, ADRs, and acceptance artifacts. There is no canonical Decision node, causal-edge vocabulary, or precedent query. | **Adopt now.** Add an immutable Decision Record and explicit causal/support/supersession edges. Do not record private chain-of-thought; record rationale, evidence references, alternatives considered, outcome, confidence, actor, and timestamps. |
| Provenance and audit export | **Verified code.** `ProvenanceEntry` models Entity/Activity/Agent-related fields, source locations and quotes, derivation, usage, roles, invalidation, and confidence. `ProvenanceManager` supports lineage, tombstone invalidation, audit export to JSON/CSV, and PROV-O RDF export. Checksums include `previous_checksum`; in-memory and SQLite stores are implemented. | Amber has stronger execution evidence for its narrower domain: append-only hash-chain ledgers, JSON/CSV/OTLP-JSON export, Git-tag tail seals, Session evidence, Context source hashes, and fail-closed corruption handling. It does not expose a common provenance envelope or PROV-O mapping across all artifacts. | **Adopt a common provenance envelope now; defer PROV-O export.** Preserve current ledger semantics. Map graph entities/activities/agents to PROV-O only as an interchange projection. |
| Ontology, constraints, compliance | **Mixed.** The SHACL path is real: `_run_pyshacl` imports `pyshacl`, parses data and shapes graphs, and returns a structured report. OWL generation and SKOS import/hierarchy/editing paths also exist. However, the general `OntologyValidator` explicitly contains placeholder consistency/satisfiability checks and a generic `check_constraint()` that returns `True`. | Amber's executable constraints are JSON Schemas, Action capability parity, command registries, route gates, target confinement, and explicit policy checks. These are governance contracts, not RDF ontologies. | **Keep JSON Schema and code-level invariants canonical.** Defer SHACL as a validation/export compatibility layer; defer OWL/SKOS until cross-repository vocabulary management has concrete use cases. Never replace proven gates with ontology inference. |
| Deterministic reasoning | **Verified code.** Forward chaining iterates to a bounded fixed point and returns `InferenceResult`s; the Rete engine has alpha/beta nodes and working memory; Datalog uses delta-driven iteration; SPARQL and explanation generators are separate modules. Tests exist for the base and Datalog reasoners. | Amber has deterministic routing, state transitions, validation, recommendations, and OAG dispatch, but no general rule engine or explanation graph. | **Adopt only domain rules first**: graph traversal, invariant checks, conflict detection, impact queries, and explanation paths. **Defer** general Rete/Datalog/SPARQL rule authoring until real governance rules exceed the current registries. |
| Query surface | **Verified code.** Decision queries, causal traversal, SPARQL, graph-store Cypher, REST routes, CLI, MCP tools, and Explorer endpoints exist. | `amber.object.query` is a safe read-only facade over five fixed object types. It is target-confined and benefits from Amber's contract registry, but cannot traverse relationships or query decisions/knowledge. | **Deepen OAG rather than bypass it.** Add typed graph query variants such as neighborhood, path, precedent, impact, timeline, provenance, and conflict. Bound depth/result size and return explanation metadata. |
| Audit visualization | **Verified source.** The React/Vite Explorer contains graph, decision, lineage, timeline, reasoning, SPARQL, ontology, SHACL, and SKOS workspaces. FastAPI mounts routes for decisions, provenance, temporal views, vocabulary, ontology, graph, analytics, and export. This review did not run the UI. | Amber's web app has Session status, evidence, live activity, virtual timeline, transcript timeline, handoff, and completion workbench components. No graph/mind-map workspace was found. | **Adopt two projections over one selection model**: a time-series/timeline view and a neighborhood/mind-map view, both linked to the same evidence inspector. Keep editing governed and explicit. |
| Storage portability | **Verified code.** Embedded Oxigraph and remote Blazegraph/Jena/RDF4J adapters execute SPARQL; Neo4j, FalkorDB, Apache AGE, and Neptune adapters contain real connection/query paths. Vector-store adapters are also extensive. Uniform maturity was not established; at least one Jena path is documented in source as placeholder logic. | Amber deliberately uses repository-local JSON, JSONL, Markdown, Git, and derived web read models. That keeps governance reviewable and portable. | **Reject polyglot storage as a V1 product promise.** Define a storage-neutral graph/event contract, ship one embedded local projection and one service-side implementation, then add adapters only for demonstrated deployments. |
| Knowledge pipeline and durable knowledge | **Verified broadly, not exhaustively in this review.** Source modules exist for ingestion, chunking, extraction, deduplication, merge, and provenance propagation. | Amber already has accepted Context Pages, source adapters, hash and citation checks, Loadouts, a `knowledge-plan` schema, materialization under `docs/wiki/knowledge/`, and post-accept learning write-back booking. It lacks a unified knowledge graph, semantic entity resolution, and shared sync. | **Adopt a governed knowledge ingestion boundary.** Only accepted Context Pages, reviewed knowledge documents, Decisions, Claims, Evidence, and explicit external adapters enter the durable graph. Raw transcripts and model output remain source material until accepted. Defer generic NER/relation extraction. |
| Integrations | **Verified code with qualification.** The stdio MCP server exposes graph, decision, causal, reasoning, analytics, and export tools; Agno and CrewAI integrations call decision/context APIs. Databricks code supports PAT and OAuth M2M plus Unity Catalog metadata/lineage; Snowflake supports password, key-pair, OAuth, and SSO-related configuration. Their unit tests use mocks; live connectivity was not verified. | Amber's MCP adapter has stricter governance: exact configured-target membership, capability-registry parity, read-only proof before execution, approval-required mutation, and `isError` for corrupt state and failed commands. | **Adopt integration adapters behind Amber Action/Function contracts. Reject direct mutation through a generic graph MCP API.** Defer enterprise connectors until the tenant/runtime boundary and provenance contract are stable. |
| Runtime, sync, tenancy | **Not established platform-wide.** Some stores expose namespaces or multi-tenant options, but bounded inspection found no product-wide RBAC model, tenant-scoped event protocol, or offline/team/org synchronization contract. | Amber is repository-local and has no data-sync runtime. Cross-repository MCP targets are configured at server startup; they are not synchronized. | **Amber must own this design.** Runtime is a sync/index/subscription service, not an agent executor. Tenant/repository/subject scope is mandatory on every replicated event and materialized object. |

## What the README claims versus what the code establishes

### Established strongly enough to learn from

1. **First-class decisions and causal links.** The data model, graph write path, traversal/query code, Explorer routes, MCP tools, and regression tests form a coherent vertical slice.
2. **PROV-shaped provenance and auditable invalidation.** The source implements structured provenance entries, checksum chaining, SQLite persistence, lineage traversal, tombstone invalidation, JSON/CSV audit export, and RDF serialization using PROV-O terms.
3. **Deterministic rule engines.** Forward chaining, Rete, Datalog, SPARQL, and explanations have concrete implementations rather than only module names.
4. **Real browser workbench source.** Graph, timeline, lineage, decisions, ontology, SHACL, and vocabulary workspaces are present in the frontend, with corresponding backend routes.
5. **Real storage and framework adapters.** Multiple backends contain connection and query code; Agno, CrewAI, MCP, Databricks, and Snowflake are represented by executable modules.

### Claims that need narrower wording

1. **"Everything the agent knows, decides, and reasons about."** No system can establish completeness unless every source and decision boundary is instrumented. Amber should promise a graph of **accepted, governed records and their declared derivations**, not an agent's total cognition.
2. **"Full auditability on every fact."** The provenance implementation is substantial, but completeness depends on callers using it consistently. Amber should make provenance fields mandatory at graph ingestion and reject uncited or unbound durable claims.
3. **"Ontology consistency."** The dedicated SHACL implementation is concrete, but the general ontology validator's consistency and satisfiability paths are placeholders at the inspected commit.
4. **"Swappable without code changes."** Common interfaces reduce application changes, but deployment, credentials, query dialects, consistency, and operational behavior still differ. Amber should promise contract portability, not identical backend behavior.
5. **"Enterprise-native."** Connector code and mocked tests establish implementation intent and API shape, not production proof against live workspaces, warehouses, or tenant isolation requirements.

## Amber invariants to preserve

The graph/runtime work must preserve these existing invariants rather than reimplementing them in a second authority:

1. **Repository artifacts remain authoritative.** Accepted Context Pages, authored wiki/spec/ADR content, Session state, approval records, evidence, and ledgers stay reviewable in Git. A graph index can be deleted and rebuilt.
2. **One write enters through one governed Action.** Amber's capability registry decides whether an operation is proven read-only. Mutating graph or knowledge operations return approval-required submissions and record evidence.
3. **Projection is not evidence.** Search ranks, embeddings, inferred edges, summaries, and layout coordinates are disposable derived state. Every result points back to authoritative source hashes.
4. **Facts and inferences are different node kinds.** An inferred relation must record its rule/version, inputs, time, and confidence. It never silently becomes an authored fact.
5. **No hidden-thought capture.** Store concise rationale, alternatives, evidence, decision, and outcome. Do not attempt to persist private chain-of-thought as governance data.
6. **Conflicts remain visible.** Sync and ingestion do not silently overwrite concurrent authored decisions or knowledge. They preserve both versions and emit an explicit conflict object or resolution decision.
7. **Tenant scope is structural.** `tenantId`, repository identity, actor identity, and source identity participate in object keys, authorization, queries, exports, caches, and telemetry from the first protocol version.
8. **Runtime does not execute agents.** It synchronizes, validates envelopes, materializes read models, publishes subscriptions, and detects conflicts. Agent execution remains with hosts and enters Amber through governed receipts.

## Recommended governance graph baseline

This is the smallest graph vocabulary that closes Amber's current gaps without turning it into a general knowledge-graph toolkit.

### Canonical node kinds

| Node | Purpose | Authoritative source |
|---|---|---|
| `Tenant` | Isolation and policy root | Runtime identity/policy store |
| `Repository` | Governed target and sync partition | Configured target identity plus repository metadata |
| `Actor` | Human, agent, service, or organization identity | Identity provider or signed local identity |
| `Session` | Bounded work lifecycle | Session manifest and timeline |
| `Action` | Typed governed operation | Action Type plus invocation receipt |
| `Decision` | Chosen outcome with rationale and alternatives | New immutable Decision Record or mapped ADR/gate decision |
| `Claim` | A reviewable statement that may be supported or contradicted | Accepted Context Page or reviewed knowledge document |
| `Evidence` | Verification, source excerpt, command result, or audit record | Existing evidence and source bundles |
| `Artifact` | Repository file, generated bundle, plan, ADR, or export | Git/blob identity and artifact metadata |
| `ContextPage` | Accepted distilled context | Existing Context Page |
| `KnowledgeDocument` | Reviewed durable knowledge | `docs/wiki/knowledge/` and declared write-back surfaces |
| `Policy` | Constraint or governance rule | Existing policy/route/Action registry artifacts |
| `Approval` | Human/system authorization record | Existing gate and approval evidence |
| `Inference` | Derived conclusion with reproducible rule and inputs | Disposable reasoning projection |

### Canonical edge kinds

- `CAUSED_BY`, `INFLUENCED_BY`, `PRECEDENT_FOR`
- `SUPPORTS`, `CONTRADICTS`, `SUPERSEDES`, `DERIVED_FROM`
- `PRODUCED_BY`, `USED`, `REFERENCES`, `VERIFIES`
- `APPROVED_BY`, `GOVERNED_BY`, `AFFECTS`, `BELONGS_TO`

Every edge carries `edgeId`, tenant and repository scope, source artifact/hash, recorded time, optional valid-time interval, actor, confidence/assurance, and derivation kind (`authored`, `observed`, or `inferred`). Edge direction and cardinality are part of a versioned schema, not UI convention.

### Decision Record minimum

Amber's new Decision Record should include:

- stable id, tenant/repository/session scope, title and category;
- question/context, chosen outcome, rationale, alternatives considered, and trade-offs;
- supporting and contradicting evidence references;
- actor and approver identities;
- status (`proposed`, `accepted`, `superseded`, `rejected`), confidence/assurance;
- recorded time and optional valid-time interval;
- causal, precedent, supersession, policy, and affected-artifact references;
- content hash and provenance envelope.

### Knowledge-base admission

The knowledge base is not a dump of all graph input. Admission is explicit:

1. A source adapter creates a source bundle with target binding and hashes.
2. A Context request defines the distillation contract.
3. Ingest validates schema, citations, hashes, assurance, and approval requirements.
4. Accepted pages, reviewed write-back documents, and Decision Records emit graph events.
5. The runtime materializes full-text/vector indexes and graph projections as disposable views.
6. Supersession, invalidation, or source drift produces new events; history is retained.

This extends Amber's existing Context and knowledge-plan lifecycle rather than creating a competing knowledge authority.

## Query and visualization baseline

The first query surface should be typed and finite:

- `getNode(id)` and `getProvenance(id)`
- `neighbors(id, edgeTypes, depth <= N)`
- `path(from, to, edgeTypes, maxDepth)`
- `precedents(decision, filters, limit)`
- `impact(decisionOrArtifact, direction, maxDepth)`
- `timeline(scope, recordedTime | validTime, cursor)`
- `conflicts(scope, status)`
- `search(text, nodeKinds, assurance, timeRange)`

Every query response includes truncation/cursor state and source pointers. Expensive traversals are bounded; no client can submit arbitrary server-side code.

Two initial visual modes should share selection, filters, and an evidence inspector:

1. **Timeline / time-series mode**: Sessions, Actions, Decisions, approvals, evidence, knowledge updates, sync conflicts, and supersessions ordered by recorded time or valid time.
2. **Mind-map / neighborhood mode**: a bounded ego graph centered on a Decision, Claim, Artifact, or Session, with causal/support/contradiction/provenance edge styling.

The graph is read-first. Edits such as "accept decision," "resolve conflict," or "supersede claim" invoke typed Amber Actions and show approval/evidence state; the canvas itself is not a second mutation API.

## Adopt, defer, reject

### Adopt in the architecture specification

- Governance Graph as a rebuildable projection over authoritative artifacts.
- Immutable Decision Records and an explicit causal/support/supersession vocabulary.
- Mandatory provenance envelope and source pointers on graph events, nodes, and edges.
- Append-oriented, idempotent event ingestion suitable for personal, team, and tenant deployments.
- Typed OAG graph queries with bounded traversal and explanations.
- Governed knowledge admission built on Context Pages, knowledge plans, and reviewed write-back.
- Shared timeline and mind-map visual projections with one evidence inspector.
- Tenant scope in protocol identities and keys from version one.

### Defer until the baseline is proven

- PROV-O/RDF export, SHACL validation of exported graphs, and SPARQL query compatibility.
- General Rete/Datalog authoring and arbitrary ontology inference.
- OWL generation and organization-wide SKOS vocabulary editing.
- Multiple interchangeable graph databases and vector stores.
- Generic NER/relation/event extraction and semantic entity merging.
- Graph analytics such as community detection and link prediction.
- Databricks, Snowflake, and other enterprise ingestion connectors.
- Hosted multi-tenant operations; ship tenant-aware contracts and single-organization self-hosting first.

### Reject as product direction

- Replacing `.amber/`, Git, reviewed documents, or ledgers with a graph database as the source of truth.
- Claiming capture of all agent knowledge or private reasoning.
- Allowing MCP/REST clients to mutate the graph outside Amber Action, approval, and evidence gates.
- Making a universal semantic framework, backend portability, or general AI memory platform the core Amber promise.
- Letting the sync runtime schedule or execute agents.
- Treating inferred edges, embeddings, search rankings, or visual layouts as authoritative evidence.

## Primary sources

### Semantica, pinned source

- [README capability claims](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/README.md#L73-L92)
- [Decision model](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/context/decision_models.py#L87-L136)
- [Decision recording and causal edges](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/context/context_graph.py#L2734-L2772)
- [Decision write path](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/context/context_graph.py#L3174-L3321)
- [Causal trace path](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/context/context_graph.py#L3544-L3689)
- [Decision precedent and multi-hop queries](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/context/decision_query.py)
- [Explicit causal-edge regression tests](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/tests/context/test_decision_causal_edge_regression.py)
- [Provenance schema](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/provenance/schemas.py#L35-L225)
- [Lineage, invalidation, audit, and PROV-O export](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/provenance/manager.py#L1011-L1365)
- [Provenance checksum chain](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/provenance/integrity.py#L27-L150)
- [SHACL execution path](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/ontology/ontology_validator.py#L138-L204)
- [Placeholder general ontology validation](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/ontology/ontology_validator.py#L244-L327)
- [Forward chaining](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/reasoning/reasoner.py#L204-L269)
- [Rete engine](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/reasoning/rete_engine.py#L120-L387)
- [Datalog reasoner](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/reasoning/datalog_reasoner.py)
- [Embedded Oxigraph backend](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/triplet_store/oxigraph_store.py)
- [Neo4j backend](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/graph_store/neo4j_store.py)
- [Explorer application routes](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/explorer/app.py#L171-L190)
- [Explorer graph workspace](https://github.com/semantica-agi/semantica/tree/e6b159e5c586bbd974a34037128afc739efd2a1c/explorer/src/workspaces/GraphWorkspace)
- [Explorer decision workspace](https://github.com/semantica-agi/semantica/tree/e6b159e5c586bbd974a34037128afc739efd2a1c/explorer/src/workspaces/DecisionWorkspace)
- [Explorer ontology, SHACL, and SKOS workspaces](https://github.com/semantica-agi/semantica/tree/e6b159e5c586bbd974a34037128afc739efd2a1c/explorer/src/workspaces/OntologyWorkspace)
- [MCP server](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/mcp_server/__init__.py)
- [Agno decision integration](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/integrations/agno/decision_kit.py)
- [CrewAI decision integration](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/integrations/crewai/decision_tool.py)
- [Databricks ingestion and authentication](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/ingest/databricks_ingestor.py)
- [Snowflake ingestion and authentication](https://github.com/semantica-agi/semantica/blob/e6b159e5c586bbd974a34037128afc739efd2a1c/semantica/ingest/snowflake_ingestor.py)

### Amber Protocol, pinned source

- [Action Type schema](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/schemas/action.type.schema.json)
- [`amber.object.query` variants](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/action-types/object-query.json)
- [MCP capability registry and read-only proof](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/mcp-action-contracts.js)
- [Configured-repository confinement](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/mcp-targets.js)
- [MCP fail-closed and approval-required invariants](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/amber-mcp.js#L12-L28)
- [Session manifest schema](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/schemas/session-manifest.schema.json)
- [Session timeline deep module](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/session-timeline.js)
- [Context Page schema](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/schemas/context-page.schema.json)
- [Knowledge-base materialization](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/knowledge-plan/internal/build.js)
- [Learning write-back checkpoint](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/core/learning-writeback.js)
- [Hash-chain ledger](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/core/loop-ledger.js)
- [Ledger JSON/CSV/OTLP export](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/core/ledger-export.js)
- [Ledger Git-tag anchoring](https://github.com/Bandersnatch0x/amber-protocol/blob/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/scripts/lib/core/ledger-seal.js)
- [Amber Session timeline UI](https://github.com/Bandersnatch0x/amber-protocol/tree/78e1d57e66cd17646fb9adce6bfd3066f9a1984d/apps/web/src/components/session)

### W3C Recommendations

- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/) defines the RDF vocabulary for Entities, Activities, Agents, and their provenance relations.
- [Shapes Constraint Language (SHACL)](https://www.w3.org/TR/shacl/) defines validation of RDF data graphs against shapes graphs.
- [OWL 2 Overview](https://www.w3.org/TR/owl2-overview/) defines the Web Ontology Language family and profiles.
- [SKOS Reference](https://www.w3.org/TR/skos-reference/) defines the RDF model for concept schemes and knowledge-organization vocabularies.
- [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/) defines declarative querying over RDF graphs.
