#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const ALLOWED_NAME = "Bandersnatch0x";
const ALLOWED_EMAILS = new Set([
	"xihalele@gmail.com",
	"13325067+bandersnatch0x@users.noreply.github.com",
]);

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

function validateIdentities(identities) {
	return identities.filter(
		(identity) =>
			identity.name !== ALLOWED_NAME || !ALLOWED_EMAILS.has(identity.email.toLowerCase()),
	);
}

function formatFailure(invalid) {
	const lines = ["Git identity check failed:"];
	for (const identity of invalid) {
		lines.push(`  ${identity.scope} ${identity.role}: ${identity.name} <${identity.email}>`);
	}
	lines.push("");
	lines.push(`Required name: ${ALLOWED_NAME}`);
	lines.push(`Allowed emails: ${[...ALLOWED_EMAILS].join(", ")}`);
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
		let identities;
		if (args.mode === "current") {
			identities = currentIdentities(cwd);
		} else if (args.mode === "commit") {
			identities = commitIdentities(args.revision, cwd, runGit, { single: true });
		} else {
			identities = commitIdentities(args.revision, cwd);
		}
		const invalid = validateIdentities(identities);

		if (invalid.length > 0) {
			console.error(formatFailure(invalid));
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
	ALLOWED_EMAILS,
	ALLOWED_NAME,
	commitIdentities,
	currentIdentities,
	formatFailure,
	main,
	parseArgs,
	parseGitIdent,
	validateIdentities,
};
