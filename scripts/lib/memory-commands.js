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

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

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

// ── ajv validators (lazy-compiled; §4.3-B1 reuse of ajv acceptance mode) ──────
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
let entryValidate = null;
let requestValidate = null;

function loadSchema(name) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", name), "utf8"));
}

function validateEntrySchema(entry) {
	if (!entryValidate) entryValidate = ajv.compile(loadSchema("memory-entry.schema.json"));
	if (entryValidate(entry)) return { valid: true, errors: [] };
	return {
		valid: false,
		errors: entryValidate.errors
			.slice(0, 5)
			.map((e) => `entry schema: ${e.instancePath || "/"} ${e.message}`),
	};
}

function validateRequestSchema(request) {
	if (!requestValidate) requestValidate = ajv.compile(loadSchema("memory-request.schema.json"));
	if (requestValidate(request)) return { valid: true, errors: [] };
	return {
		valid: false,
		errors: requestValidate.errors
			.slice(0, 5)
			.map((e) => `request schema: ${e.instancePath || "/"} ${e.message}`),
	};
}

// ── Envelope helpers (mirror command-dispatcher handler shape) ────────────────
function ok(args, body = {}) {
	return {
		result: { target: args.target, errors: [], warnings: [], ...body },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function fail(args, code, message, extra = {}) {
	return {
		result: {
			target: args.target,
			errors: [codedError(code, message)],
			warnings: [],
			code,
			...extra,
		},
		exitCode: 1,
		bypassPrint: false,
	};
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function makeRequestId() {
	// ^[a-z0-9-]+$ — base36 timestamp (lowercase) + hex nonce.
	return `mreq-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

// in the typed seam). Non-TTY without an explicit --yes is refused fail-closed.
function identityGate(args) {
	if (!process.stdout.isTTY && !args.yes) {
		return fail(
			args,
			"AMBER_E_MEMORY_APPROVAL_REQUIRED",
			"non-interactive invocation without --yes",
		);
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

// ── request (§5.1/§5.2) ───────────────────────────────────────────────────────
function handleRequest(args, targetRoot) {
	const gate = identityGate(args);
	if (gate) return gate;

	if (!args.payload) {
		return fail(
			args,
			"AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID",
			"memory request requires --payload <file.json>",
		);
	}
	const payloadPath = path.resolve(targetRoot, args.payload);
	if (!fs.existsSync(payloadPath)) {
		return fail(args, "AMBER_E_MEMORY_REQUEST_NOT_FOUND", `payload not found: ${args.payload}`);
	}
	let body;
	try {
		body = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
	} catch (err) {
		return fail(
			args,
			"AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID",
			`payload not valid JSON: ${err.message}`,
		);
	}

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
	if (!v.valid) return fail(args, "AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID", v.errors.join("; "));

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
	return ok(args, {
		text: `memory request ${requestId} created (${request.entries.length} entry/entries, channel ${request.provenance.channel}).`,
		requestId,
		entryIds: request.entries.map((e) => e.entryId),
	});
}

// ── ingest (§5.3 five-stage acceptance, all-or-nothing) ───────────────────────
function rejectIngest(args, targetRoot, request, channel, code, message, entryIds, ranking) {
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
		result: {
			target: args.target,
			errors: [codedError(code, message)],
			warnings,
			code,
			outcome: "rejected",
			entryIds,
			ranking,
		},
		exitCode: 1,
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

function handleIngest(args, targetRoot) {
	const gate = identityGate(args);
	if (gate) return gate;

	let rawEntries;
	let payloadBody = null;
	let channel;
	let request = null;
	const requestId = args.request || args.requestId;
	if (requestId) {
		request = store.readRequests(targetRoot).find((r) => r.requestId === requestId);
		if (!request) {
			return fail(args, "AMBER_E_MEMORY_REQUEST_NOT_FOUND", `request not found: ${requestId}`);
		}
		// §5.6-F1(i)/C5 terminality: a resolved request is a dead lineage — its
		// entries can never be re-admitted; continue via a fresh request with
		// provenance.derivedFrom.
		if (request.status === "resolved") {
			const autoAbandoned = store
				.readMemoryEvents(targetRoot, 0)
				.some((e) => e.kind === "memory-abandon" && e.targetId === requestId);
			return fail(
				args,
				"AMBER_E_MEMORY_STATE_INVALID",
				`request ${requestId} is resolved (${
					autoAbandoned
						? "F1(i) auto-abandoned lineage"
						: "all entries reached terminal disposition"
				}) — submit a new request with provenance.derivedFrom to continue the lineage`,
			);
		}
		rawEntries = request.entries || [];
		channel = request.provenance && request.provenance.channel;
	} else if (args.payload) {
		const payloadPath = path.resolve(targetRoot, args.payload);
		if (!fs.existsSync(payloadPath)) {
			return fail(args, "AMBER_E_MEMORY_REQUEST_NOT_FOUND", `payload not found: ${args.payload}`);
		}
		let body;
		try {
			body = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
		} catch (err) {
			return fail(
				args,
				"AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID",
				`payload not valid JSON: ${err.message}`,
			);
		}
		rawEntries = body.entries || [];
		payloadBody = body;
		channel = body.channel || (body.provenance && body.provenance.channel);
	} else {
		return fail(
			args,
			"AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID",
			"memory ingest requires --request <id> or --payload <file.json>",
		);
	}

	const entries = rawEntries.map(withEntryId);
	const entryIds = entries.map((e) => e.entryId);

	// Stage 1: ajv per entry (§5.3).
	for (const entry of entries) {
		const v = validateEntrySchema(entry);
		if (!v.valid) {
			return rejectIngest(
				args,
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
			args,
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
				args,
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
			result: {
				target: args.target,
				text: `ingest: no change — all ${skipped.length} candidate(s) are abandoned (F3 rebuild exclusion).`,
				errors: [],
				warnings: [],
				outcome: "no-change",
				entryIds: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}

	// Stage 4: α budget for MEMORY.md-targeted entries (§6.3 admission
	// arithmetic). β pairs free the pointed-to entry's slot and bytes — the
	// projection nets them out, so an exhausted budget still admits a
	// one-in-one-out pair (§6.4) while refusing bare growth.
	const alpha = alphaState(targetRoot);
	const memMd = effective.filter((e) => e.targetSurface === MEMORY_MD);
	if (memMd.length > 0) {
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
				args,
				targetRoot,
				request,
				channel,
				"AMBER_E_MEMORY_BUDGET_EXCEEDED",
				`α budget: entries ${projectedEntries}/${ALPHA_MAX_ENTRIES}, bytes ${projectedBytes}/${ALPHA_MAX_BYTES} (net of ${freedIds.size} β-freed) — split the batch or supersede an existing entry`,
				entryIds,
			);
		}
	}

	// Stage 5: γ rate-limit over the full admission mixed pool (§6.5 C4×M14):
	// current candidates + queued un-admitted candidates from other open
	// requests, ranked K1/K2/K3, truncated to the window's remaining quota —
	// the whole current batch must land inside the admitted slice.
	const gamma = gammaWindow(targetRoot);
	const quota = gamma.quotaRemaining;
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
				args,
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
		result: {
			target: args.target,
			text: `ingest admitted ${effectiveIds.length} proposal(s).`,
			errors: [],
			warnings,
			outcome: "admitted",
			entryIds: effectiveIds,
			ranking,
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

// ── approve (§5.4 the single human gate; typed seam already gated --yes) ──────
function handleApprove(args, targetRoot) {
	const entryId = args.entryId;
	if (!entryId) {
		return fail(args, "AMBER_E_MEMORY_STATE_INVALID", "memory approve requires --entry-id");
	}
	const entry = store.readEntry(targetRoot, entryId);
	if (!entry) return fail(args, "AMBER_E_MEMORY_ENTRY_NOT_FOUND", `entry not found: ${entryId}`);
	if (entry.status !== "proposal") {
		return fail(
			args,
			"AMBER_E_MEMORY_STATE_INVALID",
			`approve requires proposal state (got ${entry.status})`,
		);
	}
	const decision = args.decision || "approve";
	const now = nowIso();
	const requestId = findRequestId(targetRoot, entryId);

	// A4: reject drives proposal→draft with a mandatory non-empty reason.
	if (decision === "reject") {
		const reason = args.reason;
		if (!reason || !String(reason).trim()) {
			return fail(args, "AMBER_E_MEMORY_STATE_INVALID", "reject requires a non-empty --reason");
		}
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
		return ok(args, {
			text: `${CREED_HINT}\n\nrejected ${entryId} → draft.`,
			decision: "reject",
			entryId,
			status: "draft",
		});
	}

	// C3 β pair: approving an entry that carries supersedeTarget completes the
	// pair atomically — the pointed active/needs-re-review entry → superseded.
	const supersedeTarget = entry.supersedeTarget;
	if (supersedeTarget) {
		const target = store.readEntry(targetRoot, supersedeTarget);
		if (!target) {
			return fail(
				args,
				"AMBER_E_MEMORY_ENTRY_NOT_FOUND",
				`supersedeTarget not found: ${supersedeTarget}`,
			);
		}
		if (!["active", "needs-re-review"].includes(target.status)) {
			return fail(
				args,
				"AMBER_E_MEMORY_STATE_INVALID",
				`supersedeTarget must be active/needs-re-review (got ${target.status})`,
			);
		}
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
		return ok(args, {
			text: `${CREED_HINT}\n\napproved ${entryId}; superseded ${supersedeTarget} (β pair). Write to MEMORY.md, then \`amber memory book\`.`,
			decision: "approve",
			entryId,
			supersededEntryId: supersedeTarget,
		});
	}

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
	return ok(args, {
		text: `${CREED_HINT}\n\napproved ${entryId}. Write the entry into MEMORY.md, then run \`amber memory book --entry-id ${entryId}\`.`,
		decision: "approve",
		entryId,
	});
}

