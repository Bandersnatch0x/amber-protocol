#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const ALLOWED_NAME = "Bandersnatch0x";
const ALLOWED_EMAILS = new Set([
	"xihalele@gmail.com",
	"13325067+bandersnatch0x@users.noreply.github.com",
]);

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
	{ name: "GitHub", email: "noreply@github.com" },
	{
		name: "github-actions[bot]",
		email: "41898282+github-actions[bot]@users.noreply.github.com",
	},
];

function isHumanIdentity(identity) {
	return (
		identity.name === ALLOWED_NAME && ALLOWED_EMAILS.has(identity.email.toLowerCase())
	);
}

function isBotIdentity(identity) {
	const email = identity.email.toLowerCase();
	return ALLOWED_BOT_IDENTITIES.some(
		(bot) => bot.name === identity.name && bot.email.toLowerCase() === email,
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

function commitIdentities(revision, cwd = process.cwd(), git = runGit, options = {}) {
	const format = "%H%x09%an%x09%ae%x09%cn%x09%ce";
	const logArgs = ["log", `--format=${format}`];
	if (options.single) {
		logArgs.push("-1");
	}
	logArgs.push(revision);
	const output = git(logArgs, cwd).trim();
	if (!output) return [];

	return output.split(/\r?\n/).flatMap((line) => {
		const [commit, authorName, authorEmail, committerName, committerEmail] = line.split("\t");
		if (!commit || committerEmail === undefined) {
			throw new Error(`Unable to parse Git identity metadata for revision ${revision}.`);
		}

		const scope = `commit ${commit}`;
		return [
			{ scope, role: "author", name: authorName, email: authorEmail },
			{ scope, role: "committer", name: committerName, email: committerEmail },
		];
	});
}

function validateIdentities(identities, options = {}) {
	const allowBots = options.allowBots === true;
	return identities.filter((identity) => {
		if (isHumanIdentity(identity)) return false;
		if (allowBots && isBotIdentity(identity)) return false;
		return true;
	});
}

function formatFailure(invalid, options = {}) {
	const allowBots = options.allowBots === true;
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
		// CI range/commit modes also accept known automation authors (Dependabot, etc.).
		const allowBots = args.mode !== "current";
		let identities;
		if (args.mode === "current") {
			identities = currentIdentities(cwd);
		} else if (args.mode === "commit") {
			identities = commitIdentities(args.revision, cwd, runGit, { single: true });
		} else {
			identities = commitIdentities(args.revision, cwd);
		}
		const invalid = validateIdentities(identities, { allowBots });

		if (invalid.length > 0) {
			console.error(formatFailure(invalid, { allowBots }));
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
