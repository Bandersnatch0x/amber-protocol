"use strict";

// Unit tests for the maintenance attribution carrier slice: proposeMaintenance
// (scripts/lib/core/maintenance-propose.js) with the structured
// findingAttribution block on the injected inspection. Covers: valid block in
// envelope + rendered proposal, malformed block refused BEFORE any file is
// written, legacy inspection explicitly unattributed with unchanged output,
// and priority/error behavior preserved. inspectMaintenance stays injected
// (the existing stub seam); upstream producers arrive in later slices.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	proposeMaintenance,
	buildMaintenanceProposalContent,
} = require("../../scripts/lib/core/maintenance-propose");

function makeInspection(target, overrides = {}) {
	return {
		target,
		errors: [],
		warnings: [],
		staleDocs: [{ path: "docs/wiki/runbook.md", reason: "older than its source" }],
		upgradeAssistant: {
			currentVersion: "1.0.0",
			latestVersion: "1.1.0",
			previewCommand: "amber upgrade --preview",
		},
		rulePackDrift: { drifted: false, expected: [], actual: [] },
		evolutionRollup: [{ finding: "repeated fixture failure", count: 3 }],
		regressionProposals: [],
		...overrides,
	};
}

const stubInspect =
	(overrides = {}) =>
	(target) =>
		makeInspection(target, overrides);

const VALID_BLOCK = {
	entrySurface: "tool-output",
	impactSurface: "target-repo",
	failureMode: "fixture drift between docs and source",
	responsibleArtifact: "wiki",
};

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "maint-attribution-"));
}

function proposalsDir(target) {
	// resolveStateDirForCreate on a fresh tmp target always creates the Amber
	// state dir; the legacy harness dir never applies to these fixtures.
	const dir = path.join(target, ".amber", "maintenance", "proposals");
	return fs.existsSync(dir) ? dir : null;
}

