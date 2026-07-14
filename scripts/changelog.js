"use strict";

/**
 * Zero-dependency CHANGELOG generator driven by conventional commits.
 *
 * Philosophy (per repo preference and AGENTS/CLAUDE): extend the existing
 * zero-dep script approach (see sync-version.js, verify-release.js). No
 * release-please, no new runtime deps, pure Node built-ins + git.
 *
 * Release constraints honored here (documented for users):
 *   - Publishes exclusively via GitHub Packages (see .github/workflows/publish-github-packages.yml)
 *   - `npm run version:sync` is mandatory in release prep (syncs plugin manifests)
 *   - `npm run release:verify` is the terminal gate after tag push (guards #46 ghost-version class)
 *   - Prefer minimal (patch) version bumps for most releases.
 *
 * Conventional commit discipline is the source of truth:
 *   feat|fix|docs|chore|refactor|test|perf|ci(scope)!?: subject (#pr)
 *
 * Usage (release cut flow):
 *   1. (work landed as conventional commits)
 *   2. npm version --no-git-tag-version patch   # or minor/major as needed; minimal by preference
 *   3. npm run version:sync
 *   4. node scripts/changelog.js
 *   5. git add package.json .claude-plugin/plugin.json .codex-plugin/plugin.json CHANGELOG.md
 *   6. git commit -m "chore(release): vX.Y.Z"
 *   7. git tag -a vX.Y.Z -m "Release vX.Y.Z"
 *   8. git push origin master && git push origin vX.Y.Z
 *   9. (CI: tests + publish-github-packages)
 *  10. npm run release:verify
 *
 * The script is safe to re-run for the same version (replaces the section).
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

const STABLE_TAG_RE = /^v\d+\.\d+\.\d+$/;

function getPackageVersion(root = ROOT) {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	if (!pkg.version || typeof pkg.version !== "string") {
		throw new Error("package.json is missing a usable version field");
	}
	return pkg.version;
}

function getLatestStableTag(root = ROOT) {
	try {
		const out = execSync('git tag -l "v*"', {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!out) return null;
		const tags = out
			.split(/\r?\n/)
			.map((t) => t.trim())
			.filter((t) => STABLE_TAG_RE.test(t));
		if (tags.length === 0) return null;
		// descending semver
		tags.sort((a, b) => {
			const pa = a.slice(1).split(".").map(Number);
			const pb = b.slice(1).split(".").map(Number);
			return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
		});
		return tags[0];
	} catch {
		return null;
	}
}

function getCommitsSince(tag, root = ROOT) {
	// When no prior tag (first release / tagless repo), use empty range for
	// unbounded git log over full history. Using "HEAD" only ever surfaced
	// the single HEAD commit in the parsed result (see #53).
	const range = tag ? `${tag}..HEAD` : "";
	try {
		// %x00 is safe delimiter; capture subject + body for refs
		const format = "%H%x00%s%x00%b%x00%x00";
		const gitCmd = `git log --pretty=format:${format} --no-merges ${range}`.trim();
		const out = execSync(gitCmd, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 2 * 1024 * 1024,
		}).trim();
		if (!out) return [];
		// Robust token parse: git inserts \n between records + empty-body produces
		// extra \x00 so we walk the \x00-split tokens and skip empties / ws noise.
		const tokens = out.split("\x00");
		const commits = [];
		let i = 0;
		while (i < tokens.length) {
			let hash = (tokens[i++] || "").replace(/^\s+/, "");
			if (!hash || hash.length < 10) continue;
			let subject = (tokens[i++] || "").trim();
			let body = (tokens[i++] || "").trim();
			while (i < tokens.length && (tokens[i] === "" || tokens[i].trim() === "")) i++;
			if (subject) {
				commits.push({
					hash: hash.slice(0, 7),
					subject,
					body,
				});
			}
		}
		return commits;
	} catch {
		return [];
	}
}

function hasBreakingFooter(body) {
	// Conventional Commits: a "BREAKING CHANGE:" or "BREAKING-CHANGE:" footer
	// in the commit body signals a breaking change, independent of the subject.
	return /^BREAKING[ -]CHANGE:/m.test(body || "");
}

function parseConventional(subject, body = "") {
	// Supports: type(scope)!?: message
	// Breaking is indicated ONLY by `!` after the scope or a
	// "BREAKING CHANGE:" / "BREAKING-CHANGE:" footer in the body — NOT by the
	// word "BREAKING" appearing in the subject, which is usually descriptive
	// (e.g. "detect BREAKING CHANGE in footer") and caused a false-positive
	// when this generator first dogfooded itself (v1.3.3 release).
	const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
	if (!match) {
		return { type: "other", scope: null, breaking: false, subject };
	}
	const [, typeRaw, scope, bang, msg] = match;
	const type = typeRaw.toLowerCase();
	const breaking = Boolean(bang) || hasBreakingFooter(body);
	return {
		type,
		scope: scope || null,
		breaking,
		subject: msg.trim(),
	};
}

function extractReference(text) {
	// Look for (#123) style PR / issue reference
	const m = (text || "").match(/\(#(\d+)\)/);
	return m ? `#${m[1]}` : null;
}

function stripRef(text) {
	return (text || "").replace(/\s*\(#\d+\)\s*$/, "").trim();
}

function formatEntry(parsed, ref) {
	const prefix = parsed.scope ? `${parsed.scope}: ` : "";
	const cleanSubject = stripRef(parsed.subject);
	const base = `${prefix}${cleanSubject}`;
	return ref ? `${base} (${ref})` : base;
}

function groupCommits(commits) {
	const groups = {
		Added: [],
		Fixed: [],
		Changed: [],
		Other: [],
	};
	for (const c of commits) {
		const p = parseConventional(c.subject, c.body);
		const ref = extractReference(c.subject) || extractReference(c.body);
		let entry = formatEntry(p, ref);
		if (p.breaking) {
			entry = `**BREAKING** ${entry}`;
			groups.Changed.unshift(entry); // put breakings first in Changed
			continue;
		}
		switch (p.type) {
			case "feat":
				groups.Added.push(entry);
				break;
			case "fix":
				groups.Fixed.push(entry);
				break;
			case "refactor":
			case "perf":
			case "docs":
			case "test":
			case "chore":
			case "ci":
			case "style":
				groups.Changed.push(entry);
				break;
			default:
				groups.Other.push(entry);
		}
	}
	return groups;
}

function formatDate(d = new Date()) {
	return d.toISOString().slice(0, 10);
}

function formatReleaseSection(version, dateStr, groups) {
	let out = `## [${version}] - ${dateStr}\n\n`;
	const sections = [
		{ title: "Added", items: groups.Added },
		{ title: "Fixed", items: groups.Fixed },
		{ title: "Changed", items: groups.Changed },
		{ title: "Other", items: groups.Other },
	];
	let any = false;
	for (const s of sections) {
		if (s.items.length === 0) continue;
		any = true;
		out += `### ${s.title}\n`;
		for (const item of s.items) {
			out += `- ${item}\n`;
		}
		out += "\n";
	}
	if (!any) {
		out += "No notable changes.\n\n";
	}
	return out;
}

function updateChangelogFile(version, sectionText, changelogPath) {
	const target = changelogPath || CHANGELOG_PATH;
	let content = fs.readFileSync(target, "utf8");

	const header = `## [${version}] - `;
	const existingIdx = content.indexOf(header);

	if (existingIdx !== -1) {
		// Replace the existing section for this version (idempotent re-run support)
		// Find end of this section: next ## [ or end of file
		const afterHeader = existingIdx + header.length;
		let nextSection = content.indexOf("\n## [", afterHeader);
		if (nextSection === -1) nextSection = content.length;
		// include the trailing blank lines before next if any
		content =
			content.slice(0, existingIdx) +
			sectionText.trimEnd() +
			"\n\n" +
			content.slice(nextSection).trimStart();
	} else {
		// Insert as the new top release section, right after the file header + intro
		const firstRelease = content.indexOf("\n## [");
		if (firstRelease === -1) {
			// legacy or minimal file
			content = content.trimEnd() + "\n\n" + sectionText;
		} else {
			content =
				content.slice(0, firstRelease + 1) +
				"\n" +
				sectionText +
				content.slice(firstRelease + 1);
		}
	}

	fs.writeFileSync(target, content.endsWith("\n") ? content : content + "\n");
	return true;
}

function generateChangelog(opts = {}) {
	const root = opts.root || ROOT;
	const version = opts.version || getPackageVersion(root);
	const tag = getLatestStableTag(root);
	const commits = getCommitsSince(tag, root);
	const groups = groupCommits(commits);
	const dateStr = opts.date || formatDate();
	const section = formatReleaseSection(version, dateStr, groups);
	if (!opts.dryRun) {
		const changelogPath = path.join(root, "CHANGELOG.md");
		updateChangelogFile(version, section, changelogPath);
	}
	return { version, tag, commitCount: commits.length, groups, section };
}

function main() {
	const dry = process.argv.includes("--dry-run") || process.argv.includes("-n");
	const result = generateChangelog({ dryRun: dry });
	console.log(`changelog: v${result.version} (since ${result.tag || "start"}) — ${result.commitCount} commits`);
	if (result.commitCount === 0) {
		console.log("  (no new commits; section contains placeholder)");
	}
	if (dry) {
		console.log("\n--- generated section (dry-run, not written) ---\n");
	} else {
		console.log("\n--- generated section (written to CHANGELOG.md) ---\n");
	}
	console.log(result.section.trimEnd());
	if (dry) {
		console.log("\n(Re-run without --dry-run to write.)");
	}
}

if (require.main === module) {
	try {
		main();
	} catch (err) {
		console.error("ERROR:", err.message);
		process.exit(1);
	}
}

module.exports = {
	getPackageVersion,
	getLatestStableTag,
	getCommitsSince,
	parseConventional,
	hasBreakingFooter,
	groupCommits,
	formatReleaseSection,
	updateChangelogFile,
	generateChangelog,
};
