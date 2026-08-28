"use strict";

const path = require("node:path");
const { CONTEXT_MANIFEST_ROLES } = require("./planning");

// Declarative flag table driving parseArgs. Each entry maps a CLI flag to the
// args key it sets and how it consumes argv:
//   kind: "value"   -> args[key] = next argv token (default)
//   kind: "boolean" -> args[key] = true, no token consumed
//   accumulate      -> also push the value onto args[accumulate] (repeatable flag)
// Adding a flag is a single row here, not a new branch in a parse ladder.
const FLAG_SPECS = {
	"--target": { key: "target" },
	"--goal": { key: "goal" },
	"--objective": { key: "objective" },
	"--route": { key: "route" },
	"--budget": { key: "budget" },
	"--mode": { key: "mode" },
	"--feature": { key: "feature" },
	"--agent": { key: "agent" },
	"--title": { key: "title" },
	"--issue": { key: "issue" },
	"--recurrence": { key: "recurrence" },
	"--plan": { key: "plan" },
	"--file": { key: "file" },
	"--task": { key: "task" },
	"--session": { key: "session" },
	"--request-id": { key: "requestId" },
	"--gate": { key: "gate" },
	"--stage": { key: "stage" },
	"--command": { key: "command" },
	"--result": { key: "result" },
	"--id": { key: "id" },
	"--area": { key: "area" },
	"--behavior": { key: "behavior" },
	"--verify": { key: "verifyVal", accumulate: "verify" },
	"--notes": { key: "notes" },
	"--worker": { key: "worker" },
	"--reviewer": { key: "reviewer" },
	"--backend": { key: "backend" },
	"--concurrency": { key: "concurrency" },
	"--evidence": { key: "evidence" },
	"--version": { key: "version" },
	"--preset": { key: "preset" },
	"--registry": { key: "registry" },
	"--output": { key: "output" },
	"--output-dir": { key: "outputDir" },
	"--out": { key: "out" },
	"--format": { key: "format" },
	"--scope": { key: "scope" },
	"--suite": { key: "suite" },
	"--definition-id": { key: "definitionIdentity" },
	"--outcome-id": { key: "outcomeIdentity" },
	"--evidence-id": { key: "evidenceId" },
	"--limit": { key: "limit" },
	"--home": { key: "home" },
	"--bundle-dir": { key: "bundleDir" },
	"--report": { key: "report" },
	"--finding": { key: "finding" },
	"--baseline": { key: "baseline" },
	"--current": { key: "current" },
	"--base": { key: "base" },
	"--head": { key: "head" },
	"--index": { key: "index" },
	"--reports-dir": { key: "reportsDir" },
	"--trace-input": { key: "traceInput" },
	"--agent-config": { key: "agentConfig" },
	"--regression-assertion": { key: "regressionAssertion" },
	"--loop-contract": { key: "loopContract" },
	"--contract": { key: "contract" },
	"--ledger": { key: "ledger" },
	"--trigger-source": { key: "triggerSource" },
	"--stop-reason": { key: "stopReason" },
	"--since": { key: "since" },
	"--loadout": { key: "loadout" },
	"--threshold": { key: "threshold" },
	"--threshold-days": { key: "thresholdDays" },
	"--hard-stop-status": { key: "hardStopStatus" },
	"--budget-status": { key: "budgetStatus" },
	"--review-bandwidth-status": { key: "reviewBandwidthStatus" },
	"--review-gate-status": { key: "reviewGateStatus" },
	"--priority": { key: "priority" },
	"--profile": { key: "profile" },
	"--type": { key: "type" },
	"--artifact": { key: "artifact" },
	"--auth": { key: "auth" },
	"--tenant": { key: "tenant" },
	"--repository": { key: "repository" },
	"--query-tenant": { key: "queryTenant" },
	"--action": { key: "action" },
	"--entity": { key: "entity" },
	"--kind": { key: "kind" },
	"--sort": { key: "sort" },
	"--phase": { key: "phase" },
	"--checkpoint": { key: "checkpoint" },
	"--projection-version": { key: "projectionVersion" },
	"--depth": { key: "depth" },
	"--cursor": { key: "cursor" },
	"--dependency": { key: "dependency" },
	"--envelope": { key: "envelope" },
	"--paths": { key: "pathsVal", accumulate: "paths" },
	"--path": { key: "path", accumulate: "paths" },
	"--decision": { key: "decision", accumulate: "decisions" },
	"--include": { key: "include", accumulate: "includes" },
	"--worktree": { key: "worktree", kind: "boolean" },
	"--json": { key: "json", kind: "boolean" },
	"--dry-run": { key: "dryRun", kind: "boolean" },
	"--with-wiki": { key: "withWiki", kind: "boolean" },
	"--skip-detection": { key: "skipDetection", kind: "boolean" },
	"--confirm": { key: "confirm", kind: "boolean" },
	"--summary": { key: "summary", kind: "boolean" },
	"--page": { key: "page" },
	"--source": { key: "source", accumulate: "sources" },
	"--request": { key: "request" },
	"--payload": { key: "payload" },
	"--entry-id": { key: "entryId" },
	"--entry": { key: "entry" },
	"--ratify": { key: "ratify", kind: "boolean" },
	"--reason": { key: "reason" },
	"--max-words": { key: "maxWords" },
	"--window": { key: "window" },
	"--knowledge-kind": { key: "knowledgeKind" },
	"--supersedes": { key: "supersedesValue", accumulate: "supersedes" },
	"--supersedes-revision": { key: "supersedesRevision" },
	"--expected-head": { key: "expectedHead" },
	"--idempotency-key": { key: "idempotencyKey" },
	"--revision": { key: "revision" },
	"--body": { key: "body" },
	"--provenance": { key: "provenance" },
	"--transition": { key: "transition" },
	"--trace": { key: "traceVal", accumulate: "traceArgs" },
	"--extension": { key: "extensionVal", accumulate: "extensionArgs" },
	// F050 ticket 1 (#226): Principal registry + Decision admission flags.
	"--decision-kind": { key: "decisionKind" },
	"--principal": { key: "principal" },
	"--role": { key: "role" },
	"--membership": { key: "membership" },
	"--capability": { key: "capability" },
	"--valid-from": { key: "validFrom" },
	"--valid-to": { key: "validTo" },
	"--issuer": { key: "issuer" },
	"--fixture": { key: "fixture" },
	"--older-than-days": { key: "olderThanDays" },
	// F050 ticket 2 (#227): Evidence receipts + Assurance level flags.
	"--producer": { key: "producer" },
	"--assurance": { key: "assurance" },
	"--subject": { key: "subject" },
	"--status": { key: "status" },
	"--replay-of": { key: "replayOf" },
	"--verifier": { key: "verifier" },
	"--input": { key: "inputVal", accumulate: "inputs" },
	"--tool": { key: "toolVal", accumulate: "tools" },
	"--env": { key: "envVal", accumulate: "envEntries" },
	"--outputs": { key: "outputVal", accumulate: "outputs" },
	// F050 ticket 4 (#229): Approval registry flags (--id, --scope, --body,
	// and --trace are shared with the artifact surface).
	"--approver": { key: "approver" },
	"--revoker": { key: "revoker" },
	"--valid-until": { key: "validUntil" },
	"--decision-identity": { key: "decisionIdentity" },
	// F050 ticket 3 (#228): Gate evaluation flags (--gate, --subject,
	// --revision, and --index are shared with the existing surfaces).
	"--now": { key: "now" },
	"--verdict": { key: "verdict" },
	// F050 ticket 5 (#230): Policy evaluation flags.
	"--org-policy": { key: "orgPolicy" },
	"--tenant-policy": { key: "tenantPolicy" },
	"--repo-policy": { key: "repoPolicy" },
	"--play-policy": { key: "playPolicy" },
	"--gate-policy": { key: "gatePolicy" },
	"--gate-outcome-index": { key: "gateOutcomeIndex" },
	"--approval": { key: "approval" },
	"--submitter": { key: "submitter" },
	"--delegator": { key: "delegator" },
	// F051 ticket 1 (#233): Read-only Adapter flags.
	"--adapter-owner": { key: "adapterOwner" },
	"--adapter-version": { key: "adapterVersion" },
	"--record-type": { key: "recordType" },
	"--record-version": { key: "recordVersion" },
	"--expected-source-hash": { key: "expectedSourceHash" },
	// F051 ticket 4 (#236): Cutover & rollback flags (--decision-identity,
	// --revision, and --evidence are shared with the F050 surfaces).
	"--cutover-id": { key: "cutoverId" },
	"--artifact-type": { key: "artifactType" },
	"--generation": { key: "generation" },
	"--comparison-index": { key: "comparisonIndex" },
	"--confirmed-by": { key: "confirmedBy" },
	"--rollback-evidence": { key: "rollbackEvidence" },
	// F052 ticket 1 (#255): Runner registry flags (--id, --capability,
	// --decision-identity, --revision, and --rollback are shared with the
	// F050/F051 surfaces). F052 ticket 2 (#256) adds the request flags
	// (--repository, --path, --body, --trace, --approval, and --status are
	// shared with the existing surfaces).
	"--runner-version": { key: "runnerVersion" },
	"--integrity": { key: "integrity" },
	"--runner-owner": { key: "runnerOwner" },
	"--capability-version": { key: "capabilityVersion" },
	"--effect": { key: "effectVal", accumulate: "effects" },
	"--path-prefix": { key: "pathPrefixVal", accumulate: "pathPrefixes" },
	"--timeout-ms": { key: "timeoutMs" },
	"--credential": { key: "credential" },
	"--rollback": { key: "rollback" },
	"--environment": { key: "environment" },
	"--input-hash": { key: "inputHashVal", accumulate: "inputHashes" },
	"--request-hash": { key: "requestHash" },
	// F052 ticket 3 (#257): environment boundary flags.
	"--credential-handle": { key: "credentialHandle" },
	"--credential-purpose": { key: "credentialPurpose" },
	"--credential-scope": { key: "credentialScope" },
	"--credential-expires": { key: "credentialExpires" },
	"--rehearsal": { key: "rehearsal" },
	// F052 ticket 4 (#258): execution settlement flags (--evidence,
	// --reason, and --status are shared with the existing surfaces).
	"--receipt": { key: "receipt" },
	// F053 ticket 1 (#274): release candidate flags (--id, --environment,
	// --runner-version, --capability, --capability-version, --credential,
	// and --rollback are shared with the F052 surfaces).
	"--commit": { key: "commit" },
	"--change-artifact": { key: "changeArtifactVal", accumulate: "changeArtifacts" },
	"--evidence-item": { key: "evidenceItemVal", accumulate: "evidenceItems" },
	"--review-logic": { key: "reviewLogic" },
	"--review-security": { key: "reviewSecurity" },
	"--review-spec": { key: "reviewSpec" },
	"--release-policy": { key: "releasePolicy" },
	"--runner": { key: "runner" },
	"--identity-map": { key: "identityMap" },
	"--freshness-ms": { key: "freshnessMs" },
	"--allow-path": { key: "allowPath" },
	"--record-id": { key: "recordId" },
	"--all": { key: "all", kind: "boolean" },
	"--explain": { key: "explain", kind: "boolean" },
	"--strict": { key: "strict", kind: "boolean" },
	"--fix-markers": { key: "fixMarkers", kind: "boolean" },
	"--okf": { key: "okf", kind: "boolean" },
	"--markdown": { key: "markdown" },
	"--framework": { key: "framework" },
	"--execute": { key: "execute", kind: "boolean" },
	"--refresh-amber-owned": { key: "refreshAmberOwned", kind: "boolean" },
	"--archive-legacy": { key: "archiveLegacy", kind: "boolean" },
	"--refresh": { key: "refresh", kind: "boolean" },
	"--yes": { key: "yes", kind: "boolean" },
	"--warn-only": { key: "warnOnly", kind: "boolean" },
	"--force": { key: "force", kind: "boolean" },
	"--no-fail": { key: "noFail", kind: "boolean" },
	"--no-sessions": { key: "noSessions", kind: "boolean" },
	"--enable": { key: "enable", kind: "boolean" },
	"--allow-transcript": { key: "allowTranscript", kind: "boolean" },
	"--reviewed": { key: "reviewed", kind: "boolean" },
	"--owner": { key: "owner", accumulate: "owners" },
	"--surface": { key: "surface", accumulate: "surfaces" },
	"--help": { key: "help", kind: "boolean" },
	"-h": { key: "help", kind: "boolean" },
};

