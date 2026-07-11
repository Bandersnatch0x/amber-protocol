#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "quality", "external-adoption-evidence.json");

function get(url) {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let d = "";
				res.on("data", (c) => (d += c));
				res.on("end", () => resolve(d));
			})
			.on("error", reject);
	});
}

function walk(dir, acc = []) {
	if (!fs.existsSync(dir)) return acc;
	for (const f of fs.readdirSync(dir)) {
		const p = path.join(dir, f);
		const st = fs.statSync(p);
		if (st.isDirectory()) walk(p, acc);
		else if (/adoption/i.test(f) && f.endsWith(".md")) {
			acc.push(path.relative(ROOT, p).split(path.sep).join("/"));
		}
	}
	return acc;
}

async function main() {
	const out = { collectedAt: new Date().toISOString() };
	out.githubSummary = JSON.parse(
		execSync(
			'gh api repos/Bandersnatch0x/amber-protocol --jq "{stars:.stargazers_count,forks:.forks_count,open_issues:.open_issues_count,watchers:.subscribers_count,created:.created_at,pushed:.pushed_at}"',
			{ encoding: "utf8" },
		),
	);
	const issues = JSON.parse(
		execSync(
			"gh issue list --repo Bandersnatch0x/amber-protocol --state all --limit 100 --json number,title,author,createdAt",
			{ encoding: "utf8" },
		),
	);
	out.issueAuthors = [
		...new Set(issues.map((i) => i.author && i.author.login).filter(Boolean)),
	];
	out.externalIssues = issues.filter(
		(i) => i.author && !["Bandersnatch0x", "summersong"].includes(i.author.login),
	);
	out.issueCount = issues.length;
	try {
		out.npmVersion = execSync("npm view amber-protocol version", { encoding: "utf8" }).trim();
	} catch {
		out.npmVersion = null;
	}
	try {
		out.npmDownloadsLastMonth = JSON.parse(
			await get("https://api.npmjs.org/downloads/point/last-month/amber-protocol"),
		);
	} catch (e) {
		out.npmDlErr = e.message;
	}
	try {
		out.npmDownloadsLastWeek = JSON.parse(
			await get("https://api.npmjs.org/downloads/point/last-week/amber-protocol"),
		);
	} catch {
		/* optional */
	}
	out.adoptionArtifacts = walk(path.join(ROOT, "docs", "examples"));
	// Product dogfood signals
	const sess = path.join(ROOT, ".amber", "sessions");
	out.localProductSessions = fs.existsSync(sess) ? fs.readdirSync(sess).length : 0;
	out.assessment = {
		independentTargetReposWithRepeatedRealUse: 0,
		realTasksOutsideProductDogfood: 0,
		adoptionReportsAreReadOnlyAuditsNotUsage: true,
		interest: {
			stars: out.githubSummary.stars,
			forks: out.githubSummary.forks,
			npmVersion: out.npmVersion,
			downloadsLastMonth:
				out.npmDownloadsLastMonth && out.npmDownloadsLastMonth.downloads,
			downloadsLastWeek:
				out.npmDownloadsLastWeek && out.npmDownloadsLastWeek.downloads,
		},
		externalIssueAuthors: out.externalIssues.length,
		meets2Repo10TaskBar: false,
		note:
			"Adoption reports under docs/examples are generator outputs against local paths (read-only audit), not evidence of sustained multi-task use by independent teams. Stars/downloads are interest signals only per map Notes.",
	};
	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
	console.log(JSON.stringify({ github: out.githubSummary, assessment: out.assessment }, null, 2));
	console.log("Wrote", OUT);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
