"use strict";

const fs = require("node:fs");

const { canonicalJson, sha256 } = require("./context-hash");
const { resolvePathWithin } = require("./fs-utils");
const { pagePath, readEvents } = require("./context-store");
const { statePathForCreate } = require("../state-dir-resolver");
const {
	summarizeFreshnessActivity,
	feedbackForPage,
	effectiveConfidence,
} = require("./context-freshness");

const EVIDENCE_SCHEMA_VERSION = "1.0.0";

// Verification evidence is a post-rename context-layer state kind: it never
// existed under .harness, so reads and creates both target the canonical dir
// (see the note in context-store.js).
function verificationDir(targetRoot) {
	return resolvePathWithin(targetRoot, statePathForCreate(targetRoot, "context", "verification"), {
		label: "Context verification evidence directory",
	});
}

function evidencePath(targetRoot, pageId) {
	return resolvePathWithin(
		targetRoot,
		statePathForCreate(targetRoot, "context", "verification", `${pageId}.json`),
		{
			label: "Context verification evidence file",
		},
	);
}

function hashPersistedPage(targetRoot, pageId) {
	const file = pagePath(targetRoot, pageId);
	if (!fs.existsSync(file)) return null;
	return sha256(fs.readFileSync(file, "utf8"));
}

function writeVerificationEvidence(targetRoot, pageId, details = {}) {
	const pageHash = hashPersistedPage(targetRoot, pageId);
	if (!pageHash) throw new Error(`cannot verify missing Context Page: ${pageId}`);
	const ingestEvent = details.ingestEvent;
	if (!ingestEvent || ingestEvent.kind !== "ingest" || ingestEvent.pageId !== pageId) {
		throw new Error(`accepted ingest event is required for Context Page: ${pageId}`);
	}
	const evidence = {
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		pageId,
		requestId: ingestEvent.requestId,
		outcome: ingestEvent.outcome,
		pageHash,
		ingestEventHash: sha256(canonicalJson(JSON.stringify(ingestEvent))),
		verifiedAt: ingestEvent.at,
	};
	fs.mkdirSync(verificationDir(targetRoot), { recursive: true });
	fs.writeFileSync(
		evidencePath(targetRoot, pageId),
		`${JSON.stringify(evidence, null, 2)}\n`,
		"utf8",
	);
	return evidence;
}

function readAcceptedEvidence(targetRoot, pageId, events = null) {
	const file = evidencePath(targetRoot, pageId);
	if (!fs.existsSync(file)) return null;
	let evidence;
	try {
		evidence = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	const matchingEvent = (events || readEvents(targetRoot)).find(
		(event) =>
			event.kind === "ingest" &&
			event.pageId === pageId &&
			event.requestId === evidence.requestId &&
			event.outcome === evidence.outcome &&
			event.at === evidence.verifiedAt,
	);
	if (
		evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION ||
		evidence.pageId !== pageId ||
		typeof evidence.requestId !== "string" ||
		!["accepted", "no-change"].includes(evidence.outcome) ||
		!/^sha256:[0-9a-f]{64}$/.test(evidence.pageHash || "") ||
		!/^sha256:[0-9a-f]{64}$/.test(evidence.ingestEventHash || "") ||
		Number.isNaN(Date.parse(evidence.verifiedAt || "")) ||
		evidence.pageHash !== hashPersistedPage(targetRoot, pageId) ||
		!matchingEvent ||
		evidence.ingestEventHash !== sha256(canonicalJson(JSON.stringify(matchingEvent)))
	) {
		return null;
	}
	return evidence;
}

function deriveAssurance(targetRoot, page, events = null) {
	const log = events || readEvents(targetRoot);
	const evidence = readAcceptedEvidence(targetRoot, page.pageId, log);
	const activity = summarizeFreshnessActivity(log);
	const revisionAt =
		activity.latestIngestAtByPage[page.pageId] ||
		(typeof page.created_at === "string" ? page.created_at : null);
	const feedback = feedbackForPage(log, page.pageId, revisionAt);
	const storedConfidence = page.assurance?.confidence || null;
	return {
		// Effective confidence is derived, never written back: each recorded
		// contradiction since the current revision drops one level.
		confidence: effectiveConfidence(storedConfidence, feedback.contradicted),
		storedConfidence,
		maturity: page.assurance?.maturity || null,
		verifiedAt: evidence ? evidence.verifiedAt : null,
		feedback,
	};
}

module.exports = {
	EVIDENCE_SCHEMA_VERSION,
	verificationDir,
	evidencePath,
	writeVerificationEvidence,
	readAcceptedEvidence,
	deriveAssurance,
};
