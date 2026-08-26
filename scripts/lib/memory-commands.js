"use strict";

// Business-logic layer for the Governed Memory Layer (spec 2026-08-21
// abandon) plus the read-only status projection. It reuses ONLY the data layer
// (core/memory-store), identity/hash helpers (core/context-hash) and the error
// catalog (core/error-catalog) — zero cross-imports of session/context/
// governance handlers (spec §8: single-track registration, no aggregation
// layer). It never spawns a subprocess and never executes target-repo code
// (executesAnything: false); MEMORY.md is read-only here (never overwritten).
//
// Verb surface (§8.1):
//   request  → produce a nomination request artifact (+ memory-request-created)
//   ingest   → mechanical admission: ajv → α budget → γ rate-limit → K1/K2/K3
//              ranking → write proposals (+ memory-ingest)
//   approve  → the single human gate; proposal→(approved) or reject→draft; β
//              pair supersession atomic (+ memory-approval)
//   book     → surface hash registration; proposal/needs-re-review→active;
//              origin governed-promotion|human-direct-ratification (+ memory-book)
//   abandon  → explicit F1(ii) entry/request terminal marker (+ memory-abandon)
//   status   → three-section read-only projection (entries/gamma/alpha)
//
// Envelope, routing, and exit codes are owned by defineCommand (F039): the
// verb handlers return bodies; failure bodies carry bypassPrint: false so the
// coded envelope still renders through printResult in text mode.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const store = require("./core/memory-store");
const { sha256, hashFile } = require("./core/context-hash");
const {
	SCHEMA_VERSION,
	ALPHA_MAX_ENTRIES,
	ALPHA_MAX_BYTES,
	GAMMA_QUOTA,
	GAMMA_WINDOW_MS,
	AUTO_ABANDON_THRESHOLD,
	MEMORY_MD,
	SIGNAL_REQUIRED_CHANNELS,
	SIGNAL_CLOSED_SET,
	nowIso,
	readMemoryMd,
	alphaState,
	gammaWindow,
	bookText,
	computeEntryIdFor,
	withEntryId,
	rankEntries,
	maybeResolveRequests,
} = require("./core/memory-policy");
const { codedError } = require("./core/error-catalog");
const { compileSchema } = require("./core/schema-contract");
const { defineCommand } = require("./subcommand-dispatcher");

const CREED_HINT = [
	"── Memory creed (capability, not ceremony) ──",
	"Write to memory only when the entry is:",
	"  • a durable operator preference or correction that later sessions must respect;",
	"  • a decision that reverses an earlier one, so the outdated answer stops propagating;",
	"  • anything a fresh session would otherwise get wrong twice.",
	"Keep out of memory:",
	"  • one-off session detail — notes.md owns that for the current session;",
	"  • anything reconstructible from git history, feature_list.json, or the session timeline;",
	"  • transient task state that expires with the work it belonged to;",
	"  • mechanical facts the repository already records on its own.",
	"Every entry must change a future decision or be deleted.",
].join("\n");

// ── schema validators (§4.3-B1; compiled through the one schema-contract seam) ─

function validateEntrySchema(entry) {
	const entryValidate = compileSchema("memory-entry");
	if (entryValidate(entry)) return { valid: true, errors: [] };
	return {
		valid: false,
		errors: entryValidate.errors
			.slice(0, 5)
			.map((e) => `entry schema: ${e.instancePath || "/"} ${e.message}`),
	};
}

