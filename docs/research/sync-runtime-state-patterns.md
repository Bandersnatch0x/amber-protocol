# State Patterns for a Non-Executing Amber Sync Runtime

> Research date: 2026-08-19  
> Local CLI baseline: Orca `1.4.184`  
> Protocol source baseline: Agent Client Protocol repository commit `15513b2fd532f1b70fd0ff2db6855e7acb523117` (2026-08-19)

## Question

Which state-management patterns from Orca orchestration and the Agent Client Protocol (ACP) are reusable for an Amber Sync Runtime that synchronizes governance data across personal, team, and organization-tenant deployments without executing agents?

## Conclusion

Amber should adopt a transport-independent, cursor-resumable event protocol with explicit ownership, capability negotiation, at-least-once delivery, idempotent application, visible conflicts, advisory cancellation, and provenance-rich observability. Stable governance identities must be separated from transient connections and process handles.

The Sync Runtime must remain a data plane and projection engine. It may ingest, validate, replicate, index, query, and render governance facts. It must not start or stop agents, dispatch work, control terminals or worktrees, or turn observed plans and tool calls into executable commands.

## Source Baseline

The Orca evidence is the first-party, version-matched documentation bundled with the locally installed CLI:

- `[O1]` `orca skills get orchestration`, CLI file version `1.4.184`, captured 2026-08-19.
- `[O2]` `orca skills get orca-cli`, CLI file version `1.4.184`, captured 2026-08-19.

The ACP evidence is pinned to one official repository commit so later protocol changes do not silently alter this research:

