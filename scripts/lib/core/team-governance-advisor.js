"use strict";

// Team governance advisor.
//
// Turns repository signals (contributor count, existing .gitignore, existing
// CONTRIBUTING / PR template) into governance recommendations scaled to team
// size: a code-review strategy, a .gitignore policy for personal Amber state,
// and which consensus docs to author. Pure/deterministic except for the single
// git call in analyzeTeamSize, which degrades to a count of 0 on any failure.

const path = require("node:path");

const { pathExists, readText, resolveTarget } = require("./fs-utils");
const { gitOutput } = require("./git-exec");

// Personal, per-developer Amber state that should not be committed to a shared
// repository. The advisor flags any of these not already covered by .gitignore.
const PERSONAL_PATTERNS = [
	".amber/sessions/",
	"PROGRESS.md",
	"session-handoff.md",
	"notes.md",
];

const REQUIRED_DOCS = [
	"docs/wiki/product/overview.md",
	"docs/wiki/engineering/verification.md",
];

const CODE_REVIEW = {
	single: {
		strategy:
			"Single-contributor project — run `amber session verify` to self-verify after a feature.",
		tooling: ["amber session verify"],
	},
	small: {
		strategy: "At least 1 reviewer; use `amber review` to assist.",
		tooling: ["amber review", "PR template: reference the Amber session ID"],
	},
	medium: {
		strategy: "At least 2 reviewers; domain experts review critical modules.",
		tooling: ["amber session approve --gate code-review"],
	},
	large: {
		strategy: "CODEOWNERS per module; critical paths need 2+ approvals.",
		tooling: ["CODEOWNERS", "amber doctor in CI"],
	},
};

function categorize(count) {
	if (count <= 1) return "single";
	if (count <= 5) return "small";
	if (count <= 15) return "medium";
	return "large";
}

// Count distinct commit authors. `git log --format=%ae` is used instead of
// `git shortlog`, which reads from stdin when not attached to a TTY and would
// hang under a non-interactive child process. Absent git / zero commits -> 0.
function analyzeTeamSize(targetRoot) {
	const out = gitOutput(resolveTarget(targetRoot), [
		"log",
		"--all",
		"--no-merges",
		"--format=%ae",
	]);
	const count = out
		? new Set(out.split("\n").map((line) => line.trim()).filter(Boolean)).size
		: 0;
	return { count, category: categorize(count) };
}

function readGitignore(targetRoot) {
	const p = path.join(resolveTarget(targetRoot), ".gitignore");
	if (!pathExists(p)) return "";
	try {
		return readText(p);
	} catch {
		return "";
	}
}

function checkPRTemplate(targetRoot) {
	const root = resolveTarget(targetRoot);
	return [
		path.join(root, ".github", "pull_request_template.md"),
		path.join(root, ".github", "PULL_REQUEST_TEMPLATE.md"),
	].some((p) => pathExists(p));
}

// workflowDetection is accepted for future workflow-specific tuning and may be
// null; it is intentionally not dereferenced here.
function generateCodeReviewAdvice(teamMetrics, _workflowDetection) {
	const base = CODE_REVIEW[teamMetrics.category] || CODE_REVIEW.single;
	return { strategy: base.strategy, tooling: [...base.tooling] };
}

// A gitignore line covers a pattern when it matches exactly, or when it is a
// parent directory rule — `.amber/` (or `.amber`) covers `.amber/sessions/`.
function isCovered(pattern, rules) {
	return rules.some((rule) => {
		if (rule === pattern) return true;
		const dir = rule.endsWith("/") ? rule : `${rule}/`;
		return pattern.startsWith(dir);
	});
}

function generateGitignoreAdvice(gitignoreContent) {
	const rules = String(gitignoreContent || "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	const missing = PERSONAL_PATTERNS.filter(
		(pattern) => !isCovered(pattern, rules),
	);
	const patch = missing.length
		? `# Amber personal state\n${missing.join("\n")}\n`
		: "";
	return { missing, patch };
}

// Consensus docs to author, keyed by team size. `required` is the must-have
// baseline; `recommended` scales up with team size. CONTRIBUTING.md is filtered
// out of `recommended` when the repo already has one.
const DOC_ADVICE = {
	single: { recommended: ["CONTRIBUTING.md"] },
	small: { recommended: ["CONTRIBUTING.md"] },
	medium: {
		recommended: [
			"docs/wiki/architecture/module-boundaries.md",
			"CONTRIBUTING.md",
			"docs/wiki/agent/working-rules.md",
		],
	},
	large: {
		recommended: [
			"docs/wiki/architecture/decisions/",
			"docs/wiki/engineering/release.md",
			"per-module CLAUDE.md",
		],
	},
};

function generateDocAdvice(teamMetrics, existingConfig) {
	const entry = DOC_ADVICE[teamMetrics.category] || DOC_ADVICE.single;
	let recommended = [...entry.recommended];
	if (existingConfig && existingConfig.hasContributing) {
		recommended = recommended.filter((doc) => doc !== "CONTRIBUTING.md");
	}
	return { required: [...REQUIRED_DOCS], recommended };
}

function generateGovernanceAdvice(targetRoot, workflowDetection) {
	const root = resolveTarget(targetRoot);
	const teamMetrics = analyzeTeamSize(root);
	const existingConfig = {
		hasContributing: pathExists(path.join(root, "CONTRIBUTING.md")),
		gitignoreContent: readGitignore(root),
		hasPRTemplate: checkPRTemplate(root),
	};

	return {
		teamSize: teamMetrics.category,
		contributors: teamMetrics.count,
		recommendations: {
			codeReview: generateCodeReviewAdvice(teamMetrics, workflowDetection || null),
			gitignore: generateGitignoreAdvice(existingConfig.gitignoreContent),
			documentation: generateDocAdvice(teamMetrics, existingConfig),
		},
	};
}

module.exports = {
	generateGovernanceAdvice,
	analyzeTeamSize,
	readGitignore,
	checkPRTemplate,
	generateCodeReviewAdvice,
	generateGitignoreAdvice,
	generateDocAdvice,
};