function validateRequestSchema(request) {
	const requestValidate = compileSchema("memory-request");
	if (requestValidate(request)) return { valid: true, errors: [] };
	return {
		valid: false,
		errors: requestValidate.errors
			.slice(0, 5)
			.map((e) => `request schema: ${e.instancePath || "/"} ${e.message}`),
	};
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function makeRequestId() {
	// ^[a-z0-9-]+$ — base36 timestamp (lowercase) + hex nonce.
	return `mreq-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

// The coded failure envelope every refusal returns. bypassPrint: false keeps
// the coded error rendering through printResult in text mode (F039).
function failure(code, message) {
	return {
		errors: [codedError(code, message)],
		warnings: [],
		code,
		bypassPrint: false,
	};
}

// Non-TTY without an explicit --yes is refused fail-closed.
function identityGate(args) {
	if (!process.stdout.isTTY && !args.yes) {
		return failure("AMBER_E_MEMORY_APPROVAL_REQUIRED", "non-interactive invocation without --yes");
	}
	return null;
}

function surfaceNormHash(targetRoot) {
	return sha256(store.normalizeMemoryMd(readMemoryMd(targetRoot)));
}

function findRequestId(targetRoot, entryId) {
	const found = store
		.readRequests(targetRoot)
		.find((r) => Array.isArray(r.entries) && r.entries.some((e) => e.entryId === entryId));
	return found ? found.requestId : undefined;
}

// Shared payload loading for request/ingest: resolve, exist-check, JSON.parse
// — both verbs emit the same coded failures.
function loadPayloadJson(targetRoot, ref) {
	const payloadPath = path.resolve(targetRoot, ref);
	if (!fs.existsSync(payloadPath)) {
		return failure("AMBER_E_MEMORY_REQUEST_NOT_FOUND", `payload not found: ${ref}`);
	}
	let body;
	try {
		body = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
	} catch (err) {
		return failure(
			"AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID",
			`payload not valid JSON: ${err.message}`,
		);
	}
	return { body };
}

// ── request (§5.1/§5.2) ───────────────────────────────────────────────────────
function handleRequest(args, targetRoot) {
	const gate = identityGate(args);
	if (gate) return gate;

	if (!args.payload) {
		return failure(
			"AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID",
			"memory request requires --payload <file.json>",
		);
	}
	const loaded = loadPayloadJson(targetRoot, args.payload);
	if (loaded.errors) return loaded;
	const body = loaded.body;

	const requestId = body.requestId || makeRequestId();
	const request = {
		schemaVersion: body.schemaVersion || SCHEMA_VERSION,
		requestId,
		createdAt: body.createdAt || nowIso(),
		triggerRef: body.triggerRef || { ref: "manual" },
		provenance: body.provenance || { channel: "human-escape-hatch" },
		entries: (body.entries || []).map(withEntryId),
		contract: body.contract || {
			instructions: "Nominate durable memory entries for human approval.",
			constraints: { forbidNewFacts: true },
		},
		acceptance: body.acceptance || [
			{ check: "entry schema", code: "AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID" },
		],
	};

	const v = validateRequestSchema(request);
	if (!v.valid) {
		return failure("AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID", v.errors.join("; "));
	}

	// §10.4: request file = artifact + bookkeeping {status, resolvedAt?, rejectionCount}.
	// §5.2-C5/F2: a derived request inherits the parent's rejection count — the
	// 3-strike auto-abandon threshold accumulates across the lineage.
	let rejectionCount = body.rejectionCount || 0;
	const derivedFrom = request.provenance && request.provenance.derivedFrom;
	if (derivedFrom) {
		const parent = store.readRequests(targetRoot).find((r) => r.requestId === derivedFrom);
		if (parent && (parent.rejectionCount || 0) > rejectionCount) {
			rejectionCount = parent.rejectionCount || 0;
		}
	}
	const artifact = { ...request, status: "open", rejectionCount };
	store.writeRequest(targetRoot, artifact);
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-request-created",
		requestId,
		channel: request.provenance.channel,
		signal: request.provenance.signal,
		triggerRef: { ref: request.triggerRef.ref },
		entryIds: request.entries.map((e) => e.entryId),
		batchId: request.provenance.batchId,
		derivedFrom: request.provenance.derivedFrom,
	});
	return {
		errors: [],
		warnings: [],
		text: `memory request ${requestId} created (${request.entries.length} entry/entries, channel ${request.provenance.channel}).`,
		requestId,
		entryIds: request.entries.map((e) => e.entryId),
	};
}

// ── ingest (§5.3 five-stage acceptance, all-or-nothing) ───────────────────────
function rejectIngest(targetRoot, request, channel, code, message, entryIds, ranking) {
	const warnings = [];
	let abandoned = false;
	if (request) {
		// §5.6-F1(i)/F2: lineage rejection count;唯一重置 = 新 requestId。
		request.rejectionCount = (request.rejectionCount || 0) + 1;
		if (request.rejectionCount >= AUTO_ABANDON_THRESHOLD) {
			abandoned = true;
			request.status = "resolved";
			request.resolvedAt = nowIso();
		}
		store.writeRequest(targetRoot, request);
	}
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-ingest",
		requestId: request && request.requestId,
		channel,
		outcome: "rejected",
		entryIds,
		code,
		ranking,
		batchId: request && request.provenance && request.provenance.batchId,
	});
	if (abandoned) {
		// F1(i) auto path: request + named entries → abandoned, ledger-only
		// (不经任何动词表面调用), a single memory-abandon event records it.
		for (const id of entryIds) {
			const entry = store.readEntry(targetRoot, id);
			if (entry && entry.status !== "abandoned") {
				entry.status = "abandoned";
				entry.updatedAt = nowIso();
				store.writeEntry(targetRoot, entry);
			}
		}
		store.appendMemoryEvent(targetRoot, {
			kind: "memory-abandon",
			scope: "request",
			targetId: request.requestId,
			triggerSource: "auto-threshold",
			requestId: request.requestId,
		});
		warnings.push(
			`request ${request.requestId} auto-abandoned after ${AUTO_ABANDON_THRESHOLD} ingest rejections (F1(i)).`,
		);
	}
	return {
		errors: [codedError(code, message)],
		warnings,
		code,
		outcome: "rejected",
		entryIds,
		ranking,
		bypassPrint: false,
	};
}

// source whose ref resolves to an existing file inside the target must still
// hash to the registered rawHash/normHash; a mismatch means the file changed
// after the request (or the hash was fabricated) — refuse the whole batch.
function checkSourceBinding(targetRoot, entries) {
	for (const entry of entries) {
		for (const source of (entry.provenance && entry.provenance.sources) || []) {
			// Excerpt sources carry their own integrity seal: excerptHash must
			// be the hash of the excerpt text itself (§5.3 provenance 哈希校验).
			if (source.excerpt && source.excerptHash && sha256(source.excerpt) !== source.excerptHash) {
				return {
					code: "AMBER_E_MEMORY_BINDING_MISMATCH",
					message: `source ${String(source.ref || "(excerpt)")} excerpt fails its excerptHash seal — regenerate the request`,
				};
			}
			const ref = String(source.ref || "");
			if (!ref || ref === "manual") continue;
			const resolved = path.resolve(targetRoot, ref);
			if (resolved !== targetRoot && !resolved.startsWith(targetRoot + path.sep)) continue;
			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
				if (source.mutable === false) {
					return {
						code: "AMBER_E_MEMORY_SOURCE_STALE",
						message: `immutable source missing at ingest: ${ref}`,
					};
				}
				continue;
			}
			const hashed = hashFile(resolved);
			if (source.rawHash && source.rawHash !== hashed.rawHash) {
				return {
					code: "AMBER_E_MEMORY_BINDING_MISMATCH",
					message: `source ${ref} no longer hashes to the registered rawHash — regenerate the request`,
				};
			}
			if (source.normHash && source.normHash !== hashed.normHash) {
				return {
					code: "AMBER_E_MEMORY_BINDING_MISMATCH",
					message: `source ${ref} no longer hashes to the registered normHash — regenerate the request`,
				};
			}
		}
	}
	return null;
}

// §5.3 input resolution: --request <id> loads the stored artifact (terminal
// lineages refused fail-closed); --payload reads a raw ad-hoc batch.
function resolveIngestSource(args, targetRoot) {
	const requestId = args.request || args.requestId;
	if (requestId) {
		const request = store.readRequests(targetRoot).find((r) => r.requestId === requestId);
		if (!request) {
			return failure("AMBER_E_MEMORY_REQUEST_NOT_FOUND", `request not found: ${requestId}`);
		}
		// §5.6-F1(i)/C5 terminality: a resolved request is a dead lineage — its
		// entries can never be re-admitted; continue via a fresh request with
		// provenance.derivedFrom.
		if (request.status === "resolved") {
			const autoAbandoned = store
				.readMemoryEvents(targetRoot, 0)
				.some((e) => e.kind === "memory-abandon" && e.targetId === requestId);
			return failure(
				"AMBER_E_MEMORY_STATE_INVALID",
				`request ${requestId} is resolved (${
					autoAbandoned
						? "F1(i) auto-abandoned lineage"
						: "all entries reached terminal disposition"
				}) — submit a new request with provenance.derivedFrom to continue the lineage`,
			);
		}
		return {
			request,
			requestId,
			rawEntries: request.entries || [],
			payloadBody: null,
			channel: request.provenance && request.provenance.channel,
		};
	}
	if (args.payload) {
		const loaded = loadPayloadJson(targetRoot, args.payload);
		if (loaded.errors) return loaded;
		return {
			request: null,
			requestId: undefined,
			rawEntries: loaded.body.entries || [],
			payloadBody: loaded.body,
			channel: loaded.body.channel || (loaded.body.provenance && loaded.body.provenance.channel),
		};
	}
	return failure(
		"AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID",
		"memory ingest requires --request <id> or --payload <file.json>",
	);
}

function handleIngest(args, targetRoot) {
	const gate = identityGate(args);
	if (gate) return gate;

	const source = resolveIngestSource(args, targetRoot);
	if (source.errors) return source;
	const { request, requestId, payloadBody, channel } = source;

	const entries = source.rawEntries.map(withEntryId);
	const entryIds = entries.map((e) => e.entryId);

	// Stage 1: ajv per entry (§5.3).
	for (const entry of entries) {
		const v = validateEntrySchema(entry);
		if (!v.valid) {
			return rejectIngest(
				targetRoot,
				request,
				channel,
				"AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID",
				v.errors.join("; "),
				entryIds,
			);
		}
	}

	// Stage 2: checkRequestBinding-style per-source hash verification (§5.3-B1).
	// A file-backed source must still hash to what the request registered;
	// a drifted or fabricated hash refuses the whole batch.
	const bindingFindings = checkSourceBinding(targetRoot, entries);
	if (bindingFindings) {
		return rejectIngest(
			targetRoot,
			request,
			channel,
			bindingFindings.code,
			bindingFindings.message,
			entryIds,
		);
	}

	// Stage 3: signal closed-set for conversion/dreaming channels (§5.3/§6.1).
	if (channel && SIGNAL_REQUIRED_CHANNELS.has(channel)) {
		const signal =
			(request && request.provenance && request.provenance.signal) ||
			(payloadBody && payloadBody.provenance && payloadBody.provenance.signal);
		if (!signal || !SIGNAL_CLOSED_SET.has(signal)) {
			return rejectIngest(
				targetRoot,
				request,
				channel,
				"AMBER_E_MEMORY_SIGNAL_INVALID",
				`channel ${channel} requires a closed-set signal id`,
				entryIds,
			);
		}
	}

	// F3 rebuild exclusion first (§3.5): abandoned registry entries are never
	// re-admitted — drop them from the candidate set before budget arithmetic.
	const skipped = entries
		.filter((e) => {
			const prior = store.readEntry(targetRoot, e.entryId);
			return prior && prior.status === "abandoned";
		})
		.map((e) => e.entryId);
	const effective = entries.filter((e) => !skipped.includes(e.entryId));
	const effectiveIds = effective.map((e) => e.entryId);
	if (effective.length === 0) {
		// §5.3-M3 / §9: a legal empty result — outcome "no-change", no γ consumed.
		store.appendMemoryEvent(targetRoot, {
			kind: "memory-ingest",
			requestId,
			channel,
			outcome: "no-change",
			entryIds: [],
			skippedAbandoned: skipped,
			batchId: request && request.provenance && request.provenance.batchId,
		});
		return {
			text: `ingest: no change — all ${skipped.length} candidate(s) are abandoned (F3 rebuild exclusion).`,
			errors: [],
			warnings: [],
			outcome: "no-change",
			entryIds: [],
		};
	}

	// Stage 4: α budget for MEMORY.md-targeted entries (§6.3 admission
	// arithmetic, β-freed slots netted out — see alphaBudgetRefusal).
	const alphaRefusal = alphaBudgetRefusal(targetRoot, request, channel, entryIds, effective);
	if (alphaRefusal) return alphaRefusal;

	// Stage 5: γ rate-limit over the mixed pool — see rankForGammaAdmission.
	const gammaOutcome = rankForGammaAdmission(
		targetRoot,
		request,
		channel,
		entryIds,
		effective,
		effectiveIds,
	);
	if (gammaOutcome.errors) return gammaOutcome;
	const rankedPool = gammaOutcome.rankedPool;

	// Stage 6: admit (draft→proposal), ranking留痕 over the mixed pool (§6.5).
	const now = nowIso();
	for (const { entry } of rankedPool.filter((r) => !r.queued)) {
		store.writeEntry(targetRoot, {
			...entry,
			status: "proposal",
			rejectionCount: 0,
			createdAt: now,
			updatedAt: now,
		});
	}
	const ranking = rankedPool.map((r) => ({
		entryId: r.entryId,
		k1: r.k1,
		k2: r.k2,
		queued: r.queued,
	}));
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-ingest",
		requestId,
		channel,
		outcome: "admitted",
		entryIds: effectiveIds,
		skippedAbandoned: skipped,
		ranking,
		batchId: request && request.provenance && request.provenance.batchId,
	});
	const warnings = skipped.length
		? [
				`${skipped.length} abandoned entr${skipped.length === 1 ? "y" : "ies"} skipped (F3 rebuild exclusion — abandoned is terminal).`,
			]
		: [];
	return {
		text: `ingest admitted ${effectiveIds.length} proposal(s).`,
		errors: [],
		warnings,
		outcome: "admitted",
		entryIds: effectiveIds,
		ranking,
	};
}

// Stage 4: α budget projection for MEMORY.md-targeted entries (§6.3 admission
// arithmetic). β pairs free the pointed-to entry's slot and bytes — the
// projection nets them out, so an exhausted budget still admits a
// one-in-one-out pair (§6.4) while refusing bare growth.
function alphaBudgetRefusal(targetRoot, request, channel, entryIds, effective) {
	const memMd = effective.filter((e) => e.targetSurface === MEMORY_MD);
	if (memMd.length === 0) return null;
	const alpha = alphaState(targetRoot);
	const freedIds = new Set();
	let freedBytes = 0;
	for (const entry of memMd) {
		if (!entry.supersedeTarget) continue;
		const prior = store.readEntry(targetRoot, entry.supersedeTarget);
		if (
			prior &&
			["active", "needs-re-review"].includes(prior.status) &&
			!freedIds.has(prior.entryId)
		) {
			freedIds.add(prior.entryId);
			freedBytes += Buffer.byteLength(bookText(prior), "utf8");
		}
	}
	const projectedEntries = alpha.entries + memMd.length - freedIds.size;
	const projectedBytes =
		alpha.bytes +
		memMd.reduce((s, e) => s + Buffer.byteLength(bookText(e), "utf8"), 0) -
		freedBytes;
	if (projectedEntries > ALPHA_MAX_ENTRIES || projectedBytes > ALPHA_MAX_BYTES) {
		return rejectIngest(
			targetRoot,
			request,
			channel,
			"AMBER_E_MEMORY_BUDGET_EXCEEDED",
			`α budget: entries ${projectedEntries}/${ALPHA_MAX_ENTRIES}, bytes ${projectedBytes}/${ALPHA_MAX_BYTES} (net of ${freedIds.size} β-freed) — split the batch or supersede an existing entry`,
			entryIds,
		);
	}
	return null;
}

// Stage 5: γ rate-limit over the full admission mixed pool (§6.5 C4×M14):
// current candidates + queued un-admitted candidates from other open
// requests, ranked K1/K2/K3, truncated to the window's remaining quota —
// the whole current batch must land inside the admitted slice. Returns the
// refusal, or the ranked pool stage 6 admits from.
function rankForGammaAdmission(targetRoot, request, channel, entryIds, effective, effectiveIds) {
	const quota = gammaWindow(targetRoot).quotaRemaining;
	const currentCandidates = effective.map((entry) => ({
		entry,
		createdAt: request ? request.createdAt : undefined,
		queued: false,
	}));
	const queued = [];
	const queuedSeen = new Set(effectiveIds);
	for (const other of store.readRequests(targetRoot)) {
		if (other.status === "resolved") continue;
		if (request && other.requestId === request.requestId) continue;
		for (const e of other.entries || []) {
			const prior = store.readEntry(targetRoot, e.entryId);
			if (
				prior &&
				["proposal", "active", "superseded", "needs-re-review", "abandoned"].includes(prior.status)
			)
				continue;
			if (queuedSeen.has(e.entryId)) continue;
			queuedSeen.add(e.entryId);
			queued.push({ entry: withEntryId(e), createdAt: other.createdAt, queued: true });
		}
	}
	const pool = currentCandidates.concat(queued);
	const rankedPool = rankEntries(targetRoot, pool);
	if (effectiveIds.length > quota || pool.length > quota) {
		const admittedSlice = new Set(rankedPool.slice(0, quota).map((r) => r.entryId));
		const currentFits = effectiveIds.every((id) => admittedSlice.has(id));
		if (!currentFits) {
			const ranking = rankedPool.map((r) => ({
				entryId: r.entryId,
				k1: r.k1,
				k2: r.k2,
				queued: r.queued,
			}));
			return rejectIngest(
				targetRoot,
				request,
				channel,
				"AMBER_E_MEMORY_RATE_LIMITED",
				`γ remaining ${quota} in 168h window cannot admit the whole batch of ${effectiveIds.length} (mixed pool ${pool.length}, ranked)`,
				entryIds,
				ranking,
			);
		}
	}
	return { rankedPool };
}

// ── approve (§5.4 the single human gate; typed seam already gated --yes) ──────

// A4 reject path: proposal→draft with a mandatory non-empty reason.
function approveReject(args, targetRoot, entry, entryId, requestId) {
	const reason = args.reason;
	if (!reason || !String(reason).trim()) {
		return failure("AMBER_E_MEMORY_STATE_INVALID", "reject requires a non-empty --reason");
	}
	const now = nowIso();
	entry.status = "draft";
	entry.lastRejection = { reason: String(reason), at: now };
	entry.updatedAt = now;
	store.writeEntry(targetRoot, entry);
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-approval",
		entryId,
		requestId,
		decision: "reject",
		reason: String(reason),
		decidedBy: "human",
	});
	maybeResolveRequests(targetRoot, [entryId]);
	return {
		errors: [],
		warnings: [],
		text: `${CREED_HINT}\n\nrejected ${entryId} → draft.`,
		decision: "reject",
		entryId,
		status: "draft",
	};
}

// C3 β pair: approving an entry that carries supersedeTarget completes the
// pair atomically — the pointed active/needs-re-review entry → superseded.
function approveSupersedePair(targetRoot, entry, entryId, requestId) {
	const supersedeTarget = entry.supersedeTarget;
	const target = store.readEntry(targetRoot, supersedeTarget);
	if (!target) {
		return failure(
			"AMBER_E_MEMORY_ENTRY_NOT_FOUND",
			`supersedeTarget not found: ${supersedeTarget}`,
		);
	}
	if (!["active", "needs-re-review"].includes(target.status)) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			`supersedeTarget must be active/needs-re-review (got ${target.status})`,
		);
	}
	const now = nowIso();
	entry.approvedAt = now;
	entry.updatedAt = now;
	store.writeEntry(targetRoot, entry);
	target.status = "superseded";
	target.updatedAt = now;
	store.writeEntry(targetRoot, target);
	// Two memory-approval events in the same call (§4.1/§9).
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-approval",
		entryId,
		requestId,
		decision: "approve",
		decidedBy: "human",
	});
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-approval",
		entryId,
		requestId,
		decision: "approve",
		decidedBy: "human",
		supersededEntryId: supersedeTarget,
	});
	maybeResolveRequests(targetRoot, [entryId, supersedeTarget]);
	return {
		errors: [],
		warnings: [],
		text: `${CREED_HINT}\n\napproved ${entryId}; superseded ${supersedeTarget} (β pair). Write to MEMORY.md, then \`amber memory book\`.`,
		decision: "approve",
		entryId,
		supersededEntryId: supersedeTarget,
	};
}

