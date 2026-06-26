"use strict";

// Team governance advisor.
//
// Turns repository signals (contributor count, existing .gitignore, existing
// CONTRIBUTING / PR template) into governance recommendations scaled to team
// size: a code-review strategy, a .gitignore policy for personal Amber state,
// and which consensus docs to author. Pure/deterministic except for the single
// git call in analyzeTeamSize, which degrades to a count of 0 on any failure.

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { pathExists, readText, resolveTarget } = require("./fs-utils");

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
// `git shortlog` because shortlog reads from stdin when not attached to a TTY,
// which would hang under spawnSync. Any failure (no git, zero commits) -> 0.
function analyzeTeamSize(targetRoot) {
	const root = resolveTarget(targetRoot);
	let count = 0;
	try {
		const res = spawnSync(
			"git",
			["log", "--all", "--no-merges", "--format=%ae"],
			{ cwd: root, encoding: "utf8" },
		);
		if (res && res.status === 0 && typeof res.stdout === "string") {
			const emails = res.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			count = new Set(emails).size;
		}
	} catch {
		count = 0;
	}
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
function generateCodeReviewAdvice(teamMetrics, workflowDetection) {
	const base = CODE_REVIEW[teamMetrics.category] || CODE_REVIEW.single;
	return { strategy: base.strategy, tooling: [...base.tooling] };
}

function generateGitignoreAdvice(gitignoreContent) {
	const covered = new Set(
		String(gitignoreContent || "")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#")),
	);
	const missing = PERSONAL_PATTERNS.filter((pattern) => !covered.has(pattern));
	const patch = missing.length
		? `# Amber personal state\n${missing.join("\n")}\n`
		: "";
	return { missing, patch };
}

function generateDocAdvice(teamMetrics, existingConfig) {
	const required = [...REQUIRED_DOCS];
	let recommended;
	if (teamMetrics.category === "medium") {
		recommended = [
			"docs/wiki/architecture/module-boundaries.md",
			"CONTRIBUTING.md",
			"docs/wiki/agent/working-rules.md",
		];
	} else if (teamMetrics.category === "large") {
		recommended = [
			"docs/wiki/architecture/decisions/",
			"docs/wiki/engineering/release.md",
			"per-module CLAUDE.md",
		];
	} else {
		recommended = ["CONTRIBUTING.md"];
	}
	if (existingConfig && existingConfig.hasContributing) {
		recommended = recommended.filter((doc) => doc !== "CONTRIBUTING.md");
	}
	return { required, recommended };
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