function getFlagSpec(flag) {
	return FLAG_SPECS[flag] || null;
}

function parseArgs(argv) {
	const args = { target: process.cwd(), json: false, dryRun: false };

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const spec = FLAG_SPECS[arg];

		if (!spec) {
			args._ = args._ || [];
			args._.push(arg);
			continue;
		}

		if (spec.kind === "boolean") {
			args[spec.key] = true;
			continue;
		}

		const value = argv[index + 1];
		args[spec.key] = value;
		if (spec.accumulate) {
			if (!Array.isArray(args[spec.accumulate])) {
				args[spec.accumulate] = [];
			}
			args[spec.accumulate].push(value);
		}
		index += 1;
	}

	return args;
}

function printAuditClassification(result) {
	if (result.classification?.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
}

function printAuditStarterSummary(result) {
	if (result.auditMode === "product-repo") {
		const template = result.templateStarterFiles;
		const total = template.existing.length + template.missing.length;
		console.log(`Template starter files: ${template.existing.length}/${total} in templates/`);
		return;
	}

	console.log(`Existing Amber starter files: ${result.existing.length}`);
	console.log(`Missing Amber starter files: ${result.missing.length}`);
	if (typeof result.workflowArtifactCount === "number" && result.workflowArtifactCount > 0) {
		console.log(
			`Historical .workflow/ artifacts: ${result.workflowArtifactCount} feature directory(s)`,
		);
	}
}

function printAuditStarterDetails(result) {
	if (result.auditMode !== "product-repo") {
		return;
	}

	const missing = result.templateStarterFiles?.missing || [];
	if (missing.length === 0) {
		return;
	}

	console.log("Missing template starter files:");
	for (const item of missing) {
		console.log(`  - ${item}`);
	}
}

function printAuditSummary(result) {
	console.log(`Audit summary: ${result.target}`);
	console.log(`Read-only: ${result.readOnly}`);
	printAuditClassification(result);
	printAuditStarterSummary(result);
	console.log(
		`Suggested additions: ${Array.isArray(result.suggestedAdditions) ? result.suggestedAdditions.length : 0}`,
	);
	console.log(`Existing docs: ${Array.isArray(result.docs) ? result.docs.length : 0}`);
	console.log(
		`Wiki-like files: ${Array.isArray(result.wikiLikeFiles) ? result.wikiLikeFiles.length : 0}`,
	);
	console.log(`Conflicts: ${Array.isArray(result.conflicts) ? result.conflicts.length : 0}`);

	if (Array.isArray(result.commands) && result.commands.length > 0) {
		console.log("Detected commands:");
		for (const command of result.commands) {
			console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
		}
	}

	if (Array.isArray(result.candidateCommands) && result.candidateCommands.length > 0) {
		console.log("Candidate commands requiring confirmation:");
		for (const command of result.candidateCommands) {
			console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
		}
	}

	if (Array.isArray(result.toolingEvidence) && result.toolingEvidence.length > 0) {
		console.log("Tooling evidence:");
		for (const item of result.toolingEvidence) {
			console.log(`  - ${item.source}: ${item.name}`);
		}
	}

	if (Array.isArray(result.unknowns)) {
		console.log("Unknowns:");
		if (result.unknowns.length === 0) {
			console.log("  - none");
		} else {
			for (const item of result.unknowns) {
				console.log(`  - ${item}`);
			}
		}
	}

	if (typeof result.nextSafeCommand === "string") {
		console.log(`Next safe command: ${result.nextSafeCommand}`);
	}
}

// Shared "Errors: N" footer used by every structured result branch below.
// Empty or absent errors render as "Errors: 0".
function printErrorFooter(result) {
	if (Array.isArray(result.errors) && result.errors.length > 0) {
		console.log(`Errors: ${result.errors.length}`);
		for (const error of result.errors) {
			console.log(`  - ${error}`);
		}
	} else {
		console.log("Errors: 0");
	}
}

// Shared "Warnings: N" footer; prints nothing when there are no warnings.
function printWarningFooter(result) {
	if (Array.isArray(result.warnings) && result.warnings.length > 0) {
		console.log(`Warnings: ${result.warnings.length}`);
		for (const warning of result.warnings) {
			console.log(`  - ${warning}`);
		}
	}
}

// Init/scaffold extras: wiki readiness and Git-workflow/governance detection.
// Every field is optional — prints nothing when a section is absent, so plain
// `init` (no --with-wiki, non-git target) renders exactly as before.
function printInitInsights(result) {
	const wiki = result.wikiReadiness;
	if (wiki) {
		console.log("");
		console.log(`Wiki readiness: ${wiki.present}/${wiki.total} files present`);
		if (Array.isArray(wiki.missing) && wiki.missing.length > 0) {
			console.log(`  Missing: ${wiki.missing.length}`);
			for (const file of wiki.missing.slice(0, 5)) {
				console.log(`    - ${file}`);
			}
		}
		if (Array.isArray(wiki.contextPlaceholders) && wiki.contextPlaceholders.length > 0) {
			console.log(`  Still placeholder (fill these in): ${wiki.contextPlaceholders.length}`);
			for (const file of wiki.contextPlaceholders.slice(0, 8)) {
				console.log(`    ! ${file}`);
			}
		}
	}

	const detection = result.detection;
	if (detection && detection.workflow) {
		const wf = detection.workflow;
		console.log("");
		console.log(`Git workflow: ${wf.detected} (${wf.confidence} confidence)`);
		if (Array.isArray(wf.evidence) && wf.evidence.length > 0) {
			console.log("  Evidence:");
			for (const item of wf.evidence.slice(0, 4)) {
				console.log(`    - ${item}`);
			}
		}
	}
	if (detection && detection.governance) {
		const g = detection.governance;
		const review = g.recommendations && g.recommendations.codeReview;
		const missing =
			g.recommendations && g.recommendations.gitignore ? g.recommendations.gitignore.missing : [];
		console.log("");
		console.log(`Team size: ${g.teamSize} (${g.contributors} contributor(s))`);
		if (review) {
			console.log(`  Code review: ${review.strategy}`);
		}
		if (Array.isArray(missing) && missing.length > 0) {
			console.log("  Suggested .gitignore additions:");
			for (const pattern of missing) {
				console.log(`    - ${pattern}`);
			}
		}
	}
}

function renderInit(result) {
	const skipped = Array.isArray(result.skipped) ? result.skipped : [];
	console.log(`Target: ${result.target}`);
	console.log(`Created: ${result.created.length}`);
	for (const item of result.created) {
		console.log(`  + ${item}`);
	}
	console.log(`Skipped: ${skipped.length}`);
	for (const item of skipped) {
		console.log(`  - ${item}`);
	}

	if (Array.isArray(result.warnings) && result.warnings.length > 0) {
		console.log("");
		for (const warning of result.warnings) {
			console.log(`WARNING: ${warning}`);
		}
	}
	if (Array.isArray(result.nextSteps) && result.nextSteps.length > 0) {
		console.log("");
		console.log("Next steps:");
		for (const step of result.nextSteps) {
			console.log(`  ${step}`);
		}
	}
	printInitInsights(result);
	if (Array.isArray(result.errors)) {
		if (result.errors.length === 0) {
			console.log("Errors: 0");
		} else {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		}
	}
	printWarningFooter(result);
}

function renderAudit(result) {
	if (result.auditMode === "product-repo") {
		printAuditStarterDetails(result);
	} else {
		for (const item of result.missing) {
			console.log(`  - ${item}`);
		}
	}
	if (Array.isArray(result.suggestedAdditions) && result.suggestedAdditions.length > 0) {
		console.log("Suggested additions:");
		for (const item of result.suggestedAdditions) {
			console.log(`  - ${item}`);
		}
	}
	if (result.commands.length > 0) {
		console.log("Detected commands:");
		for (const command of result.commands) {
			console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
		}
	}
	if (Array.isArray(result.candidateCommands) && result.candidateCommands.length > 0) {
		console.log("Candidate commands requiring confirmation:");
		for (const command of result.candidateCommands) {
			console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
		}
	}
	if (Array.isArray(result.toolingEvidence) && result.toolingEvidence.length > 0) {
		console.log("Tooling evidence:");
		for (const item of result.toolingEvidence) {
			console.log(`  - ${item.source}: ${item.name}`);
		}
	}
	if (Array.isArray(result.docs) && result.docs.length > 0) {
		console.log("Existing docs:");
		for (const item of result.docs) {
			console.log(`  - ${item}`);
		}
	}
	if (Array.isArray(result.wikiLikeFiles) && result.wikiLikeFiles.length > 0) {
		console.log("Wiki-like files:");
		for (const item of result.wikiLikeFiles) {
			console.log(`  - ${item}`);
		}
	}
	if (Array.isArray(result.suggestedPatches) && result.suggestedPatches.length > 0) {
		console.log("Suggested patches requiring approval:");
		for (const patch of result.suggestedPatches) {
			console.log(`  - ${patch.file}: ${patch.suggestion}`);
		}
	}
	if (Array.isArray(result.unknowns)) {
		console.log("Unknowns:");
		if (result.unknowns.length === 0) {
			console.log("  - none");
		} else {
			for (const item of result.unknowns) {
				console.log(`  - ${item}`);
			}
		}
	}
	if (result.conflicts.length > 0) {
		console.log("Files that will not be touched:");
		for (const item of result.conflicts) {
			console.log(`  - ${item}`);
		}
	}
	if (typeof result.nextSafeCommand === "string") {
		console.log(`Next safe command: ${result.nextSafeCommand}`);
	}
}

function renderReports(result) {
	console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
	if (result.outputPath) {
		console.log(`Index: ${result.outputPath}`);
	}
	if (result.indexPath) {
		console.log(`Index: ${result.indexPath}`);
	}
	if (typeof result.valid === "boolean") {
		console.log(`Valid: ${result.valid}`);
		console.log(`Index checked: ${result.checkedIndex}`);
	}
	console.log(`Reports: ${result.reports.length}`);
	for (const report of result.reports) {
		console.log(`  - ${report.generatedAt}: ${path.basename(report.file)} -> ${report.target}`);
	}
	printErrorFooter(result);
	printWarningFooter(result);
}

function renderBenchmark(result) {
	console.log(`Base: ${result.base.file}`);
	console.log(`Head: ${result.head.file}`);
	console.log(`Same target: ${result.sameTarget}`);
	if (result.outputPath) {
		console.log(`Diff: ${result.outputPath}`);
	}
	console.log("Metric deltas:");
	for (const metric of Object.values(result.metrics)) {
		console.log(
			`  - ${metric.label}: ${metric.base ?? "n/a"} -> ${metric.head ?? "n/a"} (${metric.delta ?? "n/a"})`,
		);
	}
	console.log(`Candidate commands added: ${result.candidateCommands.added.length}`);
	console.log(`Unknowns removed: ${result.unknowns.removed.length}`);
	printErrorFooter(result);
}

function renderGateReport(result) {
	console.log(`Report: ${result.report.file}`);
	console.log(`Target: ${result.report.target}`);
	console.log(`Decision: ${result.decision}`);
	if (result.outputPath) {
		console.log(`Gate report: ${result.outputPath}`);
	}
	console.log(`Findings: ${result.findings.length}`);
	for (const finding of result.findings) {
		console.log(`  - ${finding.id}: ${finding.message}`);
	}
	printErrorFooter(result);
}

function renderAdoptionKind(result) {
	const { kind } = result;
	console.log(`Output: ${result.outputPath || "n/a"}`);
	console.log(`Target: ${result.target || "n/a"}`);
	console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
	if (kind === "adoption-selected-files") {
		console.log(
			`Selected files: ${Array.isArray(result.selectedFiles) ? result.selectedFiles.length : 0}`,
		);
		console.log(
			`Required selected: ${Array.isArray(result.requiredSelected) ? result.requiredSelected.length : 0}`,
		);
		console.log(
			`Optional selected: ${Array.isArray(result.optionalSelected) ? result.optionalSelected.length : 0}`,
		);
	}
	if (kind === "adoption-apply-plan") {
		console.log(`Dry run: ${result.dryRun}`);
		console.log(`Apply ready: ${result.applyReady}`);
		console.log(`Created preview: ${result.preview ? result.preview.created.length : 0}`);
		console.log(`Skipped existing: ${result.preview ? result.preview.skipped.length : 0}`);
	}
	if (kind === "adoption-decision-record" || kind === "adoption-next-actions") {
		console.log(`Gate decision: ${result.gateDecision}`);
	}
	if (kind === "adoption-decision-record") {
		console.log(`Approval status: ${result.approvalStatus}`);
		console.log(`Decisions: ${Array.isArray(result.decisions) ? result.decisions.length : 0}`);
		if (Array.isArray(result.decisions)) {
			for (const decision of result.decisions) {
				console.log(`  - ${decision.id}: ${decision.status}`);
			}
		}
	}
	if (kind === "adoption-next-actions") {
		console.log(
			`Approval gates: ${Array.isArray(result.approvalGates) ? result.approvalGates.length : 0}`,
		);
		if (Array.isArray(result.approvalGates)) {
			for (const gate of result.approvalGates) {
				console.log(`  - ${gate.id}: ${gate.question}`);
			}
		}
	}
	if (kind === "adoption-bundle") {
		console.log(`Latest report: ${result.latestReport || "none"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(`Files: ${Array.isArray(result.files) ? result.files.length : 0}`);
		if (Array.isArray(result.files)) {
			for (const file of result.files) {
				console.log(`  - ${file.relativePath}`);
			}
		}
		console.log(`Next safe action: ${result.nextSafeAction}`);
	}
	if (kind === "adoption-status") {
		console.log(`Reports: ${result.reports.count}`);
		console.log(`Latest report: ${result.latestReport ? result.latestReport.file : "none"}`);
		console.log(`Index checked: ${result.index.checked}`);
		console.log(`Index valid: ${result.index.valid ?? "n/a"}`);
		console.log(`Gate decision: ${result.gate.decision}`);
		if (result.outputPath) {
			console.log(`Status report: ${result.outputPath}`);
		}
		console.log(`Blockers: ${result.blockers.length}`);
		for (const blocker of result.blockers) {
			console.log(`  - ${blocker.id}: ${blocker.message}`);
		}
		console.log(`Next safe action: ${result.nextSafeAction}`);
	}
	printErrorFooter(result);
}

function renderGeneric(result) {
	console.log(`Target: ${result.target || "n/a"}`);
	if (typeof result.text === "string") {
		console.log(result.text);
	}
	if (result.classification && result.classification.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
	if (Array.isArray(result.checks) && result.checks.length > 0) {
		console.log("Checks:");
		for (const check of result.checks) {
			const status = check.passed ? "PASS" : "FAIL";
			const detail = check.detail ? ` (${check.detail})` : "";
			console.log(`  [${status}] ${check.name}${detail}`);
			if (!check.passed && check.remedy) {
				console.log(`         → fix: ${check.remedy}`);
			}
		}
	}
	if (Array.isArray(result.loadedStandards) && result.loadedStandards.length > 0) {
		console.log(`Standards loaded: ${result.loadedStandards.join(", ")}`);
	}
	if (Array.isArray(result.applicableChecks) && result.applicableChecks.length > 0) {
		console.log("Checks evaluated:");
		for (const check of result.applicableChecks) {
			console.log(`  - ${check.id}: ${check.description || "(no description)"}`);
		}
	}
	if (result.scopeDiscipline && Array.isArray(result.scopeDiscipline.checklist)) {
		console.log("Scope discipline checklist (advisory — never blocks the gate):");
		for (const question of result.scopeDiscipline.checklist) {
			console.log(`  - ${question}`);
		}
	}
	if (result.contextManifests) {
		console.log("Context manifests (knowledge surfaces per role):");
		for (const role of CONTEXT_MANIFEST_ROLES) {
			const entries = result.contextManifests[role] || [];
			console.log(`  ${role}: ${entries.length > 0 ? entries.join(", ") : "(not curated)"}`);
		}
	}
	if (result.releaseReadiness && result.releaseReadiness.status) {
		const statusLabel = result.releaseReadiness.status === "ready" ? "READY" : "BLOCKED";
		console.log(`Release readiness: ${statusLabel}`);
	}
	if (Array.isArray(result.productChecks) && result.productChecks.length > 0) {
		console.log("Product checks:");
		for (const check of result.productChecks) {
			console.log(`  - ${check.name}: errors=${check.errors}, warnings=${check.warnings}`);
		}
	}
	const errors = Array.isArray(result.errors) ? result.errors : [];
	const warnings = Array.isArray(result.warnings) ? result.warnings : [];
	if (errors.length === 0) {
		console.log("Errors: 0");
	} else {
		console.log(`Errors: ${errors.length}`);
		for (const error of errors) {
			console.log(`  - ${error}`);
		}
	}
	if (warnings.length > 0) {
		console.log(`Warnings: ${warnings.length}`);
		for (const warning of warnings) {
			console.log(`  - ${warning}`);
		}
	}
}

// Typed-mutation seam (F019): a write intercepted without --yes/--confirm is
// returned as an approval-required envelope (executed: false, hint, exit 1).
// JSON consumers read the envelope fields directly, but the generic renderer
// would print "Target: n/a / Errors: 0" — indistinguishable from success.
// Text mode fails loudly with the seam's own hint instead, mirroring the coded
// error the memory verbs print for the same approval situation.
function renderApprovalRequired(result) {
	console.log(`Target: ${result.target || "n/a"}`);
	if (result.actionTypeId) {
		console.log(`Action type: ${result.actionTypeId}`);
	}
	console.log("Executed: false");
	console.log("Errors: 1");
	console.log(
		`  - ${result.hint || "This typed mutation requires explicit approval (--yes or --confirm)."}`,
	);
}

// Shape → renderer registry (architecture review #2). A new command output
// shape is a new entry: matcher and renderer live together (locality), and
// printResult stays a registry lookup instead of a growing if-cascade.
const SHAPE_RENDERERS = Object.freeze([
	{ id: "init", match: (r) => Array.isArray(r.created), render: renderInit },
	{
		id: "audit",
		match: (r) => Array.isArray(r.missing),
		render: (r) => {
			console.log(`Target: ${r.target}`);
			console.log(`Read-only: ${r.readOnly}`);
			printAuditClassification(r);
			printAuditStarterSummary(r);
			renderAudit(r);
		},
	},
	{ id: "reports", match: (r) => Array.isArray(r.reports), render: renderReports },
	{
		id: "benchmark",
		match: (r) => r.base && r.head && r.metrics,
		render: renderBenchmark,
	},
	{
		id: "gate-report",
		match: (r) => r.report && r.decision && Array.isArray(r.findings),
		render: renderGateReport,
	},
	{
		id: "adoption",
		match: (r) => typeof r.kind === "string" && r.kind.startsWith("adoption-"),
		render: renderAdoptionKind,
	},
	{
		id: "approval-required",
		match: (r) => r.approvalRequired === true,
		render: renderApprovalRequired,
	},
	{ id: "generic", match: () => true, render: renderGeneric },
]);

function printResult(result, options = {}) {
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	// audit summary mode: only the summary section, no full classification
	if (options.summary && Array.isArray(result.missing)) {
		printAuditSummary(result);
		return;
	}
	const shape = SHAPE_RENDERERS.find((s) => s.match(result));
	shape.render(result);
}

module.exports = {
	getFlagSpec,
	parseArgs,
	printAuditSummary,
	printResult,
};
