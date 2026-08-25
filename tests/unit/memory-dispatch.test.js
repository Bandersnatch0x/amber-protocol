"use strict";

// F039 slice 2: pin memoryDispatch envelopes so the defineCommand migration
// stays byte-compatible with the ok()/fail() envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	memoryDispatch,
	GAMMA_QUOTA,
	ALPHA_MAX_ENTRIES,
	ALPHA_MAX_BYTES,
} = require("../../scripts/lib/memory-commands");

function tmpRoot(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-memory-dispatch-${label}-`));
	fs.writeFileSync(path.join(dir, "MEMORY.md"), MEMORY_MD_FIXTURE);
	return dir;
}

const MEMORY_MD_FIXTURE = [
	"# Memory",
	"",
	"Durable project knowledge selected by humans.",
	"",
	"## Entries",
	"",
].join("\n");

test("status envelope: projection payload, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot("status");
	const envelope = memoryDispatch("status", { target: root, json: true }, root);
	assert.deepEqual(envelope, {
		result: {
			target: root,
			entries: {
				draft: 0,
				proposal: 0,
				active: 0,
				superseded: 0,
				needsReReview: 0,
				abandoned: 0,
				pendingRequests: 0,
			},
			gamma: {
				windowAdmitted: 0,
				quotaRemaining: GAMMA_QUOTA,
				windowStart: envelope.result.gamma.windowStart,
				windowEnd: envelope.result.gamma.windowEnd,
			},
			alpha: {
				entries: 0,
				maxEntries: ALPHA_MAX_ENTRIES,
				bytes: Buffer.byteLength(MEMORY_MD_FIXTURE, "utf8"),
				maxBytes: ALPHA_MAX_BYTES,
				utilizationPct:
					Math.round(
						Math.max(
							0 / ALPHA_MAX_ENTRIES,
							Buffer.byteLength(MEMORY_MD_FIXTURE, "utf8") / ALPHA_MAX_BYTES,
						) * 1000,
					) / 10,
			},
			text: envelope.result.text,
			errors: [],
			warnings: [],
		},
		exitCode: 0,
		bypassPrint: false,
	});
});

test("identity-gate failure body: exit 1, bypassPrint false, coded envelope", () => {
	const root = tmpRoot("gate");
	const envelope = memoryDispatch("request", { target: root, json: true }, root);
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.result.code, "AMBER_E_MEMORY_APPROVAL_REQUIRED");
	assert.equal(envelope.result.errors.length, 1);
	assert.ok(envelope.result.errors[0].includes("AMBER_E_MEMORY_APPROVAL_REQUIRED"));
	assert.deepEqual(envelope.result.warnings, []);
});

test("unknown action: exit 1, guidance on the printResult path", () => {
	const envelope = memoryDispatch("explode", { target: "t", json: true }, "t");
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.equal(envelope.result.code, "AMBER_E_MEMORY_STATE_INVALID");
	assert.ok(
		envelope.result.errors[0].includes("unknown memory action: explode"),
		"guidance names the attempted verb",
	);
});

test("three-argument signature preserved: targetRoot drives reads, args.target stays raw", () => {
	const root = tmpRoot("signature");
	const envelope = memoryDispatch("status", { target: "display-name", json: true }, root);
	assert.equal(envelope.result.target, "display-name");
	assert.equal(envelope.exitCode, 0);
	assert.equal(envelope.result.entries.pendingRequests, 0);
});
