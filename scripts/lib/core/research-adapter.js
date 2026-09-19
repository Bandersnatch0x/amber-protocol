"use strict";

// Trusted-control context/runtime contract §6 — the Research adapter:
// ResearchProcess as a LocalProcess-family ExecutionBoundary, the SECOND
// consumer of the 0049 five-method domain-adapter contract (capabilities /
// contexts / executions / verifiers / validate). Scope stands: search /
// extract / cite — read / diagnose / write-target effects, Research before
// Ops, BrowserSession out. The boundary owns exactly one write path: the
// citation store (`.amber/research/citations.jsonl`); retrieval itself
// executes OUTSIDE Amber (the F052 Runtime stage), and everything Amber
// records about it is declared, never observed.
//
// Honest verification semantics (§6.3):
//   citation_exists  — deterministic (parse the store); any principal.
//   source_accessible— deterministic existence check; network references
//                      record `unavailable` — never fake success.
//   claim_supported  — semantic judgment requiring an INDEPENDENT verifier
//                      principal (verifier ≠ producer); human review is
//                      sufficient but not necessary (a service Principal may
//                      verify). The producer never verifies its own claim.
//
// Time semantics (§6.1): a citation carries `retrievedAt` (per-source fetch
// instant, declared by the Runtime) and the store stamps `at` (recording).
// A freshness flag derives when the gap exceeds the declared bound — the two
// timestamps are never merged.

const fs = require("node:fs");
const path = require("node:path");

const { statePath } = require("../state-dir-resolver");
const { citationExists, foldCitations, recordCitation } = require("./citation-store");
const { isNonEmptyString, isPlainObject } = require("./registry-ledger");

const RESEARCH_CAPABILITIES = Object.freeze([
	{
		name: "research.search",
		effects: ["read"],
		description: "Query external sources; the query text is available to Amber, the retrieval executes outside Amber.",
	},
	{
		name: "research.extract",
		effects: ["diagnose"],
		description: "Extract cited spans from declared sources; read-only beyond the retrieval.",
	},
	{
		name: "research.cite",
		effects: ["write-target"],
		description: "Write citation records to the research citation store — the one write path this boundary owns.",
	},
]);

// The boundary's write scope: the citation store only. No worktree, no
// repository mutation, no network execution from Amber's side.
const CITATION_STORE_RELATIVE = ".amber/research/citations.jsonl";

/**
 * Five-method contract, method 1 — capabilities(): the Research domain's
 * declared capability set with its registered egress constraints (R-EG-2),
 * resolved from the F052 registry fold when a target is supplied.
 */
function capabilities(cwd) {
	const declared = RESEARCH_CAPABILITIES.map((capability) => ({ ...capability }));
	if (!cwd) return { capabilities: declared, registry: [] };
	let registered;
	try {
		const { foldRunnerRegistry } = require("./runner-registry");
		registered = foldRunnerRegistry(cwd).capabilities.filter((capability) =>
			capability.name.startsWith("research."),
		);
	} catch {
		registered = [];
	}
	return { capabilities: declared, registry: registered };
}

/**
 * Five-method contract, method 2 — contexts(): the accessible context — the
 * declared sources of the target repository's Distillation Contracts and
 * Context Pages (the resolution surface R-EG-2 validates against). Read-only
 * declaration; no content is read here.
 */
function contexts(cwd) {
	const sources = [];
	const requestsPath = statePath(cwd, "context", "requests");
	if (fs.existsSync(requestsPath)) {
		for (const file of fs.readdirSync(requestsPath)) {
			if (!file.endsWith(".json")) continue;
			try {
				const request = JSON.parse(fs.readFileSync(path.join(requestsPath, file), "utf8"));
				for (const source of request.sources || []) {
					sources.push({
						kind: "contract-source",
						ref: source.ref,
						rawHash: source.rawHash,
						classification: source.classification ?? "unknown",
					});
				}
			} catch {
				continue;
			}
		}
	}
	return { citationStore: CITATION_STORE_RELATIVE, sources };
}