function handleApprove(args, targetRoot) {
	const entryId = args.entryId;
	if (!entryId) {
		return failure("AMBER_E_MEMORY_STATE_INVALID", "memory approve requires --entry-id");
	}
	const entry = store.readEntry(targetRoot, entryId);
	if (!entry) {
		return failure("AMBER_E_MEMORY_ENTRY_NOT_FOUND", `entry not found: ${entryId}`);
	}
	if (entry.status !== "proposal") {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			`approve requires proposal state (got ${entry.status})`,
		);
	}
	const requestId = findRequestId(targetRoot, entryId);
	const decision = args.decision || "approve";

	if (decision === "reject") {
		return approveReject(args, targetRoot, entry, entryId, requestId);
	}
	if (entry.supersedeTarget) {
		return approveSupersedePair(targetRoot, entry, entryId, requestId);
	}

	const now = nowIso();
	entry.approvedAt = now;
	entry.updatedAt = now;
	store.writeEntry(targetRoot, entry);
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-approval",
		entryId,
		requestId,
		decision: "approve",
		decidedBy: "human",
	});
	return {
		errors: [],
		warnings: [],
		text: `${CREED_HINT}\n\napproved ${entryId}. Write the entry into MEMORY.md, then run \`amber memory book --entry-id ${entryId}\`.`,
		decision: "approve",
		entryId,
	};
}

