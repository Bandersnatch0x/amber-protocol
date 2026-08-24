"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	fileMentionsWiki,
	hasNextAction,
	hasVerificationCommand,
	validateHandoff,
} = require("./audit");

const { REQUIRED_HARNESS_FILES } = require("./constants");

const { pathExists, resolveTarget } = require("./fs-utils");

const { statePath } = require("../state-dir-resolver");

const { validateManifests } = require("./manifests");
const { classifyTarget } = require("./target-classification");

const { inspectProjectProfile } = require("./profiles");

const {
	validateContinuousImprovementStateFile,
	validateFeatureListFile,
	validateWiki,
} = require("./validators");

const { inspectWorkflowPack } = require("./workflow-packs");

const { remedyFor } = require("./lifecycle");

const memoryStore = require("./memory-store");
const { hashFile } = require("./context-hash");
const {
	alphaState,
	gammaWindow,
	GAMMA_QUOTA,
	ALPHA_MAX_ENTRIES,
	ALPHA_MAX_BYTES,
} = require("./memory-policy");
const { sha256, canonicalJson } = require("./context-hash");

const { CLI_VERSION } = require("./constants");

function hasPluginManifestDirectory(targetRoot) {
	return (
		pathExists(path.join(targetRoot, ".codex-plugin")) ||
		pathExists(path.join(targetRoot, ".claude-plugin"))
	);
}

function doctorProductRepo(targetRoot, classification) {
	const errors = [];
	const warnings = [];
	const productChecks = [];

	// Product-repo still owns a feature_list.json (self-dogfood). Enforce the
	// same feature-list invariants as target-repo doctor — including at most
	// one in_progress — so product-repo doctor can't print Errors:0 while the
	// list violates Operating Manual §6 (#66).
	const featureResult = validateFeatureListFile(path.join(targetRoot, "feature_list.json"));
	errors.push(...featureResult.errors);
	warnings.push(...featureResult.warnings);
	productChecks.push({
		name: "feature_list.json",
		errors: featureResult.errors.length,
		warnings: featureResult.warnings.length,
	});

	if (hasPluginManifestDirectory(targetRoot)) {
		const manifestResult = validateManifests(targetRoot);
		errors.push(...manifestResult.errors);
		warnings.push(...manifestResult.warnings);
		productChecks.push({
			name: "plugin-manifests",
			errors: manifestResult.errors.length,
			warnings: manifestResult.warnings.length,
		});
	}

	const samplePackPath = path.join(targetRoot, "workflow-packs", "safe-amber-bootstrap.pack.json");
	const sampleProfilePath = path.join(targetRoot, "profiles", "default.profile.json");
	const packResult = inspectWorkflowPack(samplePackPath);
	const profileResult = inspectProjectProfile(sampleProfilePath);
	errors.push(...packResult.errors);
	warnings.push(...packResult.warnings);
	errors.push(...profileResult.errors);
	warnings.push(...profileResult.warnings);
	productChecks.push({
		name: "workflow-pack-smoke",
		errors: packResult.errors.length,
		warnings: packResult.warnings.length,
	});
	productChecks.push({
		name: "project-profile-smoke",
		errors: profileResult.errors.length,
		warnings: profileResult.warnings.length,
	});

	return {
		target: targetRoot,
		classification,
		productChecks,
		errors,
		warnings,
	};
}

// Governed Memory Layer doctor delta — spec §11 rules 6–11 (#173/#174
// increments). Rules 1–5 (ledger/registry consistency, source health, pointer
// health, surface drift, budget/rate compliance) are delivered separately; this
// function owns the six read-only increments over the registry + the memory-*
// event subset. One-shot load; never spawns a subprocess (executesAnything:
// false) — git "tracking" is inferred from filesystem markers only.
const ALPHA_REVIEW_ENTRIES = 25; // 50% of the §6.3 entry budget (rule 6)
const ALPHA_REVIEW_BYTES = 4096; // 50% of the §6.3 byte budget (rule 6)
const MEMORY_TRIPLET_KEYS = ["approvalPolicy", "loopLedger", "workspaceIsolation"];