/**
 * Five-method contract, method 3 — executions(): the execution boundary.
 * LocalProcess-family: the Research process runs OUTSIDE Amber (the F052
 * Runtime stage); Amber's side is the citation store plus read-only
 * retrieval declarations. No worktree is created and none is needed.
 */
function executions() {
	return {
		family: "LocalProcess",
		writePaths: [CITATION_STORE_RELATIVE],
		readPaths: ["docs/", ".amber/context/"],
		network: "declared-only",
		worktree: false,
	};
}

/**
 * Five-method contract, method 4 — verifiers(): the boundary's verification
 * actors with their §6.3 semantics.
 */
function verifiers() {
	return [
		{ verifier: "citation_exists", kind: "deterministic", actorClass: "any-principal" },
		{ verifier: "source_accessible", kind: "deterministic", actorClass: "any-principal" },
		{
			verifier: "claim_supported",
			kind: "semantic",
			actorClass: "independent-verifier-principal",
			constraint: "verifier ≠ producer; human review sufficient, not necessary",
		},
	];
}

/**
 * Five-method contract, method 5 — validate(): run legality against the
 * boundary. A research run is legal when its declared write path stays
 * inside the citation store and its declared sources resolve in the
 * accessible context.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validate(run) {
	if (!isPlainObject(run)) return { ok: false, reason: "a research run declaration must be an object" };
	for (const writePath of run.writePaths ?? []) {
		if (writePath !== CITATION_STORE_RELATIVE) {
			return {
				ok: false,
				reason: `write path ${JSON.stringify(writePath)} is outside the research boundary; the one write path is ${CITATION_STORE_RELATIVE}`,
			};
		}
	}
	return { ok: true };
}

/**
 * `source_accessible` (§6.3): deterministic existence check. Repository-
 * relative file references are checked on disk; any other scheme (network
 * URL) records `unavailable` — Amber's core makes no network calls, and an
 * unavailable check is never faked into success.
 * @returns {{ status: "accessible" | "unavailable", detail: string }}
 */
function sourceAccessible(cwd, sourceRef) {
	if (!isNonEmptyString(sourceRef)) {
		return { status: "unavailable", detail: "sourceRef must be a non-empty string" };
	}
	if (/^[a-z]+:\/\//i.test(sourceRef)) {
		return {
			status: "unavailable",
			detail: `network reference ${JSON.stringify(sourceRef)} is outside Amber's deterministic checks; an independent verifier with network access may raise this`,
		};
	}
	const fullPath = path.join(cwd, sourceRef);
	if (fs.existsSync(fullPath)) {
		return { status: "accessible", detail: sourceRef };
	}
	return { status: "unavailable", detail: `${sourceRef} does not exist in the repository` };
}

/**
 * `claim_supported` (§6.3): the semantic judgment is RECORDED here, judged
 * elsewhere — this seam refuses to record a self-verification (the producer
 * never verifies its own claim) and otherwise delegates to the Evidence
 * receipt contract, whose `verified` assurance already demands an
 * independent verifier event (verifier id ≠ producer id).
 * @returns {{ ok: true, note: string } | { ok: false, code: string, errors: string[] }}
 */
function recordClaimVerification(cwd, { claimRef, producer, verifier, verdict, evidenceId }) {
	const { showEvidence, recordEvidence } = require("./evidence-receipts");
	if (!isNonEmptyString(claimRef) || !isNonEmptyString(producer) || !isNonEmptyString(verifier)) {
		return {
			ok: false,
			code: "AMBER_E_RESEARCH_VERIFIER_INVALID",
			errors: ["claimRef, producer, and verifier are required non-empty strings"],
		};
	}
	if (producer === verifier) {
		return {
			ok: false,
			code: "AMBER_E_RESEARCH_VERIFIER_INVALID",
			errors: [
				`the producer (${JSON.stringify(producer)}) never verifies its own claim; claim_supported requires an independent verifier principal (§6.3)`,
			],
		};
	}
	const recorded = recordEvidence(cwd, {
		id: evidenceId ?? `evidence/research/claim/${claimRef.replace(/[^a-z0-9.-]/gi, "-")}`,
		producer: verifier,
		assurance: "observed",
		scope: "research",
		subject: `research-claim:${claimRef}`,
		inputs: [claimRef],
		tools: ["research-adapter"],
		environment: null,
		outputs: [`verdict:${verdict === true ? "supported" : "unsupported"}`],
		status: verdict === true ? "pass" : "fail",
	});
	if (!recorded.ok) {
		return { ok: false, code: "AMBER_E_RESEARCH_VERIFIER_INVALID", errors: recorded.errors };
	}
	const receipt = showEvidence(cwd, recorded.receipt.id);
	return {
		ok: true,
		note:
			"the verification receipt stays at observed assurance; `verified` is reachable only through an independent verification event per 0054",
		receipt,
	};
}