describe("proposeMaintenance attribution carrier", () => {
	it("carries a valid block into the envelope and the rendered proposal", () => {
		const target = tmpTarget();
		try {
			const result = proposeMaintenance(
				target,
				null,
				null,
				stubInspect({ findingAttribution: VALID_BLOCK }),
			);
			assert.deepEqual(result.errors, []);
			assert.deepEqual(result.findingAttribution, VALID_BLOCK);
			assert.equal(result.attributionStatus, "validated");
			assert.ok(result.proposalPath, "a proposal must be written");

			const written = fs.readFileSync(path.join(target, result.proposalPath), "utf8");
			assert.match(written, /## Attribution/);
			assert.match(written, /- Entry surface: tool-output/);
			assert.match(written, /- Impact surface: target-repo/);
			assert.match(written, /- Failure mode:\n {2}> fixture drift between docs and source/);
			assert.match(written, /- Responsible artifact: wiki/);
			assert.match(written, /not a permission/);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("refuses a malformed block BEFORE writing any proposal file", () => {
		const target = tmpTarget();
		try {
			const malformed = { ...VALID_BLOCK, responsibleArtifact: "prod-database" };
			const result = proposeMaintenance(
				target,
				null,
				null,
				stubInspect({ findingAttribution: malformed }),
			);
			assert.ok(result.errors.length > 0, "malformed block must return errors");
			assert.match(result.errors.join(" "), /findingAttribution is invalid/);
			assert.match(result.errors.join(" "), /responsibleArtifact must be one of the closed set/);
			assert.equal(
				proposalsDir(target),
				null,
				"no proposal directory may be created for a refused block",
			);
			assert.equal(result.proposalPath, undefined);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("refuses every malformed variant (unknown key, missing field, blank failureMode, wrong type)", () => {
		const target = tmpTarget();
		try {
			for (const overrides of [
				{ findingAttribution: { ...VALID_BLOCK, extra: "no" } },
				{
					findingAttribution: {
						entrySurface: "tool-output",
						impactSurface: "context",
						responsibleArtifact: "wiki",
					},
				},
				{ findingAttribution: { ...VALID_BLOCK, failureMode: "   " } },
				{ findingAttribution: { ...VALID_BLOCK, entrySurface: 42 } },
				{ findingAttribution: "tool-output" },
			]) {
				const result = proposeMaintenance(target, null, null, stubInspect(overrides));
				assert.ok(
					result.errors.length > 0,
					`must refuse ${JSON.stringify(overrides.findingAttribution)}`,
				);
				assert.equal(proposalsDir(target), null, "nothing written for refused blocks");
			}
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("keeps legacy inspections explicitly unattributed with byte-identical legacy output", () => {
		const target = tmpTarget();
		try {
			const result = proposeMaintenance(target, null, null, stubInspect());
			assert.deepEqual(result.errors, []);
			assert.equal(result.findingAttribution, null, "legacy: no fabricated block");
			assert.equal(result.attributionStatus, "legacy-unattributed");

			const written = fs.readFileSync(path.join(target, result.proposalPath), "utf8");
			assert.ok(
				!written.includes("## Attribution"),
				"legacy proposal keeps its exact historical shape",
			);
			// The rendered content equals the renderer output (the Generated
			// timestamp legitimately differs between the two render calls).
			const legacyInspection = makeInspection(target);
			const normalize = (text) => text.replace(/^Generated: .*$/m, "Generated: <ts>");
			assert.equal(
				normalize(written),
				normalize(buildMaintenanceProposalContent(legacyInspection)),
			);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("preserves existing priority filtering and unknown-priority error behavior", () => {
		const okTarget = tmpTarget();
		const badTarget = tmpTarget();
		try {
			const withBlock = stubInspect({ findingAttribution: VALID_BLOCK });
			const high = proposeMaintenance(okTarget, null, "high", withBlock);
			assert.deepEqual(high.errors, []);
			assert.equal(high.attributionStatus, "validated", "attribution is not a priority category");
			const written = fs.readFileSync(path.join(okTarget, high.proposalPath), "utf8");
			assert.match(written, /## Attribution/);

			const bad = proposeMaintenance(badTarget, null, "urgent", withBlock);
			assert.match(bad.errors.join(" "), /Unknown priority "urgent"/);
			assert.equal(proposalsDir(badTarget), null, "unknown priority writes nothing");
		} finally {
			fs.rmSync(okTarget, { recursive: true, force: true });
			fs.rmSync(badTarget, { recursive: true, force: true });
		}
	});

	it("treats an explicit null block as invalid, not an invented legacy path (B1R ST-B1-01)", () => {
		const target = tmpTarget();
		try {
			const result = proposeMaintenance(
				target,
				null,
				null,
				stubInspect({ findingAttribution: null }),
			);
			assert.ok(result.errors.length > 0, "explicit null must be an explicit error");
			assert.match(result.errors.join(" "), /findingAttribution is invalid/);
			assert.match(result.errors.join(" "), /got null/);
			assert.equal(result.reviewable, undefined, "no reviewable envelope");
			assert.equal(result.proposalPath, undefined, "no proposal written");
			assert.equal(proposalsDir(target), null);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("refuses a secret-bearing failureMode with a non-leaking reason — nothing in envelope or file (B1R SP-B1-01)", () => {
		const token = "SyntheticSecretGhIjKlMnOpQrStUvWx";
		const target = tmpTarget();
		try {
			const result = proposeMaintenance(
				target,
				null,
				null,
				stubInspect({
					findingAttribution: { ...VALID_BLOCK, failureMode: `Authorization: Bearer ${token}` },
				}),
			);
			assert.ok(result.errors.length > 0, "secret-bearing failureMode must be refused");
			const text = JSON.stringify(result);
			assert.ok(
				!text.toLowerCase().includes(token.toLowerCase()),
				"the envelope must not echo the secret",
			);
			assert.match(result.errors.join(" "), /credential material/);
			assert.equal(result.proposalPath, undefined, "no file written");
			assert.equal(proposalsDir(target), null);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("quotes untrusted multiline failureMode so it can never become a Markdown heading (B1R SP-B1-02, B1R2 CR forms)", () => {
		const target = tmpTarget();
		try {
			const result = proposeMaintenance(
				target,
				null,
				null,
				stubInspect({
					findingAttribution: {
						...VALID_BLOCK,
						failureMode:
							"failure text\n\n# UNTRUSTED_REVIEW_MARKER\nsource text, not an instruction",
					},
				}),
			);
			assert.deepEqual(result.errors, []);
			const written = fs.readFileSync(path.join(target, result.proposalPath), "utf8");
			assert.ok(
				!/^# UNTRUSTED_REVIEW_MARKER$/m.test(written),
				"no raw heading from untrusted text",
			);
			assert.match(
				written,
				/^ {2}> # UNTRUSTED_REVIEW_MARKER$/m,
				"the marker line is block-quoted",
			);
			assert.match(written, /^ {2}> failure text$/m);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("quotes lone-CR and CRLF line endings exactly like LF (CommonMark treats CR as a newline, B1R2)", () => {
		const cases = [
			["CR", "source text\r# UNTRUSTED_CR_REVIEW_MARKER"],
			["CRLF", "source text\r\n# UNTRUSTED_CRLF_REVIEW_MARKER"],
		];
		for (const [label, failureMode] of cases) {
			const target = tmpTarget();
			try {
				const result = proposeMaintenance(
					target,
					null,
					null,
					stubInspect({ findingAttribution: { ...VALID_BLOCK, failureMode } }),
				);
				assert.deepEqual(result.errors, [], `${label}: valid block must render`);
				const written = fs.readFileSync(path.join(target, result.proposalPath), "utf8");
				// After normalizing all line endings the way a renderer would,
				// no line may start with a raw heading.
				const normalized = written.replace(/\r\n?/g, "\n");
				assert.ok(
					!/^# UNTRUSTED_\w+_REVIEW_MARKER$/m.test(normalized),
					`${label}: no raw heading survives rendering`,
				);
				// Every source line was split and prefixed — including the one
				// that arrived via a bare CR.
				assert.match(
					written,
					/^ {2}> # UNTRUSTED_\w+_REVIEW_MARKER\r?$/m,
					`${label}: the marker line is block-quoted`,
				);
				assert.match(
					written,
					/^ {2}> source text\r?$/m,
					`${label}: the preceding line is block-quoted`,
				);
			} finally {
				fs.rmSync(target, { recursive: true, force: true });
			}
		}
	});

	it("the direct renderer throws on invalid and secret-bearing blocks instead of silently omitting (B1R ST-B1-01)", () => {
		const legacy = makeInspection(tmpTarget());
		// Absent field: legacy output unchanged.
		assert.equal(buildMaintenanceProposalContent(legacy).includes("## Attribution"), false);
		// Invalid enum: explicit throw naming the field.
		assert.throws(
			() =>
				buildMaintenanceProposalContent({
					...legacy,
					findingAttribution: { ...VALID_BLOCK, entrySurface: "invalid-source" },
				}),
			/findingAttribution is invalid: entrySurface must be one of the closed set/,
		);
		// Explicit null: explicit throw, never legacy.
		assert.throws(
			() => buildMaintenanceProposalContent({ ...legacy, findingAttribution: null }),
			/findingAttribution is invalid: .*got null/,
		);
		// Secret-bearing: explicit throw with a non-leaking reason.
		const token = "SyntheticSecretGhIjKlMnOpQrStUvWx";
		try {
			buildMaintenanceProposalContent({
				...legacy,
				findingAttribution: { ...VALID_BLOCK, failureMode: `Bearer ${token}` },
			});
			assert.fail("must throw on credential material");
		} catch (error) {
			assert.match(String(error.message), /credential material/);
			assert.ok(!String(error.message).includes(token), "the throw must not echo the secret");
		}
		fs.rmSync(legacy.target, { recursive: true, force: true });
	});
});