// ── book (§5.5 surface registration + dual-track origin) ──────────────────────

// §5.5 ratification track (human-direct-ratification): a human edit already
// on MEMORY.md enters the ledger directly — no prior request/ingest/approve,
// no γ. Provenance points at the edit fact itself (surface path + time +
// normHash); knowledgeKind is the human's choice (unspecified allowed).
function bookRatified(targetRoot, args, surfacePath, normHash, now, warnings) {
	const claim = args.claim;
	if (!claim || !String(claim).trim()) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			"ratification requires --claim <text> (the entry heading as written in MEMORY.md)",
		);
	}
	const knowledgeKind = args.knowledgeKind || "unspecified";
	const raw = readMemoryMd(targetRoot);
	const candidate = withEntryId({
		schemaVersion: SCHEMA_VERSION,
		claim: String(claim),
		knowledgeKind,
		targetSurface: MEMORY_MD,
		provenance: {
			sources: [
				{
					kind: "surface",
					ref: MEMORY_MD,
					rawHash: sha256(raw),
					normHash,
					mutable: true,
				},
			],
		},
	});
	const v = validateEntrySchema(candidate);
	if (!v.valid) {
		return failure("AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID", v.errors.join("; "));
	}
	if (store.readEntry(targetRoot, candidate.entryId)) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			`entry ${candidate.entryId} is already registered — no ratification needed (re-book by --entry-id only if drift moves it to needs-re-review)`,
		);
	}
	store.writeEntry(targetRoot, {
		...candidate,
		status: "active",
		origin: "human-direct-ratification",
		bookedSurface: { path: surfacePath, normHash, bookedAt: now },
		createdAt: now,
		updatedAt: now,
	});
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-book",
		entryIds: [candidate.entryId],
		origin: "human-direct-ratification",
		surfacePath,
		normHash,
	});
	return {
		text: `ratified ${candidate.entryId} → active (human-direct-ratification; no γ consumed).`,
		errors: [],
		warnings,
		origin: "human-direct-ratification",
		entryId: candidate.entryId,
		normHash,
	};
}