- `[A1]` [Initialization](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/initialization.mdx)
- `[A2]` [Session setup and resume](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/session-setup.mdx)
- `[A3]` [Session listing](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/session-list.mdx)
- `[A4]` [Prompt lifecycle and streaming updates](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/prompt-lifecycle.mdx)
- `[A5]` [Request cancellation](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/cancellation.mdx)
- `[A6]` [Tool-call status and permission requests](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/tool-calls.mdx)
- `[A7]` [Agent plan updates](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/agent-plan.mdx)
- `[A8]` [Transport definitions](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/transports.mdx)
- `[A9]` [Extensibility rules](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/protocol/v2/extensibility.mdx)
- `[A10]` [Session resume and replay design](https://github.com/agentclientprotocol/agent-client-protocol/blob/15513b2fd532f1b70fd0ff2db6855e7acb523117/docs/rfds/v2/session-resume-replay.mdx)

## Reusable Patterns

| Concern | Source pattern | Amber recommendation | Decision |
| --- | --- | --- | --- |
| Durable ownership | An Orca Run is a durable namespace and inbox; lifecycle authority belongs to an active Dispatch, while terminal handles are routing metadata, not durable identity. `[O1]` | Give every stream a stable tenant, repository, replica, and stream identity. Treat sockets, processes, and connection IDs as replaceable routing details. | Adopt |
| State separation | Orca separates Run, Task, Dispatch, Delivery, and terminal identity. `[O1]` | Separate `SyncSession`, `SyncOperation`, `Event`, `Delivery`, `Checkpoint`, and `Conflict`; do not overload one status field. | Adopt |
| Capability negotiation | ACP initialization negotiates one major protocol version, both parties' capabilities, implementation information, and authentication methods. `[A1]` | Require `initialize` before synchronization; persist the negotiated protocol and capability set in session evidence. | Adopt |
| Session discovery | ACP exposes stable session IDs, cursor-paginated listing, timestamps, titles, and metadata. `[A3]` | Expose cursor-paginated repository/stream/session discovery with opaque cursors and tenant scoping. | Adopt |
| Resume and replay | ACP reconnects through `session/resume`; replay is explicitly requested from the start or a cursor and occurs before resume completes. `[A2]` `[A10]` | Resume one stable sync session from an acknowledged checkpoint; replay before declaring the session caught up. | Adopt |
| Bounded delivery | Orca returns the oldest bounded FIFO Delivery and replays the exact batch until it is acknowledged. `[O1]` | Use bounded batches and acknowledge only after durable, validated application. Promise at-least-once delivery, not exactly-once delivery. | Adopt |
| Idempotency | Orca gives pending questions, replies, final settlement, and consuming checks durable recovery identities; recovery replays must be processed idempotently. `[O1]` | Deduplicate by immutable `eventId`; reject an ID reused with a different payload hash. | Adopt |
| Streaming state | ACP separates request acceptance from `session/update` notifications and a later terminal state update. `[A4]` | Separate operation acceptance, event streaming, progress, conflicts, and terminal settlement. | Adopt |
| Permission outcome | ACP models permission as an explicit request with typed options; unknown outcomes must not be treated as approval. `[A6]` | Record policy/approval decisions as typed evidence. Unknown, missing, stale, or mismatched decisions fail closed. | Adopt |
| Cancellation | ACP cancellation is a notification and does not guarantee cancellation; the original request still receives a valid or cancelled terminal response. `[A5]` | Make cancellation advisory and idempotent. Always settle the operation and expose partial progress; never imply rollback. | Adopt |
| Recovery authority | Orca degrades to read-only inspection when it cannot prove liveness, principal ownership, capability, or the exact contract. `[O1]` | On identity, policy, capability, or provenance uncertainty, stop applying writes but preserve read-only inspection and export. | Adopt |
| Handoff fencing | Orca distinguishes supervised work from a full ownership transfer and fences the old coordinator during takeover. `[O1]` `[O2]` | Model ownership handoff explicitly with a checkpoint and fencing token; the previous writer loses mutation authority after acceptance. | Adopt |
| Source-pinned cursors | Orca cursors stay pinned to one output source; a source change requires a fresh read rather than cursor reuse. `[O1]` | Bind checkpoints to `sourceReplicaId`, stream generation, and schema version. Never apply a cursor to a different source generation. | Adopt |
| Transport abstraction | ACP currently standardizes stdio while its Streamable HTTP transport remains a draft. `[A8]` | Keep the state protocol transport-independent; choose local and remote transports in a later decision. | Defer transport choice |
| Namespaced extensions | ACP advertises custom capabilities at initialization and reserves namespaced extension data/methods. `[A1]` `[A9]` | Permit namespaced extensions only when advertised; unknown required capabilities reject initialization. | Adopt |

## Proposed Amber Invariants

1. Repository-owned governance artifacts, decisions, and evidence remain authoritative in the repository domain.
2. Identity, membership, tenant policy, and server-issued fencing state remain authoritative in the service domain.
3. Synchronization never silently overwrites concurrent facts. It appends an event, applies a deterministic rule, or emits a first-class conflict.
4. Every accepted event is immutable, content-hashed, tenant-scoped, repository-scoped, and provenance-bearing.
5. A transport connection is never an actor identity, an ownership claim, or a durable checkpoint.
6. Delivery is at least once. Application is idempotent. Exactly-once behavior is not claimed.
7. A timeout is a checkpoint, not evidence of failure. Only an explicit terminal settlement changes an operation to `completed`, `failed`, or `cancelled`. This follows Orca's distinction between wait timeout and worker failure. `[O1]`
8. Unknown permission outcomes, unsupported required capabilities, corrupt state, and unprovable authority fail closed to read-only operation.
9. The runtime does not execute target-project commands or control an agent runtime. This preserves Amber's repository-local governance boundary.

## Recommended State Model

### Stable entities

| Entity | Purpose | Stable identity |
| --- | --- | --- |
| `Tenant` | Security and isolation boundary carried in all three deployment forms | `tenantId` |
| `Principal` | Human, service, or authenticated client that observes or submits events | `principalId` |
| `Repository` | Governed repository namespace | `repositoryId` plus canonical repository fingerprint |
| `Replica` | One local or server-side copy of repository governance state | `replicaId` and `generation` |
| `Stream` | Ordered event partition, normally one repository aggregate or bounded domain aggregate | `streamId` |
| `SyncSession` | Negotiated, resumable synchronization context; never an agent session | `syncSessionId` |
| `SyncOperation` | One pull, push, reconcile, snapshot, or subscription attempt | `operationId` |
| `Event` | Immutable governance fact or state transition | `eventId` |
| `Delivery` | Bounded batch offered to a replica until acknowledged | `deliveryId` |
| `Checkpoint` | Last durably applied position for one source generation | `(sourceReplicaId, generation, cursor)` |
| `Conflict` | Visible unresolved disagreement or invariant violation | `conflictId` |
| `Handoff` | Explicit transfer of mutation ownership | `handoffId` plus fencing token |

### Sync session lifecycle

```text
opening
  -> negotiating
  -> replaying
  -> live
  -> draining
  -> closed

negotiating | replaying | live
  -> degraded_read_only
  -> failed

opening | negotiating | replaying | live | draining
  -> cancelling
  -> cancelled | completed
```

`degraded_read_only` is intentional: discovery, inspection, export, and diagnostics remain available, but the runtime refuses to apply mutations until identity, capability, policy, or provenance is re-established.

### Sync operation lifecycle

```text
pending -> accepted -> streaming -> applying -> caught_up -> completed
                         |            |
                         |            +-> conflicted
                         +--------------> cancelling -> cancelled
                                      +-> failed
```

An operation may finish `completed` with visible conflicts only if the result explicitly reports them. A conflict must never be hidden inside a successful prose message.

## Protocol Envelope

Use one immutable envelope across personal, team, and organization deployments:

```json
{
  "protocolVersion": 1,
  "tenantId": "tenant_...",
  "repositoryId": "repo_...",
  "streamId": "stream_...",
  "sourceReplicaId": "replica_...",
  "sourceGeneration": 3,
  "eventId": "evt_...",
  "sequence": 1042,
  "eventType": "amber.decision.recorded",
  "schemaVersion": 1,
  "actor": { "principalId": "principal_...", "kind": "human" },
  "correlationId": "corr_...",
  "causationId": "evt_...",
  "occurredAt": "2026-08-19T08:00:00Z",
  "observedAt": "2026-08-19T08:00:02Z",
  "payloadHash": "sha256:...",
  "payload": {},
  "provenance": {}
}
```

The ordering guarantee should be monotonic only within one stream and source generation. Cross-stream ordering must use causal links and timestamps, not a fictitious global sequence.

## Initialization and Capability Negotiation

The opening handshake should exchange:

- latest supported major protocol version;
- implementation name and version;
- authenticated principal and tenant context;
- repository and replica identity;
- supported event schema versions;
- supported operations such as `pull`, `push`, `subscribe`, `snapshot`, `conflicts`, and `knowledge_projection`;
- optional compression, batch-size, and transport features;
- required policy version and evidence format;
- namespaced extensions.

Negotiation rules:

1. Select a mutually supported major version or fail initialization.
2. Capabilities are opt-in; absence means unsupported.
3. An unknown required capability fails initialization. An unknown optional capability is ignored and retained in diagnostics.
4. The negotiated result is immutable for the session. A capability change requires a new session.
5. Never infer write permission from transport reachability or authentication alone.

These rules adapt ACP's explicit version/capability handshake without adopting its agent-execution surface. `[A1]` `[A9]`

## Delivery, Acknowledgement, and Conflict Handling

Recommended delivery contract:

1. The producer returns one bounded batch with `deliveryId`, source generation, start cursor, end cursor, and events.
2. The consumer validates tenant/repository scope, schema, hash, provenance, policy, and sequence.
3. The consumer durably applies each event idempotently or records a conflict/rejection.
4. Only after durable application does the consumer acknowledge `deliveryId` and the end cursor.
5. Until acknowledgement, reconnects may receive the exact same delivery.
6. A duplicate `eventId` with the same hash is a no-op; the same ID with a different hash is corruption and fails closed.
7. A batch may not cross tenant, repository, stream generation, or policy boundary.

This mirrors Orca's bounded replay-until-ack delivery rather than attempting fragile exactly-once transport semantics. `[O1]`

Conflicts should be first-class graph nodes with links to both claims, their provenance, the violated invariant, the chosen or pending resolution, and the decision that resolved them. That shape supports both timeline and mind-map visualization without inventing a second audit model.

## Cancellation

Separate two meanings:

- **Request cancellation** stops work associated with one in-flight transport request when possible.
- **Sync operation cancellation** asks the runtime to stop scheduling additional batches for one `operationId`.

Both are advisory. The runtime may finish an already-committed batch, but it must return one terminal result. The terminal result reports the final checkpoint, applied/rejected/conflicted event counts, and whether additional replay is required. Cancellation never implies rollback and never deletes already accepted evidence. This follows ACP's rule that a cancellation request may race with completion and the original request must still settle. `[A5]`

## Reconnection and Recovery

Recommended recovery sequence:

1. Re-authenticate and re-negotiate capabilities.
2. Resume by stable `syncSessionId` or create a new session bound to the same replica.
3. Present the last acknowledged checkpoint, source generation, schema version, and payload hash chain head.
4. The source either accepts incremental replay, requires replay from an earlier safe cursor, or reports a source-generation mismatch.
5. Replay completes before the session reports `live` or `caught_up`.
6. If authority cannot be proven, enter `degraded_read_only`; do not create a replacement writer implicitly.

Never reuse a cursor after `sourceReplicaId`, generation, tenant, repository, or stream identity changes. Orca's source-pinned cursor and stale-handle recovery patterns support this rule, while ACP's `session/resume` plus `replayFrom` supplies the protocol shape. `[O1]` `[A2]` `[A10]`

## Ownership Handoff

A handoff is not a new delivery and not a hidden retry. It is a durable mutation-authority transfer containing:

- source and destination principal/replica;
- tenant, repository, and stream scope;
- last acknowledged checkpoint and hash-chain head;
- negotiated schema and policy versions;
- open conflicts and pending approvals;
- new fencing token;
- acceptance or rejection evidence;
- recovery instructions.

After acceptance, the previous token is fenced and cannot publish new events. The old replica may remain readable. This adapts Orca's explicit full-handoff/takeover distinction without importing coordinator or worker behavior. `[O1]` `[O2]`

## Observability and Knowledge Projection

The event log should be the audit source and the input to query/visualization projections. A separate visualization-specific truth store would create drift.

Minimum runtime telemetry:

- negotiated protocol and capabilities;
- connection state and degraded reason;
- current source generation and cursor;
- last offered and last acknowledged delivery;
- event lag by count and time;
- applied, duplicate, rejected, and conflicted counts;
- retry and replay counts;
- policy and schema versions;
- provenance/hash validation failures;
- handoff/fencing state;
- cancellation request and final settlement.

Minimum event relationships for knowledge accumulation and visualization:

- `caused_by` and `correlated_with`;
- `derived_from` and `supersedes`;
- `decided_by` and `approved_by`;
- `conflicts_with` and `resolves`;
- `belongs_to` tenant/repository/session/feature;
- `observed_by` replica;
- `precedes` within a stream generation.

These relations support two projections from the same evidence:

- **Timeline projection:** ordered state transitions, decisions, approvals, conflicts, sync deliveries, and handoffs.
- **Mind-map/graph projection:** entities and causal/provenance edges, with filters by tenant, repository, feature, decision, and time.

ACP's streamed state, plan, and tool-call updates demonstrate the value of typed incremental observability, but Amber should ingest such data only as external observations. It must not execute reported plans or tool calls. `[A4]` `[A6]` `[A7]`

## Deployment Shapes

One protocol and event envelope should serve all three forms:

| Form | Authority and storage | Runtime topology | Required constraints |
| --- | --- | --- | --- |
| Personal self-maintained | Repository artifacts are authoritative; local identity and policy use a synthetic personal tenant | Embedded/local runtime with one or more device replicas | Tenant field still mandatory; offline append/replay; exportable audit; no remote dependency |
| Team shared | Repository artifacts remain authoritative for work facts; shared service owns membership and team policy | Local replicas synchronize with one shared service | Membership checks, explicit conflicts, repository-scoped subscriptions, handoff/fencing |
| Organization tenant | Repository facts remain repository-authoritative; organization service owns tenant identity, policy, retention, and cross-repository indexes | Tenant-aware service with isolated streams and projections | Tenant scope on every key/query/event, deny-by-default cross-tenant access, per-tenant encryption/retention/audit, noisy-neighbor limits |

Using a synthetic tenant in personal mode prevents a later schema migration from "no tenant" to tenant-aware data. It also preserves the decision that the protocol carries tenant boundaries from day one.

## Adopt, Reject, Defer

### Adopt now

- Stable identities separate from transient handles and connections.
- Explicit ownership and fencing for mutation authority.
- Major-version and capability negotiation before sync.
- Immutable provenance-bearing event envelopes.
- Bounded cursor delivery, replay-until-ack, and idempotent apply.
- Explicit operation/session state machines and typed terminal outcomes.
- Advisory cancellation with visible partial progress.
- Read-only degradation when authority or state cannot be proven.
- Cursor-paginated discovery and resumable replay.
- Timeline and graph projections built from the same event/provenance model.

### Reject

- Agent process startup, shutdown, supervision, or replacement.
- Worker dispatch, task DAG execution, coordinator loops, or automatic retries of agent work.
- Terminal, PTY, worktree, editor, browser, or emulator control.
- Treating plans, tool calls, or terminal output as executable runtime instructions.
- Using a terminal/socket/connection handle as durable actor or ownership identity.
- Silent last-write-wins conflict resolution.
- Exactly-once delivery claims.
- Automatic mutation when identity, capability, provenance, policy, or ownership is uncertain.
- Destructive reset as normal recovery.

### Defer to later decision tickets

- Remote transport choice and reconnection framing; ACP Streamable HTTP is still draft at the pinned source. `[A8]`
- Cross-repository merge rules and domain-specific conflict resolvers.
- Snapshot compaction, event retention, and cryptographic checkpoint rotation.
- Hosted multi-tenant storage engine and physical isolation strategy.
- Dynamic runtime module assembly and connector lifecycle.
- Ingestion contracts for external agent telemetry beyond read-only observations.

## Decision-Ready Recommendation

Define Amber Sync Runtime as a **non-executing, tenant-scoped event synchronization and projection service**. Its core contract is:

```text
negotiate -> discover/resume -> replay bounded events -> validate/apply
          -> acknowledge checkpoint -> stream updates -> settle explicitly
```

The architectural seam should be enforced in the protocol registry: read/query/export and governed synchronization actions are valid; agent execution, terminal/worktree control, and worker dispatch have no Action Type and therefore cannot be invoked through the runtime.
