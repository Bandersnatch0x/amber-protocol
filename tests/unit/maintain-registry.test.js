"use strict";

// F054 T1 (#279) — Control Band detectors & deterministic Findings.
// F054 T2 (#280) — Trigger Proposals & cooldown dedup.
// F054 T3 (#281) — Owner triage & governed Intent re-entry.
// F054 T4 (#282) — Staleness, Eval write-back & deterministic rollups.
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
	MAINTAIN_PROPOSAL_SCHEMA_VERSION,
	SUPPORTED_MAINTAIN_PROPOSAL_SCHEMA_VERSIONS,
	proposalsPath,
	propose,
	listProposals,
	TRIAGE_OUTCOMES,
	triage,
	complete,
	rollup,
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

test("propose pins the proposal schema contract and derives only from a recorded Finding", () => {
	assert.equal(MAINTAIN_PROPOSAL_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_MAINTAIN_PROPOSAL_SCHEMA_VERSIONS], [1]);
	const dir = mkTarget("propose");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	const smuggled = propose(dir, { findingIndex: 0, body: "# smuggled intent" }, { now: NOW });
	assert.equal(smuggled.ok, false);
	assert.equal(smuggled.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(smuggled.errors[0], /unknown field "body"/);
	const negative = propose(dir, { findingIndex: -1 }, { now: NOW });
	assert.equal(negative.ok, false);
	assert.equal(negative.code, "AMBER_E_MAINTAIN_INVALID");
	const ghost = propose(dir, { findingIndex: 9 }, { now: NOW });
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_MAINTAIN_NOT_FOUND");
	const opened = propose(dir, { findingIndex: 0 }, { now: NOW });
	assert.equal(opened.ok, true, (opened.errors || []).join("; "));
	assert.equal(opened.action, "opened");
	const finding = listFindings(dir)[0];
	assert.equal(opened.record.kind, "proposal");
	assert.equal(opened.record.status, "open");
	assert.equal(opened.record.fingerprint, finding.fingerprint);
	assert.equal(opened.record.detectorId, finding.detectorId);
	assert.equal(opened.record.detectorVersion, finding.detectorVersion);
	assert.equal(opened.record.subject, finding.subject);
	assert.equal(opened.record.scope, finding.scope);
	assert.equal(opened.record.tier, finding.tier);
	assert.equal(opened.record.cooldownMs, 3_600_000);
	assert.deepEqual(opened.record.findings, [0]);
	assert.equal("body" in opened.record, false);
});

test("in-cooldown repeats append onto the open proposal instead of duplicating it", () => {
	const dir = mkTarget("cooldown-append");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation({ inputHash: HASH_B }), { now: NOW }).ok, true);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	const repeat = propose(dir, { findingIndex: 1 }, { now: new Date("2026-08-29T02:30:00.000Z") });
	assert.equal(repeat.ok, true, (repeat.errors || []).join("; "));
	assert.equal(repeat.action, "appended");
	assert.deepEqual(repeat.record.findings, [0, 1]);
	assert.equal(listProposals(dir).length, 1);
	const duplicate = propose(dir, { findingIndex: 1 }, { now: NOW });
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(duplicate.errors[0], /already referenced/);
});

