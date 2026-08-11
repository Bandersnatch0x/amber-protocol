"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const { buildLoadout } = require("./context-loadout");
const { canonicalJson, sha256 } = require("./context-hash");
const { resolvePathWithin } = require("./fs-utils");

const RUN_COUNT = 10;
const HARD_METRIC_THRESHOLDS = Object.freeze({
	expectedPageRecall: 1,
	selectionPrecision: 1,
	freshnessExclusion: 1,
	requiredCoverage: 1,
	stability: 1,
});
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
let fixtureValidator = null;

function getFixtureValidator() {
	if (fixtureValidator) return fixtureValidator;
	const schemaPath = path.join(
		__dirname,
		"..",
		"..",
		"..",
		"schemas",
		"context-benchmark.schema.json",
	);
	fixtureValidator = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
	return fixtureValidator;
}

function ratio(numerator, denominator) {
	return denominator === 0 ? 1 : numerator / denominator;
}

function intersectionSize(left, right) {
	const rightSet = new Set(right);
	return new Set(left.filter((value) => rightSet.has(value))).size;
}

function exclusionKey(entry) {
	return `${entry.pageId}:${entry.reason}`;
}

function benchmarkLoadout(loadout) {
	return {
		budgetWords: loadout.budgetWords,
		tiers: loadout.tiers,
		pages: Object.entries(loadout.pages)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([pageId, page]) => ({ pageId, ...page })),
		references: loadout.references,
		requiredArtifacts: loadout.artifacts.required,
		excluded: loadout.excluded,
		deltaSince: loadout.deltaSince,
	};
}

function exactFailures(expected, actual, field = "loadout", failures = []) {
	if (Array.isArray(expected) || Array.isArray(actual)) {
		if (!Array.isArray(expected) || !Array.isArray(actual)) {
			failures.push({ metric: "exactLoadout", field, expected, actual });
			return failures;
		}
		if (expected.length !== actual.length) {
			failures.push({
				metric: "exactLoadout",
				field: `${field}.length`,
				expected: expected.length,
				actual: actual.length,
			});
		}
		for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
			exactFailures(expected[index], actual[index], `${field}[${index}]`, failures);
		}
		return failures;
	}
	const expectedObject = expected !== null && typeof expected === "object";
	const actualObject = actual !== null && typeof actual === "object";
	if (expectedObject || actualObject) {
		if (!expectedObject || !actualObject) {
			failures.push({ metric: "exactLoadout", field, expected, actual });
			return failures;
		}
		const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
		for (const key of keys) {
			const expectedHas = Object.prototype.hasOwnProperty.call(expected, key);
			const actualHas = Object.prototype.hasOwnProperty.call(actual, key);
			if (!expectedHas || !actualHas) {
				failures.push({
					metric: "exactLoadout",
					field: `${field}.${key}`,
					expected: expectedHas ? expected[key] : "<missing>",
					actual: actualHas ? actual[key] : "<missing>",
				});
				continue;
			}
			exactFailures(expected[key], actual[key], `${field}.${key}`, failures);
		}
		return failures;
	}
	if (!Object.is(expected, actual)) {
		failures.push({ metric: "exactLoadout", field, expected, actual });
	}
	return failures;
}

function eligibleFailures(loadout, eligiblePages) {
	const actual = [
		...loadout.references.map((reference) => reference.pageId),
		...loadout.excluded.map((entry) => entry.pageId),
	]
		.filter((pageId, index, all) => all.indexOf(pageId) === index)
		.sort();
	const expected = eligiblePages.slice().sort();
	return JSON.stringify(actual) === JSON.stringify(expected)
		? []
		: [{ metric: "eligiblePages", field: "eligiblePages", expected, actual }];
}

function measure(loadout, expected, hashes) {
	const selected = loadout.references.map((reference) => reference.pageId);
	const expectedPages = expected.pages;
	const selectedMatches = intersectionSize(selected, expectedPages);
	const actualExclusions = loadout.excluded.map(exclusionKey);
	const expectedExclusions = expected.excluded.map(exclusionKey);
	const exclusionUnion = [...new Set([...actualExclusions, ...expectedExclusions])];
	const exclusionMatches = intersectionSize(actualExclusions, expectedExclusions);
	const requiredKinds = loadout.artifacts.required.map((artifact) => artifact.kind);
	const requiredMatches = intersectionSize(requiredKinds, expected.requiredArtifacts);
	const selectedWords = loadout.references.reduce(
		(total, reference) => total + (loadout.pages[reference.pageId]?.words || 0),
		0,
	);
	return {
		expectedPageRecall: ratio(selectedMatches, expectedPages.length),
		selectionPrecision: ratio(selectedMatches, selected.length),
		freshnessExclusion: ratio(exclusionMatches, exclusionUnion.length),
		requiredCoverage: ratio(requiredMatches, expected.requiredArtifacts.length),
		stability: new Set(hashes).size === 1 ? 1 : 0,
		budgetEfficiency: ratio(selectedWords, loadout.budgetWords),
		warmContinuationCost: null,
		correctionRate: null,
	};
}

