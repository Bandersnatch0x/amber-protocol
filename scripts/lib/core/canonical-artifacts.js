"use strict";

/**
 * Canonical Planning Artifacts — Intent admission tracer bullet (F049, #218).
 *
 * A Canonical Artifact is a bound pair (ADR-0023): one human-readable
 * Artifact Body (Markdown) and one machine-actionable Artifact Envelope
 * (JSON). The pair is committed atomically through a durable
 * prepared/committed/aborted journal; only committed revisions are visible
 * to reads. Revisions are append-only and immutable — there is no in-place
 * mutation path for a committed revision's status or content.
 *
 * Storage layout (repository-local, always under .amber):
 *   .amber/artifacts/<types>/<identity-slug>/
 *     rev-<n>.md                 Body, verbatim
 *     rev-<n>.envelope.json      Envelope (canonical JSON)
 *     journal.jsonl              prepared/committed/aborted records
 *
 * Hashes reuse the existing canonical-hash primitives: the Body contentHash
 * is sha256 of the verbatim Body text; the Envelope hash covers the sorted-key
 * canonical serialization with the self-referential envelopeHash field
 * excluded, so an external verifier can recompute it from the stored file.
 */

const fs = require("node:fs");
const path = require("node:path");
const { sha256Hex, canonicalJson } = require("./context-hash");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { codedError } = require("./error-catalog");

const ARTIFACT_TYPES = Object.freeze(["intent"]);
const ARTIFACT_STATUSES = Object.freeze(["prepared", "committed", "aborted"]);

// Journal record kinds double as the durable status names.
const KIND_PREPARED = "prepared";
const KIND_COMMITTED = "committed";
const KIND_ABORTED = "aborted";

const JOURNAL_CORRUPT_CODE = "AMBER_E_ARTIFACT_JOURNAL_CORRUPT";

const TYPE_DIR_BY_TYPE = Object.freeze({ intent: "intents" });

