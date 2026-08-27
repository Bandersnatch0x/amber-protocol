"use strict";

// Single source of truth for user-facing Amber error codes.
// Each code maps to the Amber control layer it defends (see CLAUDE.md).
const CATALOG = {
	AMBER_E_FEATURE_NOT_FOUND: {
		title: "Feature not registered in feature_list.json",
		cause: "A command referenced a feature id that is not present in feature_list.json.",
		remedy: 'amber feature add --id <ID> --title "..."',
		layer: "Context",
		related: ["AMBER_E_FEATURE_NO_EVIDENCE"],
	},
	AMBER_E_GATE_UNCONFIRMED: {
		title: "Plan gate not confirmed",
		cause: "The plan's 'User Confirmation:' field is still 'pending'.",
		remedy: "amber gate --confirm --target . --plan <path>",
		layer: "Governance",
		related: ["AMBER_E_HOOK_PRECOMMIT_BLOCKED"],
	},
	AMBER_E_FEATURE_NO_EVIDENCE: {
		title: "Feature claims completion without evidence",
		cause: "A feature has status passing/accepted/done but an empty evidence array.",
		remedy: 'amber feature verify --feature <ID> --command "<cmd>" --result <pass|fail>',
		layer: "Verification",
		related: ["AMBER_E_HOOK_PRECOMMIT_BLOCKED"],
	},
	AMBER_E_ROUTE_NOT_FOUND: {
		title: "No route matched the session goal",
		cause: "session start could not match the goal to a route trigger and no --route was given.",
		remedy: "amber route list   # then: amber session start --goal <g> --route <name> --confirm",
		layer: "Lifecycle",
		related: [],
	},
	AMBER_E_PLAN_NOT_FOUND: {
		title: "Plan file not found",
		cause: "A command referenced a plan path that does not exist under the target repo.",
		remedy: 'amber plan --target . --feature <ID> --title "..."',
		layer: "Context",
		related: ["AMBER_E_GATE_UNCONFIRMED"],
	},
	AMBER_E_SESSION_INCOMPLETE: {
		title: "Session completion check failed",
		cause: "complete-check found missing verification and/or approval evidence for the session.",
		remedy:
			"amber session verify --session <id> ... --confirm   then   amber session approve --session <id>",
		layer: "Verification",
		related: [],
	},
	AMBER_E_MISSING_PATH_ARG: {
		title: "Required path argument missing",
		cause: "A command that needs a file/path argument was invoked without one.",
		remedy: "Re-run with the documented --flag <path> (see `amber <command> --help`).",
		layer: "Tooling",
		related: ["AMBER_E_INVALID_ARG"],
	},
	AMBER_E_INVALID_ARG: {
		title: "Command argument is invalid",
		cause: "A hooks command received an unsupported format or platform value for one of its flags.",
		remedy:
			"Re-run with a supported value (see the command's --help, e.g. --format json, --platform claude).",
		layer: "Tooling",
		related: ["AMBER_E_MISSING_PATH_ARG"],
	},
	AMBER_E_SETTINGS_UNMERGEABLE: {
		title: "Claude settings file cannot be safely merged",
		cause:
			".claude/settings.json is not a valid JSON object, or its hooks shape is incompatible (hooks not an object, UserPromptSubmit not an array).",
		remedy:
			"Repair .claude/settings.json to a valid JSON object with an optional hooks.UserPromptSubmit array, then retry; the file is left untouched on this error.",
		layer: "Tooling",
		related: [],
	},
	AMBER_E_HOOK_PRECOMMIT_BLOCKED: {
		title: "Commit blocked by Amber governance guard",
		cause: "One or more commit-time governance assertions failed.",
		remedy: "Resolve the listed codes, or bypass once with: AMBER_SKIP_HOOKS=1 git commit ...",
		layer: "Governance",
		related: ["AMBER_E_FEATURE_NO_EVIDENCE"],
	},
	AMBER_E_POLICY_DENY: {
		title: "Command blocked by governance policy",
		cause:
			"A loop governed.command matched a deny rule (or no allow rule under defaultAction=deny).",
		remedy: "Adjust .amber/governance/rules.json or change the contract's governed.command.",
		layer: "Governance",
		related: ["AMBER_E_CONFIDENCE_GATE", "AMBER_E_LOOP_NOT_APPROVED"],
	},
	AMBER_E_CONFIDENCE_GATE: {
		title: "Command blocked by confidence gate",
		cause:
			"Governed execution was allowed by policy but its configured confidence is medium or low; only high confidence may execute.",
		remedy:
			"Complete the required route and plan evidence, then configure the matched rule as high confidence; otherwise use dry-run or human review.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_DENY", "AMBER_E_LOOP_NOT_APPROVED"],
	},
	AMBER_E_LOOP_NOT_APPROVED: {
		title: "Governed loop execution not approved",
		cause: "loop run --execute requires a prior, unconsumed approval record for the contract.",
		remedy: "amber loop approve --file <pack> --contract <id> --reviewer <name>",
		layer: "Governance",
		related: ["AMBER_E_POLICY_DENY", "AMBER_E_CONFIDENCE_GATE"],
	},
	AMBER_E_LEDGER_TAMPERED: {
		title: "Loop ledger hash chain is broken",
		cause: "verify-ledger recomputed a record hash that does not match the stored chain.",
		remedy: "Investigate the flagged record; restore it from version control if it was edited.",
		layer: "Observability",
		related: ["AMBER_E_KB_CORRUPT"],
	},
	// --- Fail-closed ledger reads (F035-S5 decision D4: absence is empty, not corruption) ---
	AMBER_E_KB_CORRUPT: {
		title: "Knowledge ledger is corrupt or unreadable",
		cause:
			"A knowledge-base read hit a corrupt line or unreadable .amber/knowledge/records.jsonl. An absent ledger reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/knowledge/records.jsonl from version control; never delete it to reset — the ledger is append-only provenance.",
		layer: "Observability",
		related: ["AMBER_E_ORG_CORRUPT", "AMBER_E_LEDGER_TAMPERED"],
	},
	AMBER_E_KB_DENY: {
		title: "Knowledge query scope is denied",
		cause:
			"A knowledge-base query named a scope (pageId) with no records — deny-wins semantics refuse rather than guess or return an empty success.",
		remedy:
			"List valid scopes with `amber knowledge list` (or inspect .amber/knowledge/records.jsonl), then re-query with a scope that has records.",
		layer: "Governance",
		related: ["AMBER_E_ORG_DENY", "AMBER_E_GRAPH_DENY"],
	},
	AMBER_E_ORG_CORRUPT: {
		title: "Organization audit ledger is corrupt or unreadable",
		cause:
			"An organization-audit read hit a corrupt line or unreadable .amber/audit/events.jsonl. An absent ledger reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/audit/events.jsonl from version control; never delete it to reset — the ledger is append-only provenance.",
		layer: "Observability",
		related: ["AMBER_E_KB_CORRUPT", "AMBER_E_LEDGER_TAMPERED"],
	},
	AMBER_E_ORG_DENY: {
		title: "Organization audit query is denied",
		cause:
			"The audit query was cross-tenant, missing a scope, or scoped to a tenant/repository with no events — deny-wins semantics refuse rather than guess or return an empty success.",
		remedy:
			"Query your own tenant with an explicit scope that has events; cross-tenant audit is not permitted.",
		layer: "Governance",
		related: ["AMBER_E_KB_DENY", "AMBER_E_GRAPH_DENY"],
	},
	AMBER_E_GRAPH_DENY: {
		title: "Governance graph query scope is denied",
		cause:
			"A graph query named an exact scope with no matching node — deny-wins semantics refuse rather than guess or return an empty graph.",
		remedy:
			"Query `amber object query` without an exact scope, or use a node id that exists in the graph.",
		layer: "Governance",
		related: ["AMBER_E_ORG_DENY", "AMBER_E_KB_DENY"],
	},
	AMBER_E_PROJECTION_MISSING: {
		title: "Governance projection has not been built",
		cause:
			"The projection manifest or output file is absent, so the derived projection cannot be served or verified.",
		remedy:
			"Build it with `amber projection rebuild` (see the projection registry), then re-check status.",
		layer: "Observability",
		related: ["AMBER_E_PROJECTION_DRIFT", "AMBER_E_CONTEXT_PROJECTION_MISSING"],
	},
	AMBER_E_PROJECTION_DRIFT: {
		title: "Governance projection is drifted",
		cause:
			"The projection manifest is unreadable, fails its schema, or its recorded source/output hashes no longer match the canonical state — the derived view may be stale or tampered.",
		remedy: "Rebuild it with `amber projection rebuild`; investigate unexpected repeated drift.",
		layer: "Verification",
		related: ["AMBER_E_PROJECTION_MISSING", "AMBER_E_CONTEXT_PROJECTION_DRIFT"],
	},
	AMBER_E_PROJECTION_RESOURCE_CEILING: {
		title: "Governance projection exceeds its resource ceiling",
		cause:
			"Building the Governance Graph would produce more nodes or edges than the projection's resource ceilings allow (defaults: 20,000 nodes / 200,000 edges; env overrides AMBER_PROJECTION_MAX_NODES / AMBER_PROJECTION_MAX_EDGES). A projection over its bounds is refused — never emitted as a truncated success that pretends to be the complete graph.",
		remedy:
			"Raise AMBER_PROJECTION_MAX_NODES / AMBER_PROJECTION_MAX_EDGES deliberately to bound the rebuild cost for this store size, or split the target's state so one projection stays bounded.",
		layer: "Verification",
		related: ["AMBER_E_PROJECTION_MISSING", "AMBER_E_PROJECTION_DRIFT"],
	},
	AMBER_E_CONTEXT_SCHEMA_INVALID: {
		title: "Context page payload fails the page schema",
		cause: "ingest received a payload that does not satisfy schemas/context-page.schema.json.",
		remedy:
			"Re-distil the page against the request's output schema; validate locally with `amber context verify`.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_CLAIM_UNCITED"],
	},
	AMBER_E_CONTEXT_REQUEST_MISSING: {
		title: "Context ingest request is missing",
		cause:
			"ingest was invoked without a readable Distillation Contract, so the payload has no authority or source binding.",
		remedy: "Create a request with `amber context request`, then ingest with its request id.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_REQUEST_MISMATCH"],
	},
	AMBER_E_CONTEXT_REQUEST_MISMATCH: {
		title: "Context payload does not match its request",
		cause:
			"the payload page, scope, or bundled sources differ from the Distillation Contract named by the ingest request id.",
		remedy:
			"Return output for the exact request without changing its target, scope, sources, excerpts, or hashes.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_REQUEST_MISSING"],
	},
	AMBER_E_CONTEXT_CLAIM_UNCITED: {
		title: "Context page block cites an undeclared source",
		cause:
			"A block's sources array names ids absent from the page's sources map, so its claims have no verifiable provenance. (Schema already forbids empty sources arrays.)",
		remedy:
			'Reference only source ids the page declares; mark uncovered content as type "unknown" instead of inventing a citation.',
		layer: "Context",
		related: ["AMBER_E_CONTEXT_SCHEMA_INVALID"],
	},
	AMBER_E_CONTEXT_SOURCE_MISSING: {
		title: "Context page source no longer exists",
		cause:
			"A referenced source path is absent on disk. For mutable sources this blocks refresh; for immutable sources re-verification is unavailable (the page stands on its embedded excerpt).",
		remedy:
			"Restore the source, or re-request the page so sources are re-bundled; if every mutable source is gone the page becomes obsolete.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_PAGE_OBSOLETE"],
	},
	AMBER_E_CONTEXT_SOURCE_INVALID: {
		title: "External Context source candidate is invalid",
		cause:
			"An opt-in source adapter returned malformed provenance, hashes, identifiers, or content.",
		remedy:
			"Correct the target-local fixture and retry `amber context source-adapter --enable --fixture <file>`.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_SOURCE_MISSING", "AMBER_E_CONTEXT_SCHEMA_INVALID"],
	},
	AMBER_E_CONTEXT_ADAPTER_DISABLED: {
		title: "External Context source adapter is disabled",
		cause: "Source adapters are opt-in and the command was invoked without explicit enablement.",
		remedy:
			"Inspect the target-local fixture, then retry with `amber context source-adapter --enable --fixture <file>`.",
		layer: "Governance",
		related: ["AMBER_E_CONTEXT_SOURCE_INVALID"],
	},
	AMBER_E_CONTEXT_TRANSCRIPT_OPT_IN: {
		title: "Transcript source requires explicit opt-in",
		cause:
			"A Source Bundle candidate contains transcript content, which is excluded by default because it may contain sensitive data.",
		remedy:
			"Select and inspect the transcript explicitly, then retry with `--allow-transcript`; Amber applies redaction before returning the candidate.",
		layer: "Governance",
		related: ["AMBER_E_CONTEXT_ADAPTER_DISABLED", "AMBER_E_CONTEXT_SOURCE_INVALID"],
	},
	AMBER_E_CONTEXT_RETENTION_INVALID: {
		title: "Context retention options are invalid",
		cause: "The report-only retention command received an invalid age threshold.",
		remedy: "Retry `amber context retention --older-than-days <positive-number>`.",
		layer: "Lifecycle",
		related: [],
	},
	AMBER_E_CONTEXT_PAGE_SUPERSEDED: {
		title: "Context Page has been superseded",
		cause:
			"A Loadout explicitly requested retained historical knowledge that has one or more accepted successors.",
		remedy:
			"Use the reported successor Context Page ids, or inspect the historical page with `amber context show --page <id>`.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_PAGE_OBSOLETE"],
	},
	AMBER_E_CONTEXT_PROJECTION_MISSING: {
		title: "Context projection is unavailable",
		cause:
			"The derived Context index projection is missing or unreadable, so consumers cannot prove it is complete.",
		remedy:
			"Rebuild it with `amber context projection rebuild`, then check `amber context projection status`.",
		layer: "Observability",
		related: ["AMBER_E_CONTEXT_PROJECTION_DRIFT"],
	},
	AMBER_E_CONTEXT_PROJECTION_DRIFT: {
		title: "Context projection does not match accepted pages",
		cause:
			"The projection's recorded source hashes or content hash differ from the authoritative Context Pages.",
		remedy:
			"Rebuild it with `amber context projection rebuild`; investigate unexpected repeated drift.",
		layer: "Verification",
		related: ["AMBER_E_CONTEXT_PROJECTION_MISSING"],
	},
	AMBER_E_CONTEXT_BENCHMARK_FAILED: {
		title: "Context Loadout benchmark failed",
		cause:
			"A deterministic fixture missed an expected page, admitted a forbidden page, lost Required Artifact coverage, or produced unstable output.",
		remedy:
			"Inspect the report's metric-specific failure reasons, correct selection behavior, and rerun `amber context benchmark --fixture <file>`.",
		layer: "Verification",
		related: ["AMBER_E_CONTEXT_LOADOUT_REQUIRED", "AMBER_E_CONTEXT_PROJECTION_DRIFT"],
	},
	AMBER_E_CONTEXT_LOADOUT_ROUTE: {
		title: "Context loadout requires a valid route",
		cause: "`amber context load` was invoked without --route, or the route id is not kebab-case.",
		remedy:
			"Pass --route <id> matching a Route manifest in routes/*.route.json (e.g. --route feature-standard).",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW"],
	},
	AMBER_E_CONTEXT_LOADOUT_MISSING: {
		title: "Context Loadout file is unavailable",
		cause:
			"`amber context verify --loadout` received a missing path or a path that resolves outside the Target Repository.",
		remedy:
			"Regenerate the Loadout with `amber context load --route <id>`, then verify its target-local path.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_LOADOUT_CORRUPT", "AMBER_E_CONTEXT_LOADOUT_REQUIRED"],
	},
	AMBER_E_CONTEXT_LOADOUT_CORRUPT: {
		title: "Context Loadout is corrupt",
		cause: "The Loadout is not valid JSON or does not satisfy schemas/context-loadout.schema.json.",
		remedy:
			"Discard the invalid artifact and regenerate it with `amber context load --route <id>`.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_LOADOUT_MISSING", "AMBER_E_CONTEXT_SCHEMA_INVALID"],
	},
	AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW: {
		title: "Context loadout required tier exceeds the budget",
		cause:
			"Required Artifacts plus required-tier Pages exceed the budget, so the Loadout cannot be provably bounded.",
		remedy:
			"Raise --budget, unpin optional required Pages, or reduce required input size. No Loadout file is written on this error.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_LOADOUT_ROUTE"],
	},
	AMBER_E_CONTEXT_LOADOUT_REQUIRED: {
		title: "Context loadout required artifact is invalid",
		cause:
			"the target-local Operating Manual, selected Route manifest, or Loadout Definition is missing, outside the target, or no longer matches its recorded hash.",
		remedy:
			"Run `amber init` to install the required artifacts, restore any missing file, then regenerate and verify the Loadout.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW", "AMBER_E_CONTEXT_LOADOUT_MISSING"],
	},
	AMBER_E_CONTEXT_SOURCE_STALE: {
		title: "Context page source is stale",
		cause:
			"A mutable source's normalized hash no longer matches the stored normHash, so the page may describe outdated code.",
		remedy:
			'Run `amber context refresh` to generate a refresh request, execute it, then ingest; or ingest {"outcome":"no-change"} to rebase hashes.',
		layer: "Context",
		related: ["AMBER_E_CONTEXT_SOURCE_MISSING"],
	},
	AMBER_E_CONTEXT_SOURCE_TAMPERED: {
		title: "Immutable context source has been modified",
		cause:
			"An immutable source (append-only ledger, archived session, accepted ADR) no longer matches the page's embedded excerpt hash.",
		remedy:
			"Investigate the source; append-only artifacts must not change. Restore from version control or re-request the page.",
		layer: "Verification",
		related: ["AMBER_E_LEDGER_TAMPERED"],
	},
	AMBER_E_CONTEXT_PAGE_ORPHANED: {
		title: "Context page absent from the generated index",
		cause:
			"A page under .amber/context/pages/ is missing from docs/wiki/context-index.md (or the index lists a page with no file).",
		remedy:
			"Regenerate the index via `amber context ingest` / `amber context refresh` / `amber context delete`.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_PAGE_OBSOLETE"],
	},
	AMBER_E_CONTEXT_PAGE_OBSOLETE: {
		title: "Context page's subject no longer exists",
		cause:
			"Every mutable source of the page is missing on disk, so the page describes something that is gone.",
		remedy:
			"Delete the page with `amber context delete --page <id>`, or re-request it against surviving evidence.",
		layer: "Context",
		related: ["AMBER_E_CONTEXT_SOURCE_MISSING"],
	},
	// --- Governed Memory Layer (spec 2026-08-21 §12; extends, never rebuilds) ---
	// layer is Context for the whole family, inheriting the AMBER_E_CONTEXT_* tier.
	AMBER_E_MEMORY_RATE_LIMITED: {
		title: "168h 窗口内 memory-ingest 准入已达 5 条上限，提交整体拒绝",
		cause: "entries[] 超剩余配额（γ 168h 滚动窗口内 memory-ingest 准入事件 ≥ 5）。",
		remedy: "缩减后重交，或待窗口滚动（request 保留）。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_BUDGET_EXCEEDED"],
	},
	AMBER_E_MEMORY_SOURCE_STALE: {
		title: "条目 provenance 源 normHash 漂移或源失效",
		cause: "源被修改或清除，登记哈希与当前源不符。",
		remedy: "复审条目：修正后重验或 supersede。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_SURFACE_DRIFT"],
	},
	AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID: {
		title: "载荷未过 memory-request schema",
		cause: "字段缺失或类型错误。",
		remedy: "修正后重交（request 保留）。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID"],
	},
	AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID: {
		title: "条目未过 memory-entry schema",
		cause: "字段缺失或类型错误（signal 闭集/枚举违例在 AMBER_E_MEMORY_SIGNAL_INVALID 单列）。",
		remedy: "修正后重交。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID", "AMBER_E_MEMORY_SIGNAL_INVALID"],
	},
	AMBER_E_MEMORY_BINDING_MISMATCH: {
		title: "checkRequestBinding 逐源哈希比对失败",
		cause: "源文件与 request 登记哈希不符。",
		remedy: "重新生成 request。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_SOURCE_STALE"],
	},
	AMBER_E_MEMORY_BUDGET_EXCEEDED: {
		title: "α 预算耗尽状态拒绝新准入",
		cause: "MEMORY.md 物理条目数或字节数达上限（条目数 ≥ 50 或字节数 ≥ 8192）。",
		remedy: "拆分为多条、或经 β 指认 supersedeTarget 腾出预算（禁止裸拒绝）。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_RATE_LIMITED"],
	},
	AMBER_E_MEMORY_SIGNAL_INVALID: {
		title: "provenance.signal 缺失或不属 6 闭集",
		cause: "转换/dreaming 通道的 request 未提供 §6.1 闭集信号 id。",
		remedy: "引用闭集信号 id 之一。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID"],
	},
	AMBER_E_MEMORY_APPROVAL_REQUIRED: {
		title: "非 TTY 调用人判定动词且无 --yes",
		cause: "非交互环境执行 request/ingest/book 或 approve/abandon。",
		remedy: "由人在 TTY 执行或显式 --yes（agent 永不传）。",
		layer: "Context",
		related: [],
	},
	AMBER_E_MEMORY_ENTRY_NOT_FOUND: {
		title: "entryId 不在 registry",
		cause: "指针指向不存在条目。",
		remedy: "核对 `amber memory status` 与 entryId。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_REQUEST_NOT_FOUND"],
	},
	AMBER_E_MEMORY_REQUEST_NOT_FOUND: {
		title: "requestId 无对应 request 文件",
		cause: "指针指向不存在 request。",
		remedy: "核对 `amber memory status` 与 requestId。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_ENTRY_NOT_FOUND"],
	},
	AMBER_E_MEMORY_STATE_INVALID: {
		title: "状态机非法迁移",
		cause: "如 approve 非 proposal 条目、参数互斥违例。",
		remedy: "对照 §4.1 迁移表。",
		layer: "Context",
		related: [],
	},
	AMBER_E_MEMORY_SURFACE_DRIFT: {
		title: "登记 surface normHash 漂移",
		cause: "关联条目进入 needs-re-review。",
		remedy: "按 §11-4 二选一 remedy 处置。",
		layer: "Context",
		related: ["AMBER_E_MEMORY_SOURCE_STALE"],
	},
	// --- ADR-0020 Stage A governed local transport (F041) ---
	AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED: {
		title: "Sync transport execution requires explicit approval",
		cause:
			"sync session push --execute was invoked without --yes, or non-interactively without an explicit confirmation.",
		remedy:
			"Review the report (default push), approve with `amber sync session approve --reviewer <name>`, then re-run with --execute --yes.",
		layer: "Governance",
		related: ["AMBER_E_SYNC_TRANSPORT_NOT_APPROVED", "AMBER_E_LOOP_NOT_APPROVED"],
	},
	AMBER_E_SYNC_TRANSPORT_NOT_APPROVED: {
		title: "Sync transport has no unconsumed approval",
		cause:
			"executeTransport found no unconsumed approval record in .amber/sync/transport/ledger.jsonl (each approval authorizes exactly one execution).",
		remedy:
			"Record a fresh approval: amber sync session approve --reviewer <name> --target <repo>.",
		layer: "Governance",
		related: ["AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED", "AMBER_E_POLICY_DENY"],
	},
	AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED: {
		title: "Sync transport blocked by governance policy",
		cause:
			"A derived git operation (add/commit) was denied by .amber/governance/rules.json (deny rule, or no allow rule under defaultAction=deny, or missing/invalid rules).",
		remedy:
			"Allow the sync transport git operations in .amber/governance/rules.json, then re-approve and retry.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_DENY", "AMBER_E_SYNC_TRANSPORT_NOT_APPROVED"],
	},
	AMBER_E_SYNC_TRANSPORT_DIRTY_TREE: {
		title: "Sync transport refused: index or path confinement failed",
		cause:
			"The git index already holds staged paths, or a sync path resolves (via symlink) outside the target repository — git commit commits the whole index, so pre-staged content would be swept into the transport commit.",
		remedy:
			"Commit or reset the staged changes first (git restore --staged .), remove symlinks under .amber/sync, then re-run the transport.",
		layer: "Governance",
		related: ["AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED"],
	},
	AMBER_E_ARTIFACT_ORPHANED_HALF: {
		title: "Canonical Artifact pair is incomplete",
		cause:
			"Admission arrived incomplete: a Body without an Envelope, an Envelope without a Body, or no artifact identity to bind the pair; ADR-0023 requires the pair to be committed atomically.",
		remedy: "Re-admit with both the Artifact Body and its Artifact Envelope in one call.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_HASH_MISMATCH", "AMBER_E_ARTIFACT_CONFLICT"],
	},
	AMBER_E_ARTIFACT_HASH_MISMATCH: {
		title: "Canonical Artifact Body/Envelope hash mismatch",
		cause:
			"The Envelope's recorded Body hash does not match the canonical serialization of the submitted Body.",
		remedy:
			"Regenerate the Envelope from the current Body so both sides bind to the same contentHash, then re-admit.",
		layer: "Verification",
		related: ["AMBER_E_ARTIFACT_ORPHANED_HALF", "AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH"],
	},
	AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH: {
		title: "Canonical Artifact Envelope hash mismatch",
		cause:
			"The stored Envelope no longer matches its recorded envelopeHash — its metadata (provenance, supersedes, lifecycle references) was edited after admission.",
		remedy:
			"Restore the Envelope file from version control; never edit a committed Envelope in place — any change is a new admission input.",
		layer: "Verification",
		related: ["AMBER_E_ARTIFACT_HASH_MISMATCH"],
	},
	AMBER_E_ARTIFACT_JOURNAL_CORRUPT: {
		title: "Canonical Artifact journal is corrupt or unreadable",
		cause:
			"An artifact read or admission hit a corrupt line or unreadable .amber/artifacts journal.jsonl. An absent journal reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/artifacts/<type>/<identity>/journal.jsonl from version control; never delete it — the journal is append-only provenance.",
		layer: "Observability",
		related: [
			"AMBER_E_KB_CORRUPT",
			"AMBER_E_LEDGER_TAMPERED",
			"AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT",
		],
	},
	AMBER_E_ARTIFACT_CONFLICT: {
		title: "Canonical Artifact compare-and-swap conflict",
		cause:
			"The admission's expected head (supersedes revision) is not the artifact's current committed revision.",
		remedy:
			"Read the current revision with `amber artifact show`, then re-admit superseding that revision.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_NOT_FOUND", "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT"],
	},
	AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT: {
		title: "Canonical Artifact idempotency conflict",
		cause:
			"A retry presented canonical content that differs from the admission already settled at the same position — the same Artifact Body with different provenance at the current head, or an idempotency key reused for different content.",
		remedy:
			"Replay the exact original admission (identical Body, provenance, and expected head) to receive the original receipt, or admit the changed content as a new revision with an explicit expected head and a fresh idempotency key.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_CONFLICT", "AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH"],
	},
	AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT: {
		title: "Canonical Artifact settlement state is corrupt",
		cause:
			"The settlement journal replays to a state admission itself could never have written — a revision committed twice, committed without a matching prepared record, committed against a stale expected head (forked settlement), a skipped revision slot, a committed record stripped of the settlement hashes its journal otherwise carries, a committed Body/Envelope pair missing or mismatched on disk, or a pure ticket-01 legacy journal that admission refuses to extend with hash-bearing records — detected at admission or by a verification read (show/list).",
		remedy:
			"Restore .amber/artifacts/<type>/<identity>/ (journal and revision files) from version control; the journal is append-only provenance and must never be hand-edited. For a pure ticket-01 legacy journal, re-admit the content as a fresh store instead of migrating in place.",
		layer: "Observability",
		related: [
			"AMBER_E_ARTIFACT_JOURNAL_CORRUPT",
			"AMBER_E_ARTIFACT_CONFLICT",
			"AMBER_E_ARTIFACT_TRACE_CYCLE",
		],
	},
	AMBER_E_ARTIFACT_NOT_FOUND: {
		title: "Canonical Artifact or revision not found",
		cause:
			"A read named an identity or revision with no committed record — including a case-variant of a stored spelling, since identity matching is exact. Prepared and aborted revisions are invisible by design.",
		remedy:
			"List committed artifacts with `amber artifact list` to see valid identities and revisions; when the message names a stored spelling, use that exact spelling.",
		layer: "Observability",
		related: ["AMBER_E_ARTIFACT_CONFLICT", "AMBER_E_ARTIFACT_IDENTITY_CASE_COLLISION"],
	},
	AMBER_E_ARTIFACT_UNKNOWN_TYPE: {
		title: "Canonical Artifact type is not registered",
		cause:
			"Admission named an Artifact Type outside the closed registry (currently intent, spec, and plan).",
		remedy: "Use a registered Artifact Type: `intent`, `spec`, or `plan`.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_ORPHANED_HALF", "AMBER_E_ARTIFACT_TRANSITION_UNKNOWN"],
	},
	AMBER_E_ARTIFACT_INVALID_IDENTITY: {
		title: "Canonical Artifact identity is not a usable directory name",
		cause:
			'Admission named an artifact identity that is empty or a pure-dot path segment ("." / ".."); such names would resolve the artifact home outside its per-identity directory.',
		remedy:
			"Re-admit with a concrete identity (letters, digits, dots, dashes, underscores; e.g. intent/login-bug).",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_ORPHANED_HALF"],
	},
	AMBER_E_ARTIFACT_IDENTITY_CASE_COLLISION: {
		title: "Canonical Artifact identity collides by letter case with an existing artifact",
		cause:
			"Admission named an identity that differs only by letter case from an existing artifact home of the same type. Directory-name case folding (Windows, default macOS) would alias the two spellings to one artifact home, so the store refuses the ambiguity instead of normalizing: identity spelling is exact, and the check compares stored directory entries so the verdict is identical on case-sensitive filesystems.",
		remedy:
			"Re-admit with the exact stored spelling (run `amber artifact list` to see it), or choose an identity that differs by more than case.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_INVALID_IDENTITY", "AMBER_E_ARTIFACT_NOT_FOUND"],
	},
	AMBER_E_ARTIFACT_TRANSITION_UNKNOWN: {
		title: "Canonical Artifact lifecycle transition is not registered",
		cause:
			"Admission named a lifecycle transition outside the closed per-type transition table (the registry in canonical-artifact-contracts).",
		remedy:
			"Use a registered transition for the artifact type: `accept` moves an Intent draft to accepted; `approve` moves a Spec or Plan draft to approved.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRANSITION_INVALID", "AMBER_E_ARTIFACT_UNKNOWN_TYPE"],
	},
	AMBER_E_ARTIFACT_TRANSITION_INVALID: {
		title: "Canonical Artifact lifecycle transition does not apply",
		cause:
			"The named transition is registered for the artifact type but its from-state does not match the artifact's current committed lifecycle state.",
		remedy:
			"Read the current head with `amber artifact show` and admit a transition that applies to its lifecycle state.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRANSITION_UNKNOWN", "AMBER_E_ARTIFACT_CONFLICT"],
	},
	AMBER_E_ARTIFACT_TRACE_UNKNOWN: {
		title: "Canonical Artifact trace type is not registered",
		cause:
			"Admission named a trace type outside the versioned trace registry (refines, realizes, supersedes).",
		remedy:
			"Use a registered trace type: `refines` (Spec to accepted Intent), `realizes` (Plan to approved Spec), or `supersedes` (same-type revision succession).",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRACE_DIRECTION", "AMBER_E_ARTIFACT_TRACE_CARDINALITY"],
	},
	AMBER_E_ARTIFACT_TRACE_DIRECTION: {
		title: "Canonical Artifact trace direction is invalid",
		cause:
			"The trace's declared or resolved target type does not satisfy the trace contract's direction (fromType/toType) — including a Plan attempting to realize an Intent directly (omitted-Spec policy).",
		remedy:
			"Point the trace at a target the contract allows: a Spec refines an accepted Intent revision; a Plan realizes an approved Spec revision — admit the intervening Spec first.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRACE_UNKNOWN", "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND"],
	},
	AMBER_E_ARTIFACT_TRACE_CARDINALITY: {
		title: "Canonical Artifact trace cardinality is violated",
		cause:
			"The admission's traces violate the trace contract's cardinality — required planning lineage (a Spec refining exactly one accepted Intent revision; a Plan realizing exactly one approved Spec revision) was missing, duplicated, or carried a forbidden same-source trace type.",
		remedy:
			"Admit exactly one required trace: a Spec carries one `refines` trace to an accepted Intent revision; a Plan carries one `realizes` trace to an approved Spec revision.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRACE_UNKNOWN", "AMBER_E_ARTIFACT_TRACE_DIRECTION"],
	},
	AMBER_E_ARTIFACT_TRACE_SCOPE: {
		title: "Canonical Artifact trace crosses a scope boundary",
		cause:
			"The trace's target artifact lives outside the source's scope confinement — every registered planning trace requires the same scope.",
		remedy:
			"Admit the trace within one scope, or admit a new artifact in the target scope that carries the cross-scope relationship in its Body.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRACE_DIRECTION", "AMBER_E_INVALID_ARG"],
	},
	AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND: {
		title: "Canonical Artifact trace target has no committed revision",
		cause:
			"The trace names a target identity (and optional revision) with no committed revision — prepared and aborted revisions are invisible by design.",
		remedy:
			"Admit and settle the target artifact first (for example, accept the Intent before a Spec refines it), then re-admit the trace.",
		layer: "Observability",
		related: ["AMBER_E_ARTIFACT_NOT_FOUND", "AMBER_E_ARTIFACT_TRACE_DIRECTION"],
	},
	AMBER_E_ARTIFACT_TRACE_TARGET_LIFECYCLE: {
		title: "Canonical Artifact trace target lifecycle state is insufficient",
		cause:
			"The trace's target revision is committed but has not reached the lifecycle state the trace contract requires (a Spec may only refine an accepted Intent revision; a Plan may only realize an approved Spec revision).",
		remedy:
			"Advance the target first — accept the Intent (or approve the Spec) via its registered transition, then re-admit the trace.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_TRANSITION_INVALID", "AMBER_E_ARTIFACT_TRACE_CARDINALITY"],
	},
	AMBER_E_ARTIFACT_TRACE_CYCLE: {
		title: "Canonical Artifact trace lineage is cyclic",
		cause:
			"The committed trace graph (refines / realizes / supersedes edges between committed revisions, across artifacts) contains a cycle. Admission can never produce one — every trace binds an already-committed revision and committed revisions are immutable — so a cycle means hand-edited Body or Envelope state.",
		remedy:
			"Restore .amber/artifacts/ from version control; never hand-edit a committed revision's Envelope — a lineage change is always a new admission.",
		layer: "Observability",
		related: ["AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT", "AMBER_E_ARTIFACT_TRACE_DIRECTION"],
	},
	AMBER_E_ARTIFACT_IO: {
		title: "Canonical Artifact durable write failed",
		cause:
			"Admission failed on the filesystem — creating the artifact home or its exclusive admission lock (full-review follow-up finding 6), writing the committed Body/Envelope pair, or appending a journal record — the durable serialization point could not complete. These are I/O conditions, never compare-and-swap races.",
		remedy:
			"Free disk space and check filesystem permissions under .amber/artifacts/, then re-admit; inspect journal.jsonl to see whether the prepared record needs a retry pass.",
		layer: "Observability",
		related: ["AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT", "AMBER_E_ARTIFACT_JOURNAL_CORRUPT"],
	},
	AMBER_E_ARTIFACT_UNSUPPORTED_VERSION: {
		title: "Canonical Artifact Envelope declares an unsupported version",
		cause:
			"The Envelope's schemaVersion (or traceContractVersion, on an Envelope carrying Traces) is not a version this reader supports. Version negotiation is fail-closed: a version the reader cannot interpret is rejected at admission and at every read — show, list, projection rebuild — never silently reinterpreted.",
		remedy:
			"Upgrade amber to a version that supports the declared Envelope/Trace schema, or re-admit the artifact under the supported schema version (1).",
		layer: "Governance",
		related: [
			"AMBER_E_ARTIFACT_UNKNOWN_FIELD",
			"AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT",
			"AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH",
		],
	},
	AMBER_E_ARTIFACT_UNKNOWN_FIELD: {
		title: "Canonical Artifact Envelope carries an unknown field",
		cause:
			"The stored Envelope has a top-level field outside the closed core field set — written by a newer writer or hand-edited. A required field this reader does not recognize is rejected, never silently dropped.",
		remedy: `Upgrade amber to a version that knows the field, or restore the Envelope from version control; extension data belongs under the reserved "extensions" carrier, never at the top level.`,
		layer: "Governance",
		related: [
			"AMBER_E_ARTIFACT_UNSUPPORTED_VERSION",
			"AMBER_E_ARTIFACT_EXTENSION_COLLISION",
			"AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH",
		],
	},
	AMBER_E_ARTIFACT_EXTENSION_COLLISION: {
		title: "Canonical Artifact extension namespace contract violated",
		cause: `The reserved "extensions" carrier violates the namespace contract: the carrier is not an object of namespace → { key → value }, or a namespace or extension key collides with (would shadow) a core Envelope field, or an extension value is not JSON. Unregistered namespaces are otherwise carried opaquely and never alter core semantics.`,
		remedy:
			"Carry extension data only inside the extensions carrier, under namespace and key names that never match a core Envelope field (type, identity, revision, traces, ...), with JSON values; rename the colliding namespace or key.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_UNKNOWN_FIELD", "AMBER_E_INVALID_ARG"],
	},
	AMBER_E_ARTIFACT_SIZE_CEILING: {
		title: "Canonical Artifact exceeds its admission size ceiling",
		cause:
			"The Body (default 512 KiB, env AMBER_ARTIFACT_MAX_BODY_BYTES) or the serialized Envelope (default 256 KiB, env AMBER_ARTIFACT_MAX_ENVELOPE_BYTES) exceeds its size ceiling, so admission refuses before any durable state is touched — an oversized artifact never reaches the journal.",
		remedy:
			"Split the artifact into smaller admissions, or raise the ceiling deliberately via AMBER_ARTIFACT_MAX_BODY_BYTES / AMBER_ARTIFACT_MAX_ENVELOPE_BYTES (positive integers; garbage fails closed as AMBER_E_INVALID_ARG).",
		layer: "Governance",
		related: ["AMBER_E_INVALID_ARG", "AMBER_E_PROJECTION_RESOURCE_CEILING"],
	},
	// --- F050 Decisions, Gates & Evidence Assurance (ticket 1, #226) ---
	// Principal registry + Decision artifacts. The registry family covers the
	// append-only ledger under .amber/principals/registry.jsonl; the decision
	// family covers Decision admission (a Canonical Artifact of type decision)
	// and its human-only authority slots.
	AMBER_E_PRINCIPAL_REGISTRY_CORRUPT: {
		title: "Principal registry is corrupt or unreadable",
		cause:
			"A principal registry read hit a corrupt line or an event sequence the register/revoke writers could never have produced (a duplicate registration, a revocation of an unknown or already-revoked principal, a malformed event, or an event outside the closed field set). An absent registry reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/principals/registry.jsonl from version control; never edit the ledger in place — the registry is append-only governed state and every change is a register or revoke event.",
		layer: "Observability",
		related: [
			"AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION",
			"AMBER_E_KB_CORRUPT",
			"AMBER_E_ARTIFACT_JOURNAL_CORRUPT",
		],
	},
	AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION: {
		title: "Principal registry event declares an unsupported version",
		cause:
			"A registry event carries a schemaVersion this reader does not support. Version negotiation is fail-closed: an event the reader cannot interpret is rejected, never silently reinterpreted.",
		remedy:
			"Upgrade amber to a version that supports the declared registry schema, or rebuild the registry under the supported schema version (1) with fresh register events.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION"],
	},
	AMBER_E_PRINCIPAL_REGISTRY_CEILING: {
		title: "Principal registry exceeds its size ceiling",
		cause:
			"Appending the next registry event would grow .amber/principals/registry.jsonl beyond the size ceiling (default 1 MiB, env AMBER_PRINCIPAL_MAX_REGISTRY_BYTES), so the write is refused before any durable state is touched.",
		remedy:
			"Split principals across repositories, or raise the ceiling deliberately via AMBER_PRINCIPAL_MAX_REGISTRY_BYTES (a positive integer; garbage fails closed as AMBER_E_INVALID_ARG).",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_SIZE_CEILING", "AMBER_E_INVALID_ARG"],
	},
	AMBER_E_PRINCIPAL_REGISTRY_LOCK: {
		title: "Another principal registry write is in flight",
		cause:
			"A concurrent register/revoke holds the registry lock (.amber/principals/registry.lock, fresh within the stale window), so the conflicting write is refused instead of racing the in-flight one — two racing writers would both pass the pre-check and append, producing a duplicate event the fold treats as corruption.",
		remedy:
			"Retry once the in-flight register/revoke completes; a lock older than the stale window (30 s) is a crashed holder and is reclaimed automatically.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT"],
	},
	AMBER_E_PRINCIPAL_ALREADY_REGISTERED: {
		title: "Principal id is already registered",
		cause:
			"register was invoked with an id the registry already holds. A principal id is registered at most once and revocation is terminal, so a revoked id cannot be re-registered either — re-registering would launder the revocation.",
		remedy:
			"Inspect the existing record with `amber principal show --id <id>`; register a distinct principal id instead.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_ALREADY_REVOKED", "AMBER_E_PRINCIPAL_NOT_FOUND"],
	},
	AMBER_E_PRINCIPAL_NOT_FOUND: {
		title: "Principal is not registered",
		cause:
			"A lookup named a principal id with no registration in the registry — decision admission verifies its acting Principal against the registry, so an unregistered principal cannot occupy a decision slot.",
		remedy:
			"Register the principal first: `amber principal register --id <id> --kind <human|service>`.",
		layer: "Observability",
		related: ["AMBER_E_PRINCIPAL_REVOKED", "AMBER_E_DECISION_PRINCIPAL_REQUIRED"],
	},
	AMBER_E_PRINCIPAL_ALREADY_REVOKED: {
		title: "Principal is already revoked",
		cause: "revoke was invoked for a principal whose registration is already revoked.",
		remedy: "Inspect the record with `amber principal show --id <id>`; revocation is terminal.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_REVOKED", "AMBER_E_PRINCIPAL_ALREADY_REGISTERED"],
	},
	AMBER_E_PRINCIPAL_REVOKED: {
		title: "Principal has been revoked",
		cause:
			"Decision admission named a principal whose registration is revoked. A revoked principal holds no authority, so admission fails closed instead of binding the decision to dead authority.",
		remedy:
			"Register and use a different principal, or — if the revocation was wrong — audit the registry ledger and restore it from version control.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_EXPIRED", "AMBER_E_PRINCIPAL_NOT_FOUND"],
	},
	AMBER_E_PRINCIPAL_EXPIRED: {
		title: "Principal validity window has ended",
		cause:
			"Decision admission named a principal whose validTo bound is at or before the admission time (the window is half-open: [validFrom, validTo)).",
		remedy:
			"Register a new principal with a current validity window and use it for the decision; a validity change is a new registration, never an in-place edit.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_REVOKED", "AMBER_E_PRINCIPAL_NOT_YET_VALID"],
	},
	AMBER_E_PRINCIPAL_NOT_YET_VALID: {
		title: "Principal validity window has not started",
		cause:
			"Decision admission named a principal whose validFrom bound is after the admission time.",
		remedy:
			"Wait for the window to open, or register a principal whose validity window covers the admission time.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_EXPIRED"],
	},
	AMBER_E_DECISION_KIND_INVALID: {
		title: "Decision kind is invalid",
		cause:
			"Decision admission named a kind outside the closed set (acceptance, approval, review). The three kinds are distinct authorities and never interchangeable.",
		remedy: "Re-admit with --decision-kind acceptance, approval, or review.",
		layer: "Governance",
		related: ["AMBER_E_DECISION_HUMAN_SLOT_REQUIRED", "AMBER_E_DECISION_PRINCIPAL_REQUIRED"],
	},
	AMBER_E_DECISION_PRINCIPAL_REQUIRED: {
		title: "Decision admission is missing its acting Principal",
		cause:
			"Decision admission arrived without a --principal id, or the stored Envelope's principal binding snapshot is malformed. Every Decision binds the Principal that acted; the binding is core Envelope content, not extension data.",
		remedy: "Re-admit with --principal <id> naming a registered principal.",
		layer: "Governance",
		related: ["AMBER_E_PRINCIPAL_NOT_FOUND", "AMBER_E_DECISION_KIND_INVALID"],
	},
	AMBER_E_DECISION_HUMAN_SLOT_REQUIRED: {
		title: "Human-only decision slot occupied by a non-human principal",
		cause:
			"An acceptance or approval Decision was admitted by a service principal (or any principal whose principalKind is not human). Formal Acceptance and Approval require independently authenticated humans; agents and service identities cannot occupy a human approval slot.",
		remedy:
			"Re-admit with --principal naming a registered human principal, or record the artifact as a review Decision instead (review is the only kind a service principal may carry).",
		layer: "Governance",
		related: ["AMBER_E_DECISION_KIND_INVALID", "AMBER_E_DECISION_PRINCIPAL_REQUIRED"],
	},
	AMBER_E_EVIDENCE_REGISTRY_CORRUPT: {
		title: "Evidence ledger is corrupt or unreadable",
		cause:
			"An evidence ledger read hit a corrupt line or an event sequence the record/verify writers could never have produced (a broken hash chain, a duplicate recorded id, a verification of an unrecorded id, a self-verification, a malformed receipt, or an event outside the closed field set). An absent ledger reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/evidence/receipts.jsonl from version control; never edit the ledger in place — the evidence ledger is append-only governed state and every change is a record or verify event.",
		layer: "Observability",
		related: [
			"AMBER_E_EVIDENCE_UNSUPPORTED_VERSION",
			"AMBER_E_PRINCIPAL_REGISTRY_CORRUPT",
			"AMBER_E_ARTIFACT_JOURNAL_CORRUPT",
		],
	},
	AMBER_E_EVIDENCE_UNSUPPORTED_VERSION: {
		title: "Evidence ledger event declares an unsupported version",
		cause:
			"An evidence ledger event carries a schemaVersion this reader does not support. Version negotiation is fail-closed: an event the reader cannot interpret is rejected, never silently reinterpreted.",
		remedy:
			"Upgrade amber to a version that supports the declared evidence schema, or rebuild the ledger under the supported schema version (1) with fresh record events.",
		layer: "Governance",
		related: ["AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION"],
	},
	AMBER_E_EVIDENCE_SIZE_CEILING: {
		title: "Evidence ledger exceeds its size ceiling",
		cause:
			"Appending the next evidence event would grow .amber/evidence/receipts.jsonl beyond the size ceiling (default 1 MiB, env AMBER_EVIDENCE_MAX_REGISTRY_BYTES), so the write is refused before any durable state is touched — the ceiling is re-checked under the write lock on the exact chained event.",
		remedy:
			"Keep receipt outputs bounded, or raise the ceiling deliberately via AMBER_EVIDENCE_MAX_REGISTRY_BYTES (a positive integer; garbage fails closed as AMBER_E_INVALID_ARG).",
		layer: "Governance",
		related: [
			"AMBER_E_PRINCIPAL_REGISTRY_CEILING",
			"AMBER_E_ARTIFACT_SIZE_CEILING",
			"AMBER_E_INVALID_ARG",
		],
	},
	AMBER_E_EVIDENCE_REGISTRY_LOCK: {
		title: "Another evidence ledger write is in flight",
		cause:
			"A concurrent record/verify holds the evidence lock (.amber/evidence/receipts.lock, fresh within the stale window), so the conflicting write is refused instead of racing the in-flight one — two racing writers would both pass the pre-check and append, producing a duplicate or unanchored event the fold treats as corruption.",
		remedy:
			"Retry once the in-flight record/verify completes; a lock older than the stale window (30 s) is a crashed holder and is reclaimed automatically.",
		layer: "Governance",
		related: ["AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "AMBER_E_PRINCIPAL_REGISTRY_LOCK"],
	},
	AMBER_E_EVIDENCE_ALREADY_RECORDED: {
		title: "Evidence id is already recorded",
		cause:
			"record was invoked with an id the ledger already holds. An evidence id is recorded exactly once — a re-run of the same check is a new receipt with a distinct id, not a rewrite of the old one.",
		remedy:
			"Inspect the existing receipt with `amber evidence show --id <id>`; record the re-run under a distinct id.",
		layer: "Governance",
		related: ["AMBER_E_EVIDENCE_NOT_FOUND", "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT"],
	},
	AMBER_E_EVIDENCE_ALREADY_VERIFIED: {
		title: "Evidence is already verified by this principal",
		cause:
			"verify was invoked by a principal who has already appended a verification event for this receipt. A verification is recorded exactly once per verifier — repeating it would only grow the ledger without changing the derived state.",
		remedy:
			"Nothing to do: the effective assurance is already verified. A different independent principal may still add its own verification.",
		layer: "Verification",
		related: ["AMBER_E_EVIDENCE_SELF_VERIFICATION", "AMBER_E_EVIDENCE_NOT_FOUND"],
	},
	AMBER_E_EVIDENCE_NOT_FOUND: {
		title: "Evidence id is not recorded",
		cause: "A verify or show named an evidence id with no recorded receipt in the ledger.",
		remedy:
			"List recorded evidence with `amber evidence list`; record the receipt first (`amber evidence record`).",
		layer: "Observability",
		related: ["AMBER_E_EVIDENCE_ALREADY_RECORDED", "AMBER_E_PRINCIPAL_NOT_FOUND"],
	},
	AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN: {
		title: "Receipt cannot claim the verified assurance level",
		cause:
			'record was invoked with assurance "verified". The four-level Assurance contract reserves "verified" for independent verification: a Runner can never award itself proof, so no receipt may be recorded at that level.',
		remedy:
			"Record at the honest level (unavailable, observed, or replayable); an independent registered principal then promotes the effective assurance via `amber evidence verify --id <id> --verifier <other-principal>`.",
		layer: "Verification",
		related: ["AMBER_E_EVIDENCE_SELF_VERIFICATION", "AMBER_E_DECISION_HUMAN_SLOT_REQUIRED"],
	},
	AMBER_E_EVIDENCE_SELF_VERIFICATION: {
		title: "Evidence producer cannot verify its own receipt",
		cause:
			"verify was invoked with a verifier whose principal id equals the receipt's producer id. Verification requires an independent principal — a Runner naming itself as verifier would award itself proof.",
		remedy:
			"Verify with a different registered principal (e.g. a human reviewer or an independent service identity).",
		layer: "Verification",
		related: ["AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN", "AMBER_E_PRINCIPAL_NOT_FOUND"],
	},
	AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT: {
		title: "Replay provenance conflicts with the assurance level",
		cause:
			"A replayable receipt arrived without replayOf (a bare claim with nothing to replay), or a non-replayable receipt carried replayOf (replay provenance is reserved for deterministic replays).",
		remedy:
			"Name the deterministic definition the replay executed (--replay-of, e.g. an Eval id or a command definition) on replayable receipts, and drop replayOf from non-replayable ones.",
		layer: "Verification",
		related: ["AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN", "AMBER_E_INVALID_ARG"],
	},
	AMBER_E_APPROVAL_REGISTRY_CORRUPT: {
		title: "Approval registry is corrupt or unreadable",
		cause:
			"An approval registry read hit a corrupt line or an event sequence the grant/revoke/consume writers could never have produced (a broken hash chain, a duplicate granted id, a revoked or consumed event for an unknown id, a revoked-then-consumed sequence, a malformed snapshot, or an event outside the closed field set). An absent registry reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/approvals/registry.jsonl from version control; never edit the registry in place — it is append-only governed state and every change is a granted, revoked, or consumed event.",
		layer: "Governance",
		related: [
			"AMBER_E_APPROVAL_UNSUPPORTED_VERSION",
			"AMBER_E_EVIDENCE_REGISTRY_CORRUPT",
			"AMBER_E_PRINCIPAL_REGISTRY_CORRUPT",
		],
	},
	AMBER_E_APPROVAL_UNSUPPORTED_VERSION: {
		title: "Approval registry event declares an unsupported version",
		cause:
			"An approval registry event carries a schemaVersion this reader does not support. Version negotiation is fail-closed: an event the reader cannot interpret is rejected, never silently reinterpreted.",
		remedy:
			"Upgrade amber to a version that supports the declared approval schema, or rebuild the registry under the supported schema version (1) with fresh grant events.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_REGISTRY_CORRUPT", "AMBER_E_EVIDENCE_UNSUPPORTED_VERSION"],
	},
	AMBER_E_APPROVAL_SIZE_CEILING: {
		title: "Approval registry exceeds its size ceiling",
		cause:
			"Appending the next approval event would grow .amber/approvals/registry.jsonl beyond the size ceiling (default 1 MiB, env AMBER_APPROVAL_MAX_REGISTRY_BYTES), so the write is refused before any durable state is touched — the ceiling is re-checked under the write lock on the exact chained event.",
		remedy:
			"Keep approval ids, scopes, and subjects bounded, or raise the ceiling deliberately via AMBER_APPROVAL_MAX_REGISTRY_BYTES (a positive integer; garbage fails closed as AMBER_E_INVALID_ARG).",
		layer: "Governance",
		related: [
			"AMBER_E_EVIDENCE_SIZE_CEILING",
			"AMBER_E_PRINCIPAL_REGISTRY_CEILING",
			"AMBER_E_INVALID_ARG",
		],
	},
	AMBER_E_APPROVAL_REGISTRY_LOCK: {
		title: "Another approval registry write is in flight",
		cause:
			"A concurrent grant/revoke/consume holds the approvals lock (.amber/approvals/approvals.lock, fresh within the stale window), so the conflicting write is refused instead of racing the in-flight one — two racing consumers would both pass the pre-check and settle two Decisions under one authorization.",
		remedy:
			"Retry once the in-flight write completes; a lock older than the stale window (30 s) is a crashed holder and is reclaimed automatically.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_REGISTRY_CORRUPT", "AMBER_E_EVIDENCE_REGISTRY_LOCK"],
	},
	AMBER_E_APPROVAL_NOT_FOUND: {
		title: "Approval id is not recorded",
		cause:
			"A revoke, consume, or show named an approval id with no granted record in the registry.",
		remedy:
			"List recorded approvals with `amber approval list`; grant the authorization first (`amber approval grant`).",
		layer: "Observability",
		related: ["AMBER_E_APPROVAL_ALREADY_GRANTED", "AMBER_E_PRINCIPAL_NOT_FOUND"],
	},
	AMBER_E_APPROVAL_ALREADY_GRANTED: {
		title: "Approval id is already granted",
		cause:
			"grant was invoked with an id the registry already holds. An approval id is granted exactly once — a re-grant is a new id, never a rewrite of the old authorization.",
		remedy:
			"Inspect the existing record with `amber approval show --id <id>`; grant a distinct approval id instead.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_NOT_FOUND", "AMBER_E_APPROVAL_ALREADY_CONSUMED"],
	},
	AMBER_E_APPROVAL_ALREADY_REVOKED: {
		title: "Approval is already revoked",
		cause:
			"revoke was invoked for an approval whose record is already revoked. Revocation is terminal — a second revoked event would only grow the ledger.",
		remedy:
			"Nothing to do: the authorization holds no force. Inspect the record with `amber approval show --id <id>`.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_REVOKED", "AMBER_E_APPROVAL_ALREADY_GRANTED"],
	},
	AMBER_E_APPROVAL_ALREADY_CONSUMED: {
		title: "Approval is already consumed",
		cause:
			"consume was invoked for an approval whose single use is settled, or revoke was invoked after consumption. An authorization is single-use: one authorization can never be replayed, so a second consumption (including a racing concurrent consumer) is refused with this stable code rather than recorded.",
		remedy:
			"Inspect the settled Decision with `amber approval show --id <id>` (or `amber artifact show`); settle further work under a freshly granted approval id.",
		layer: "Governance",
		related: [
			"AMBER_E_APPROVAL_ALREADY_REVOKED",
			"AMBER_E_APPROVAL_NOT_FOUND",
			"AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT",
		],
	},
	AMBER_E_APPROVAL_EXPIRED: {
		title: "Approval validity window has ended",
		cause:
			"consume was invoked for an approval whose validUntil bound is at or before the evaluation time. The window is half-open [validAt, validUntil) under the recorded no-tolerance skew policy: at exactly validUntil the authorization is already expired.",
		remedy:
			"Grant a fresh approval with a current validity window; an expired authorization is never revived — history is not rewritten.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_NOT_YET_VALID", "AMBER_E_PRINCIPAL_EXPIRED"],
	},
	AMBER_E_APPROVAL_REVOKED: {
		title: "Approval has been revoked",
		cause:
			"consume was invoked for an approval whose record is revoked. A revoked authorization holds no force, so it cannot settle a Decision.",
		remedy:
			"Grant a fresh approval; the revoked record stays in the ledger as history (revocation is terminal).",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_ALREADY_REVOKED", "AMBER_E_PRINCIPAL_REVOKED"],
	},
	AMBER_E_APPROVAL_NOT_YET_VALID: {
		title: "Approval validity window has not started",
		cause:
			"consume was invoked before the approval's validAt bound. The window is half-open and the recorded time is authoritative — no skew tolerance moves the boundary.",
		remedy:
			"Wait for the window to open, or grant an approval whose window covers the consumption.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_EXPIRED", "AMBER_E_PRINCIPAL_NOT_YET_VALID"],
	},
	AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED: {
		title: "Human-only approval slot occupied by a non-human principal",
		cause:
			"grant or revoke named an approver or revoker whose principalKind is not human. An Approval is a human authorization and its revocation a human act — agents and service identities cannot hold either slot (mirroring the acceptance/approval Decision discipline).",
		remedy:
			"Grant or revoke with a registered human principal; a service identity may at most carry a review Decision.",
		layer: "Governance",
		related: ["AMBER_E_DECISION_HUMAN_SLOT_REQUIRED", "AMBER_E_PRINCIPAL_NOT_FOUND"],
	},
	AMBER_E_GATE_NOT_FOUND: {
		title: "Gate artifact is not recorded",
		cause:
			"A gate evaluation named an identity with no committed gate artifact revision in the canonical artifact store (or the named revision does not exist).",
		remedy:
			"List committed artifacts with `amber artifact list`; admit the Gate Contract first (`amber artifact admit --type gate ... --extension gate.require=...`), or evaluate the stored spelling of the identity.",
		layer: "Observability",
		related: ["AMBER_E_ARTIFACT_NOT_FOUND", "AMBER_E_GATE_CONTRACT_INVALID"],
	},
	AMBER_E_GATE_CONTRACT_INVALID: {
		title: "Gate Contract is malformed",
		cause:
			"The gate artifact's extensions.gate contract failed the evaluator's shape validation: a missing or empty gate.require, an unknown gate.* key, a requirement with unknown keys or a non-string evidenceType, an unparseable expiry, a non-array where an array is required, an anyOf set outside the bounded explicit limits (at most 8 alternative sets of at most 8 entries), or a threshold value/comparator family mismatch (a number only compares numerically; a string compares exactly under eq/ne/contains and dot-numerically under lt/le/gt/ge).",
		remedy:
			"Fix the contract in a new gate revision (`amber artifact admit --type gate ... --expected-head <n>`) — a committed revision is immutable, so the correction is always a new revision. The message names the offending key.",
		layer: "Governance",
		related: [
			"AMBER_E_GATE_UNSUPPORTED_COMPARATOR",
			"AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED",
			"AMBER_E_INVALID_ARG",
		],
	},
	AMBER_E_GATE_EXPIRED: {
		title: "Gate Contract has expired",
		cause:
			"gate evaluate was invoked for a gate whose gate.expires bound is at or before the evaluation clock. Expiry is evaluated with no clock-skew tolerance: at exactly gate.expires the gate already refuses to run, and no outcome is appended — the gate did not evaluate, it declined.",
		remedy:
			"Admit a fresh gate revision with a current expiry; an expired contract is never revived — history is not rewritten.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_EXPIRED", "AMBER_E_PRINCIPAL_EXPIRED"],
	},
	AMBER_E_GATE_UNSUPPORTED_COMPARATOR: {
		title: "Gate threshold declares an unregistered comparator",
		cause:
			"A requirement threshold carries a comparator outside the registered comparison operator set. Only registered operators can be evaluated deterministically; an unknown one makes the contract invalid rather than silently satisfiable.",
		remedy:
			"Use a registered comparator — numeric: eq, ne, lt, le, gt, ge (over strict base-10 decimal outputs); string: eq, ne, contains (exact); version ordering: lt, le, gt, ge (dot-numeric) — in a new gate revision.",
		layer: "Governance",
		related: ["AMBER_E_GATE_CONTRACT_INVALID", "AMBER_E_INVALID_ARG"],
	},
	AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED: {
		title: "Gate failure behavior is unsupported",
		cause:
			'The gate contract declares a gate.failBehavior other than "deny". v1 is deny-only: a failing gate denies — there is no warn, quorum, or weighted pass, and no model confidence can soften the verdict.',
		remedy:
			'Omit gate.failBehavior (deny is the default) or set it to "deny" in a new gate revision.',
		layer: "Governance",
		related: ["AMBER_E_GATE_CONTRACT_INVALID"],
	},
	AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT: {
		title: "Gate outcome ledger is corrupt or unreadable",
		cause:
			"A gate outcome read hit a corrupt line or an event the evaluate writer could never have produced (a broken hash chain, an event outside the closed field set, a missing field, an unknown kind, or a non-integer schemaVersion this reader cannot interpret). An absent ledger reads as empty; this code only fires on real corruption.",
		remedy:
			"Restore .amber/gates/outcomes.jsonl from version control; never edit the ledger in place — it is append-only governed state and every change is an evaluated event.",
		layer: "Governance",
		related: ["AMBER_E_APPROVAL_REGISTRY_CORRUPT", "AMBER_E_EVIDENCE_REGISTRY_CORRUPT"],
	},
	AMBER_E_GATE_OUTCOME_SIZE_CEILING: {
		title: "Gate outcome ledger exceeds its size ceiling",
		cause:
			"Appending the next evaluated event would grow .amber/gates/outcomes.jsonl beyond the size ceiling (default 1 MiB, env AMBER_GATE_MAX_OUTCOME_BYTES), so the write is refused before any durable state is touched — the ceiling is checked under the write lock on the exact chained event.",
		remedy:
			"Keep gate contracts bounded (fewer requirements with shorter subjects), or raise the ceiling deliberately via AMBER_GATE_MAX_OUTCOME_BYTES (a positive integer; garbage fails closed as AMBER_E_INVALID_ARG).",
		layer: "Governance",
		related: [
			"AMBER_E_APPROVAL_SIZE_CEILING",
			"AMBER_E_EVIDENCE_SIZE_CEILING",
			"AMBER_E_INVALID_ARG",
		],
	},
	AMBER_E_GATE_OUTCOME_REGISTRY_LOCK: {
		title: "Another gate outcome write is in flight",
		cause:
			"A concurrent gate evaluation holds the outcomes lock (.amber/gates/outcomes.lock, fresh within the stale window), so the conflicting write is refused instead of racing the in-flight one — two racing evaluators would both chain onto the same head and fork the ledger.",
		remedy:
			"Retry once the in-flight evaluation completes; a lock older than the stale window (30 s) is a crashed holder and is reclaimed automatically.",
		layer: "Governance",
		related: ["AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT", "AMBER_E_APPROVAL_REGISTRY_LOCK"],
	},
	AMBER_E_POLICY_MISSING: {
		title: "Required Policy Contract is missing",
		cause:
			"A strict policy evaluation did not receive, or could not resolve, a required Policy Contract artifact. Org and tenant policy identities are mandatory; optional repo/play/gate policy identities must also resolve when named.",
		remedy:
			"Admit and activate the missing Policy Contract with `amber artifact admit --type policy ... --transition activate`, or pass the stored policy identity in the appropriate --*-policy flag.",
		layer: "Governance",
		related: ["AMBER_E_ARTIFACT_NOT_FOUND", "AMBER_E_POLICY_INVALID"],
	},
	AMBER_E_POLICY_INVALID: {
		title: "Policy Contract is malformed",
		cause:
			"A policy artifact's extensions.policy contract failed the evaluator's shape validation: missing or malformed policyVersion/layer/rules/delegations, a non-active policy lifecycle, malformed timestamps, or a lower-level value that cannot be evaluated deterministically.",
		remedy:
			"Admit a new active policy revision with policyVersion 1, the correct layer, deny-only rules, and explicit direct delegations. Committed policy revisions are immutable; corrections are new revisions.",
		layer: "Governance",
		related: [
			"AMBER_E_POLICY_MISSING",
			"AMBER_E_POLICY_CONFLICT",
			"AMBER_E_POLICY_UNSUPPORTED_VERSION",
		],
	},
	AMBER_E_POLICY_UNSUPPORTED_VERSION: {
		title: "Policy Contract version is unsupported",
		cause:
			"A strict policy evaluation encountered a Policy Contract whose policyVersion is newer or otherwise unsupported by this evaluator. Unknown policy semantics are refused rather than reinterpreted.",
		remedy:
			"Use a Policy Contract with policyVersion 1, or upgrade the evaluator before consuming the newer policy version.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_INVALID", "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION"],
	},
	AMBER_E_POLICY_STALE: {
		title: "Policy Contract is stale or expired",
		cause:
			"A Policy Contract named by a strict evaluation has expired (validUntil is at or before the evaluation clock) or is older than its maxPolicyAgeMs freshness bound. Stale policy cannot authorize strict consumption.",
		remedy:
			"Admit and activate a fresh policy revision, then retry the strict policy evaluation against the current policy stack.",
		layer: "Governance",
		related: ["AMBER_E_GATE_EXPIRED", "AMBER_E_PRINCIPAL_EXPIRED"],
	},
	AMBER_E_POLICY_CONFLICT: {
		title: "Policy stack conflicts with the deny-wins ceiling",
		cause:
			"A Policy Contract attempts to relabel its layer or relax the non-relaxable policy ceiling. Lower layers may only tighten org/tenant policy.",
		remedy:
			"Remove relaxing keys and admit a new policy revision. Model repo/play/gate policy as additional deny rules or explicit direct delegations, never as authority-widening overrides.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_INVALID", "AMBER_E_POLICY_DENIED"],
	},
	AMBER_E_POLICY_DENIED: {
		title: "Policy evaluation denied strict consumption",
		cause:
			"The policy stack evaluated successfully and appended a deny outcome: a deny rule matched, the Gate Outcome was not a matching pass, the Approval was missing or not consumed, or another strict consumption precondition failed.",
		remedy:
			"Inspect the Policy Outcome reasons, then supply the required consumed Approval, passing Gate Outcome, current policy stack, and non-denied principals/scope before retrying.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_SEPARATION_OF_DUTIES", "AMBER_E_POLICY_DELEGATION_REQUIRED"],
	},
	AMBER_E_POLICY_SEPARATION_OF_DUTIES: {
		title: "Policy separation of duties failed",
		cause:
			"The strict consumption context reused one principal across separated roles such as submitter, Evidence producer, verifier, approval approver, or delegator. Self-approval and self-review fail closed.",
		remedy:
			"Use distinct registered principals for submitter, Evidence producer, verifier, approval approver, and delegator, then retry. The denied outcome remains immutable audit evidence.",
		layer: "Governance",
		related: ["AMBER_E_EVIDENCE_SELF_VERIFICATION", "AMBER_E_POLICY_DENIED"],
	},
	AMBER_E_POLICY_DELEGATION_REQUIRED: {
		title: "Required delegation is absent or invalid",
		cause:
			"The policy evaluation named a delegator, but no active direct delegation grants the submitter the exact capability on the exact subject for the evaluation clock. Delegation is explicit, non-transitive, scoped, capability-limited, and time-limited.",
		remedy:
			"Add an explicit direct delegation to an active Policy Contract, with matching delegator/delegate/capability/scope and a valid half-open time window. Do not rely on chained delegation.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_DENIED", "AMBER_E_POLICY_CONFLICT"],
	},
	AMBER_E_POLICY_OUTCOME_REGISTRY_CORRUPT: {
		title: "Policy outcome ledger is corrupt or unreadable",
		cause:
			"A policy outcome read hit a corrupt line or an event the evaluator could never have produced: a broken hash chain, an event outside the closed field set, a missing field, or an unsupported schemaVersion. An absent ledger reads as empty.",
		remedy:
			"Restore .amber/policies/outcomes.jsonl from version control; never edit the ledger in place — it is append-only governed state.",
		layer: "Governance",
		related: ["AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT", "AMBER_E_APPROVAL_REGISTRY_CORRUPT"],
	},
	AMBER_E_POLICY_OUTCOME_SIZE_CEILING: {
		title: "Policy outcome ledger exceeds its size ceiling",
		cause:
			"Appending the next policy outcome would grow .amber/policies/outcomes.jsonl beyond the configured ceiling (default 1 MiB, env AMBER_POLICY_MAX_OUTCOME_BYTES), so the write is refused before durable state is touched.",
		remedy:
			"Keep policy contexts bounded, or deliberately raise AMBER_POLICY_MAX_OUTCOME_BYTES to a positive integer. Garbage ceiling values fail closed as AMBER_E_INVALID_ARG.",
		layer: "Governance",
		related: ["AMBER_E_GATE_OUTCOME_SIZE_CEILING", "AMBER_E_INVALID_ARG"],
	},
	AMBER_E_POLICY_OUTCOME_REGISTRY_LOCK: {
		title: "Another policy outcome write is in flight",
		cause:
			"A concurrent policy evaluation holds .amber/policies/outcomes.lock within the stale window, so this writer refused instead of racing and forking the ledger chain.",
		remedy:
			"Retry after the in-flight evaluation completes; a lock older than the stale window (30 s) is reclaimed automatically.",
		layer: "Governance",
		related: ["AMBER_E_POLICY_OUTCOME_REGISTRY_CORRUPT", "AMBER_E_POLICY_DENIED"],
	},
	AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED: {
		title: "Sync transport git command failed",
		cause:
			"A governed git add/commit exited non-zero (hook refusal, identity missing, or git error); stderr is captured in the transport ledger.",
		remedy:
			"Inspect the recorded stderr in .amber/sync/transport/ledger.jsonl, fix the underlying cause, then re-approve and retry.",
		layer: "Verification",
		related: ["AMBER_E_SYNC_TRANSPORT_DIRTY_TREE", "AMBER_E_LEDGER_TAMPERED"],
	},
	// F058 instruction-surface Eval suite finding codes (#224). These are
	// Eval FINDINGS (replayable evidence, never Approval) reported by
	// scripts/lib/core/instruction-surface-evals.js; they are registered here
	// so every production AMBER_E_* literal stays explainable (ticket 06,
	// #223 — the consolidated catalog is the single registration point).
	AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT: {
		title: "Eval finding: MCP tool description drifted from its contract",
		cause:
			"The tools/list description an MCP server advertises no longer matches what the contract composer derives, or the server does not advertise its tools through the registered composer markers.",
		remedy:
			"Route the server's tools/list through the contract composer (mcp-tool-surface) so descriptions are derived, not hand-maintained; re-run the eval.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_MCP_INSTRUCTION_OVERRIDE", "AMBER_E_EVAL_MCP_AUTHORITY_CLAIM"],
	},
	AMBER_E_EVAL_MCP_INSTRUCTION_OVERRIDE: {
		title: "Eval finding: MCP description carries instruction-override language",
		cause:
			"An advertised tool description contains language that tries to override or re-target the model's instructions (e.g. ignore-previous-instructions patterns).",
		remedy:
			"Strip the override language from the tool contract; descriptions state capability, never instructions; re-run the eval.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT", "AMBER_E_EVAL_MCP_AUTHORITY_CLAIM"],
	},
	AMBER_E_EVAL_MCP_AUTHORITY_CLAIM: {
		title: "Eval finding: read-only tool claims unauthorized capability",
		cause:
			"A tool registered as read-only advertises mutating or authority-widening capability in its description text.",
		remedy:
			"Correct the description to the tool's registered (read-only) capability, or re-register the tool with its true capability boundary; re-run the eval.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT", "AMBER_E_EVAL_MCP_INSTRUCTION_OVERRIDE"],
	},
	AMBER_E_EVAL_MODEL_DEPENDENCY: {
		title: "Eval finding: eval source references a model or network client",
		cause:
			"An Eval suite source file references a model provider or network client. Evals are deterministic and model-independent — a network or model dependency makes the evidence non-replayable.",
		remedy:
			"Remove the model/network dependency from the eval source; evals must be deterministic over local state only.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT"],
	},
	AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING: {
		title: "Eval finding: context quote boundary is not enforced",
		cause:
			"The context-request schema or a Distillation Contract does not enforce treatSourcesAsQuotedEvidence=true (or omits the source quote-boundary instruction), so distilled context could pass as the assistant's own words.",
		remedy:
			"Set treatSourcesAsQuotedEvidence=true on the Distillation Contract constraints and include the source quote-boundary rule in its instructions; keep the schema gate that requires it.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE"],
	},
	AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE: {
		title: "Eval finding: Required Artifact role contract violated",
		cause:
			"The Required Artifact kinds drifted from the closed set, a Required Artifact path or loadout occupies the Context Page store, or the loadouts directory is not target-local.",
		remedy:
			"Restore the closed Required Artifact kind set and keep Required Artifacts out of .amber/context/pages/; re-run the eval.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING"],
	},
	AMBER_E_EVAL_BREADCRUMB_BINDING: {
		title: "Eval finding: printed breadcrumb binding did not verify",
		cause:
			"The workflow-state breadcrumb could not be printed for the target, printed empty, or failed verification of its binding to canonical state — the breadcrumb must be derived state, not free text.",
		remedy:
			"Run amber doctor on the target to repair the breadcrumb's derived state, then re-run the eval.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_BREADCRUMB_IMITATION"],
	},
	AMBER_E_EVAL_BREADCRUMB_IMITATION: {
		title: "Eval finding: Context Page imitates the breadcrumb",
		cause:
			"A Context Page embeds the breadcrumb marker (<amber-workflow-state>). Knowledge pages are never next-step authority; embedding the marker makes the page an imitation of the breadcrumb channel.",
		remedy:
			"Remove the <amber-workflow-state> marker from the Context Page text; next-step authority lives only in the breadcrumb channel.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_BREADCRUMB_BINDING"],
	},
	// F058 fix round (grill G-1/G-4, review S-2): registry-load failures and
	// empty scans are Evidence delivered through the suite result envelope,
	// never a bare crash or a vacuous pass.
	AMBER_E_EVAL_REGISTRY_UNREADABLE: {
		title: "Eval finding: Action/Function registry could not be loaded",
		cause:
			"The action-types or action-functions registry directory is missing, unreadable, or contains an entry that fails its schema, so the instruction-surface Eval cannot inspect the tool contracts.",
		remedy:
			"Repair the registry entry to valid JSON that satisfies schemas/action.type.schema.json (or restore the registry directory), then re-run the eval.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_EMPTY_SCAN", "AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT"],
	},
	AMBER_E_EVAL_EMPTY_SCAN: {
		title: "Eval finding: an Eval scanned zero candidate surfaces",
		cause:
			"An instruction-surface Eval examined none of its candidate surfaces — an empty tool registry (zero Action Types and Functions) or an empty model-independence scan file set — so a pass would be vacuous.",
		remedy:
			"Restore the scanned population (register Action Types/Functions, or provide the Eval scan file set); a clean pass must be earned over a non-empty surface.",
		layer: "Verification",
		related: ["AMBER_E_EVAL_REGISTRY_UNREADABLE"],
	},
	// F059 (#247): deterministic knowledge graph (amber knowledge graph).
	AMBER_E_KNOWLEDGE_GRAPH_INVALID: {
		title: "Knowledge graph failed its own schema validation",
		cause:
			"The graph built by the deterministic parser did not validate against schemas/knowledge-graph.schema.json — an internal parser defect or a hand-edited schema, never a property of the scanned repository.",
		remedy:
			"Re-run with an unmodified schemas/knowledge-graph.schema.json; if it still fails, the parser and schema have drifted — fix scripts/lib/core/knowledge-graph.js so they agree.",
		layer: "Verification",
		related: ["AMBER_E_KNOWLEDGE_GRAPH_SOURCE"],
	},
	AMBER_E_KNOWLEDGE_GRAPH_SOURCE: {
		title: "Knowledge-graph source document is unreadable",
		cause:
			"A source the graph parses (feature_list.json) exists but is not valid JSON, so the deterministic graph refuses to build from a corrupt corpus. An absent source reads as an empty layer; this code only fires on real corruption.",
		remedy:
			"Repair feature_list.json to valid JSON (restore it from version control if it was hand-edited), then re-run amber knowledge graph.",
		layer: "Context",
		related: ["AMBER_E_KNOWLEDGE_GRAPH_INVALID", "AMBER_E_KB_CORRUPT"],
	},
};