function handleBook(args, targetRoot) {
	const gate = identityGate(args);
	if (gate) return gate;

	const surfacePath = MEMORY_MD;
	const normHash = surfaceNormHash(targetRoot);
	const now = nowIso();
	const warnings = [];
	// §5.5/§11-10 git detection (no spawn): warn when there is no git working tree.
	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		warnings.push(
			`target surface ${surfacePath} is not in a git-tracked repository (non-blocking).`,
		);
	}

	// §5.5 ratification track (human-direct-ratification): a human edit already
	// on MEMORY.md enters the ledger directly — no prior request/ingest/approve,
	// no γ. Provenance points at the edit fact itself (surface path + time +
	// normHash); knowledgeKind is the human's choice (unspecified allowed).
	const entryId = args.entryId || args.entry;
	if (args.ratify && entryId) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			"--ratify and --entry-id are mutually exclusive: ratify creates a new registry entry from --claim; --entry-id books an existing one",
		);
	}
	if (args.ratify && !entryId) {
		return bookRatified(targetRoot, args, surfacePath, normHash, now, warnings);
	}

	if (!entryId) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			"memory book requires --entry-id, or --ratify --claim <text> for a human direct edit",
		);
	}
	const entry = store.readEntry(targetRoot, entryId);
	if (!entry) {
		return failure("AMBER_E_MEMORY_ENTRY_NOT_FOUND", `entry not found: ${entryId}`);
	}
	// proposal→active (governed-promotion) or needs-re-review→active (reset, §4.1).
	if (!["proposal", "needs-re-review"].includes(entry.status)) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			`book requires proposal/needs-re-review (got ${entry.status})`,
		);
	}

	const origin = args.ratify ? "human-direct-ratification" : "governed-promotion";

	// §11-7 ratification-class: a governed-promotion book with no prior approve.
	if (origin === "governed-promotion" && !entry.approvedAt) {
		warnings.push(
			"book without a prior approve event (ratification-class); doctor rule 7 will flag this.",
		);
	}

	entry.status = "active";
	entry.origin = origin;
	entry.bookedSurface = { path: surfacePath, normHash, bookedAt: now };
	entry.updatedAt = now;
	store.writeEntry(targetRoot, entry);
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-book",
		entryIds: [entryId],
		origin,
		surfacePath,
		normHash,
		requestId: origin === "governed-promotion" ? findRequestId(targetRoot, entryId) : undefined,
	});
	maybeResolveRequests(targetRoot, [entryId]);
	return {
		text: `booked ${entryId} → active (${origin}).`,
		errors: [],
		warnings,
		origin,
		entryId,
		normHash,
	};
}

