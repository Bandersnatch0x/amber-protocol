"use strict";

// F054 T1 (#279) — Control Band detectors & deterministic Findings.
//
// Tests assert externally visible behavior: governed detector registration
// binding a single-use committed human Decision, immutable detector
// versions, deterministic tier verdicts (in-band appends nothing), stable
// Finding fingerprints that correlate repeated observations, and
// tamper-evident fail-closed reads on both ledgers — every failure mode
// carries a stable AMBER_E_MAINTAIN_* code.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	MAINTAIN_DETECTOR_SCHEMA_VERSION,
	SUPPORTED_MAINTAIN_DETECTOR_SCHEMA_VERSIONS,
	MAINTAIN_FINDING_SCHEMA_VERSION,
	SUPPORTED_MAINTAIN_FINDING_SCHEMA_VERSIONS,
	DEFAULT_MAX_MAINTAIN_BYTES,
	DETECTOR_COMPARATORS,
	DETECTOR_OUTPUT_TYPES,
	MAINTAIN_DECISION_KINDS,
	GENESIS_HASH,
	chainHash,
	detectorsPath,
	findingsPath,
	registerDetector,
	showDetector,
	listDetectors,
	detect,
	listFindings,
} = require("../../scripts/lib/core/maintain-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-maintain-${label}-`));
}

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const NOW = new Date("2026-08-29T02:00:00.000Z");

/** Admit one committed human Decision anchored to the maintain intent. */
function decisionFixture(dir, identity, opts = {}) {
	const { kind = "approval", scope = null } = opts;
	const decision = admitArtifact(dir, {
		type: "decision",
		identity,
		body: `# ${identity}\n`,
		decisionKind: kind,
		principal: "alice@example.com",
		scope,
		traces: [
			{
				type: "decides",
				to: { type: "intent", identity: scope === null ? "intent/maintain" : "intent/scoped" },
			},
		],
	});
	assert.equal(decision.ok, true, (decision.errors || []).join("; "));
}

/** Principal + intent + decision anchors every registration test needs. */
function registryFixture(dir) {
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/maintain", body: "# Maintain\n" }).ok,
		true,
	);
	decisionFixture(dir, "decision/detector-1");
}

function detectorInput(overrides = {}) {
	return {
		id: "detector/error-rate",
		version: "1",
		metric: "http-5xx-rate",
		source: "observability/api",
		baseline: 10,
		rules: [
			{ tier: "warn", comparator: "ge", threshold: 100 },
			{ tier: "page", comparator: "ge", threshold: 500 },
		],
		windowMs: 3_600_000,
		scope: "service/api",
		cooldownMs: 3_600_000,
		maxObservations: 100,
		outputType: "finding",
		decision: { identity: "decision/detector-1", revision: 1 },
		...overrides,
	};
}

function observation(overrides = {}) {
	return {
		detectorId: "detector/error-rate",
		detectorVersion: "1",
		subject: "service/api",
		window: { from: "2026-08-29T00:00:00.000Z", to: "2026-08-29T00:30:00.000Z" },
		value: 120,
		inputHash: HASH_A,
		...overrides,
	};
}

