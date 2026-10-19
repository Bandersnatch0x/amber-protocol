"use strict";

// Held-out evaluation core (R-ET-4 / 0174).
//
// An eval-set is the content measured by an eval definition, not the
// definition itself. This module resolves one committed set and checks only
// the run's event trail and run-scoped context loadouts, keeping the held-out
// lines out of receipts and event findings while making the result deterministic.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const { showArtifact } = require("../core/canonical-artifacts");
const { artifactGraphNodeId } = require("../core/artifact-graph-projection");
const { readRunEvents } = require("./event-ledger");
const { readPage } = require("../core/context-store");
const { loadoutsDir } = require("../core/context-loadout");

const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";
const CODE_ARTIFACT_NOT_FOUND = "AMBER_E_ARTIFACT_NOT_FOUND";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function resolveHeldOutBinding(targetRoot, pin) {
	if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
		throw typedError(CODE_INVALID_ARG, "heldOut must be { identity, revision }");
	}
	if (typeof pin.identity !== "string" || pin.identity.length === 0) {
		throw typedError(CODE_INVALID_ARG, "heldOut.identity must be a non-empty string");
	}
	if (!Number.isInteger(pin.revision) || pin.revision < 1) {
		throw typedError(CODE_INVALID_ARG, "heldOut.revision must be a positive integer");
	}

	const revision = showArtifact(targetRoot, pin.identity, {
		type: "eval-set",
		revision: pin.revision,
	});
	if (revision === null) {
		throw typedError(
			CODE_ARTIFACT_NOT_FOUND,
			`no committed eval-set revision ${JSON.stringify(pin.identity)}@${pin.revision} exists; admit one first (amber artifact list --type eval-set)`,
		);
	}

	const needles = [...new Set(revision.body.split(/\r?\n/).map((line) => line.trim()))]
		.filter((line) => line.length >= 16)
		.sort()
		.slice(0, 200);
	if (needles.length === 0) {
		throw typedError(
			CODE_INVALID_ARG,
			`eval-set ${JSON.stringify(pin.identity)}@${pin.revision} has no line long enough to detect; an undetectable set cannot be bound`,
		);
	}

	return {
		binding: {
			identity: pin.identity,
			revision: pin.revision,
			contentHash: revision.contentHash,
		},
		needles,
		pointer: artifactGraphNodeId("eval-set", pin.identity, pin.revision),
	};
}

function pageText(page) {
	const blocks = Array.isArray(page.blocks) ? page.blocks : [];
	return blocks
		.map((block) => (block && typeof block.text === "string" ? block.text : ""))
		.join("\n");
}

function needleHash(needle) {
	return `sha256:${createHash("sha256").update(needle).digest("hex")}`;
}

function compareCodeUnits(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function leakCheck(targetRoot, { runId, needles } = {}) {
	if (typeof runId !== "string" || runId.length === 0) {
		throw typedError(CODE_INVALID_ARG, "leakCheck requires a non-empty runId");
	}
	if (!Array.isArray(needles) || needles.some((needle) => typeof needle !== "string")) {
		throw typedError(CODE_INVALID_ARG, "leakCheck requires an array of string needles");
	}

	const findings = new Map();
	const addFinding = (surface, pointer, needle) => {
		const finding = { surface, pointer, needleHash: needleHash(needle) };
		findings.set(`${surface}|${pointer}|${finding.needleHash}`, finding);
	};

	const events = readRunEvents(targetRoot, runId);
	for (const event of events) {
		const serialized = JSON.stringify(event);
		for (const needle of needles) {
			if (serialized.includes(needle))
				addFinding("event", `event:${event.kind}@${event.at}`, needle);
		}
	}

	let scannedPages = 0;
	const directory = loadoutsDir(targetRoot);
	if (fs.existsSync(directory)) {
		const entries = fs
			.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			let loadout;
			try {
				loadout = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
			} catch {
				continue;
			}
			if (loadout?.firewall?.runId !== runId) continue;
			for (const pageId of Object.keys(loadout.pages || {})) {
				scannedPages += 1;
				const page = readPage(targetRoot, pageId);
				if (page === null) continue;
				const text = pageText(page);
				for (const needle of needles) {
					if (text.includes(needle)) addFinding("page", `page:${pageId}`, needle);
				}
			}
		}
	}

	const orderedFindings = [...findings.values()]
		.sort(
			(a, b) =>
				compareCodeUnits(a.surface, b.surface) ||
				compareCodeUnits(a.pointer, b.pointer) ||
				compareCodeUnits(a.needleHash, b.needleHash),
		)
		.slice(0, 5);
	return {
		status: orderedFindings.length === 0 ? "pass" : "fail",
		findings: orderedFindings,
		scanned: { events: events.length, pages: scannedPages },
	};
}

module.exports = {
	resolveHeldOutBinding,
	leakCheck,
	CODE_INVALID_ARG,
	CODE_ARTIFACT_NOT_FOUND,
};