// ── abandon (§5.6-F1(ii) explicit human entry point) ──────────────────────────
function handleAbandon(args, targetRoot) {
	const requestId = args.request;
	const entryId = args.entry || args.entryId;
	if ((requestId && entryId) || (!requestId && !entryId)) {
		return failure(
			"AMBER_E_MEMORY_STATE_INVALID",
			"memory abandon requires exactly one of --request or --entry",
		);
	}
	const now = nowIso();

	if (entryId) {
		const entry = store.readEntry(targetRoot, entryId);
		if (!entry) {
			return failure("AMBER_E_MEMORY_ENTRY_NOT_FOUND", `entry not found: ${entryId}`);
		}
		if (entry.status === "abandoned") {
			return failure("AMBER_E_MEMORY_STATE_INVALID", `entry already abandoned: ${entryId}`);
		}
		entry.status = "abandoned";
		entry.updatedAt = now;
		store.writeEntry(targetRoot, entry);
		store.appendMemoryEvent(targetRoot, {
			kind: "memory-abandon",
			scope: "entry",
			targetId: entryId,
			triggerSource: "explicit",
			entryId,
		});
		maybeResolveRequests(targetRoot, [entryId]);
		return {
			errors: [],
			warnings: [],
			text: `abandoned entry ${entryId}.`,
			scope: "entry",
			entryId,
		};
	}

	const request = store.readRequests(targetRoot).find((r) => r.requestId === requestId);
	if (!request) {
		return failure("AMBER_E_MEMORY_REQUEST_NOT_FOUND", `request not found: ${requestId}`);
	}
	const abandonedIds = [];
	for (const e of request.entries || []) {
		const entry = store.readEntry(targetRoot, e.entryId);
		if (entry && entry.status !== "abandoned") {
			entry.status = "abandoned";
			entry.updatedAt = now;
			store.writeEntry(targetRoot, entry);
			abandonedIds.push(e.entryId);
		}
	}
	request.status = "resolved";
	request.resolvedAt = now;
	store.writeRequest(targetRoot, request);
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-abandon",
		scope: "request",
		targetId: requestId,
		triggerSource: "explicit",
		requestId,
	});
	return {
		errors: [],
		warnings: [],
		text: `abandoned request ${requestId} (${abandonedIds.length} entry/entries).`,
		scope: "request",
		requestId,
		entryIds: abandonedIds,
	};
}