// ── book (§5.5 surface registration + dual-track origin) ──────────────────────
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
		return fail(
			args,
			"AMBER_E_MEMORY_STATE_INVALID",
			"--ratify and --entry-id are mutually exclusive: ratify creates a new registry entry from --claim; --entry-id books an existing one",
		);
	}
	if (args.ratify && !entryId) {
		const claim = args.claim;
		if (!claim || !String(claim).trim()) {
			return fail(
				args,
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
			return fail(args, "AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID", v.errors.join("; "));
		}
		if (store.readEntry(targetRoot, candidate.entryId)) {
			return fail(
				args,
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
			result: {
				target: args.target,
				text: `ratified ${candidate.entryId} → active (human-direct-ratification; no γ consumed).`,
				errors: [],
				warnings,
				origin: "human-direct-ratification",
				entryId: candidate.entryId,
				normHash,
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}

	if (!entryId) {
		return fail(
			args,
			"AMBER_E_MEMORY_STATE_INVALID",
			"memory book requires --entry-id, or --ratify --claim <text> for a human direct edit",
		);
	}
	const entry = store.readEntry(targetRoot, entryId);
	if (!entry) return fail(args, "AMBER_E_MEMORY_ENTRY_NOT_FOUND", `entry not found: ${entryId}`);
	// proposal→active (governed-promotion) or needs-re-review→active (reset, §4.1).
	if (!["proposal", "needs-re-review"].includes(entry.status)) {
		return fail(
			args,
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
		result: {
			target: args.target,
			text: `booked ${entryId} → active (${origin}).`,
			errors: [],
			warnings,
			origin,
			entryId,
			normHash,
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

// ── abandon (§5.6-F1(ii) explicit human entry point) ──────────────────────────
function handleAbandon(args, targetRoot) {
	const requestId = args.request;
	const entryId = args.entry || args.entryId;
	if ((requestId && entryId) || (!requestId && !entryId)) {
		return fail(
			args,
			"AMBER_E_MEMORY_STATE_INVALID",
			"memory abandon requires exactly one of --request or --entry",
		);
	}
	const now = nowIso();

	if (entryId) {
		const entry = store.readEntry(targetRoot, entryId);
		if (!entry) return fail(args, "AMBER_E_MEMORY_ENTRY_NOT_FOUND", `entry not found: ${entryId}`);
		if (entry.status === "abandoned") {
			return fail(args, "AMBER_E_MEMORY_STATE_INVALID", `entry already abandoned: ${entryId}`);
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
		return ok(args, { text: `abandoned entry ${entryId}.`, scope: "entry", entryId });
	}

	const request = store.readRequests(targetRoot).find((r) => r.requestId === requestId);
	if (!request) {
		return fail(args, "AMBER_E_MEMORY_REQUEST_NOT_FOUND", `request not found: ${requestId}`);
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
	return ok(args, {
		text: `abandoned request ${requestId} (${abandonedIds.length} entry/entries).`,
		scope: "request",
		requestId,
		entryIds: abandonedIds,
	});
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
		result: {
			target: args.target,
			...projection,
			text: renderStatus(projection),
			errors: [],
			warnings: [],
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

// ── dispatch (§8.1 one handler per verb, zero mapping table) ──────────────────
function memoryDispatch(subcommand, args, targetRoot) {
	const root = path.resolve(targetRoot || (args && args.target) || process.cwd());
	switch (subcommand) {
		case "request":
			return handleRequest(args, root);
		case "ingest":
			return handleIngest(args, root);
		case "approve":
			return handleApprove(args, root);
		case "book":
			return handleBook(args, root);
		case "abandon":
			return handleAbandon(args, root);
		case "status":
			return handleStatus(args, root);
		default:
			return fail(
				args || {},
				"AMBER_E_MEMORY_STATE_INVALID",
				`unknown memory action: ${subcommand}. Expected one of: request, ingest, approve, book, abandon, status`,
			);
	}
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