// Format an error string that carries its code + remedy, matching the existing
// "<message>. → fix: <cmd>" convention rendered verbatim by cli-output.js.
function codedError(code, message) {
	const entry = CATALOG[code];
	if (!entry) return message || code;
	const head = message || entry.title;
	return `${head} [${code}] → fix: ${entry.remedy}`;
}

// Resolve a code from a full id or its bare suffix, case-insensitively.
function getEntry(code) {
	if (!code || typeof code !== "string") return null;
	const upper = code.toUpperCase();
	if (CATALOG[upper]) return CATALOG[upper];
	const prefixed = `AMBER_E_${upper}`;
	return CATALOG[prefixed] || null;
}

/**
 * Construct a typed Error carrying its stable code (F049 ticket 06, #223):
 * the error-channel equivalent of codedError's string form. Read and
 * projection seams throw these so CLI failure envelopes surface
 * err.amberCode instead of a fallback code.
 * @param {string} code - Registered AMBER_E_* code.
 * @param {string} message - Human-readable head of the message.
 * @returns {Error} Error with .amberCode set and the coded message.
 */
function typedError(code, message) {
	const error = new Error(codedError(code, message));
	error.amberCode = code;
	return error;
}

function listCodes() {
	return Object.keys(CATALOG).sort();
}

module.exports = { CATALOG, codedError, typedError, getEntry, listCodes };