// Rule 9 anchor: normHash of the three governance blocks that must be verbatim
// identical across memory-maintenance and safe-amber-bootstrap (spec M2/§11-9).
function memoryTripletHash(pack) {
	const subset = {};
	for (const key of MEMORY_TRIPLET_KEYS) subset[key] = pack ? (pack[key] ?? null) : null;
	return sha256(canonicalJson(JSON.stringify(subset)));
}

// Rule 8/10 anchor: does .gitignore ignore MEMORY.md? Read-only, re-include wins.
function gitignoresMemoryMd(targetRoot) {
	const file = path.join(targetRoot, ".gitignore");
	if (!fs.existsSync(file)) return false;
	let ignored = false;
	for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		if (line === "MEMORY.md" || line === "/MEMORY.md") ignored = true;
		if (line === "!MEMORY.md" || line === "!/MEMORY.md") ignored = false;
	}
	return ignored;
}

// Rule 2/4 helper: mechanically move an active entry to needs-re-review
// (§4.1 — surface/source drift detection; no event is booked because doctor
// is not a verb, the finding itself is the record).
function markNeedsReReview(targetRoot, entry) {
	if (entry.status !== "active") return;
	entry.status = "needs-re-review";
	entry.updatedAt = new Date().toISOString();
	memoryStore.writeEntry(targetRoot, entry);
}