function readEvents(ledgerPath) {
	return fs
		.readFileSync(ledgerPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

function writeEvents(ledgerPath, events) {
	fs.writeFileSync(ledgerPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

/** Every file under .amber except maintain/, as sorted [path, bytes] pairs. */
function snapshotOutsideMaintain(dir) {
	const root = path.join(dir, ".amber");
	const entries = [];
	const walk = (current) => {
		for (const name of fs.readdirSync(current)) {
			const full = path.join(current, name);
			if (fs.statSync(full).isDirectory()) {
				if (path.relative(root, full) === "maintain") continue;
				walk(full);
			} else {
				entries.push([path.relative(root, full), fs.readFileSync(full, "utf8")]);
			}
		}
	};
	walk(root);
	return entries.sort((a, b) => a[0].localeCompare(b[0]));
}

test("maintain constants pin the schema, comparator, output, and authority contracts", () => {
	assert.equal(MAINTAIN_DETECTOR_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_MAINTAIN_DETECTOR_SCHEMA_VERSIONS], [1]);
	assert.equal(MAINTAIN_FINDING_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_MAINTAIN_FINDING_SCHEMA_VERSIONS], [1]);
	assert.equal(DEFAULT_MAX_MAINTAIN_BYTES, 1024 * 1024);
	assert.deepEqual([...DETECTOR_COMPARATORS], ["ge", "gt", "le", "lt"]);
	assert.deepEqual([...DETECTOR_OUTPUT_TYPES], ["finding"]);
	assert.deepEqual([...MAINTAIN_DECISION_KINDS], ["acceptance", "approval"]);
});

test("registerDetector binds the verified human Decision snapshot into a chained event", () => {
	const dir = mkTarget("register");
	registryFixture(dir);
	const result = registerDetector(dir, detectorInput(), { now: NOW });
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.record.id, "detector/error-rate");
	assert.equal(result.record.version, "1");
	assert.equal(result.record.metric, "http-5xx-rate");
	assert.equal(result.record.baseline, 10);
	assert.equal(result.record.outputType, "finding");
	assert.equal(result.record.index, 0);
	assert.deepEqual(result.record.decision, {
		identity: "decision/detector-1",
		revision: 1,
		decisionKind: "approval",
		principal: "alice@example.com",
	});
	const events = readEvents(detectorsPath(dir));
	assert.equal(events.length, 1);
	assert.equal(events[0].kind, "detector");
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[0].hash, chainHash(events[0], GENESIS_HASH));
	assert.equal(listDetectors(dir).length, 1);
});

test("detector versions are immutable and a changed definition registers a new version", () => {
	const dir = mkTarget("versions");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const duplicate = registerDetector(dir, detectorInput(), { now: NOW });
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_MAINTAIN_EXISTS");
	assert.match(duplicate.errors[0], /already registered/);
	decisionFixture(dir, "decision/detector-2");
	const next = registerDetector(
		dir,
		detectorInput({
			version: "2",
			baseline: 20,
			decision: { identity: "decision/detector-2", revision: 1 },
		}),
		{ now: NOW },
	);
	assert.equal(next.ok, true, (next.errors || []).join("; "));
	assert.equal(showDetector(dir, "detector/error-rate").version, "2");
	assert.equal(showDetector(dir, "detector/error-rate", "1").baseline, 10);
	assert.equal(showDetector(dir, "detector/error-rate", "9"), null);
	assert.equal(showDetector(dir, "detector/ghost"), null);
});

