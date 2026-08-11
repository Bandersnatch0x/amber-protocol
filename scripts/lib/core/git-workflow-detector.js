"use strict";

// Git workflow detector.
//
// Infers a repository's branching workflow (gitflow | github-flow | trunk-based)
// from four independent signals — branch names, commit history, config files, and
// release tags — and reports a confidence band. Every git call degrades to "no
// signal" on failure: a missing git binary, a non-zero exit, or a zero-commit repo
// must NEVER throw out of here, because the caller (amber init) treats detection as
// a best-effort enhancement that can never block installation.

const path = require("node:path");

const { pathExists, readText, resolveTarget } = require("./fs-utils");
const { gitOutput } = require("./git-exec");

const WORKFLOWS = ["gitflow", "github-flow", "trunk-based"];

function emptyScores() {
	return { gitflow: 0, "github-flow": 0, "trunk-based": 0 };
}

function isGitRepository(targetRoot) {
	return gitOutput(resolveTarget(targetRoot), ["rev-parse", "--is-inside-work-tree"]) === "true";
}

// ── Branch helpers ───────────────────────────────────────────────────────────

function listBranches(targetRoot) {
	const out = gitOutput(targetRoot, ["branch", "-a", "--format=%(refname:short)"]);
	if (!out) return [];
	return out
		.split("\n")
		.map((b) => b.trim())
		.filter((b) => b && !/HEAD/.test(b));
}

const isDevelop = (b) => b === "develop" || b.endsWith("/develop");
const isRelease = (b) => /(^|\/)release\//.test(b);
const isHotfix = (b) => /(^|\/)hotfix\//.test(b);
const isFeature = (b) => /(^|\/)feature\//.test(b);
const isMainish = (b) => {
	const tip = b.split("/").pop();
	return tip === "main" || tip === "master";
};

// Dimension 1 — branch naming pattern (the strongest signal).
function analyzeBranchPattern(targetRoot) {
	const scores = emptyScores();
	const evidence = [];
	const branches = listBranches(targetRoot);
	if (branches.length === 0) return { scores, evidence };

	const hasDevelop = branches.some(isDevelop);
	const hasRelease = branches.some(isRelease);
	const hasHotfix = branches.some(isHotfix);
	const hasFeature = branches.some(isFeature);

	if (hasDevelop) {
		scores.gitflow += 30;
		evidence.push("develop branch present");
	}
	if (hasRelease) {
		scores.gitflow += 20;
		evidence.push("release/* branch present");
	}
	if (hasHotfix) {
		scores.gitflow += 10;
		evidence.push("hotfix/* branch present");
	}
	if (!hasDevelop && hasFeature) {
		scores["github-flow"] += 25;
		evidence.push("main plus short-lived feature/* branches");
	}
	if (!hasDevelop && !hasFeature && !hasRelease && !hasHotfix && branches.every(isMainish)) {
		scores["trunk-based"] += 30;
		evidence.push("all work on main, no long-lived branches");
	}

	return { scores, evidence };
}