// ── status (§8.2 three-section read-only projection) ──────────────────────────
function buildProjection(targetRoot) {
	const counts = {
		draft: 0,
		proposal: 0,
		active: 0,
		superseded: 0,
		needsReReview: 0,
		abandoned: 0,
	};
	for (const entry of store.listEntries(targetRoot)) {
		switch (entry.status) {
			case "draft":
				counts.draft += 1;
				break;
			case "proposal":
				counts.proposal += 1;
				break;
			case "active":
				counts.active += 1;
				break;
			case "superseded":
				counts.superseded += 1;
				break;
			case "needs-re-review":
				counts.needsReReview += 1;
				break;
			case "abandoned":
				counts.abandoned += 1;
				break;
			default:
				break;
		}
	}
	const pendingRequests = store
		.readRequests(targetRoot)
		.filter((r) => r.status !== "resolved").length;
	const gamma = gammaWindow(targetRoot);
	const alpha = alphaState(targetRoot);
	const utilizationPct =
		Math.round(Math.max(alpha.entries / ALPHA_MAX_ENTRIES, alpha.bytes / ALPHA_MAX_BYTES) * 1000) /
		10;
	return {
		entries: { ...counts, pendingRequests },
		gamma: {
			windowAdmitted: gamma.windowAdmitted,
			quotaRemaining: gamma.quotaRemaining,
			windowStart: gamma.windowStart,
			windowEnd: gamma.windowEnd,
		},
		alpha: {
			entries: alpha.entries,
			maxEntries: ALPHA_MAX_ENTRIES,
			bytes: alpha.bytes,
			maxBytes: ALPHA_MAX_BYTES,
			utilizationPct,
		},
	};
}