function measureWords(loadout) {
	return {
		budget: loadout.budgetWords,
		selected: loadout.references.reduce(
			(total, reference) => total + (loadout.pages[reference.pageId]?.words || 0),
			0,
		),
		requiredArtifacts: loadout.artifacts.required.reduce(
			(total, artifact) => total + (artifact.words || 0),
			0,
		),
	};
}

function metricFailures(metrics) {
	return Object.entries(HARD_METRIC_THRESHOLDS)
		.filter(([metric, expected]) => metrics[metric] !== expected)
		.map(([metric, expected]) => ({ metric, expected, actual: metrics[metric] }));
}

function benchmarkFailure(code, detail, report = null) {
	return { ok: false, code, detail, report };
}

function loadFixture(targetRoot, fixturePath) {
	let resolved;
	try {
		resolved = resolvePathWithin(targetRoot, fixturePath, {
			label: "Context benchmark fixture",
		});
		const fixture = JSON.parse(fs.readFileSync(resolved, "utf8"));
		const validate = getFixtureValidator();
		if (!validate(fixture)) {
			return benchmarkFailure(
				"AMBER_E_CONTEXT_SCHEMA_INVALID",
				validate.errors
					.slice(0, 5)
					.map((error) => `${error.instancePath || "/"} ${error.message}`)
					.join("; "),
			);
		}
		return { ok: true, fixture, fixturePath: resolved };
	} catch (error) {
		return benchmarkFailure("AMBER_E_CONTEXT_SCHEMA_INVALID", error.message || String(error));
	}
}

function persistReport(targetRoot, fixtureId, report) {
	const reportPath = resolvePathWithin(
		targetRoot,
		path.join(".amber", "context", "benchmarks", `${fixtureId}.json`),
		{ label: "Context benchmark report" },
	);
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return reportPath;
}

function runBenchmark(targetRoot, options = {}) {
	const loaded = loadFixture(targetRoot, options.fixture);
	if (!loaded.ok) return loaded;
	const { fixture } = loaded;
	if (options.mode && fixture.mode !== options.mode) {
		return benchmarkFailure(
			"AMBER_E_CONTEXT_SCHEMA_INVALID",
			`fixture mode ${fixture.mode} does not match requested mode ${options.mode}`,
		);
	}
	const hashes = [];
	let loadout = null;
	const startedAt = Date.now();
	for (let run = 0; run < RUN_COUNT; run += 1) {
		const built = buildLoadout(targetRoot, {
			route: fixture.signal.route,
			feature: fixture.signal.feature,
			budget: fixture.signal.budget,
			since: fixture.signal.since,
			knowledgeKinds: fixture.signal.knowledgeKinds,
			required: fixture.signal.requiredPages,
		});
		if (built.errors.length > 0) {
			return benchmarkFailure(built.errors[0].code, built.errors[0].detail);
		}
		loadout = built.loadout;
		hashes.push(sha256(canonicalJson(JSON.stringify(loadout))));
	}
	const metrics = measure(loadout, fixture.expected, hashes);
	const actualExactLoadout = benchmarkLoadout(loadout);
	const durationMs = Date.now() - startedAt;
	const failureReasons = [
		...metricFailures(metrics),
		...eligibleFailures(loadout, fixture.expected.eligiblePages),
		...exactFailures(fixture.expected.loadout, actualExactLoadout),
	];
	const fixtureRelativePath = path
		.relative(targetRoot, loaded.fixturePath)
		.split(path.sep)
		.join("/");
	const report = {
		schemaVersion: "1.0.0",
		fixtureId: fixture.fixtureId,
		fixtureRevision: fixture.fixtureRevision,
		fixtureHash: sha256(fs.readFileSync(loaded.fixturePath, "utf8")),
		mode: fixture.mode,
		amberRevision: require("../../../package.json").version,
		runs: RUN_COUNT,
		durationMs,
		timings: { durationMs },
		commandOptions: {
			fixture: fixtureRelativePath,
			mode: options.mode || fixture.mode,
		},
		configuration: {
			runs: RUN_COUNT,
			hardMetricThresholds: HARD_METRIC_THRESHOLDS,
		},
		signal: fixture.signal,
		metrics,
		wordCounts: measureWords(loadout),
		exclusions: loadout.excluded,
		expectedLoadoutHash: sha256(canonicalJson(JSON.stringify(fixture.expected.loadout))),
		actualLoadoutHash: sha256(canonicalJson(JSON.stringify(actualExactLoadout))),
		exactLoadout: actualExactLoadout,
		failureReasons,
		resultHash: hashes[0],
		passed: failureReasons.length === 0,
	};
	report.reportPath = persistReport(targetRoot, fixture.fixtureId, report);
	return report.passed
		? { ok: true, code: null, detail: "benchmark passed", report }
		: benchmarkFailure(
				"AMBER_E_CONTEXT_BENCHMARK_FAILED",
				"one or more fail-closed benchmark metrics or exact Loadout fields did not match",
				report,
			);
}

module.exports = { RUN_COUNT, HARD_METRIC_THRESHOLDS, runBenchmark };