// Dimension 2 — commit history shape.
// The design doc's branch-lifetime sub-signal is intentionally omitted: branch
// lifetime is not reliably recoverable from git history alone (reflogs expire,
// merges may be fast-forwarded), so we score only the shares we can measure.
function analyzeCommitHistory(targetRoot) {
	const scores = emptyScores();
	const evidence = [];

	// One row per commit: "<parents>\x1f<subject>" so merge-ness and subject stay
	// aligned. Counting squashes only for single-parent commits prevents a merge
	// whose subject ends in "(#n)" (e.g. "Merge pull request ... (#5)") from being
	// tallied as both a merge and a squash.
	const logOut = gitOutput(targetRoot, ["log", "-n", "100", "--pretty=%P%x1f%s"]);
	if (logOut === null) return { scores, evidence };
	const rows = logOut.split("\n").filter((line) => line.includes("\x1f"));
	const total = rows.length;
	if (total === 0) return { scores, evidence };

	const squashRe = /\(#\d+\)\s*$/;
	let mergeCount = 0;
	let squashCount = 0;
	for (const row of rows) {
		const sep = row.indexOf("\x1f");
		const parentField = row.slice(0, sep).trim();
		const subject = row.slice(sep + 1);
		const parentCount = parentField ? parentField.split(/\s+/).length : 0;
		if (parentCount >= 2) {
			mergeCount += 1;
		} else if (squashRe.test(subject)) {
			squashCount += 1;
		}
	}

	const directCount = Math.max(0, total - mergeCount - squashCount);
	const mergeShare = mergeCount / total;
	const squashShare = squashCount / total;
	const directShare = directCount / total;

	if (mergeShare > 0.5) {
		scores.gitflow += 20;
		evidence.push("majority merge commits");
	}
	if (squashShare > 0.5) {
		scores["github-flow"] += 15;
		evidence.push("majority squash/PR-style commits");
	}
	if (directShare > 0.8) {
		scores["trunk-based"] += 25;
		evidence.push("almost all direct commits");
	}

	return { scores, evidence };
}

// Dimension 3 — declared workflow in config / contributing docs.
// Branch-protection detection (CI ruleset parsing) is intentionally omitted as
// best-effort and provider-specific; the declared-workflow signals below are the
// reliable part.
function analyzeConfigFiles(targetRoot) {
	const scores = emptyScores();
	const evidence = [];

	const contributing = path.join(targetRoot, "CONTRIBUTING.md");
	if (pathExists(contributing)) {
		let text;
		try {
			text = readText(contributing);
		} catch {
			text = "";
		}
		if (/git\s*flow/i.test(text)) {
			scores.gitflow += 15;
			evidence.push("CONTRIBUTING.md mentions GitFlow");
		}
		if (/github\s*flow/i.test(text)) {
			scores["github-flow"] += 15;
			evidence.push("CONTRIBUTING.md mentions GitHub Flow");
		}
	}

	let gitflowConfig = pathExists(path.join(targetRoot, ".gitflow"));
	if (!gitflowConfig) {
		const cfg = path.join(targetRoot, ".git", "config");
		if (pathExists(cfg)) {
			try {
				if (readText(cfg).includes("[gitflow")) gitflowConfig = true;
			} catch {
				/* ignore unreadable config */
			}
		}
	}
	if (gitflowConfig) {
		scores.gitflow += 20;
		evidence.push("gitflow config present");
	}

	return { scores, evidence };
}

// Dimension 4 — release tag pattern. A generic signal: SemVer tags nudge every
// workflow equally, so this raises absolute confidence without skewing which
// workflow wins.
function analyzeReleasePattern(targetRoot) {
	const scores = emptyScores();
	const evidence = [];

	const tagsOut = gitOutput(targetRoot, ["tag"]);
	if (tagsOut) {
		const tags = tagsOut
			.split("\n")
			.map((t) => t.trim())
			.filter(Boolean);
		if (tags.some((t) => /^v?\d+\.\d+\.\d+/.test(t))) {
			scores.gitflow += 5;
			scores["github-flow"] += 5;
			scores["trunk-based"] += 5;
			evidence.push("semver release tags present");
		}
	}

	return { scores, evidence };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function calculateWeightedScores(dimensions) {
	const final = emptyScores();
	for (const dim of dimensions) {
		for (const wf of WORKFLOWS) {
			final[wf] += dim.scores[wf] || 0;
		}
	}
	for (const wf of WORKFLOWS) {
		final[wf] = Math.min(100, final[wf]);
	}
	return final;
}

function getTopWorkflow(scores) {
	let top = WORKFLOWS[0];
	for (const wf of WORKFLOWS) {
		if (scores[wf] > scores[top]) top = wf;
	}
	return top;
}

function calculateConfidence(scores) {
	const ranked = WORKFLOWS.map((wf) => scores[wf]).sort((a, b) => b - a);
	const top = ranked[0];
	const second = ranked[1] || 0;
	if (top >= 60 && top - second > 20) return "high";
	if (top >= 40 && top - second > 10) return "medium";
	return "low";
}

function detectGitWorkflow(target) {
	const targetRoot = resolveTarget(target);
	if (!isGitRepository(targetRoot)) return null;

	const dimensions = [
		analyzeBranchPattern(targetRoot),
		analyzeCommitHistory(targetRoot),
		analyzeConfigFiles(targetRoot),
		analyzeReleasePattern(targetRoot),
	];
	const scores = calculateWeightedScores(dimensions);

	return {
		detected: getTopWorkflow(scores),
		confidence: calculateConfidence(scores),
		scores,
		evidence: dimensions.flatMap((dim) => dim.evidence),
	};
}

module.exports = {
	detectGitWorkflow,
	isGitRepository,
	analyzeBranchPattern,
	analyzeCommitHistory,
	analyzeConfigFiles,
	analyzeReleasePattern,
	calculateWeightedScores,
	getTopWorkflow,
	calculateConfidence,
};