test("the cooldown window is half-open and the anchor never regresses", () => {
	const dir = mkTarget("cooldown-boundary");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	const detectAt = (iso, inputHash) =>
		assert.equal(detect(dir, observation({ inputHash }), { now: new Date(iso) }).ok, true);
	detectAt("2026-08-29T02:00:00.000Z", HASH_A);
	detectAt("2026-08-29T02:59:59.999Z", HASH_B);
	detectAt("2026-08-29T03:00:00.000Z", `sha256:${"c".repeat(64)}`);
	detectAt("2026-08-29T01:00:00.000Z", `sha256:${"d".repeat(64)}`);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	// delta 3599999 ms < cooldownMs 3600000 — inside, appends.
	assert.equal(propose(dir, { findingIndex: 1 }, { now: NOW }).action, "appended");
	// An older observation appends without regressing the anchor …
	assert.equal(propose(dir, { findingIndex: 3 }, { now: NOW }).action, "appended");
	assert.equal(listProposals(dir)[0].lastObservedAt, "2026-08-29T02:59:59.999Z");
	// … so the next observation measures 1 ms from the true latest — inside.
	assert.equal(propose(dir, { findingIndex: 2 }, { now: NOW }).action, "appended");
	// A repeat exactly cooldownMs after the latest observation is outside.
	detectAt("2026-08-29T04:00:00.000Z", `sha256:${"e".repeat(64)}`);
	const boundary = propose(dir, { findingIndex: 4 }, { now: NOW });
	assert.equal(boundary.ok, false);
	assert.equal(boundary.code, "AMBER_E_MAINTAIN_PROPOSAL_EXISTS");
});

test("outside cooldown an open proposal must be triaged before a new one may open", () => {
	const dir = mkTarget("cooldown-escalate");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput({ cooldownMs: 1 }), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(
		detect(dir, observation({ inputHash: HASH_B }), {
			now: new Date("2026-08-29T03:00:00.000Z"),
		}).ok,
		true,
	);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	const escalated = propose(
		dir,
		{ findingIndex: 1 },
		{ now: new Date("2026-08-29T03:00:00.000Z") },
	);
	assert.equal(escalated.ok, false);
	assert.equal(escalated.code, "AMBER_E_MAINTAIN_PROPOSAL_EXISTS");
	assert.match(escalated.errors[0], /must be triaged/);
	assert.equal(listProposals(dir).length, 1);
	assert.deepEqual(listProposals(dir)[0].findings, [0]);
});

test("proposals separate by fingerprint and filter on it", () => {
	const dir = mkTarget("propose-split");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(
		detect(
			dir,
			observation({
				window: { from: "2026-08-29T01:00:00.000Z", to: "2026-08-29T01:30:00.000Z" },
				inputHash: HASH_B,
			}),
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	assert.equal(propose(dir, { findingIndex: 1 }, { now: NOW }).action, "opened");
	const proposals = listProposals(dir);
	assert.equal(proposals.length, 2);
	assert.notEqual(proposals[0].fingerprint, proposals[1].fingerprint);
	assert.equal(listProposals(dir, { fingerprint: proposals[0].fingerprint }).length, 1);
});

test("no proposal field can carry an admission payload even on a valid chain", () => {
	const dir = mkTarget("propose-payload");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	const events = readEvents(proposalsPath(dir));
	const { hash: _hash, ...rest } = events[0];
	const forged = { ...rest, body: "# smuggled admission payload" };
	forged.hash = chainHash(forged, forged.prevHash);
	writeEvents(proposalsPath(dir), [forged]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/unknown field "body"/.test(err.message),
	);
});

test("validly re-chained forgeries cannot bypass the proposal invariants", () => {
	const dir = mkTarget("propose-forgery");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	const base = readEvents(proposalsPath(dir));
	const open = base[0];
	const { prevHash: _prev, hash: _hash, ...openBody } = open;
	const chained = (body) => ({ ...body, prevHash: open.hash, hash: chainHash(body, open.hash) });
	const evidence = (overrides) =>
		chained({
			kind: "evidence",
			schemaVersion: 1,
			at: open.at,
			observedAt: open.observedAt,
			fingerprint: open.fingerprint,
			findingIndex: 0,
			...overrides,
		});
	const forgeries = [
		// Reopening an open fingerprint would create a duplicate proposal.
		[chained(openBody), /reopens fingerprint/],
		// Evidence must land on a known open proposal.
		[evidence({ fingerprint: HASH_B }), /unknown fingerprint/],
		// One Finding is referenced at most once per proposal.
		[evidence({}), /repeats finding 0/],
	];
	for (const [event, pattern] of forgeries) {
		writeEvents(proposalsPath(dir), [open, event]);
		assert.throws(
			() => listProposals(dir),
			(err) => err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" && pattern.test(err.message),
			pattern.source,
		);
	}
});

test("a tampered proposal ledger fails every read closed", () => {
	const dir = mkTarget("propose-tamper");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation({ inputHash: HASH_B }), { now: NOW }).ok, true);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	assert.equal(propose(dir, { findingIndex: 1 }, { now: NOW }).action, "appended");
	const events = readEvents(proposalsPath(dir));
	events[1].findingIndex = 0;
	writeEvents(proposalsPath(dir), events);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	const detection = detect(dir, observation({ value: 700, inputHash: HASH_B }), { now: NOW });
	assert.equal(detection.ok, true);
	const blocked = propose(dir, { findingIndex: 2 }, { now: NOW });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.code, "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT");
});