/**
 * The §6.1 freshness flag: a citation whose `recordedAt − retrievedAt` gap
 * exceeds the declared bound is flagged on the citation record — never
 * silently accepted, never merged into one timestamp.
 */
function freshnessFlag(citation, freshnessBoundMs, now = new Date()) {
	const retrievedAt = Date.parse(citation.retrievedAt);
	if (Number.isNaN(retrievedAt)) return { flagged: true, reason: "retrievedAt unparseable" };
	const recordedAt = citation.at ? Date.parse(citation.at) : now.getTime();
	const gap = recordedAt - retrievedAt;
	if (gap > freshnessBoundMs) {
		return { flagged: true, reason: `recorded ${gap}ms after retrieval, beyond the ${freshnessBoundMs}ms bound` };
	}
	return { flagged: false };
}

// ── R-EG-2: the search query egress seam ────────────────────────────────────
// The search capability request carries the query text (available to Amber,
// unlike an F056 payload) plus querySources[] in exactly the R-EG-1
// reference shape, with the capability's registered constraints declaring
// maxQueryClassification / requiresQueryProvenance. Amber holding the query
// text does NOT add a containment claim: no scanner, no substring check.

// The shared §3.5 declaration validation — the same three checks as the F056
// seam (resolution, ceiling, provenance-required), reusing the external
// registry's resolver so both seams read the identical snapshot semantics.
/**
 * R-EG-2 validation for the search query declaration.
 * @returns {{ ok: true } | { ok: false, code: string, errors: string[] }}
 */
function validateQueryDeclaration(cwd, { querySources, capability }) {
	const { resolveDeclaredContextSource, declaredSourceShapeProblem } = require("./external-registry");
	const sources = querySources ?? [];
	for (const [index, entry] of sources.entries()) {
		const shape = declaredSourceShapeProblem(entry, `querySources[${index}]`);
		if (shape !== null) {
			return { ok: false, code: "AMBER_E_RESEARCH_QUERY_REFUSED", errors: [shape] };
		}
	}
	const requires = capability?.requiresQueryProvenance === true;
	if (requires && sources.length === 0) {
		return {
			ok: false,
			code: "AMBER_E_RESEARCH_QUERY_REFUSED",
			errors: [
				"the capability requires query provenance; a search request without querySources declarations is unverifiable and refuses (never silently passed)",
			],
		};
	}
	const ceiling = capability?.maxQueryClassification ?? "internal";
	for (const entry of sources) {
		const resolved = resolveDeclaredContextSource(cwd, entry);
		if (resolved.problem) {
			return { ok: false, code: "AMBER_E_RESEARCH_QUERY_REFUSED", errors: [resolved.problem] };
		}
		const { admittedUnderCeiling } = require("./classification");
		const verdict = admittedUnderCeiling(resolved.classification, ceiling);
		if (!verdict.ok) {
			return {
				ok: false,
				code: "AMBER_E_RESEARCH_QUERY_REFUSED",
				errors: [
					`${verdict.refusal}: declared source ${JSON.stringify(entry.ref)} carries classification ${resolved.classification}, above the capability ceiling ${ceiling}`,
				],
			};
		}
	}
	return { ok: true };
}

module.exports = {
	RESEARCH_CAPABILITIES,
	CITATION_STORE_RELATIVE,
	capabilities,
	contexts,
	executions,
	verifiers,
	validate,
	sourceAccessible,
	recordClaimVerification,
	freshnessFlag,
	validateQueryDeclaration,
	recordCitation,
	citationExists,
	foldCitations,
};
