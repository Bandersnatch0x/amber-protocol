#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const ALLOWED_NAME = "Bandersnatch0x";
const GITHUB_MERGE_AUTHOR_EMAIL = "13325067+bandersnatch0x@users.noreply.github.com";
const GITHUB_COMMITTER_NAME = "GitHub";
const GITHUB_COMMITTER_EMAIL = "noreply@github.com";
const ALLOWED_EMAILS = new Set(["xihalele@gmail.com", GITHUB_MERGE_AUTHOR_EMAIL]);

/**
 * Trusted automation identities allowed only when validating already-made
 * commits (`--range` / `--commit`), so Dependabot PRs and GitHub-authored bot
 * commits can pass CI. Local pre-commit (`current` mode) stays human-only.
 *
 * Each entry is an exact name+email pair (email match is case-insensitive).
 */
const ALLOWED_BOT_IDENTITIES = [
	{
		name: "dependabot[bot]",
		email: "49699333+dependabot[bot]@users.noreply.github.com",
	},
	// Dependabot commits are often authored by the bot and committed by GitHub.
	{ name: GITHUB_COMMITTER_NAME, email: GITHUB_COMMITTER_EMAIL },
	{
		name: "github-actions[bot]",
		email: "41898282+github-actions[bot]@users.noreply.github.com",
	},
];

function isHumanIdentity(identity) {
	return identity.name === ALLOWED_NAME && ALLOWED_EMAILS.has(identity.email.toLowerCase());
}

function isBotIdentity(identity) {
	const email = identity.email.toLowerCase();
	return ALLOWED_BOT_IDENTITIES.some(
		(bot) => bot.name === identity.name && bot.email.toLowerCase() === email,
	);
}

/**
 * GitHub writes the account's profile display name into the author field of a
 * web-created merge commit. The email and GitHub committer are still exact,
 * and the commit must have at least two parents; this is not a second human
 * identity.
 */
function isGitHubMergeAuthor(identity, commit) {
	return (
		identity.role === "author" &&
		String(identity.email).toLowerCase() === GITHUB_MERGE_AUTHOR_EMAIL &&
		Array.isArray(commit?.parents) &&
		commit.parents.length >= 2 &&
		commit.committer?.name === GITHUB_COMMITTER_NAME &&
		String(commit.committer?.email).toLowerCase() === GITHUB_COMMITTER_EMAIL
	);
}