function artifactDir(cwd, type, identity) {
	// ponytail: flat slug identity→dir; collisions across e.g. "a/b" vs "a_b"
	// would alias, acceptable for the tracer bullet's intent-only registry.
	const slug = `${identity}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return statePathForCreate(cwd, "artifacts", TYPE_DIR_BY_TYPE[type] || type, slug);
}

function journalPath(dir) {
	return path.join(dir, "journal.jsonl");
}

// Settlement journal reads fail closed (F035-S5 convention, matching the
// knowledge/audit ledgers): only an ABSENT journal is a legitimate empty
// state; a corrupt line throws the typed corruption error instead of letting
// a dropped record resurrect a stale head or reuse a consumed revision slot.
function readJournal(dir) {
	return readLedgerFailClosed(journalPath(dir), JOURNAL_CORRUPT_CODE, "artifact");
}

/** The Body's contentHash: sha256 of the verbatim Markdown text. */
function bodyHash(body) {
	return `sha256:${sha256Hex(body)}`;
}

/**
 * Deterministic canonical serialization of the Envelope: sorted keys, no
 * insignificant whitespace, self-referential envelopeHash field excluded —
 * the documented canonical form an external verifier recomputes to check
 * the stored hash. Reuses canonicalJson from context-hash (F049 constraint:
 * reuse existing canonical-hash primitives).
 */
function envelopeHash(envelope) {
	const { envelopeHash: _self, ...body } = envelope;
	return sha256Hex(canonicalJson(JSON.stringify(body)));
}

function readEnvelope(dirPath, revision) {
	try {
		return JSON.parse(fs.readFileSync(path.join(dirPath, `rev-${revision}.envelope.json`), "utf8"));
	} catch {
		return null;
	}
}

function readBody(dirPath, revision) {
	try {
		return fs.readFileSync(path.join(dirPath, `rev-${revision}.md`), "utf8");
	} catch {
		return null;
	}
}

// Walk every existing artifact home directory and yield { dir }.
function walkArtifactHomes(cwd) {
	const root = statePathForCreate(cwd, "artifacts");
	if (!fs.existsSync(root)) return [];
	const out = [];
	for (const typeDir of fs.readdirSync(root)) {
		const homeRoot = path.join(root, typeDir);
		if (!fs.statSync(homeRoot).isDirectory()) continue;
		for (const slug of fs.readdirSync(homeRoot)) {
			const dir = path.join(homeRoot, slug);
			if (!fs.existsSync(journalPath(dir))) continue;
			out.push({ dir });
		}
	}
	return out;
}

// Current committed revision number for an artifact dir, or 0 when none.
function committedHead(journal) {
	return maxSettledRevision(journal, KIND_COMMITTED);
}

// Highest settled revision slot ever used (committed OR aborted): aborted
// slots are consumed, so the next admission never reuses them.
function highestSettledRevision(journal) {
	return maxSettledRevision(journal, KIND_COMMITTED, KIND_ABORTED);
}

function maxSettledRevision(journal, ...kinds) {
	let max = 0;
	for (const record of journal) {
		if (kinds.includes(record.kind) && typeof record.revision === "number") {
			max = Math.max(max, record.revision);
		}
	}
	return max;
}

/**
 * Build the externally visible projection of one committed revision.
 * Verifies the Body hash before serving: a stored Body that no longer
 * matches its recorded contentHash is corruption, not content.
 */
function committedProjection(type, identity, revision, body, envelope, committedAt) {
	const recordedHash = envelope.bodyHash || null;
	if (!recordedHash || bodyHash(body) !== recordedHash) {
		throw codedError(
			"AMBER_E_ARTIFACT_HASH_MISMATCH",
			`stored Body for "${identity}" revision ${revision} no longer matches its recorded contentHash`,
		);
	}
	return Object.freeze({
		type,
		identity,
		revision,
		status: "committed",
		body,
		envelope,
		contentHash: recordedHash,
		envelopeHash: envelope.envelopeHash || null,
		supersedes: envelope.supersedes ?? null,
		provenance: envelope.provenance || null,
		committedAt: committedAt || null,
	});
}

/**
 * Read one artifact's current (or explicit) revision with journal-settled
 * visibility. Returns null when the identity has no committed revision or
 * the named revision is not committed — prepared/aborted stay invisible.
 * @throws {Error} Typed AMBER_E_ARTIFACT_JOURNAL_CORRUPT on a corrupt journal,
 *         AMBER_E_ARTIFACT_HASH_MISMATCH when a stored pair fails its binding.
 */
function showArtifact(cwd, identity, { type = "intent", revision = null } = {}) {
	const dir = artifactDir(cwd, type, identity);
	const journal = readJournal(dir);
	for (const record of [...journal].reverse()) {
		if (record.kind !== KIND_COMMITTED) continue;
		if (revision !== null && record.revision !== revision) continue;
		const body = readBody(dir, record.revision);
		const envelope = readEnvelope(dir, record.revision);
		if (!body || !envelope) continue; // orphaned half on disk: not readable
		return committedProjection(type, identity, record.revision, body, envelope, record.at);
	}
	return null;
}

// Latest committed revision per artifact, first-seen order.
function committedCurrents(cwd) {
	const currents = [];
	for (const { dir } of walkArtifactHomes(cwd)) {
		const journal = readJournal(dir);
		const head = committedHead(journal);
		if (!head) continue;
		const envelope = readEnvelope(dir, head);
		const body = readBody(dir, head);
		if (!envelope || !body) continue; // orphaned half: skip
		currents.push(
			committedProjection(envelope.type, envelope.identity, head, body, envelope, null),
		);
	}
	return currents;
}

/** List committed artifacts (current revision each). */
function listArtifacts(cwd) {
	return committedCurrents(cwd);
}

// Settled revision slots (committed OR aborted) are consumed: the next
// admission never reuses an aborted slot.

/**
 * Admit one Canonical Artifact revision: validate the Body/Envelope pair,
 * then settle it atomically through prepared → committed journal records.
 *
 * Admission is compare-and-swap by default (F049): with no `supersedes`,
 * an exact-duplicate Body at the current head returns the original receipt
 * (idempotent retry); different content without an expected head fails
 * closed as conflict. Superseding requires `supersedes` to name the current
 * committed revision.
 */
function admitArtifact(
	cwd,
	{ type = "intent", identity, body, provenance = null, supersedes = null },
) {
	const fail = (code, errors) => ({ ok: false, code, receipt: null, errors });

	if (!ARTIFACT_TYPES.includes(type)) {
		return fail("AMBER_E_ARTIFACT_UNKNOWN_TYPE", [
			`artifact type "${type}" is not registered; registered types: ${ARTIFACT_TYPES.join(", ")}`,
		]);
	}
	if (!identity || typeof identity !== "string") {
		return fail("AMBER_E_ARTIFACT_ORPHANED_HALF", ["admission requires an artifact identity"]);
	}
	// Pair binding (ADR-0023): both sides must arrive in one atomic call.
	if (typeof body !== "string" || body.length === 0) {
		return fail("AMBER_E_ARTIFACT_ORPHANED_HALF", [
			"admission received an Envelope without a readable Artifact Body",
		]);
	}

	let journal;
	try {
		journal = readJournal(artifactDir(cwd, type, identity));
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || JOURNAL_CORRUPT_CODE,
			receipt: null,
			errors: [err.message],
		};
	}
	const dir = artifactDir(cwd, type, identity);
	const head = committedHead(journal);

	// Idempotent retry bound to canonical content: identical Body at the
	// current head returns the original committed receipt.
	if (head > 0) {
		const current = readEnvelope(dir, head);
		if (current && current.bodyHash === bodyHash(body)) {
			return {
				ok: true,
				duplicate: true,
				code: null,
				errors: [],
				receipt: receiptFor(type, identity, head, current, journal),
			};
		}
		// Different content at an existing head MUST go through supersedes —
		// silent forking of history fails closed as conflict.
		if (supersedes === null || supersedes !== head) {
			return fail("AMBER_E_ARTIFACT_CONFLICT", [
				supersedes === null
					? `"${identity}" is at revision ${head} with different content; pass --supersedes-revision ${head} to supersede it`
					: `expected head ${supersedes} is stale; current committed revision is ${head}`,
			]);
		}
	} else if (head === 0 && supersedes !== null) {
		return fail("AMBER_E_ARTIFACT_CONFLICT", [
			`cannot supersede revision ${supersedes}: "${identity}" has no committed revisions`,
		]);
	}

	const revision = highestSettledRevision(journal) + 1;
	const contentHashValue = bodyHash(body);
	const preparedAt = new Date().toISOString();
	const envelope = Object.freeze({
		schemaVersion: 1,
		type,
		identity,
		revision,
		supersedes: supersedes ?? null,
		bodyHash: contentHashValue,
		envelopeHash: envelopeHash({
			schemaVersion: 1,
			type,
			identity,
			revision,
			supersedes: supersedes ?? null,
			bodyHash: contentHashValue,
			provenance: provenance || null,
			committedAt: preparedAt,
		}),
		provenance: provenance || null,
		committedAt: preparedAt,
	});

	// Atomic pair write between prepared and committed: a crash in between
	// leaves the files present but the revision uncommitted (invisible).
	appendJSONL(journalPath(dir), { kind: KIND_PREPARED, revision, at: preparedAt });
	fs.writeFileSync(path.join(dir, `rev-${revision}.md`), body, "utf8");
	fs.writeFileSync(
		path.join(dir, `rev-${revision}.envelope.json`),
		JSON.stringify(envelope, null, 2) + "\n",
		"utf8",
	);
	appendJSONL(journalPath(dir), {
		kind: KIND_COMMITTED,
		revision,
		at: new Date().toISOString(),
	});

	return {
		ok: true,
		duplicate: false,
		code: null,
		errors: [],
		receipt: receiptFor(type, identity, revision, envelope, readJournal(dir)),
	};
}

function receiptFor(type, identity, revision, envelope, journal) {
	const commitRecord = [...journal]
		.reverse()
		.find((r) => r.kind === KIND_COMMITTED && r.revision === revision);
	return Object.freeze({
		type,
		identity,
		revision,
		contentHash: envelope.bodyHash,
		envelopeHash: envelope.envelopeHash,
		supersedes: envelope.supersedes ?? null,
		provenance: envelope.provenance,
		committedAt: commitRecord ? commitRecord.at : envelope.committedAt,
	});
}

module.exports = {
	ARTIFACT_TYPES,
	ARTIFACT_STATUSES,
	bodyHash,
	envelopeHash,
	admitArtifact,
	showArtifact,
	listArtifacts,
};
