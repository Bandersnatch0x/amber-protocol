"use strict";

// `amber ledger seal` + `verify-anchoring` — anchor ledger tail hashes into
// git history via an annotated tag. Closes the ADR-0003 self-admitted gap:
// "hash chain detects tampering but does not prevent a full-file rewrite
// (that needs external anchoring)." After sealing, forging a ledger requires
// rewriting git tag history too. Human-triggered; no push; no scheduling.
const fs = require("node:fs");
const { resolveTarget } = require("./fs-utils");
const {
	walkLedgers,
	readLedger,
	verifyLedgerChain,
	adoptUnanchoredLedger,
} = require("./loop-ledger");
const { codedError } = require("./error-catalog");
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
		const verdict = verifyLedgerChain(ledgerPath);
		tails.push({
			home,
			sub,
			ledgerPath,
			tailHash: tail,
			recordCount: records.length,
			hashes: records.map((r) => r.hash),
			intact: verdict.intact,
			reason: verdict.intact ? null : verdict.reason,
		});
	});
	return { stateDir: stateDirAbs, tails };
}

// A sealed tail anchors a prefix: the current chain must still carry the
// sealed tail hash at the sealed position. Appending after a seal extends it.
function sealDrift(sealedLedgers, current) {
	const byKey = new Map(current.map((t) => [`${t.home}/${t.sub}`, t]));
	const drift = [];
	const extended = [];
	for (const sealedTail of sealedLedgers) {
		const { home, sub, tailHash, recordCount } = sealedTail;
		const cur = byKey.get(`${home}/${sub}`);
		if (!cur) {
			drift.push({ home, sub, status: "ledger-removed" });
		} else if (!cur.intact || (recordCount > 0 && cur.hashes[recordCount - 1] !== tailHash)) {
			drift.push({
				home,
				sub,
				status: "tail-changed",
				sealedTail: tailHash,
				currentTail: cur.tailHash,
			});
		} else if (cur.recordCount > recordCount) {
			extended.push({ home, sub, sealedCount: recordCount, currentCount: cur.recordCount });
		}
	}
	return { drift, extended };
}

function readLatestSeal(targetRoot) {
	const tagName = latestSealTag(targetRoot);
	if (!tagName) return { tagName: null, sealed: null };
	try {
		return { tagName, sealed: JSON.parse(readSealMessage(targetRoot, tagName)) };
	} catch {
		return { tagName, sealed: null };
	}
}

function sealLedger(target, options = {}) {
	const targetRoot = resolveTarget(target);
	if (!defaultGitAdapter().gitOutput(targetRoot, ["rev-parse", "--is-inside-work-tree"])) {
		return {
			target: targetRoot,
			sealed: false,
			errors: ["not a git repository"],
			warnings: [],
			adopted: [],
		};
	}
	const { stateDir, tails } = collectTails(targetRoot);
	if (!stateDir) {
		return {
			target: targetRoot,
			sealed: false,
			errors: ["no Amber state directory"],
			warnings: [],
			adopted: [],
		};
	}
	const refuse = (reason) => ({
		target: targetRoot,
		sealed: false,
		errors: [codedError("AMBER_E_LEDGER_RESEAL_REFUSED", reason)],
		warnings: [],
		adopted: [],
	});
	// A chain whose hashes verify but whose anchor is gone is legacy, not tampered. Any
	// other failure is a real break and refuses the seal without adopting anything.
	const broken = tails.filter((t) => !t.intact && t.reason !== "anchor-missing");
	if (broken.length > 0) {
		return refuse(
			`ledger chain broken: ${broken.map((t) => `${t.home}/${t.sub} (${t.reason})`).join(", ")}`,
		);
	}
	const previous = readLatestSeal(targetRoot);
	if (previous.tagName) {
		if (!previous.sealed) return refuse(`seal tag ${previous.tagName} message is not valid JSON`);
		const { drift } = sealDrift(previous.sealed.ledgers || [], tails);
		if (drift.length > 0) {
			return refuse(
				`ledger(s) no longer extend seal ${previous.tagName}: ${drift.map((d) => `${d.home}/${d.sub} ${d.status}`).join(", ")}`,
			);
		}
	}
	const adopted = [];
	for (const t of tails) {
		if (t.intact) continue;
		const anchor = adoptUnanchoredLedger(t.ledgerPath);
		if (anchor) adopted.push({ home: t.home, sub: t.sub, recordCount: anchor.count });
		t.intact = true;
		t.reason = null;
	}
	const head = defaultGitAdapter().gitOutput(targetRoot, ["rev-parse", "HEAD"]);
	const headShort = head ? head.slice(0, 12) : "no-head";
	const tagName = `${SEAL_PREFIX}${headShort}`;
	const ledgers = tails.map(({ home, sub, tailHash, recordCount }) => ({
		home,
		sub,
		tailHash,
		recordCount,
	}));
	const message = JSON.stringify({ reviewer: options.reviewer || null, ledgers });
	const res = defaultGitAdapter().gitRun(targetRoot, ["tag", "-a", tagName, "-m", message]);
	if (!res.ok) return refuse(`git tag ${tagName} failed: ${res.stderr || "git error"}`);
	return {
		target: targetRoot,
		sealed: true,
		tagName,
		head: headShort,
		ledgerCount: tails.length,
		errors: [],
		warnings: [],
		adopted,
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
	const { tagName, sealed } = readLatestSeal(targetRoot);
	if (!tagName) {
		return {
			target: targetRoot,
			anchored: false,
			errors: ["no seal tag found — run `amber ledger seal`"],
			warnings: [],
		};
	}
	if (!sealed) {
		return {
			target: targetRoot,
			anchored: false,
			sealTag: tagName,
			errors: ["seal tag message is not valid JSON"],
			warnings: [],
		};
	}
	const { drift, extended } = sealDrift(sealed.ledgers || [], collectTails(targetRoot).tails);
	return {
		target: targetRoot,
		anchored: drift.length === 0,
		sealTag: tagName,
		ledgerChangedSinceSeal: drift.length,
		drift,
		extended,
		errors: [],
		warnings: [],
	};
}

module.exports = { sealLedger, verifyAnchoring, collectTails, SEAL_PREFIX, setGitAdapter };