function doctorMemoryRules(targetRoot) {
	const errors = [];
	const warnings = [];

	// One-shot loads (§11 preamble): a single registry read + the memory-* event
	// subset feed every rule below.
	const entries = memoryStore.listEntries(targetRoot);
	const events = memoryStore.readMemoryEvents(targetRoot, 0);
	const memoryMdPath = path.join(targetRoot, "MEMORY.md");
	const memoryMdRaw = fs.existsSync(memoryMdPath) ? fs.readFileSync(memoryMdPath, "utf8") : "";
	const surface = memoryStore.parseMEMORYMd(memoryMdRaw);

	// Rule 1 — 账本-registry 一致性 (fail-closed): every proposal/active/superseded
	// entry must have a memory-ingest trail; active additionally requires a
	// memory-approval(approve) + memory-book trail. No trail = error.
	const ingestedIds = new Set();
	const approvedEntryIds = new Set();
	const bookedEntryIds = new Set();
	for (const event of events) {
		if (event.kind === "memory-ingest" && event.outcome === "admitted") {
			for (const id of event.entryIds || []) ingestedIds.add(id);
		}
		if (event.kind === "memory-approval" && event.decision === "approve" && event.entryId) {
			approvedEntryIds.add(event.entryId);
		}
		if (event.kind === "memory-book") {
			for (const id of event.entryIds || []) bookedEntryIds.add(id);
			if (event.entryId) bookedEntryIds.add(event.entryId);
		}
	}
	for (const entry of entries) {
		if (!["proposal", "active", "superseded"].includes(entry.status)) continue;
		if (!ingestedIds.has(entry.entryId)) {
			errors.push(
				`Memory entry ${entry.entryId} (${entry.status}) has no memory-ingest trail in events.jsonl — registry and ledger disagree (fail-closed).`,
			);
		}
		if (
			entry.status === "active" &&
			(!approvedEntryIds.has(entry.entryId) || !bookedEntryIds.has(entry.entryId))
		) {
			errors.push(
				`Active memory entry ${entry.entryId} is missing its memory-approval or memory-book trail — re-run the governed chain (ingest → approve → book) or remove the orphaned registry file.`,
			);
		}
	}

	// Rule 2 — 源健康: a file-backed source must resolve and hash-match. Drift on
	// an active entry mechanically moves it to needs-re-review (surface-hash
	// rebinding via book never rebinds provenance; supersede/abandon are the
	// durable exits — oscillation on re-review is expected, per spec §4.1).
	const currentSurfaceHash = memoryStore.computeSurfaceHash(memoryMdRaw);
	for (const entry of entries) {
		if (!["active", "needs-re-review", "proposal"].includes(entry.status)) continue;
		for (const source of (entry.provenance && entry.provenance.sources) || []) {
			const ref = String(source.ref || "");
			if (!ref || ref === "manual") continue;
			const resolved = path.resolve(targetRoot, ref);
			if (resolved !== targetRoot && !resolved.startsWith(targetRoot + path.sep)) continue;
			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
				const wasActive = entry.status === "active";
				if (wasActive) markNeedsReReview(targetRoot, entry);
				errors.push(
					`Memory entry ${entry.entryId}: source ${ref} is missing — entry ${wasActive ? "moved to needs-re-review" : "is stale"} (AMBER_E_MEMORY_SOURCE_STALE). Durable exits: supersede or abandon.`,
				);
				continue;
			}
			const hashed = hashFile(resolved);
			if (
				(source.rawHash && source.rawHash !== hashed.rawHash) ||
				(source.normHash && source.normHash !== hashed.normHash)
			) {
				const wasActive = entry.status === "active";
				if (wasActive) markNeedsReReview(targetRoot, entry);
				errors.push(
					`Memory entry ${entry.entryId}: source ${ref} hash drift (AMBER_E_MEMORY_SOURCE_STALE) — entry ${wasActive ? "moved to needs-re-review" : "stays flagged"}. Durable exits: supersede or abandon.`,
				);
			}
		}
	}

	// Rule 3 — 反向指针与 related 指针 (best-effort): a dangling pointer is a
	// warning and never invalidates the entry.
	const registryIds = new Set(entries.map((entry) => entry.entryId));
	for (const entry of entries) {
		for (const id of entry.related || []) {
			if (!registryIds.has(id)) {
				warnings.push(
					`Memory entry ${entry.entryId}: related pointer ${id} has no registry target (best-effort, entry stays valid).`,
				);
			}
		}
		for (const source of (entry.provenance && entry.provenance.sources) || []) {
			if (source.backref && !fs.existsSync(path.resolve(targetRoot, source.backref))) {
				warnings.push(
					`Memory entry ${entry.entryId}: backref ${source.backref} no longer resolves (best-effort, entry stays valid).`,
				);
			}
		}
	}

	// Rule 4 — surface 漂移: a booked surface hash that no longer matches
	// MEMORY.md moves the entry to needs-re-review; edited MEMORY.md entries with
	// no governing registry entry get the explicit two-choice remedy (never a
	// bare "the hash changed").
	for (const entry of entries) {
		if (entry.status !== "active") continue;
		const booked = entry.bookedSurface;
		if (!booked || booked.path !== "MEMORY.md") continue;
		if (booked.normHash !== currentSurfaceHash) {
			markNeedsReReview(targetRoot, entry);
			errors.push(
				`Memory entry ${entry.entryId}: MEMORY.md drifted from the booked surface hash (AMBER_E_MEMORY_SURFACE_DRIFT) — entry moved to needs-re-review. Remedy: re-book with \`amber memory book --entry-id ${entry.entryId}\` after confirming the edit, or supersede/abandon.`,
			);
		}
	}
	const memoryBound = entries.some(
		(entry) =>
			entry.targetSurface === "MEMORY.md" &&
			["active", "proposal", "needs-re-review"].includes(entry.status),
	);
	if (surface.entries > 0 && !memoryBound) {
		warnings.push(
			`MEMORY.md holds ${surface.entries} entries in ## Entries but no registry entry is bound to the surface. Remedy (choose one): book a human-direct-ratification entry (\`amber memory book --ratify --claim "<entry heading>"\`, provenance = surface path + time + normHash ${currentSurfaceHash.slice(0, 19)}…), or manually revert the edit.`,
		);
	}

	// Rule 5 — 预算与限速合规: recompute α level and γ consumption from the
	// physical surface and the ledger; physical over-limit or an over-quota
	// ledger is an error (tamper / drift between the two counting surfaces).
	const alpha = alphaState(targetRoot);
	if (alpha.entries > ALPHA_MAX_ENTRIES || alpha.bytes > ALPHA_MAX_BYTES) {
		errors.push(
			`Memory α budget physically exceeded: ${alpha.entries}/${ALPHA_MAX_ENTRIES} entries, ${alpha.bytes}/${ALPHA_MAX_BYTES} bytes on MEMORY.md — prune or supersede before any further admission.`,
		);
	}
	const gamma = gammaWindow(targetRoot);
	if (gamma.windowAdmitted > GAMMA_QUOTA) {
		errors.push(
			`Memory γ ledger admits ${gamma.windowAdmitted} entries in the 168h window but the quota is ${GAMMA_QUOTA} — ledger and budget disagree (fail-closed).`,
		);
	}

	// Rule 6 — α 50% 强制复审 (#173-Q5): either dimension crossing 50% utilisation.
	if (surface.entries >= ALPHA_REVIEW_ENTRIES || surface.bytes >= ALPHA_REVIEW_BYTES) {
		warnings.push(
			`Memory α budget ≥ 50% utilised (${surface.entries}/${ALPHA_MAX_ENTRIES} entries, ${surface.bytes}/${ALPHA_MAX_BYTES} bytes) — forced review: prune or supersede before it exhausts.`,
		);
	}

	// Rule 7 — ratification-class 告警 (#173 追认强化 2): book with no prior approve.
	const approvedIds = new Set();
	for (const event of events) {
		if (event.kind === "memory-approval" && event.decision === "approve" && event.entryId) {
			approvedIds.add(event.entryId);
		}
	}
	for (const event of events) {
		if (event.kind !== "memory-book") continue;
		const ids = event.entryId
			? [event.entryId]
			: Array.isArray(event.entryIds)
				? event.entryIds
				: [];
		for (const id of ids) {
			if (!approvedIds.has(id)) {
				warnings.push(
					`Memory entry ${id} was booked with no prior memory-approval event (ratification-class, alongside needs-re-review).`,
				);
			}
		}
	}

	// Rule 8 — acknowledged divergence (#173-Q6): .gitignore ignores MEMORY.md.
	if (gitignoresMemoryMd(targetRoot)) {
		warnings.push(
			"MEMORY.md is ignored by .gitignore — acknowledged divergence, not a defect. Remedy: re-include with '!/MEMORY.md' (governed shared memory, tracked by default) or accept the L2 downgrade. Reported once.",
		);
	}

	// Rule 9 — pack 三件套一致性 (#174 / M2): memory-maintenance vs safe-amber-bootstrap.
	const memoryPackPath = path.join(targetRoot, "workflow-packs", "memory-maintenance.pack.json");
	const bootstrapPackPath = path.join(
		targetRoot,
		"workflow-packs",
		"safe-amber-bootstrap.pack.json",
	);
	if (fs.existsSync(memoryPackPath) && fs.existsSync(bootstrapPackPath)) {
		try {
			const memoryPack = JSON.parse(fs.readFileSync(memoryPackPath, "utf8"));
			const bootstrapPack = JSON.parse(fs.readFileSync(bootstrapPackPath, "utf8"));
			if (memoryTripletHash(memoryPack) !== memoryTripletHash(bootstrapPack)) {
				errors.push(
					"memory-maintenance.pack.json approvalPolicy/loopLedger/workspaceIsolation diverge from safe-amber-bootstrap.pack.json (must be verbatim identical). Remedy: co-revise both in the same PR.",
				);
			}
		} catch (err) {
			warnings.push(`Could not compare memory pack triplet consistency: ${err.message}`);
		}
	}

	// Rule 10 — book 时 git 检测 (#173-Q6): booked surface not under version control.
	const hasBookedSurface = entries.some(
		(entry) => entry.status === "active" || entry.bookedSurface,
	);
	if (hasBookedSurface && !fs.existsSync(path.join(targetRoot, ".git"))) {
		warnings.push(
			"MEMORY.md holds booked entries but the target is not a git working tree — the surface is not under version control (non-blocking).",
		);
	}

	// Rule 11 — abandoned 统计 (F4): cumulative count only; consumers filter abandoned.
	const abandoned = entries.filter((entry) => entry.status === "abandoned").length;
	if (abandoned > 0) {
		warnings.push(
			`${abandoned} abandoned memory ${abandoned === 1 ? "entry" : "entries"} in the registry (statistics only; all consumers filter abandoned).`,
		);
	}

	return { errors, warnings };
}

