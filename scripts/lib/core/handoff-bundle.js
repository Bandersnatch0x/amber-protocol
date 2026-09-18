"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validateHandoff } = require("./audit");
const { resolveTarget } = require("./fs-utils");
const { buildGovernanceReport } = require("./governance-report");
const { renderHandoff } = require("../handoff-command");
const { shellQuote } = require("./text-utils");
const { readSessionEvents } = require("../session-timeline");
const { resolveStateDirForRead } = require("../state-dir-resolver");
const { readLedger } = require("./loop-ledger");
const { evaluateCommandPolicy } = require("./loop-policy");
const {
	contractHashOf,
	inputDigestOf,
	policyHashOf,
	runIdOf,
	scopeHashOf,
} = require("./run-freeze");
const {
	REQUIRED_BUNDLE_FILES,
	defaultBundleDir,
	resolveTargetRelativePath,
	slash,
} = require("./handoff-layout");

function section(content, title) {
	const pattern = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
	const match = content.match(pattern);
	if (!match) return "None recorded.\n";
	const start = match.index + match[0].length;
	const rest = content.slice(start);
	const next = rest.search(/^##\s+/m);
	return (next >= 0 ? rest.slice(0, next) : rest).trim() + "\n";
}

function renderReadme({ targetRoot, generatedAt, report }) {
	return [
		"# Amber Handoff Bundle",
		"",
		`Target: ${targetRoot}`,
		`Generated: ${generatedAt}`,
		`Readiness score: ${report.scores.overall}/100 (${report.decision})`,
		"",
		"This bundle is the portable continuation artifact for Amber Protocol work.",
		"It captures the current state, evidence, risks, next actions, and recovery commands without requiring chat history.",
		"",
		"## Files",
		"",
		"- session-summary.md",
		"- verification-evidence.md",
		"- next-actions.md",
		"- risks.md",
		"- recovery-commands.md",
		"- manifest.json",
		"",
	].join("\n");
}

function renderVerificationEvidence(handoffContent, report, failures) {
	const evidence = section(handoffContent, "Verification Evidence");
	const lines = [
		"# Verification Evidence",
		"",
		evidence.trim(),
		"",
		"## Evidence Score",
		"",
		`- Evidence: ${report.scores.evidence}/100`,
		`- Feature evidence records: ${report.summary.featureEvidence}`,
		"",
	];
	const recent = Array.isArray(failures) ? failures : [];
	if (recent.length > 0) {
		lines.push("## Recent Failed Verification Attempts", "");
		for (const f of recent) {
			lines.push(
				`- session ${f.sessionId}: \`${f.command || "(none)"}\` exit ${f.exitCode ?? "?"} at ${f.timestamp || "?"}`,
			);
			if (f.error) {
				const tail = String(f.error).split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
				lines.push(`  - error: ${tail}`);
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}

// Collect the most recent failed verification attempts recorded across session
// timelines, bounded to FAILED_VERIFICATION_LIMIT. Each carries the bounded
// command, exit code, timestamp, and stderr error context (#44 AC3). Newest
// first; ISO-8601 timestamps sort lexicographically == chronologically.
const FAILED_VERIFICATION_LIMIT = 5;
function collectFailedVerifications(targetRoot, limit = FAILED_VERIFICATION_LIMIT) {
	const sessionsDir = path.join(resolveStateDirForRead(targetRoot), "sessions");
	if (!fs.existsSync(sessionsDir)) return [];
	const failures = [];
	for (const name of fs.readdirSync(sessionsDir)) {
		const sessionDir = path.join(sessionsDir, name);
		try {
			if (!fs.statSync(sessionDir).isDirectory()) continue;
		} catch {
			continue;
		}
		for (const event of readSessionEvents(sessionDir)) {
			if (event && event.type === "verification_failed" && event.data) {
				failures.push({
					sessionId: name,
					command: event.data.command || null,
					exitCode: typeof event.data.exitCode === "number" ? event.data.exitCode : null,
					timestamp: event.timestamp || null,
					error: event.data.stderr || null,
				});
			}
		}
	}
	failures.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
	return failures.slice(0, limit);
}

function renderNextActions(report) {
	const lines = ["# Next Actions", ""];
	if (report.nextActions.length === 0) {
		lines.push("- No blocking next action. Validate the bundle before handoff.");
	} else {
		for (const action of report.nextActions) {
			lines.push(`- [${action.severity}] ${action.id}`);
			lines.push(`  - Why: ${action.why}`);
			lines.push(`  - Run: \`${action.command}\``);
			lines.push(`  - Expected outcome: ${action.expectedOutcome}`);
			lines.push(`  - Blocks: ${action.blocks.join(", ")}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function renderRisks(report) {
	const lines = ["# Risks", ""];
	const findings = report.readiness.findings || [];
	if (findings.length === 0) {
		lines.push("- None recorded.");
	} else {
		for (const finding of findings) {
			lines.push(`- [${finding.severity}] ${finding.id}: ${finding.message}`);
		}
	}
	lines.push("", "## Maintenance", "");
	if ((report.maintenance.staleDocs || []).length === 0) {
		lines.push("- No stale docs detected.");
	} else {
		for (const doc of report.maintenance.staleDocs) {
			lines.push(`- ${doc.path}: ${doc.reason}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function renderRecoveryCommands(targetDisplay) {
	const t = shellQuote(targetDisplay);
	return [
		"# Recovery Commands",
		"",
		"Run these from the Amber repository root unless your installation documents a different entry point.",
		"",
		`- Validate setup: \`node scripts/amber.js doctor --target ${t}\``,
		`- Rebuild governance report: \`node scripts/amber.js governance report --target ${t}\``,
		`- Inspect next action: \`node scripts/amber.js next --target ${t}\``,
		`- Regenerate live handoff: \`node scripts/amber.js handoff --target ${t}\``,
		`- Rebuild bundle: \`node scripts/amber.js handoff bundle --target ${t}\``,
		`- Validate bundle: \`node scripts/amber.js handoff validate --target ${t}\``,
		"",
	].join("\n");
}

function writeFile(outputDir, rel, content) {
	const filePath = path.join(outputDir, rel);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
	return filePath;
}

function buildManifest({ targetRoot, outputDir, generatedAt, report }) {
	return {
		schemaVersion: 1,
		artifactType: "amber-handoff-bundle",
		target: targetRoot,
		generatedAt,
		readinessScore: report.scores.overall,
		decision: report.decision,
		files: REQUIRED_BUNDLE_FILES.filter((file) => file !== "manifest.json"),
		bundleDir: outputDir,
	};
}

// ── trusted-control run contract: replay slices (Slice 5, spec §9) ──────────
// A bundle that carries per-attempt frozen-record slices works offline after
// the working copy is deleted: replay verifies value-hash integrity FIRST
// (R-RP-1), then re-evaluates the stored evaluated request against the stored
// hash-pinned rules with the pure policy seam (R-RP-2). Hash-only, missing-
// body, and tampered-body records are NON_REPLAYABLE — never silently
// degraded, never default-filled. Bundles spanning policy versions carry each
// attempt's own policy copy (R-RP-4).

const RUN_UUID_TOTAL = 36 + 1 + 36; // two UUIDs joined by one hyphen

/**
 * Parse a `--replay-scope` value: a sessionId, or a full derived runId
 * (`run-{sessionId}-{attemptId}`, R-ID-1). A truncated runId never resolves
 * (R-ID-2 — the display form is never an authority key).
 * @returns {{sessionId: string, attemptId: string|null}|null}
 */
function parseReplayScope(scope) {
	if (typeof scope !== "string" || scope.length === 0) return null;
	if (scope.startsWith("run-")) {
		const tuple = scope.slice(4);
		if (tuple.length !== RUN_UUID_TOTAL) return null;
		const sessionId = tuple.slice(0, 36);
		const attemptId = tuple.slice(37);
		if (tuple[36] !== "-") return null;
		return { sessionId, attemptId };
	}
	return { sessionId: scope, attemptId: null };
}

/**
 * Build one attempt's replay slice from its `stage_attempt_requested` record,
 * verifying value-hash integrity before declaring it replayable.
 */
function attemptReplaySlice(record, records) {
	const runId = runIdOf(record.sessionId, record.attemptId);
	const base = {
		runId,
		sessionId: record.sessionId,
		attemptId: record.attemptId,
		requestId: record.requestId,
		stageName: record.stageName,
	};
	const frozen = record.frozen;
	if (!frozen || !record.inputDigest) {
		return {
			...base,
			replayable: false,
			reason:
				"NON_REPLAYABLE: the attempt carries no frozen admission inputs (legacy record, R-FR-4 — never inferred)",
		};
	}
	// R-RP-1: recompute all base hashes from the stored values and compare.
	const problems = [];
	if (policyHashOf(frozen.policy) !== frozen.hashes.policyHash) {
		problems.push("policy value-hash mismatch");
	}
	if (frozen.scopeInputs && scopeHashOf(frozen.scopeInputs) !== frozen.hashes.scopeHash) {
		problems.push("scopeInputs value-hash mismatch");
	}
	if (
		frozen.hashes.contractHash !==
		contractHashOf({
			routeId: record.routeId,
			routeVersion: record.routeVersion,
			hashes: frozen.hashes,
		})
	) {
		problems.push("contractHash mismatch");
	}
	const recomputedDigest = inputDigestOf({
		resolvedCommand: frozen.evaluatedRequest?.resolvedCommand ?? null,
		argv: frozen.evaluatedRequest?.argv ?? null,
		capabilityPin: record.capabilityPin,
		routeHash: record.routeHash,
		stageName: record.stageName,
		attemptNumber: record.attemptNumber,
		fence: record.leaseFence,
	});
	if (recomputedDigest !== record.inputDigest) {
		problems.push("request value-hash mismatch");
	}
	if (problems.length > 0) {
		return { ...base, replayable: false, reason: `NON_REPLAYABLE: ${problems.join("; ")}` };
	}
	// The recorded admission verdict, joined by requestId (the fold source for
	// the reproduced-verdict comparison).
	const admitted = (records ?? []).find(
		(candidate) => candidate.kind === "attempt_admitted" && candidate.requestId === record.requestId,
	);
	return {
		...base,
		replayable: true,
		frozen,
		inputDigest: record.inputDigest,
		recordedVerdict: admitted ? admitted.policyVerdict ?? null : null,
	};
}

/**
 * R-RP-2: replay is a real deterministic evaluation — the stored evaluated
 * request runs against the stored rules object; live rules, manifests, and
 * registries are never consulted. A host-agent window froze no command, which
 * is a recorded absence, not a replayable evaluation.
 */
function replayPolicyDecision(slice) {
	if (!slice.replayable) {
		return { runId: slice.runId, replayable: false, reason: slice.reason };
	}
	const command = slice.frozen?.evaluatedRequest?.resolvedCommand;
	if (typeof command !== "string") {
		return {
			runId: slice.runId,
			replayable: false,
			reason: "NON_REPLAYABLE: the frozen request carries no resolved command (host-agent window)",
		};
	}
	const verdict = evaluateCommandPolicy(command, slice.frozen.policy);
	return {
		runId: slice.runId,
		replayable: true,
		verdict: {
			allowed: verdict.allowed === true,
			matchedRule: verdict.matchedRule ?? null,
			confidence: verdict.confidence ?? null,
		},
		recordedVerdict: slice.recordedVerdict ?? null,
	};
}

/**
 * Collect the per-attempt replay slices for a `--replay-scope` value (a
 * sessionId, or a full runId narrowing to one attempt). The session must
 * exist; an unknown scope is a bundle error, not an empty result.
 */
function collectAttemptReplaySlices(targetRoot, replayScope) {
	const scope = parseReplayScope(replayScope);
	if (!scope) {
		return { ok: false, errors: [`--replay-scope must be a sessionId or a full runId (${replayScope})`] };
	}
	const sessionDir = path.join(resolveStateDirForRead(targetRoot), "sessions", scope.sessionId);
	const ledgerPath = path.join(sessionDir, "ledger.jsonl");
	if (!fs.existsSync(ledgerPath)) {
		return { ok: false, errors: [`no session ledger exists for scope ${scope.sessionId}`] };
	}
	const records = readLedger(ledgerPath);
	const requests = records.filter((record) => record.kind === "stage_attempt_requested");
	const slices = requests
		.filter((record) => scope.attemptId === null || record.attemptId === scope.attemptId)
		.map((record) => {
			const slice = attemptReplaySlice(record, records);
			return { ...slice, replayDecision: replayPolicyDecision(slice) };
		});
	return { ok: true, sessionId: scope.sessionId, slices };
}

function writeHandoffBundle(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const targetDisplay = options.targetDisplay || target || ".";
	const outputDir = resolveTargetRelativePath(targetRoot, options.outputDir || options.bundleDir);
	const generatedAt = options.generatedAt || new Date().toISOString();
	const report = buildGovernanceReport(targetRoot, { targetDisplay });
	const handoffContent = renderHandoff(targetRoot);
	const failedVerifications = collectFailedVerifications(targetRoot);

	const files = [];
	files.push(writeFile(outputDir, "README.md", renderReadme({ targetRoot, generatedAt, report })));
	files.push(writeFile(outputDir, "session-summary.md", handoffContent));
	files.push(
		writeFile(
			outputDir,
			"verification-evidence.md",
			renderVerificationEvidence(handoffContent, report, failedVerifications),
		),
	);
	files.push(writeFile(outputDir, "next-actions.md", renderNextActions(report)));
	files.push(writeFile(outputDir, "risks.md", renderRisks(report)));
	files.push(writeFile(outputDir, "recovery-commands.md", renderRecoveryCommands(targetDisplay)));

	// Slice 5 (spec §9): an optional per-attempt replay-slices file for
	// `--replay-scope <sessionId|runId>` — frozen values plus the replay
	// decisions, so the bundle reproduces recorded verdicts offline.
	const bundleErrors = [];
	if (options.replayScope) {
		const slices = collectAttemptReplaySlices(targetRoot, options.replayScope);
		if (!slices.ok) {
			bundleErrors.push(...slices.errors);
		} else {
			const replayPath = writeFile(
				outputDir,
				"replay-slices.json",
				`${JSON.stringify(
					{
						schemaVersion: 1,
						artifactType: "amber-replay-slices",
						scope: options.replayScope,
						sessionId: slices.sessionId,
						slices: slices.slices,
					},
					null,
					2,
				)}\n`,
			);
			files.push(replayPath);
		}
	}

	files.push(
		writeFile(
			outputDir,
			"manifest.json",
			`${JSON.stringify(buildManifest({ targetRoot, outputDir, generatedAt, report }), null, 2)}\n`,
		),
	);

	const validation = validateHandoffBundle(outputDir);
	const handoffValidation = validateHandoff(targetRoot);
	// Distinguish bundle structure validity (required files present + manifest
	// well-formed) from delivery readiness (also requires a coherent live
	// handoff and a non-blocking governance decision). #44 AC2. The manifest
	// itself stays schemaVersion 1; these are bundle-result fields only (#44 AC4).
	const structureValid = validation.valid;
	const deliveryReady =
		structureValid && (handoffValidation.errors || []).length === 0 && report.decision !== "block";
	return {
		target: targetRoot,
		outputDir,
		files: files.map((filePath) => slash(path.relative(outputDir, filePath))),
		manifestPath: path.join(outputDir, "manifest.json"),
		valid: structureValid,
		structureValid,
		deliveryReady,
		readinessScore: report.scores.overall,
		decision: report.decision,
		failedVerifications,
		replayScope: options.replayScope ?? null,
		text: `Handoff bundle written: ${outputDir}\nFiles: ${files.length}\nReadiness score: ${report.scores.overall}/100 (${report.decision})`,
		errors: [...validation.errors, ...(handoffValidation.errors || []), ...bundleErrors],
		warnings: [...validation.warnings, ...(handoffValidation.warnings || [])],
	};
}

function validateHandoffBundle(bundleDir) {
	const resolved = path.resolve(bundleDir || defaultBundleDir(process.cwd()));
	const errors = [];
	const warnings = [];

	if (!fs.existsSync(resolved)) {
		return {
			bundleDir: resolved,
			valid: false,
			errors: [`handoff bundle directory is missing: ${resolved}`],
			warnings,
		};
	}

	for (const rel of REQUIRED_BUNDLE_FILES) {
		if (!fs.existsSync(path.join(resolved, rel))) {
			errors.push(`${rel} is missing from handoff bundle.`);
		}
	}

	let manifest = null;
	const manifestPath = path.join(resolved, "manifest.json");
	if (fs.existsSync(manifestPath)) {
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		} catch (error) {
			errors.push(`manifest.json is not valid JSON: ${error.message}`);
		}
	}

	if (manifest) {
		if (manifest.artifactType !== "amber-handoff-bundle") {
			errors.push("manifest.json artifactType must be amber-handoff-bundle.");
		}
		const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
		for (const rel of REQUIRED_BUNDLE_FILES.filter((file) => file !== "manifest.json")) {
			if (!manifestFiles.includes(rel)) {
				errors.push(`manifest.json does not list required file: ${rel}`);
			}
		}
	}

	return {
		bundleDir: resolved,
		valid: errors.length === 0,
		manifest,
		errors,
		warnings,
		text:
			errors.length === 0
				? `Handoff bundle valid: ${resolved}`
				: `Handoff bundle invalid: ${resolved}\nErrors: ${errors.length}`,
	};
}

module.exports = {
	REQUIRED_BUNDLE_FILES,
	FAILED_VERIFICATION_LIMIT,
	defaultBundleDir,
	resolveTargetRelativePath,
	writeHandoffBundle,
	validateHandoffBundle,
	collectFailedVerifications,
	parseReplayScope,
	collectAttemptReplaySlices,
	attemptReplaySlice,
	replayPolicyDecision,
};