// One open proposal for the default detector observation, ready to triage.
function triageFixture(dir) {
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	const opened = propose(dir, { findingIndex: 0 }, { now: NOW });
	assert.equal(opened.action, "opened");
	decisionFixture(dir, "decision/triage-1");
	return opened.record.fingerprint;
}

function triageInput(fingerprint, overrides = {}) {
	return {
		fingerprint,
		outcome: "schedule",
		reason: "next sprint",
		decision: { identity: "decision/triage-1", revision: 1 },
		...overrides,
	};
}

test("triage schedule closes the proposal reviewably and unblocks re-entry", () => {
	assert.deepEqual([...TRIAGE_OUTCOMES], ["fix", "schedule", "dismiss"]);
	const dir = mkTarget("triage-schedule");
	const fingerprint = triageFixture(dir);
	const settled = triage(dir, triageInput(fingerprint), { now: NOW });
	assert.equal(settled.ok, true, (settled.errors || []).join("; "));
	assert.equal(settled.candidate, null);
	assert.equal(settled.record.status, "triaged");
	assert.deepEqual(settled.record.triage, {
		at: NOW.toISOString(),
		outcome: "schedule",
		reason: "next sprint",
		decision: {
			identity: "decision/triage-1",
			revision: 1,
			decisionKind: "approval",
			principal: "alice@example.com",
		},
	});
	assert.equal(listProposals(dir).length, 1);
	assert.equal(listProposals(dir)[0].status, "triaged");
	const closed = triage(dir, triageInput(fingerprint), { now: NOW });
	assert.equal(closed.ok, false);
	assert.equal(closed.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(closed.errors[0], /triage of a closed proposal refuses/);
	// Triage unblocks the fingerprint: the next observation opens a NEW
	// proposal and the triaged one stays listed for review.
	assert.equal(detect(dir, observation({ inputHash: HASH_B }), { now: NOW }).ok, true);
	const reopened = propose(dir, { findingIndex: 1 }, { now: NOW });
	assert.equal(reopened.ok, true, (reopened.errors || []).join("; "));
	assert.equal(reopened.action, "opened");
	assert.equal(listProposals(dir).length, 2);
	assert.equal(listProposals(dir)[0].status, "triaged");
	assert.equal(listProposals(dir)[1].status, "open");
});

test("schedule and dismiss must preserve reasons; fix must not carry one", () => {
	const dir = mkTarget("triage-reason");
	const fingerprint = triageFixture(dir);
	const missing = triage(dir, triageInput(fingerprint, { reason: null }), { now: NOW });
	assert.equal(missing.ok, false);
	assert.equal(missing.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(missing.errors[0], /must preserve a non-empty reason/);
	const dismissed = triage(
		dir,
		triageInput(fingerprint, { outcome: "dismiss", reason: "expected load test" }),
		{ now: NOW },
	);
	assert.equal(dismissed.ok, true, (dismissed.errors || []).join("; "));
	assert.equal(dismissed.record.triage.outcome, "dismiss");
	assert.equal(dismissed.record.triage.reason, "expected load test");
	assert.equal(dismissed.candidate, null);
});

test("triage fix returns a candidate Intent payload and mutates nothing canonical", () => {
	const dir = mkTarget("triage-fix");
	const fingerprint = triageFixture(dir);
	const withReason = triage(dir, triageInput(fingerprint, { outcome: "fix" }), { now: NOW });
	assert.equal(withReason.ok, false);
	assert.equal(withReason.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(withReason.errors[0], /reason is preserved only for schedule and dismiss/);
	const before = snapshotOutsideMaintain(dir);
	const detectorBytes = fs.readFileSync(detectorsPath(dir), "utf8");
	const findingBytes = fs.readFileSync(findingsPath(dir), "utf8");
	const fixed = triage(dir, triageInput(fingerprint, { outcome: "fix", reason: null }), {
		now: NOW,
	});
	assert.equal(fixed.ok, true, (fixed.errors || []).join("; "));
	assert.equal(fixed.record.status, "triaged");
	assert.equal(fixed.record.triage.reason, null);
	assert.equal(fixed.candidate.type, "intent");
	assert.match(fixed.candidate.identity, /^intent\/maintain\/[0-9a-f]{16}$/);
	assert.equal(fixed.candidate.scope, "service/api");
	assert.match(fixed.candidate.body, /detector\/error-rate@1/);
	assert.match(fixed.candidate.body, /- finding 0: value 120 \(warn\)/);
	assert.ok(fixed.candidate.body.includes(fingerprint));
	// No canonical mutation: the artifact journal and every other ledger
	// outside .amber/maintain are byte-identical, and within maintain the
	// triage wrote only the proposals ledger.
	assert.deepEqual(snapshotOutsideMaintain(dir), before);
	assert.equal(fs.readFileSync(detectorsPath(dir), "utf8"), detectorBytes);
	assert.equal(fs.readFileSync(findingsPath(dir), "utf8"), findingBytes);
	// The candidate is a plain admission payload for the NORMAL surface.
	const admitted = admitArtifact(dir, fixed.candidate);
	assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
});

test("triage decisions are single-use across the maintain ledgers", () => {
	const dir = mkTarget("triage-single-use");
	const fingerprint = triageFixture(dir);
	// decision/detector-1 already authorized the detector registration.
	const spent = triage(
		dir,
		triageInput(fingerprint, { decision: { identity: "decision/detector-1", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(spent.ok, false);
	assert.equal(spent.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(spent.errors[0], /already authorized detector/);
	assert.match(spent.errors[0], /single-use across the maintain ledgers/);
	assert.equal(triage(dir, triageInput(fingerprint), { now: NOW }).ok, true);
	// A second fingerprint cannot reuse the spent triage decision.
	assert.equal(
		detect(
			dir,
			observation({
				window: { from: "2026-08-29T01:00:00.000Z", to: "2026-08-29T01:30:00.000Z" },
				inputHash: HASH_B,
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const second = propose(dir, { findingIndex: 1 }, { now: NOW });
	assert.equal(second.action, "opened");
	const reused = triage(dir, triageInput(second.record.fingerprint), { now: NOW });
	assert.equal(reused.ok, false);
	assert.equal(reused.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(reused.errors[0], /already triaged the proposal/);
	// … and the reverse direction: a Decision spent by a triage can never
	// authorize a detector registration afterwards.
	const registered = registerDetector(
		dir,
		detectorInput({ version: "2", decision: { identity: "decision/triage-1", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(registered.ok, false);
	assert.equal(registered.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(registered.errors[0], /already triaged the proposal/);
	assert.match(registered.errors[0], /single-use across the maintain ledgers/);
});

test("triage refuses ghosts, non-human authority, and out-of-vocabulary outcomes", () => {
	const dir = mkTarget("triage-authority");
	const fingerprint = triageFixture(dir);
	const unknown = triage(dir, triageInput(`sha256:${"f".repeat(64)}`), { now: NOW });
	assert.equal(unknown.ok, false);
	assert.equal(unknown.code, "AMBER_E_MAINTAIN_NOT_FOUND");
	const vocabulary = triage(dir, triageInput(fingerprint, { outcome: "promote" }), { now: NOW });
	assert.equal(vocabulary.ok, false);
	assert.match(vocabulary.errors[0], /outcome must be one of fix, schedule, dismiss/);
	const smuggled = triage(dir, triageInput(fingerprint, { body: "# intent" }), { now: NOW });
	assert.equal(smuggled.ok, false);
	assert.match(smuggled.errors[0], /unknown field "body"/);
	const ghost = triage(
		dir,
		triageInput(fingerprint, { decision: { identity: "decision/ghost", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.match(ghost.errors[0], /not a committed Decision artifact/);
	decisionFixture(dir, "decision/review-2", { kind: "review" });
	const review = triage(
		dir,
		triageInput(fingerprint, { decision: { identity: "decision/review-2", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(review.ok, false);
	assert.match(
		review.errors[0],
		/maintain triage requires a human acceptance or approval Decision/,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/scoped",
			body: "# S\n",
			scope: "F054",
		}).ok,
		true,
	);
	decisionFixture(dir, "decision/scoped-2", { scope: "F054" });
	const scoped = triage(
		dir,
		triageInput(fingerprint, { decision: { identity: "decision/scoped-2", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(scoped.ok, false);
	assert.match(scoped.errors[0], /maintain triage is repository-global/);
});

test("re-chained triage forgeries cannot bypass the closed-proposal and single-use invariants", () => {
	const dir = mkTarget("triage-forgery");
	const fingerprint = triageFixture(dir);
	assert.equal(triage(dir, triageInput(fingerprint), { now: NOW }).ok, true);
	const events = readEvents(proposalsPath(dir));
	const settled = events[events.length - 1];
	const chained = (body, prevHash) => ({ ...body, prevHash, hash: chainHash(body, prevHash) });
	const { prevHash: _prev, hash: _hash, ...triageBody } = settled;
	// A second triage of the same (now closed) proposal.
	writeEvents(proposalsPath(dir), [...events, chained(triageBody, settled.hash)]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/triages an already-triaged proposal/.test(err.message),
	);
	// Evidence appended onto a triaged proposal.
	const evidenceBody = {
		kind: "evidence",
		schemaVersion: 1,
		at: settled.at,
		observedAt: settled.at,
		fingerprint,
		findingIndex: 3,
	};
	writeEvents(proposalsPath(dir), [...events, chained(evidenceBody, settled.hash)]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/appends evidence to a triaged proposal/.test(err.message),
	);
	// A reopened proposal triaged with the already-spent decision.
	const reopenBody = {
		kind: "proposal",
		schemaVersion: 1,
		at: settled.at,
		observedAt: settled.at,
		fingerprint,
		detectorId: "detector/error-rate",
		detectorVersion: "1",
		subject: "service/api",
		scope: "service/api",
		tier: "warn",
		cooldownMs: 3600000,
		findingIndex: 5,
	};
	const reopened = chained(reopenBody, settled.hash);
	writeEvents(proposalsPath(dir), [...events, reopened, chained(triageBody, reopened.hash)]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/reuses triage decision/.test(err.message),
	);
	// An out-of-vocabulary outcome fails shape validation even re-chained.
	const promoted = { ...triageBody, outcome: "promote" };
	writeEvents(proposalsPath(dir), [...events, reopened, chained(promoted, reopened.hash)]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/outcome must be one of fix, schedule, dismiss/.test(err.message),
	);
});

test("staleness is derived at read time and never edits a ledger", () => {
	const dir = mkTarget("staleness");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	assert.equal(listFindings(dir)[0].stale, false);
	assert.deepEqual(listFindings(dir)[0].staleReasons, []);
	assert.equal(listProposals(dir)[0].stale, false);
	const findingBytes = fs.readFileSync(findingsPath(dir), "utf8");
	const proposalBytes = fs.readFileSync(proposalsPath(dir), "utf8");
	// A newer registered detector version supersedes the version-pinned
	// finding and its proposal chain.
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
	assert.equal(listFindings(dir)[0].stale, true);
	assert.deepEqual(listFindings(dir)[0].staleReasons, ["detector-superseded"]);
	assert.equal(listProposals(dir)[0].stale, true);
	assert.deepEqual(listProposals(dir)[0].staleReasons, ["detector-superseded"]);
	// A later observation re-presenting the fingerprint with different
	// input supersedes the earlier finding.
	assert.equal(detect(dir, observation({ inputHash: HASH_B }), { now: NOW }).ok, true);
	assert.deepEqual(listFindings(dir)[0].staleReasons, [
		"detector-superseded",
		"observation-superseded",
	]);
	assert.equal(listFindings(dir)[1].staleReasons.includes("observation-superseded"), false);
	// Derived, never edited: staleness rewrote nothing — the findings
	// ledger only grew append-only and the proposals ledger is untouched.
	assert.ok(fs.readFileSync(findingsPath(dir), "utf8").startsWith(findingBytes));
	assert.equal(fs.readFileSync(proposalsPath(dir), "utf8"), proposalBytes);
});

// Admit the committed intent + eval + eval-result pins a completion binds.
// The eval-result records its definition pin in the extensions carrier,
// mirroring the F058 admission path.
function completionPinsFixture(dir, candidate) {
	assert.equal(admitArtifact(dir, candidate).ok, true);
	assert.equal(
		admitArtifact(dir, { type: "eval", identity: "eval/maintain-check", body: "# Eval\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "eval-result",
			identity: "eval-result/maintain-check-run",
			body: "# Result\n",
			extensions: {
				evalResult: { definition: { identity: "eval/maintain-check", revision: 1 } },
			},
		}).ok,
		true,
	);
	return {
		intent: { identity: candidate.identity, revision: 1 },
		eval: { identity: "eval/maintain-check", revision: 1 },
		evalResult: { identity: "eval-result/maintain-check-run", revision: 1 },
	};
}

test("complete binds a fix-triaged proposal to committed intent and eval pins", () => {
	const dir = mkTarget("complete");
	const fingerprint = triageFixture(dir);
	const candidateIdentity = `intent/maintain/${fingerprint.slice(7, 23)}`;
	const unrelated = complete(
		dir,
		{
			fingerprint,
			intent: { identity: "intent/ghost", revision: 1 },
			eval: { identity: "eval/ghost", revision: 1 },
			evalResult: { identity: "eval-result/ghost", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(unrelated.ok, false);
	assert.equal(unrelated.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(unrelated.errors[0], /must reference the candidate Intent identity/);
	const premature = complete(
		dir,
		{
			fingerprint,
			intent: { identity: candidateIdentity, revision: 1 },
			eval: { identity: "eval/ghost", revision: 1 },
			evalResult: { identity: "eval-result/ghost", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(premature.ok, false);
	assert.equal(premature.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(premature.errors[0], /does not resolve to a committed intent artifact revision/);
	const fixed = triage(dir, triageInput(fingerprint, { outcome: "fix", reason: null }), {
		now: NOW,
	});
	assert.equal(fixed.ok, true);
	assert.equal(fixed.candidate.identity, candidateIdentity);
	const pins = completionPinsFixture(dir, fixed.candidate);
	const wrongType = complete(
		dir,
		{ ...pins, fingerprint, eval: { identity: fixed.candidate.identity, revision: 1 } },
		{ now: NOW },
	);
	assert.equal(wrongType.ok, false);
	assert.match(wrongType.errors[0], /does not resolve to a committed eval artifact revision/);
	// An eval-result that never ran the pinned eval cannot settle the pins.
	assert.equal(
		admitArtifact(dir, {
			type: "eval-result",
			identity: "eval-result/unlinked",
			body: "# R\n",
			extensions: {
				evalResult: { definition: { identity: "eval/other", revision: 1 } },
			},
		}).ok,
		true,
	);
	const unlinked = complete(
		dir,
		{ ...pins, fingerprint, evalResult: { identity: "eval-result/unlinked", revision: 1 } },
		{ now: NOW },
	);
	assert.equal(unlinked.ok, false);
	assert.match(unlinked.errors[0], /the completion pins must belong together/);
	const settled = complete(dir, { fingerprint, ...pins }, { now: NOW });
	assert.equal(settled.ok, true, (settled.errors || []).join("; "));
	assert.equal(settled.record.status, "completed");
	assert.deepEqual(settled.record.completion, {
		at: NOW.toISOString(),
		intent: pins.intent,
		eval: pins.eval,
		evalResult: pins.evalResult,
	});
	// Append-only: completing again refuses, and the triage stays bound.
	assert.equal(settled.record.triage.outcome, "fix");
	const again = complete(dir, { fingerprint, ...pins }, { now: NOW });
	assert.equal(again.ok, false);
	assert.equal(again.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(again.errors[0], /no fix-triaged proposal awaits completion/);
	assert.equal(listProposals(dir)[0].status, "completed");
});

test("complete refuses open, scheduled, and unknown proposals", () => {
	const dir = mkTarget("complete-refusals");
	const fingerprint = triageFixture(dir);
	const ghostFingerprint = `sha256:${"f".repeat(64)}`;
	for (const fp of [fingerprint, ghostFingerprint]) {
		assert.equal(
			admitArtifact(dir, {
				type: "intent",
				identity: `intent/maintain/${fp.slice(7, 23)}`,
				body: "# Candidate\n",
			}).ok,
			true,
		);
	}
	assert.equal(
		admitArtifact(dir, { type: "eval", identity: "eval/maintain-check", body: "# E\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "eval-result",
			identity: "eval-result/maintain-check-run",
			body: "# R\n",
			extensions: {
				evalResult: { definition: { identity: "eval/maintain-check", revision: 1 } },
			},
		}).ok,
		true,
	);
	const pinsFor = (fp) => ({
		intent: { identity: `intent/maintain/${fp.slice(7, 23)}`, revision: 1 },
		eval: { identity: "eval/maintain-check", revision: 1 },
		evalResult: { identity: "eval-result/maintain-check-run", revision: 1 },
	});
	const open = complete(dir, { fingerprint, ...pinsFor(fingerprint) }, { now: NOW });
	assert.equal(open.ok, false);
	assert.equal(open.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(open.errors[0], /no fix-triaged proposal awaits completion/);
	assert.equal(triage(dir, triageInput(fingerprint), { now: NOW }).ok, true);
	const scheduled = complete(dir, { fingerprint, ...pinsFor(fingerprint) }, { now: NOW });
	assert.equal(scheduled.ok, false);
	assert.match(scheduled.errors[0], /no fix-triaged proposal awaits completion/);
	const unknown = complete(
		dir,
		{ fingerprint: ghostFingerprint, ...pinsFor(ghostFingerprint) },
		{ now: NOW },
	);
	assert.equal(unknown.ok, false);
	assert.equal(unknown.code, "AMBER_E_MAINTAIN_NOT_FOUND");
	const smuggled = complete(
		dir,
		{ fingerprint, ...pinsFor(fingerprint), body: "# intent" },
		{ now: NOW },
	);
	assert.equal(smuggled.ok, false);
	assert.match(smuggled.errors[0], /unknown field "body"/);
	// A corrupt maintain ledger fails the rollup closed too.
	fs.appendFileSync(proposalsPath(dir), '{"kind":"proposal"}\n');
	const corrupt = rollup(dir, { limit: 10 });
	assert.equal(corrupt.ok, false);
	assert.equal(corrupt.code, "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT");
});

test("re-chained completion forgeries fail every read closed", () => {
	const dir = mkTarget("complete-forgery");
	const fingerprint = triageFixture(dir);
	const fixed = triage(dir, triageInput(fingerprint, { outcome: "fix", reason: null }), {
		now: NOW,
	});
	const pins = completionPinsFixture(dir, fixed.candidate);
	assert.equal(complete(dir, { fingerprint, ...pins }, { now: NOW }).ok, true);
	const events = readEvents(proposalsPath(dir));
	const settled = events[events.length - 1];
	const chained = (body, prevHash) => ({ ...body, prevHash, hash: chainHash(body, prevHash) });
	const { prevHash: _prev, hash: _hash, ...completionBody } = settled;
	// A second completion of the same proposal is not fix-triaged anymore.
	writeEvents(proposalsPath(dir), [...events, chained(completionBody, settled.hash)]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/completes a proposal that is not fix-triaged/.test(err.message),
	);
	// A completion pointed at a proposal index that never opened.
	writeEvents(proposalsPath(dir), [
		...events,
		chained({ ...completionBody, proposalIndex: 9 }, settled.hash),
	]);
	assert.throws(
		() => listProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT" &&
			/completes unknown proposal 9/.test(err.message),
	);
});

test("rollup is deterministic within its declared bound and marks truncation", () => {
	const dir = mkTarget("rollup");
	registryFixture(dir);
	assert.equal(registerDetector(dir, detectorInput(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation(), { now: NOW }).ok, true);
	assert.equal(detect(dir, observation({ value: 600, inputHash: HASH_B }), { now: NOW }).ok, true);
	assert.equal(
		detect(
			dir,
			observation({
				window: { from: "2026-08-29T01:00:00.000Z", to: "2026-08-29T01:30:00.000Z" },
				inputHash: `sha256:${"c".repeat(64)}`,
			}),
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(propose(dir, { findingIndex: 0 }, { now: NOW }).action, "opened");
	assert.equal(propose(dir, { findingIndex: 2 }, { now: NOW }).action, "opened");
	decisionFixture(dir, "decision/triage-rollup");
	assert.equal(
		triage(
			dir,
			triageInput(listProposals(dir)[1].fingerprint, {
				decision: { identity: "decision/triage-rollup", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const bounded = rollup(dir, { limit: 100 });
	assert.equal(bounded.ok, true, (bounded.errors || []).join("; "));
	assert.deepEqual(bounded.record, {
		bounds: {
			limit: 100,
			findingsScanned: 3,
			findingsTotal: 3,
			proposalsScanned: 2,
			proposalsTotal: 2,
			truncated: false,
		},
		findings: { byTier: { page: 1, warn: 2 }, stale: 1, fresh: 2 },
		proposals: {
			byStatus: { open: 1, triaged: 1, completed: 0 },
			byTier: { warn: 2 },
			stale: 1,
			fresh: 1,
		},
	});
	// The same repository state always rolls up identically.
	assert.deepEqual(rollup(dir, { limit: 100 }).record, bounded.record);
	const truncated = rollup(dir, { limit: 1 });
	assert.equal(truncated.ok, true);
	assert.equal(truncated.record.bounds.truncated, true);
	assert.equal(truncated.record.bounds.findingsScanned, 1);
	assert.deepEqual(truncated.record.findings.byTier, { warn: 1 });
	assert.equal(truncated.record.proposals.byStatus.open, 1);
	const unbounded = rollup(dir, {});
	assert.equal(unbounded.ok, false);
	assert.equal(unbounded.code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(unbounded.errors[0], /limit must be a declared positive integer bound/);
});