function renderStatus(p) {
	const e = p.entries;
	return [
		"Memory status (registry + events.jsonl; observation only — doctor is the judgment authority):",
		`  entries: draft ${e.draft}, proposal ${e.proposal}, active ${e.active}, superseded ${e.superseded}, needs-re-review ${e.needsReReview}, abandoned ${e.abandoned}, pending requests ${e.pendingRequests}`,
		`  gamma:   ${p.gamma.windowAdmitted}/${GAMMA_QUOTA} admitted in 168h (remaining ${p.gamma.quotaRemaining})`,
		`  alpha:   ${p.alpha.entries}/${p.alpha.maxEntries} entries, ${p.alpha.bytes}/${p.alpha.maxBytes} bytes (${p.alpha.utilizationPct}% utilization)`,
	].join("\n");
}

function handleStatus(args, targetRoot) {
	const projection = buildProjection(targetRoot);
	return {
		...projection,
		text: renderStatus(projection),
		errors: [],
		warnings: [],
	};
}

// ── dispatch (§8.1 one handler per verb) ──────────────────────────────────────
// defineCommand owns routing, the envelope, and exit codes. The dispatcher is
// built per call because the verb handlers need the per-call target root and
// the unknown-action guidance names the attempted verb.
const MEMORY_ACTIONS = ["request", "ingest", "approve", "book", "abandon", "status"];

function memoryDispatch(subcommand, args, targetRoot) {
	const root = path.resolve(targetRoot || (args && args.target) || process.cwd());
	const dispatch = defineCommand({
		command: "memory",
		actions: MEMORY_ACTIONS,
		handlers: {
			request: (a) => handleRequest(a, root),
			ingest: (a) => handleIngest(a, root),
			approve: (a) => handleApprove(a, root),
			book: (a) => handleBook(a, root),
			abandon: (a) => handleAbandon(a, root),
			status: (a) => handleStatus(a, root),
		},
		unknown: () => ({
			errors: [
				codedError(
					"AMBER_E_MEMORY_STATE_INVALID",
					`unknown memory action: ${subcommand}. Expected one of: ${MEMORY_ACTIONS.join(", ")}`,
				),
			],
			warnings: [],
			code: "AMBER_E_MEMORY_STATE_INVALID",
		}),
	});
	return dispatch(subcommand, args);
}

module.exports = {
	memoryDispatch,
	handleRequest,
	handleIngest,
	handleApprove,
	handleBook,
	handleAbandon,
	handleStatus,
	buildProjection,
	// exported for tests / doctor reuse
	alphaState,
	gammaWindow,
	computeEntryIdFor,
	ALPHA_MAX_ENTRIES,
	ALPHA_MAX_BYTES,
	GAMMA_QUOTA,
	GAMMA_WINDOW_MS,
	AUTO_ABANDON_THRESHOLD,
};