function doctor(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const classification = classifyTarget(targetRoot);
	if (classification.type === "product-repo") {
		return doctorProductRepo(targetRoot, classification);
	}

	const errors = [];
	const warnings = [];
	const checks = [];

	function addCheck(name, passed, detail, remedy) {
		const check = { name, passed, detail: detail || null };
		if (!passed && remedy) check.remedy = remedy;
		checks.push(check);
	}

	// Required harness files
	let missingFiles = 0;
	for (const relativePath of REQUIRED_HARNESS_FILES) {
		if (!pathExists(path.join(targetRoot, relativePath))) {
			missingFiles++;
			if (
				relativePath === "docs/wiki/agent/amber.md" &&
				pathExists(path.join(targetRoot, "docs", "wiki", "agent", "harness.md"))
			) {
				errors.push(
					`Missing required file: ${relativePath} (legacy harness.md found — run: amber migrate wiki --target .)`,
				);
				continue;
			}
			errors.push(`Missing required file: ${relativePath}`);
		}
	}
	addCheck(
		"Required harness files",
		missingFiles === 0,
		missingFiles === 0 ? "all present" : `${missingFiles} missing`,
		remedyFor("init", { targetDisplay: target || "." }),
	);

	// Feature list validation
	const featureResult = validateFeatureListFile(path.join(targetRoot, "feature_list.json"));
	errors.push(...featureResult.errors);
	warnings.push(...featureResult.warnings);
	addCheck(
		"feature_list.json",
		featureResult.errors.length === 0,
		featureResult.errors.length === 0 ? "valid" : featureResult.errors[0],
	);

	// Continuous improvement state
	const continuousImprovementResult = validateContinuousImprovementStateFile(
		path.join(targetRoot, ".workflow", "continuous-improvement", "state.json"),
	);
	errors.push(...continuousImprovementResult.errors);
	warnings.push(...continuousImprovementResult.warnings);
	addCheck(
		"Continuous improvement state",
		continuousImprovementResult.errors.length === 0,
		continuousImprovementResult.errors.length === 0
			? "valid"
			: continuousImprovementResult.errors[0],
	);

	// Wiki validation
	const wikiResult = validateWiki(targetRoot, { okf: options.okf === true });
	errors.push(...wikiResult.errors);
	warnings.push(...wikiResult.warnings);
	addCheck(
		"Wiki structure",
		wikiResult.errors.length === 0,
		wikiResult.errors.length === 0 ? "valid" : `${wikiResult.errors.length} errors`,
	);

	// AGENTS.md wiki routing
	const agentsRoutesWiki = fileMentionsWiki(path.join(targetRoot, "AGENTS.md"));
	if (!agentsRoutesWiki) {
		errors.push("AGENTS.md does not route agents to docs/wiki.");
	}
	addCheck("AGENTS.md → wiki routing", agentsRoutesWiki);

	// CLAUDE.md wiki routing
	const claudeExists = pathExists(path.join(targetRoot, "CLAUDE.md"));
	const claudeRoutesWiki = claudeExists && fileMentionsWiki(path.join(targetRoot, "CLAUDE.md"));
	if (claudeExists && !claudeRoutesWiki) {
		errors.push("CLAUDE.md does not route agents to docs/wiki.");
	}
	// When the file doesn't exist, report as not-applicable (null) rather than
	// passing — a missing file is not the same as a validated routing link.
	addCheck(
		"CLAUDE.md → wiki routing",
		claudeExists ? claudeRoutesWiki : null,
		!claudeExists
			? "file not present — check skipped"
			: claudeRoutesWiki
				? "routes to wiki"
				: "missing wiki routing",
	);

	// Verification command
	const hasVerify = hasVerificationCommand(targetRoot);
	if (!hasVerify) {
		errors.push(
			"docs/wiki/engineering/verification.md does not contain a verification command block.",
		);
	}
	addCheck("Verification command block", hasVerify);

	// PROGRESS.md next action
	const hasNext = hasNextAction(path.join(targetRoot, "PROGRESS.md"));
	if (!hasNext) {
		errors.push("PROGRESS.md does not contain a next action.");
	}
	addCheck("PROGRESS.md next action", hasNext);

	// Session handoff
	const handoffResult = validateHandoff(targetRoot);
	errors.push(...handoffResult.errors);
	warnings.push(...handoffResult.warnings);
	addCheck(
		"Session handoff",
		handoffResult.errors.length === 0,
		handoffResult.errors.length === 0 ? "valid" : `${handoffResult.errors.length} errors`,
	);

	// Plugin manifests (optional)
	if (hasPluginManifestDirectory(targetRoot)) {
		const manifestResult = validateManifests(targetRoot);
		errors.push(...manifestResult.errors);
		warnings.push(...manifestResult.warnings);
		addCheck(
			"Plugin manifests",
			manifestResult.errors.length === 0,
			manifestResult.errors.length === 0 ? "valid" : `${manifestResult.errors.length} errors`,
		);
	}

	// Version drift — scan artifacts with amber_protocol_version against the
	// installed package version. Only warn when the field is present and doesn't
	// match; absent fields are legal legacy artifacts (ADR-0012). Read policy:
	// a not-yet-migrated legacy .harness repo gets its artifacts scanned too.
	const stateDir = statePath(targetRoot);
	if (pathExists(stateDir)) {
		const driftArtifacts = [];
		const queue = [stateDir];
		while (queue.length > 0) {
			const dir = queue.shift();
			let entries;
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
					queue.push(full);
				} else if (entry.isFile() && entry.name.endsWith(".json")) {
					try {
						const content = JSON.parse(fs.readFileSync(full, "utf8"));
						if (content && typeof content.amber_protocol_version === "string") {
							if (content.amber_protocol_version !== CLI_VERSION) {
								const rel = path.relative(targetRoot, full);
								driftArtifacts.push(`${rel} (${content.amber_protocol_version})`);
							}
						}
					} catch {
						// Unparseable or non-object JSON; skip silently.
					}
				}
			}
		}
		if (driftArtifacts.length > 0) {
			const detail = `${driftArtifacts.length} artifact(s) at a different protocol version than installed (${CLI_VERSION}): ${driftArtifacts.join(", ")}`;
			warnings.push(detail);
			addCheck("Artifact protocol version", false, detail, "amber migrate --target .");
		} else {
			addCheck("Artifact protocol version", true, `all versioned artifacts match ${CLI_VERSION}`);
		}
	}

	// Context pages (optional — only when the context layer is in use, ADR-0009 D8)
	if (pathExists(statePath(targetRoot, "context"))) {
		const { verifyPages } = require("./context-verify");
		const ctx = verifyPages(targetRoot);
		if (!ctx.ok) {
			const detail = `${ctx.code}: ${ctx.detail}`;
			addCheck("Context projection", false, detail, "amber context projection rebuild --target .");
			errors.push(detail);
		} else if (ctx.summary.total > 0) {
			const hardFailures = ctx.summary.tampered + ctx.summary.obsolete + ctx.summary.orphaned;
			const detail = `${ctx.summary.total} pages: ok ${ctx.summary.ok}, stale ${ctx.summary.stale}, tampered ${ctx.summary.tampered}, obsolete ${ctx.summary.obsolete}, orphaned ${ctx.summary.orphaned}`;
			addCheck(
				"Context pages",
				hardFailures === 0,
				detail,
				hardFailures === 0 ? null : "amber context verify --target .",
			);
			if (hardFailures > 0) errors.push(detail);
		}
	}

	// Memory layer (§11 1–11): runs whenever the memory registry is in use OR
	// a MEMORY.md surface exists (rules 4/8 must see surface-only targets).
	if (
		pathExists(statePath(targetRoot, "memory")) ||
		pathExists(path.join(targetRoot, "MEMORY.md"))
	) {
		const memoryResult = doctorMemoryRules(targetRoot);
		errors.push(...memoryResult.errors);
		warnings.push(...memoryResult.warnings);
		addCheck(
			"Memory layer",
			memoryResult.errors.length === 0,
			`${memoryResult.errors.length} errors, ${memoryResult.warnings.length} warnings`,
			memoryResult.errors.length === 0 ? null : "amber memory status --json",
		);
	}

	return { target: targetRoot, classification, checks, errors, warnings };
}

module.exports = {
	hasPluginManifestDirectory,
	doctorProductRepo,
	doctorMemoryRules,
	doctor,
};
