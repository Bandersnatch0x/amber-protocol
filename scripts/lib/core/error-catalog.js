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

function listCodes() {
	return Object.keys(CATALOG).sort();
}

module.exports = { CATALOG, codedError, getEntry, listCodes };
