"use strict";

// T1/T2 memory write-back triggers (spec 2026-08-21 §5.1, ADR-0018 batch B).
//
// A trigger is a SYSTEM-side nomination contract: when a session completes
// with handoff evidence (T1) or a feature accept hits a write-back path
// category (T2), Amber records a trigger artifact and a single
// `memory-request-created` ledger event. That is the entire mechanical
// product (§5.1-M3): no γ is consumed (γ counts admitted proposals only),
// no schema-valid request is fabricated, MEMORY.md is never touched, and no
// target work executes. The host agent answers the contract later through
// the existing `amber memory request` verb with triggerRef linkage — or
// legitimately never answers (the "no-change" outcome).
//
// Spec interpretation (entries[] minItems 1 tension): the memory-request
// schema requires entries[] minItems 1, but a mechanical trigger cannot
// invent claims (zero semantic judgment, §5.1). The trigger therefore writes
// its nomination contract as a SEPARATE artifact class under
// `.amber/memory/triggers/` — not into `.amber/memory/requests/`, which
// stays reserved for schema-valid requests created through the verb. The
// `memory-request-created` event carries `entryIds: []` to mark the
// contract-only shape (§9 payload fields stay within the closed set).
//
// Exclusivity (§5.2): the same trigger event yields exactly one open
// nomination — an open trigger record with the same channel + triggerRef
// makes re-triggering a no-op.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const store = require("./memory-store");
const { statePathForCreate } = require("../state-dir-resolver");

const TRIGGER_CHANNELS = new Set(["t1-writeback", "t2-writeback"]);

// Triggers are memory-layer state (ADR-0018, post-rename): reads and creates
// both target the canonical dir (see the note in memory-store.js).
function triggersDir(targetRoot) {
	return statePathForCreate(targetRoot, "memory", "triggers");
}

function triggerPath(targetRoot, triggerId) {
	return path.join(triggersDir(targetRoot), `${triggerId}.json`);
}

function listTriggers(targetRoot) {
	const dir = triggersDir(targetRoot);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
		.sort((a, b) => String(a.triggerId || "").localeCompare(String(b.triggerId || "")));
}

function writeTrigger(targetRoot, record) {
	fs.mkdirSync(triggersDir(targetRoot), { recursive: true });
	const file = triggerPath(targetRoot, record.triggerId);
	fs.writeFileSync(file, JSON.stringify(record, null, "\t") + "\n");
	return file;
}

/**
 * Fire a T1/T2 write-back nomination trigger (§5.1).
 *
 * @param {string} targetRoot absolute repo root
 * @param {{channel: "t1-writeback"|"t2-writeback", triggerRef: string}} input
 * @returns {{created: boolean, triggerId?: string, channel: string, triggerRef: string, reason?: string}}
 */
function triggerWriteBackRequest(targetRoot, { channel, triggerRef }) {
	if (!TRIGGER_CHANNELS.has(channel)) {
		throw new Error(`Unknown write-back trigger channel: ${channel}`);
	}
	const ref = String(triggerRef || "").trim();
	if (!ref) {
		throw new Error("Write-back trigger requires a non-empty triggerRef");
	}

	// §5.2 exclusivity: one open nomination per trigger event.
	const existing = listTriggers(targetRoot).find(
		(record) =>
			record.status === "open" &&
			record.channel === channel &&
			record.triggerRef &&
			record.triggerRef.ref === ref,
	);
	if (existing) {
		return {
			created: false,
			triggerId: existing.triggerId,
			channel,
			triggerRef: ref,
			reason: "an open nomination already exists for this trigger event",
		};
	}

	const triggerId = `trig-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
	const record = {
		kind: "memory-write-back-trigger",
		triggerId,
		channel,
		triggerRef: { ref },
		createdAt: new Date().toISOString(),
		status: "open",
	};
	writeTrigger(targetRoot, record);

	// §5.1-M3: the ledger event is the second half of the trigger product.
	// entryIds stays empty — this is a contract, not an admission (§9).
	store.appendMemoryEvent(targetRoot, {
		kind: "memory-request-created",
		requestId: triggerId,
		channel,
		triggerRef: { ref },
		entryIds: [],
	});

	return { created: true, triggerId, channel, triggerRef: ref };
}

/**
 * Mount helper for the T1/T2 call sites (spec §5.1-M3): a nomination may
 * never block the host operation, so the trigger write is the ONLY code
 * under the try — failures surface as a warning line, and exclusivity
 * no-ops (already-nominated) return null. Callers keep their own gating
 * (handoff evidence / category hit) outside the catch.
 *
 * @returns {string|null} user-facing warning text, or null when silent
 */
function mountWriteBackTrigger(targetRoot, { channel, triggerRef, label }) {
	let result;
	try {
		result = triggerWriteBackRequest(targetRoot, { channel, triggerRef });
	} catch (err) {
		return `${label} memory write-back trigger failed (non-blocking): ${err.message}`;
	}
	if (!result.created) return null;
	return `${label} memory write-back nomination created (${result.triggerId}) — answer it with \`amber memory request\` (triggerRef ${triggerRef}) or legitimately skip.`;
}

module.exports = {
	TRIGGER_CHANNELS,
	triggersDir,
	triggerPath,
	listTriggers,
	writeTrigger,
	triggerWriteBackRequest,
	mountWriteBackTrigger,
};