test("a registration Decision is single-use across the detector registry", () => {
	const dir = mkTarget("single-use");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const reused = registerDetector(dir, detectorInput({ id: "detector/latency", version: "1" }), {
		now: NOW,
	});
	assert.equal(reused.ok, false);
	assert.equal(reused.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(reused.errors[0], /single-use/);
	assert.match(reused.errors[0], /detector\/error-rate@1/);
});

test("registration authority requires a committed human acceptance or approval Decision", () => {
	const dir = mkTarget("authority");
	registryFixture(dir);
	const ghost = registerDetector(
		dir,
		detectorInput({ decision: { identity: "decision/ghost", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(ghost.errors[0], /not a committed Decision artifact/);
	decisionFixture(dir, "decision/review-only", { kind: "review" });
	const review = registerDetector(
		dir,
		detectorInput({ decision: { identity: "decision/review-only", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(review.ok, false);
	assert.equal(review.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(review.errors[0], /human acceptance or approval Decision/);
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/scoped",
			body: "# S\n",
			scope: "F054",
		}).ok,
		true,
	);
	decisionFixture(dir, "decision/scoped", { scope: "F054" });
	const scoped = registerDetector(
		dir,
		detectorInput({ decision: { identity: "decision/scoped", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(scoped.ok, false);
	assert.equal(scoped.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(scoped.errors[0], /repository-global/);
	assert.equal(fs.existsSync(detectorsPath(dir)), false);
});

test("detector definitions refuse open vocabularies and malformed bands", () => {
	const dir = mkTarget("definition");
	registryFixture(dir);
	const cases = [
		[detectorInput({ command: "rm -rf" }), /unknown field/],
		[detectorInput({ baseline: Number.NaN }), /baseline must be a finite number/],
		[
			detectorInput({ rules: [{ tier: "warn", comparator: "eq", threshold: 1 }] }),
			/comparator must be one of ge, gt, le, lt/,
		],
		[
			detectorInput({ rules: [{ tier: "in-band", comparator: "ge", threshold: 1 }] }),
			/reserved in-band verdict/,
		],
		[
			detectorInput({
				rules: [
					{ tier: "warn", comparator: "ge", threshold: 1 },
					{ tier: "warn", comparator: "ge", threshold: 2 },
				],
			}),
			/repeats tier "warn"/,
		],
		[detectorInput({ rules: [] }), /non-empty array/],
		[detectorInput({ outputType: "remediation" }), /outputType must be one of finding/],
		[detectorInput({ windowMs: 0 }), /windowMs must be a positive integer/],
		[
			detectorInput({ decision: { identity: "decision/detector-1" } }),
			/decision\.revision must be a positive integer/,
		],
	];
	for (const [input, pattern] of cases) {
		const result = registerDetector(dir, input, { now: NOW });
		assert.equal(result.ok, false, JSON.stringify(input));
		assert.equal(result.code, "AMBER_E_MAINTAIN_INVALID");
		assert.match(result.errors[0], pattern);
	}
	assert.equal(fs.existsSync(detectorsPath(dir)), false);
});

test("an in-band observation returns the verdict and appends nothing", () => {
	const dir = mkTarget("in-band");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const result = detect(dir, observation({ value: 50 }), { now: NOW });
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.tier, "in-band");
	assert.equal(result.record, null);
	assert.equal(fs.existsSync(findingsPath(dir)), false);
	assert.deepEqual(listFindings(dir), []);
});

test("an out-of-band observation appends one immutable Finding and the last matching rule wins", () => {
	const dir = mkTarget("out-of-band");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const detectorBytes = fs.readFileSync(detectorsPath(dir), "utf8");
	const outsideMaintain = snapshotOutsideMaintain(dir);
	const warn = detect(dir, observation({ value: 120 }), { now: NOW });
	assert.equal(warn.ok, true, (warn.errors || []).join("; "));
	assert.equal(warn.tier, "warn");
	assert.equal(warn.record.kind, "finding");
	assert.equal(warn.record.detectorId, "detector/error-rate");
	assert.equal(warn.record.detectorVersion, "1");
	assert.equal(warn.record.subject, "service/api");
	assert.equal(warn.record.scope, "service/api");
	assert.deepEqual(warn.record.window, {
		from: "2026-08-29T00:00:00.000Z",
		to: "2026-08-29T00:30:00.000Z",
	});
	assert.equal(warn.record.value, 120);
	assert.equal(warn.record.inputHash, HASH_A);
	assert.match(warn.record.baselineHash, /^sha256:[0-9a-f]{64}$/);
	assert.match(warn.record.fingerprint, /^sha256:[0-9a-f]{64}$/);
	const page = detect(dir, observation({ value: 600, inputHash: HASH_B }), { now: NOW });
	assert.equal(page.ok, true);
	assert.equal(page.tier, "page");
	// Detection is target-read-only outside the finding ledger: the
	// detector registry bytes and everything else under .amber (canonical
	// artifact journal, principal ledger) are untouched.
	assert.equal(fs.readFileSync(detectorsPath(dir), "utf8"), detectorBytes);
	assert.deepEqual(snapshotOutsideMaintain(dir), outsideMaintain);
	const events = readEvents(findingsPath(dir));
	assert.equal(events.length, 2);
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[1].prevHash, events[0].hash);
});

test("fingerprints correlate repeated observations and split on a changed window", () => {
	const dir = mkTarget("fingerprint");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const first = detect(dir, observation(), { now: NOW });
	const repeat = detect(dir, observation({ inputHash: HASH_B }), { now: NOW });
	assert.equal(first.ok, true);
	assert.equal(repeat.ok, true);
	assert.equal(first.record.fingerprint, repeat.record.fingerprint);
	assert.notEqual(first.record.inputHash, repeat.record.inputHash);
	const shifted = detect(
		dir,
		observation({
			window: { from: "2026-08-29T01:00:00.000Z", to: "2026-08-29T01:30:00.000Z" },
		}),
		{ now: NOW },
	);
	assert.equal(shifted.ok, true);
	assert.notEqual(shifted.record.fingerprint, first.record.fingerprint);
	assert.equal(listFindings(dir).length, 3);
	assert.equal(listFindings(dir, { fingerprint: first.record.fingerprint }).length, 2);
	assert.equal(listFindings(dir, { detectorId: "detector/ghost" }).length, 0);
});

test("a changed baseline is a visibly different Finding basis", () => {
	const dir = mkTarget("baseline");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	decisionFixture(dir, "decision/detector-2");
	assert.equal(
		registerDetector(
			dir,
			detectorInput({
				version: "2",
				baseline: 20,
				decision: { identity: "decision/detector-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const v1 = detect(dir, observation(), { now: NOW });
	const v2 = detect(dir, observation({ detectorVersion: "2" }), { now: NOW });
	assert.equal(v1.ok, true);
	assert.equal(v2.ok, true);
	assert.notEqual(v1.record.baselineHash, v2.record.baselineHash);
	assert.notEqual(v1.record.fingerprint, v2.record.fingerprint);
});

test("detect refuses unknown detectors and out-of-contract observations", () => {
	const dir = mkTarget("detect-refusals");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const unknown = detect(dir, observation({ detectorId: "detector/ghost" }), { now: NOW });
	assert.equal(unknown.ok, false);
	assert.equal(unknown.code, "AMBER_E_MAINTAIN_NOT_FOUND");
	const version = detect(dir, observation({ detectorVersion: "9" }), { now: NOW });
	assert.equal(version.ok, false);
	assert.equal(version.code, "AMBER_E_MAINTAIN_NOT_FOUND");
	const cases = [
		[
			observation({
				window: { from: "2026-08-29T00:00:00.000Z", to: "2026-08-29T02:00:00.000Z" },
			}),
			/window spans 7200000 ms, above the detector's declared 3600000 ms/,
		],
		[
			observation({
				window: { from: "2026-08-29T01:00:00.000Z", to: "2026-08-29T00:00:00.000Z" },
			}),
			/to must not precede from/,
		],
		[observation({ window: { from: "yesterday", to: "2026-08-29T00:30:00.000Z" } }), /ISO-8601/],
		[observation({ value: Number.POSITIVE_INFINITY }), /value must be a finite number/],
		[observation({ inputHash: "sha256:xyz" }), /sha256:<64-hex>/],
		[observation({ verdictOverride: "page" }), /unknown field/],
	];
	for (const [input, pattern] of cases) {
		const result = detect(dir, input, { now: NOW });
		assert.equal(result.ok, false, JSON.stringify(input));
		assert.equal(result.code, "AMBER_E_MAINTAIN_INVALID");
		assert.match(result.errors[0], pattern);
	}
	assert.equal(fs.existsSync(findingsPath(dir)), false);
});

test("a tampered detector ledger fails every read closed", () => {
	const dir = mkTarget("tamper-detector");
	registryFixture(dir);
	decisionFixture(dir, "decision/detector-2");
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(
		registerDetector(
			dir,
			detectorInput({
				id: "detector/latency",
				decision: { identity: "decision/detector-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const events = readEvents(detectorsPath(dir));
	events[1].baseline = 0;
	writeEvents(detectorsPath(dir), events);
	assert.throws(
		() => listDetectors(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	const detection = detect(dir, observation(), { now: NOW });
	assert.equal(detection.ok, false);
	assert.equal(detection.code, "AMBER_E_MAINTAIN_CORRUPT");
	decisionFixture(dir, "decision/detector-3");
	const registration = registerDetector(
		dir,
		detectorInput({
			id: "detector/saturation",
			decision: { identity: "decision/detector-3", revision: 1 },
		}),
		{ now: NOW },
	);
	assert.equal(registration.ok, false);
	assert.equal(registration.code, "AMBER_E_MAINTAIN_CORRUPT");
});

test("a tampered finding ledger fails every read closed", () => {
	const dir = mkTarget("tamper-finding");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation({ inputHash: HASH_B }), { now: NOW }).ok, true);
	const events = readEvents(findingsPath(dir));
	events[1].tier = "in-band";
	writeEvents(findingsPath(dir), events);
	assert.throws(
		() => listFindings(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_FINDING_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	const detection = detect(dir, observation({ value: 700 }), { now: NOW });
	assert.equal(detection.ok, false);
	assert.equal(detection.code, "AMBER_E_MAINTAIN_FINDING_CORRUPT");
	const broken = readEvents(findingsPath(dir));
	broken[1] = { ...broken[1], tier: "warn", prevHash: HASH_B };
	writeEvents(findingsPath(dir), broken);
	assert.throws(
		() => listFindings(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_FINDING_CORRUPT" &&
			/breaks the hash chain/.test(err.message),
	);
});