function runGit(args, cwd = process.cwd()) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(`Unable to run git: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const detail = String(result.stderr || result.stdout || "unknown git error").trim();
		throw new Error(`git ${args.join(" ")} failed: ${detail}`);
	}

	return result.stdout;
}

function parseGitIdent(value, role) {
	const match = String(value)
		.trim()
		.match(/^(.*) <([^<>]+)> \d+ [+-]\d{4}$/);
	if (!match) {
		throw new Error(`Unable to parse effective Git ${role} identity: ${String(value).trim()}`);
	}

	return {
		scope: "current commit",
		role,
		name: match[1],
		email: match[2],
	};
}

function currentIdentities(cwd = process.cwd(), git = runGit) {
	return [
		parseGitIdent(git(["var", "GIT_AUTHOR_IDENT"], cwd), "author"),
		parseGitIdent(git(["var", "GIT_COMMITTER_IDENT"], cwd), "committer"),
	];
}

function commitIdentityBatch(revision, cwd = process.cwd(), git = runGit, options = {}) {
	const format = "%H%x09%P%x09%an%x09%ae%x09%cn%x09%ce";
	const logArgs = ["log", `--format=${format}`];
	if (options.single) {
		logArgs.push("-1");
	}
	logArgs.push(revision);
	const output = git(logArgs, cwd).trim();
	const commitContextByScope = new Map();
	if (!output) return { identities: [], commitContextByScope };

	const identities = output.split(/\r?\n/).flatMap((line) => {
		const [commit, parentField, authorName, authorEmail, committerName, committerEmail] =
			line.split("\t");
		if (!commit || committerEmail === undefined) {
			throw new Error(`Unable to parse Git identity metadata for revision ${revision}.`);
		}

		const scope = `commit ${commit}`;
		const commitContext = {
			parents: parentField ? parentField.trim().split(/\s+/).filter(Boolean) : [],
			committer: { name: committerName, email: committerEmail },
		};
		const author = { scope, role: "author", name: authorName, email: authorEmail };
		const committer = {
			scope,
			role: "committer",
			name: committerName,
			email: committerEmail,
		};
		commitContextByScope.set(scope, commitContext);
		return [author, committer];
	});
	return { identities, commitContextByScope };
}

function commitIdentities(revision, cwd = process.cwd(), git = runGit, options = {}) {
	return commitIdentityBatch(revision, cwd, git, options).identities;
}

function validateIdentities(identities, options = {}) {
	const allowBots = options.allowBots === true;
	const allowGitHubMergeAuthors = options.allowGitHubMergeAuthors === true;
	const commitContextByScope = options.commitContextByScope;
	return identities.filter((identity) => {
		if (isHumanIdentity(identity)) return false;
		if (allowBots && isBotIdentity(identity)) return false;
		const commitContext =
			commitContextByScope instanceof Map ? commitContextByScope.get(identity.scope) : undefined;
		if (allowGitHubMergeAuthors && isGitHubMergeAuthor(identity, commitContext)) return false;
		return true;
	});
}

function formatFailure(invalid, options = {}) {
	const allowBots = options.allowBots === true;
	const allowGitHubMergeAuthors = options.allowGitHubMergeAuthors === true;
	const lines = ["Git identity check failed:"];
	for (const identity of invalid) {
		lines.push(`  ${identity.scope} ${identity.role}: ${identity.name} <${identity.email}>`);
	}
	lines.push("");
	lines.push(`Required name: ${ALLOWED_NAME}`);
	lines.push(`Allowed emails: ${[...ALLOWED_EMAILS].join(", ")}`);
	if (allowBots) {
		lines.push("Allowed automation (exact name+email pairs):");
		for (const bot of ALLOWED_BOT_IDENTITIES) {
			lines.push(`  ${bot.name} <${bot.email}>`);
		}
	}
	if (allowGitHubMergeAuthors) {
		lines.push(
			"Allowed GitHub merge author: repository noreply email on a commit with at least two parents committed by GitHub.",
		);
	}
	lines.push("");
	lines.push(`Fix this repository with:`);
	lines.push(`  git config --local user.name "${ALLOWED_NAME}"`);
	lines.push('  git config --local user.email "xihalele@gmail.com"');
	return lines.join("\n");
}

function parseArgs(argv) {
	if (argv.length === 0) return { mode: "current" };
	if (argv.length === 2 && argv[0] === "--range") {
		return { mode: "range", revision: argv[1] };
	}
	if (argv.length === 2 && argv[0] === "--commit") {
		return { mode: "commit", revision: argv[1] };
	}
	throw new Error(
		[
			"Usage: validate-git-identity.js [--range <rev-list> | --commit <revision>]",
			"  (no args)     validate effective author/committer for the next commit",
			"  --range <rev>  validate author/committer for every commit in a git rev-list (e.g. base..head)",
			"  --commit <rev> validate author/committer for exactly one revision (git log -1)",
		].join("\n"),
	);
}

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
	try {
		const args = parseArgs(argv);
		// Local pre-commit validates the next human commit only.
		// CI range/commit modes also accept known automation identities and the
		// structural GitHub merge-author exception; local pre-commit stays strict.
		const allowBots = args.mode !== "current";
		const allowGitHubMergeAuthors = args.mode !== "current";
		let identities;
		let commitContextByScope;
		if (args.mode === "current") {
			identities = currentIdentities(cwd);
		} else {
			const batch = commitIdentityBatch(args.revision, cwd, runGit, {
				single: args.mode === "commit",
			});
			identities = batch.identities;
			commitContextByScope = batch.commitContextByScope;
		}
		const validationOptions = { allowBots, allowGitHubMergeAuthors, commitContextByScope };
		const invalid = validateIdentities(identities, validationOptions);

		if (invalid.length > 0) {
			console.error(formatFailure(invalid, validationOptions));
			return 1;
		}

		const subject = args.mode === "current" ? "effective commit identity" : args.revision;
		console.log(`Git identity check passed for ${subject}.`);
		return 0;
	} catch (error) {
		console.error(`Git identity check could not run: ${error.message}`);
		return 1;
	}
}

if (require.main === module) {
	process.exitCode = main();
}

module.exports = {
	ALLOWED_BOT_IDENTITIES,
	ALLOWED_EMAILS,
	ALLOWED_NAME,
	commitIdentityBatch,
	commitIdentities,
	currentIdentities,
	formatFailure,
	isBotIdentity,
	isHumanIdentity,
	main,
	parseArgs,
	parseGitIdent,
	validateIdentities,
};
