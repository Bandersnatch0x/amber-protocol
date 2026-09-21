"use strict";

// `amber ledger seal` + `verify-anchoring` — anchor ledger tail hashes into
// git history via an annotated tag. Closes the ADR-0003 self-admitted gap:
// "hash chain detects tampering but does not prevent a full-file rewrite
// (that needs external anchoring)." After sealing, forging a ledger requires
// rewriting git tag history too. Human-triggered; no push; no scheduling.
const fs = require("node:fs");
const { resolveTarget } = require("./fs-utils");
const { walkLedgers, readLedger } = require("./loop-ledger");
const { resolveStateDirForRead } = require("../state-dir-resolver");
// §5.5 row 6 split (governance contract G-9): the seal/verify LOGIC is
// Core; the git EXECUTION source is Adapter-injected. Default reader: the
// Coding domain adapter's git-exec seam — loaded lazily so tests (and any
// future non-Coding domain) inject via setGitAdapter. Core never imports
// git-exec at module load (guard G1/G8).
let gitAdapter = null;
function defaultGitAdapter() {
	if (gitAdapter === null) {
		gitAdapter = require("./git-exec");
	}
	return gitAdapter;
}

/**
 * Test/adapter seam: inject the git runner ({gitOutput, gitRun}). Pass null
 * to restore the default lazy Coding-domain reader.
 */
function setGitAdapter(adapter) {
	gitAdapter = adapter;
}

const SEAL_PREFIX = "amber-ledger-seal-";

function collectTails(targetRoot) {
	const stateDirAbs = resolveStateDirForRead(targetRoot, { quiet: true });
	if (!fs.existsSync(stateDirAbs)) return { stateDir: null, tails: [] };
	const tails = [];
	walkLedgers(stateDirAbs, ({ home, sub, ledgerPath }) => {
		const records = readLedger(ledgerPath);
		const tail = records.length ? records[records.length - 1].hash : null;
		tails.push({ home, sub, tailHash: tail, recordCount: records.length });
	});
	return { stateDir: stateDirAbs, tails };
}

function sealLedger(target, options = {}) {
	const targetRoot = resolveTarget(target);
	if (!defaultGitAdapter().gitOutput(targetRoot, ["rev-parse", "--is-inside-work-tree"])) {
		return { target: targetRoot, sealed: false, errors: ["not a git repository"], warnings: [] };
	}
	const { stateDir, tails } = collectTails(targetRoot);
	if (!stateDir) {
		return {
			target: targetRoot,
			sealed: false,
			errors: ["no Amber state directory"],
			warnings: [],
		};
	}
	const head = defaultGitAdapter().gitOutput(targetRoot, ["rev-parse", "HEAD"]);
	const headShort = head ? head.slice(0, 12) : "no-head";
	const tagName = `${SEAL_PREFIX}${headShort}`;
	const message = JSON.stringify({ reviewer: options.reviewer || null, ledgers: tails });
	const res = defaultGitAdapter().gitRun(targetRoot, ["tag", "-f", "-a", tagName, "-m", message]);
	if (!res.ok) {
		return {
			target: targetRoot,
			sealed: false,
			errors: [`failed to create seal tag: ${res.stderr || "git error"}`],
			warnings: [],
		};
	}
	return {
		target: targetRoot,
		sealed: true,
		tagName,
		head: headShort,
		ledgerCount: tails.length,
		errors: [],
		warnings: [],
	};
}

function latestSealTag(targetRoot) {
	const list = defaultGitAdapter().gitOutput(targetRoot, [
		"tag",
		"-l",
		`${SEAL_PREFIX}*`,
		"--sort=-creatordate",
	]);
	if (!list) return null;
	return (
		list
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean)[0] || null
	);
}

function readSealMessage(targetRoot, tagName) {
	return defaultGitAdapter().gitOutput(targetRoot, ["tag", "-l", "--format=%(contents)", tagName]);
}

function verifyAnchoring(target) {
	const targetRoot = resolveTarget(target);
	const tagName = latestSealTag(targetRoot);
	if (!tagName) {
		return {
			target: targetRoot,
			anchored: false,
			errors: ["no seal tag found — run `amber ledger seal`"],
			warnings: [],
		};
	}
	const msg = readSealMessage(targetRoot, tagName);
	let sealed;
	try {
		sealed = JSON.parse(msg);
	} catch {
		return {
			target: targetRoot,
			anchored: false,
			sealTag: tagName,
			errors: ["seal tag message is not valid JSON"],
			warnings: [],
		};
	}
	const current = collectTails(targetRoot).tails;
	const byKey = new Map(current.map((t) => [`${t.home}/${t.sub}`, t]));
	const drift = [];
	for (const sealedTail of sealed.ledgers || []) {
		const key = `${sealedTail.home}/${sealedTail.sub}`;
		const cur = byKey.get(key);
		if (!cur) {
			drift.push({ home: sealedTail.home, sub: sealedTail.sub, status: "ledger-removed" });
		} else if (cur.tailHash !== sealedTail.tailHash) {
			drift.push({
				home: sealedTail.home,
				sub: sealedTail.sub,
				status: "tail-changed",
				sealedTail: sealedTail.tailHash,
				currentTail: cur.tailHash,
			});
		}
	}
	return {
		target: targetRoot,
		anchored: drift.length === 0,
		sealTag: tagName,
		ledgerChangedSinceSeal: drift.length,
		drift,
		errors: [],
		warnings: [],
	};
}

module.exports = { sealLedger, verifyAnchoring, collectTails, SEAL_PREFIX, setGitAdapter };
