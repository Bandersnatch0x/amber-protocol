"use strict";

// Terminal release assertion. The v1.3.1 incident (#46): a release tag was
// created locally but never pushed, so the publish workflow never fired and
// the version silently never reached the registry — for 8 days. The root
// cause lives BEFORE the workflow (a missed `git push origin <tag>`), so the
// check cannot live inside the workflow: it must run at the end of the
// release flow, against reality.
//
// Asserts two invariants over stable tags (vX.Y.Z, no prerelease suffix):
//   1. every local stable tag exists on the remote        (v1.3.1's failure)
//   2. every remote stable tag has a published version    (silent-skip class)
//
// Run via `npm run release:verify` after pushing the release tag and waiting
// for the publish workflow. Requires `gh` (authenticated) for the registry.
//
// ponytail: runbook-invoked only, not wired into CI — a CI check racing an
// in-flight publish would false-red; add a debounced CI sweep if a ghost
// ever slips past the runbook again.

const { execFileSync } = require("node:child_process");

const STABLE_TAG = /^v\d+\.\d+\.\d+$/;

function stableTags(tags) {
	return tags.filter((t) => STABLE_TAG.test(t));
}

// Compare bare X.Y.Z strings numerically. Inputs are pre-filtered to stable
// three-part versions, so every segment is a number.
function cmpVer(a, b) {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

// Local stable tags missing from the remote — the v1.3.1 failure mode.
function findUnpushedTags(localTags, remoteTags) {
	const remote = new Set(stableTags(remoteTags));
	return stableTags(localTags).filter((t) => !remote.has(t));
}

// Remote stable tags whose version never landed in the registry. Tags older
// than the earliest published version predate the publish workflow (v1.0.0 /
// v1.0.1 here) and are exempt — otherwise the check is permanently red and
// stops meaning anything.
function findGhostTags(remoteTags, registryVersions) {
	if (registryVersions.length === 0) return [];
	const published = new Set(registryVersions);
	const floor = [...registryVersions].sort(cmpVer)[0];
	return stableTags(remoteTags)
		.map((t) => t.slice(1))
		.filter((v) => cmpVer(v, floor) >= 0 && !published.has(v))
		.map((v) => `v${v}`);
}

function sh(cmd, args) {
	return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function main() {
	const pkg = require("../package.json");
	const remoteUrl = sh("git", ["remote", "get-url", "origin"]);
	const owner = remoteUrl.match(/[:/]([^/]+)\/[^/]+?(?:\.git)?$/)?.[1];
	if (!owner) throw new Error(`Cannot parse owner from remote: ${remoteUrl}`);

	const localTags = sh("git", ["tag", "--list"]).split("\n").filter(Boolean);
	const remoteTags = sh("git", ["ls-remote", "--tags", "origin"])
		.split("\n")
		.map((line) => line.match(/refs\/tags\/(v[^^\s]+)$/)?.[1])
		.filter(Boolean);
	const registryVersions = sh("gh", [
		"api",
		"--paginate",
		`users/${owner}/packages/npm/${pkg.name}/versions`,
		"--jq",
		".[].name",
	])
		.split("\n")
		.filter(Boolean);

	const unpushed = findUnpushedTags(localTags, remoteTags);
	const ghosts = findGhostTags(remoteTags, registryVersions);

	if (unpushed.length === 0 && ghosts.length === 0) {
		console.log(
			`release:verify OK — ${stableTags(remoteTags).length} stable tags all published (latest registry: ${registryVersions[0] ?? "none"})`,
		);
		return 0;
	}
	for (const t of unpushed) {
		console.error(
			`GHOST RISK: local tag ${t} was never pushed — publish never triggered. Push it or delete it.`,
		);
	}
	for (const t of ghosts) {
		console.error(
			`GHOST: remote tag ${t} has no published ${t.slice(1)} in the registry. Re-run the publish workflow for it.`,
		);
	}
	return 1;
}

module.exports = { stableTags, findUnpushedTags, findGhostTags };

if (require.main === module) {
	process.exit(main());
}
