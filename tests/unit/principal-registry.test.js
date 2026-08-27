"use strict";

// F050 ticket 1 (#226) — Principal registry (unit seam).
//
// Tests assert externally visible behavior of the registry core: the closed
// kind set, append-only registered/revoked event ledger, terminal revocation
// (a principal id is registered at most once), the half-open validity window
// [validFrom, validTo), authority resolution for Decision admission, the size
// ceiling with env override, and fail-closed corruption/unsupported-version
// handling — every failure mode carries a stable AMBER_E_* code.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	PRINCIPAL_KINDS,
	REGISTRY_SCHEMA_VERSION,
	SUPPORTED_REGISTRY_SCHEMA_VERSIONS,
	DEFAULT_MAX_REGISTRY_BYTES,
	GENESIS_HASH,
	chainHash,
	parseTimestamp,
	principalStatus,
	listPrincipals,
	showPrincipal,
	registerPrincipal,
	revokePrincipal,
	resolveActivePrincipal,
} = require("../../scripts/lib/core/principal-registry");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-principal-${label}-`));
}

function registryPathOf(dir) {
	return path.join(dir, ".amber", "principals", "registry.jsonl");
}

/**
 * Chain a sequence of hand-built ledger bodies the way the writers do: each
 * event binds the previous event's hash (the genesis constant first), and the
 * event's own hash covers its full canonical content. Fixtures for verdicts
 * the fold checks AFTER the chain walk must arrive chained or they trip the
 * chain verification instead of the verdict under test.
 */
function withChain(events) {
	let prevHash = GENESIS_HASH;
	return events.map((event) => {
		const hash = chainHash(event, prevHash);
		const chained = { ...event, prevHash, hash };
		prevHash = hash;
		return chained;
	});
}

/**
 * A writer-shaped stored principal record for hand-built ledger fixtures: the
 * register writer always emits the FULL closed field set (optional fields
 * null), so a stored record missing a field is corruption in its own right —
 * fixtures for other verdicts must match the writer's shape or they trip the
 * stored-shape check before the verdict under test fires.
 */
function storedPrincipal(id, principalKind = "human") {
	return {
		id,
		principalKind,
		role: null,
		membership: null,
		capability: null,
		scope: null,
		validFrom: null,
		validTo: null,
		issuer: null,
	};
}

function registerAlice(dir, overrides = {}) {
	return registerPrincipal(dir, {
		id: "alice@example.com",
		principalKind: "human",
		role: "tech-lead",
		...overrides,
	});
}

// A fixed clock for deterministic window evaluation.
const NOW = new Date("2026-06-15T12:00:00.000Z");

test("registry constants pin the closed vocabulary and the schema contract", () => {
	assert.deepEqual(PRINCIPAL_KINDS, ["human", "service"]);
	assert.equal(REGISTRY_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_REGISTRY_SCHEMA_VERSIONS, [1]);
	assert.equal(DEFAULT_MAX_REGISTRY_BYTES, 1024 * 1024);
});

test("register appends one immutable event and returns the folded record", () => {
	const dir = mkTarget("register");
	const result = registerAlice(dir, {
		membership: "acme",
		capability: "approve-deployments",
		validFrom: "2026-01-01",
		validTo: "2027-01-01",
		issuer: "acme-it",
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.code, null);
	assert.deepEqual(
		{ ...result.record, registeredAt: "<ts>", revokedAt: null, revokedReason: null },
		{
			id: "alice@example.com",
			principalKind: "human",
			role: "tech-lead",
			membership: "acme",
			capability: "approve-deployments",
			scope: null,
			validFrom: "2026-01-01",
			validTo: "2027-01-01",
			issuer: "acme-it",
			registeredAt: "<ts>",
			revokedAt: null,
			revokedReason: null,
		},
	);
	assert.equal(
		"status" in result.record,
		false,
		"status is derived at the read/verify seams against their own clock; the write seam returns the stored fold",
	);
	assert.match(result.record.registeredAt, /^\d{4}-\d{2}-\d{2}T/);

	const events = fs
		.readFileSync(registryPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(events.length, 1, "one registered event");
	assert.equal(events[0].kind, "registered");
	assert.equal(events[0].schemaVersion, 1);
	assert.equal(events[0].principal.id, "alice@example.com");
	assert.deepEqual(Object.keys(events[0]).sort(), [
		"at",
		"hash",
		"kind",
		"prevHash",
		"principal",
		"schemaVersion",
	]);
	// The first event binds the genesis constant; the stored hash is the
	// canonical-content hash the fold re-verifies on every read.
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[0].hash, chainHash(events[0], GENESIS_HASH));
});

test("register validates input as AMBER_E_INVALID_ARG before any state is touched", () => {
	const dir = mkTarget("register-invalid");
	const cases = [
		[{ id: "", principalKind: "human" }, /principal id must be a non-empty string/],
		[{ id: "x", principalKind: "robot" }, /principalKind must be one of the closed set/],
		[{ id: "x", principalKind: "human", role: "" }, /role must be a non-empty string or null/],
		[{ id: "x", principalKind: "human", validFrom: "yesterday" }, /validFrom must be an ISO-8601/],
		[
			{ id: "x", principalKind: "human", validFrom: "2026-02-01", validTo: "2026-01-01" },
			/validTo must be after validFrom/,
		],
		[
			{ id: "x", principalKind: "human", validFrom: "2026-01-01", validTo: "2026-01-01" },
			/validTo must be after validFrom/,
		],
	];
	for (const [input, pattern] of cases) {
		const result = registerPrincipal(dir, input);
		assert.equal(result.ok, false);
		assert.equal(result.code, "AMBER_E_INVALID_ARG");
		assert.match(result.errors[0], pattern);
	}
	assert.equal(fs.existsSync(registryPathOf(dir)), false, "no durable state was touched");
});

test("a principal id is registered at most once (active and revoked)", () => {
	const dir = mkTarget("register-once");
	assert.equal(registerAlice(dir).ok, true);
	const again = registerAlice(dir);
	assert.equal(again.ok, false);
	assert.equal(again.code, "AMBER_E_PRINCIPAL_ALREADY_REGISTERED");
	assert.match(again.errors[0], /registered at most once/);

	assert.equal(revokePrincipal(dir, { id: "alice@example.com", reason: "offboarded" }).ok, true);
	const afterRevoke = registerAlice(dir);
	assert.equal(afterRevoke.ok, false);
	assert.equal(afterRevoke.code, "AMBER_E_PRINCIPAL_ALREADY_REGISTERED");
	assert.match(afterRevoke.errors[0], /revocation is terminal, so the id cannot be re-registered/);
});

test("revoke appends a terminal event; double revoke and unknown id are stable errors", () => {
	const dir = mkTarget("revoke");
	registerAlice(dir);
	const unknown = revokePrincipal(dir, { id: "ghost" });
	assert.equal(unknown.ok, false);
	assert.equal(unknown.code, "AMBER_E_PRINCIPAL_NOT_FOUND");

	const revoked = revokePrincipal(dir, { id: "alice@example.com", reason: "offboarded" });
	assert.equal(revoked.ok, true, (revoked.errors || []).join("; "));
	assert.equal("status" in revoked.record, false, "the write seam returns the stored fold");
	assert.equal(revoked.record.revokedReason, "offboarded");
	assert.match(revoked.record.revokedAt, /^\d{4}-\d{2}-\d{2}T/);

	const twice = revokePrincipal(dir, { id: "alice@example.com" });
	assert.equal(twice.ok, false);
	assert.equal(twice.code, "AMBER_E_PRINCIPAL_ALREADY_REVOKED");
	assert.match(twice.errors[0], /revocation is terminal/);

	const badReason = revokePrincipal(dir, { id: "alice@example.com", reason: "  " });
	assert.equal(badReason.ok, false);
	assert.equal(badReason.code, "AMBER_E_INVALID_ARG");

	// The ledger keeps both events; the fold is the current state.
	const events = fs
		.readFileSync(registryPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(events.length, 2);
	assert.equal(events[1].kind, "revoked");
	assert.deepEqual(Object.keys(events[1]).sort(), [
		"at",
		"hash",
		"id",
		"kind",
		"prevHash",
		"reason",
		"schemaVersion",
	]);
	// The revoked event binds the registered event's hash — the chain grows.
	assert.equal(events[1].prevHash, events[0].hash);
	assert.equal(events[1].hash, chainHash(events[1], events[0].hash));
});

test("show and list fold the ledger deterministically (first-seen order)", () => {
	const dir = mkTarget("read");
	registerPrincipal(dir, { id: "bob", principalKind: "human" });
	registerAlice(dir);
	revokePrincipal(dir, { id: "bob", reason: "left" });

	const list = listPrincipals(dir);
	assert.deepEqual(
		list.map((record) => [record.id, record.status]),
		[
			["bob", "revoked"],
			["alice@example.com", "active"],
		],
		"first-registration order, not alphabetical and not ledger-order-per-id",
	);

	const shown = showPrincipal(dir, "alice@example.com");
	assert.equal(shown.status, "active");
	assert.equal(shown.role, "tech-lead");
	assert.equal(showPrincipal(dir, "ghost"), null);

	// An absent registry is a legitimate empty state.
	assert.deepEqual(listPrincipals(mkTarget("empty")), []);
	assert.equal(showPrincipal(mkTarget("empty"), "alice"), null);
});

test("status precedence: revoked wins; the window is half-open [from, to)", () => {
	const base = { revokedAt: null, validFrom: null, validTo: null };
	assert.equal(principalStatus({ ...base }, NOW), "active");
	assert.equal(
		principalStatus({ ...base, validTo: "2026-06-15" }, NOW),
		"expired",
		"validTo itself is already expired (half-open)",
	);
	assert.equal(principalStatus({ ...base, validTo: "2026-06-16" }, NOW), "active");
	assert.equal(
		principalStatus({ ...base, validFrom: "2026-06-15" }, NOW),
		"active",
		"validFrom is inclusive",
	);
	assert.equal(principalStatus({ ...base, validFrom: "2026-06-16" }, NOW), "not-yet-valid");
	assert.equal(
		principalStatus({ ...base, revokedAt: "2026-01-01T00:00:00.000Z", validTo: "2027-01-01" }, NOW),
		"revoked",
		"a revoked principal holds no authority even inside its window",
	);
	assert.equal(
		principalStatus(
			{ ...base, revokedAt: "2026-01-01T00:00:00.000Z", validFrom: "2027-01-01" },
			NOW,
		),
		"revoked",
	);
});

test("resolveActivePrincipal resolves authority against the registry at the caller's clock", () => {
	const dir = mkTarget("resolve");
	registerAlice(dir, { validFrom: "2026-01-01", validTo: "2027-01-01" });
	registerPrincipal(dir, { id: "future", principalKind: "human", validFrom: "2027-06-01" });
	registerPrincipal(dir, { id: "past", principalKind: "human", validTo: "2026-01-01" });
	registerPrincipal(dir, { id: "svc", principalKind: "service", capability: "deploy" });
	revokePrincipal(dir, { id: "svc" });

	const ok = resolveActivePrincipal(dir, "alice@example.com", { now: NOW });
	assert.equal(ok.ok, true);
	assert.deepEqual(ok.principal, {
		id: "alice@example.com",
		principalKind: "human",
		role: "tech-lead",
		membership: null,
		capability: null,
		scope: null,
		validFrom: "2026-01-01",
		validTo: "2027-01-01",
		issuer: null,
	});

	const notFound = resolveActivePrincipal(dir, "ghost", { now: NOW });
	assert.equal(notFound.ok, false);
	assert.equal(notFound.code, "AMBER_E_PRINCIPAL_NOT_FOUND");
	assert.match(notFound.message, /not registered/);

	const revoked = resolveActivePrincipal(dir, "svc", { now: NOW });
	assert.equal(revoked.ok, false);
	assert.equal(revoked.code, "AMBER_E_PRINCIPAL_REVOKED");

	const expired = resolveActivePrincipal(dir, "past", { now: NOW });
	assert.equal(expired.ok, false);
	assert.equal(expired.code, "AMBER_E_PRINCIPAL_EXPIRED");

	const notYet = resolveActivePrincipal(dir, "future", { now: NOW });
	assert.equal(notYet.ok, false);
	assert.equal(notYet.code, "AMBER_E_PRINCIPAL_NOT_YET_VALID");

	const badId = resolveActivePrincipal(dir, "", { now: NOW });
	assert.equal(badId.ok, false);
	assert.equal(badId.code, "AMBER_E_INVALID_ARG");
});

test("parseTimestamp accepts ISO dates, date-times, and offsets; rejects garbage", () => {
	assert.equal(typeof parseTimestamp("2026-01-31"), "number");
	assert.equal(typeof parseTimestamp("2026-01-31T09:00:00Z"), "number");
	assert.equal(typeof parseTimestamp("2026-01-31T09:00:00.123+02:00"), "number");
	assert.equal(parseTimestamp("31/01/2026"), null);
	assert.equal(parseTimestamp("2026-13-01"), null);
	assert.equal(parseTimestamp(""), null);
	assert.equal(parseTimestamp(null), null);
	assert.equal(parseTimestamp(42), null);
});

test("the registry size ceiling refuses an append before any durable state is touched", () => {
	const dir = mkTarget("ceiling");
	const previous = process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES;
	try {
		process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES = "10";
		const refused = registerAlice(dir);
		assert.equal(refused.ok, false);
		assert.equal(refused.code, "AMBER_E_PRINCIPAL_REGISTRY_CEILING");
		assert.match(refused.errors[0], /AMBER_PRINCIPAL_MAX_REGISTRY_BYTES/);
		assert.equal(
			fs.existsSync(registryPathOf(dir)),
			false,
			"the refused append must not create durable state",
		);

		// A garbage override is an argument error, never a silent default.
		process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES = "not-a-number";
		assert.throws(
			() => registerAlice(dir),
			(err) => err.amberCode === "AMBER_E_INVALID_ARG",
		);
	} finally {
		if (previous === undefined) delete process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES;
		else process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES = previous;
	}
});

test("the under-lock ceiling re-check measures the real chained event, not the body alone", () => {
	const dir = mkTarget("ceiling-chain");
	registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" });

	const bytes = fs.statSync(registryPathOf(dir)).size;
	// The revoke body alone (without the chain fields) is deterministic in
	// length: same keys, same value shapes, and a 24-char ISO timestamp — key
	// order cannot change a JSON string's length.
	const bodyLine = `${JSON.stringify({
		kind: "revoked",
		schemaVersion: 1,
		at: "2026-01-01T00:00:00.000Z",
		id: "alice@example.com",
		reason: null,
	})}\n`;
	const previous = process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES;
	try {
		// Room for the body the PRE-lock check measures, but not once
		// prevHash/hash (~146 bytes) are attached to the real event: only the
		// under-lock re-check on the exact line can refuse this append.
		process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES = String(bytes + bodyLine.length + 16);
		const refused = revokePrincipal(dir, { id: "alice@example.com" });
		assert.equal(refused.ok, false);
		assert.equal(refused.code, "AMBER_E_PRINCIPAL_REGISTRY_CEILING");
		assert.match(refused.errors[0], /AMBER_PRINCIPAL_MAX_REGISTRY_BYTES/);
		assert.equal(
			JSON.parse(fs.readFileSync(registryPathOf(dir), "utf8").trim().split("\n").at(-1)).kind,
			"registered",
			"no revoke event was appended",
		);
	} finally {
		if (previous === undefined) delete process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES;
		else process.env.AMBER_PRINCIPAL_MAX_REGISTRY_BYTES = previous;
	}
});

test("a corrupt ledger fails closed on every seam; an unsupported version keeps its own code", () => {
	// Every case names the stable code its verdict carries. Corruption is
	// AMBER_E_PRINCIPAL_REGISTRY_CORRUPT; an event declaring an unsupported
	// schemaVersion is its own stable verdict (test below pins the
	// distinction) and must still fail closed on every seam.
	const CORRUPT = "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT";
	const UNSUPPORTED = "AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION";
	const corruptionCases = [
		[
			"not json at all",
			(dir) => {
				// writeJSONL creates the parent directory; the raw fs write must
				// create it itself or the ARRANGE step dies with ENOENT before the
				// corruption verdict is ever exercised.
				fs.mkdirSync(path.dirname(registryPathOf(dir)), { recursive: true });
				fs.writeFileSync(registryPathOf(dir), "{oops\n");
			},
			/corrupt or unreadable/,
			CORRUPT,
		],
		["non-object event", (dir) => writeJSONL(registryPathOf(dir), [42]), /is not an object/],
		[
			"missing integer schemaVersion",
			(dir) =>
				writeJSONL(registryPathOf(dir), [
					{
						kind: "registered",
						at: "2026-01-01T00:00:00Z",
						principal: { id: "a", principalKind: "human" },
					},
				]),
			/no integer schemaVersion/,
		],
		[
			"unsupported schemaVersion",
			(dir) =>
				writeJSONL(registryPathOf(dir), [
					{
						kind: "registered",
						schemaVersion: 2,
						at: "2026-01-01T00:00:00Z",
						principal: { id: "a", principalKind: "human" },
					},
				]),
			/schemaVersion 2/,
			UNSUPPORTED,
		],
		[
			"unknown event kind",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([{ kind: "deleted", schemaVersion: 1, at: "2026-01-01T00:00:00Z", id: "a" }]),
				),
			/unknown kind "deleted"/,
		],
		[
			"unknown registered-event field",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([
						{
							kind: "registered",
							schemaVersion: 1,
							at: "2026-01-01T00:00:00Z",
							principal: { id: "a", principalKind: "human" },
							note: "x",
						},
					]),
				),
			/registered event carrying unknown field "note"/,
		],
		[
			"malformed principal record",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([
						{
							kind: "registered",
							schemaVersion: 1,
							at: "2026-01-01T00:00:00Z",
							principal: { id: "a", principalKind: "robot" },
						},
					]),
				),
			/principalKind "robot" is outside the closed set/,
		],
		[
			"principal record with unknown field",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([
						{
							kind: "registered",
							schemaVersion: 1,
							at: "2026-01-01T00:00:00Z",
							principal: { id: "a", principalKind: "human", nickname: "al" },
						},
					]),
				),
			/unknown field "nickname"/,
		],
		[
			"double registration",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([
						{
							kind: "registered",
							schemaVersion: 1,
							at: "2026-01-01T00:00:00Z",
							principal: storedPrincipal("a"),
						},
						{
							kind: "registered",
							schemaVersion: 1,
							at: "2026-01-02T00:00:00Z",
							principal: storedPrincipal("a"),
						},
					]),
				),
			/registers "a" a second time.*edited in place/,
		],
		[
			"revocation of an unregistered id",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([
						{
							kind: "revoked",
							schemaVersion: 1,
							at: "2026-01-01T00:00:00Z",
							id: "a",
							reason: null,
						},
					]),
				),
			/revokes "a", which was never registered/,
		],
		[
			"double revocation",
			(dir) =>
				writeJSONL(
					registryPathOf(dir),
					withChain([
						{
							kind: "registered",
							schemaVersion: 1,
							at: "2026-01-01T00:00:00Z",
							principal: storedPrincipal("a"),
						},
						{
							kind: "revoked",
							schemaVersion: 1,
							at: "2026-01-02T00:00:00Z",
							id: "a",
							reason: null,
						},
						{
							kind: "revoked",
							schemaVersion: 1,
							at: "2026-01-03T00:00:00Z",
							id: "a",
							reason: null,
						},
					]),
				),
			/revokes "a" a second time/,
		],
	];

	for (const [label, arrange, pattern, expectedCode = CORRUPT] of corruptionCases) {
		const dir = mkTarget("corrupt");
		arrange(dir);
		for (const [seam, read] of [
			["listPrincipals", () => listPrincipals(dir)],
			["showPrincipal", () => showPrincipal(dir, "a")],
			["resolveActivePrincipal", () => resolveActivePrincipal(dir, "a", { now: NOW })],
			["registerPrincipal", () => registerPrincipal(dir, { id: "b", principalKind: "human" })],
			["revokePrincipal", () => revokePrincipal(dir, { id: "b" })],
		]) {
			if (seam === "registerPrincipal" || seam === "revokePrincipal") {
				// Writer seams return the typed code instead of throwing.
				const result = read();
				assert.equal(result.ok, false, `${label} / ${seam} must fail`);
				assert.equal(result.code, expectedCode, `${label} / ${seam} carries the stable code`);
				assert.match(result.errors[0], pattern, `${label} / ${seam}`);
			} else {
				assert.throws(
					read,
					(err) => err.amberCode === expectedCode && pattern.test(err.message),
					`${label} / ${seam} must fail closed with the stable code`,
				);
			}
		}
	}
});

test("an unsupported schema version is its own stable code, distinct from corruption", () => {
	const dir = mkTarget("version");
	writeJSONL(registryPathOf(dir), [
		{
			kind: "registered",
			schemaVersion: 7,
			at: "2026-01-01T00:00:00Z",
			principal: { id: "a", principalKind: "human" },
		},
	]);
	assert.throws(
		() => listPrincipals(dir),
		(err) =>
			err.amberCode === "AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION" &&
			/schemaVersion 7/.test(err.message),
	);
	const write = registerPrincipal(dir, { id: "b", principalKind: "human" });
	assert.equal(write.ok, false);
	assert.equal(write.code, "AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION");
});

test("an in-place edit of a stored event fails the hash chain on every seam (tamper evidence)", () => {
	// A writer-built ledger (a valid chain), then one event's CONTENT is
	// edited in place without recomputing its hash. The registry is the AC4
	// trust root — laundering a service principalKind into "human" must fail
	// closed everywhere, never fold to a forged-but-plausible state.
	const dir = mkTarget("tamper");
	registerPrincipal(dir, { id: "svc", principalKind: "service", capability: "deploy" });
	registerPrincipal(dir, { id: "alice", principalKind: "human" });

	const lines = fs.readFileSync(registryPathOf(dir), "utf8").trim().split("\n");
	const first = JSON.parse(lines[0]);
	assert.equal(first.principal.principalKind, "service");
	first.principal.principalKind = "human";
	lines[0] = JSON.stringify(first);
	fs.writeFileSync(registryPathOf(dir), `${lines.join("\n")}\n`);

	assert.throws(
		() => listPrincipals(dir),
		(err) =>
			err.amberCode === "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT" &&
			/hash that does not match its content/.test(err.message),
		"the edited event's stored hash no longer covers its content",
	);
	const write = registerPrincipal(dir, { id: "bob", principalKind: "human" });
	assert.equal(write.ok, false);
	assert.equal(write.code, "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT");
});

test("splicing an event's prevHash breaks the chain (reordering/removal detection)", () => {
	const dir = mkTarget("splice");
	const events = withChain([
		{
			kind: "registered",
			schemaVersion: 1,
			at: "2026-01-01T00:00:00Z",
			principal: storedPrincipal("a"),
		},
		{
			kind: "registered",
			schemaVersion: 1,
			at: "2026-01-02T00:00:00Z",
			principal: storedPrincipal("b"),
		},
	]);
	// Event 2 re-binds the genesis constant instead of event 1's hash — the
	// signature of a removed or reordered predecessor.
	events[1].prevHash = GENESIS_HASH;
	writeJSONL(registryPathOf(dir), events);
	assert.throws(
		() => listPrincipals(dir),
		(err) =>
			err.amberCode === "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT" &&
			/breaks the hash chain/.test(err.message),
	);
});

test("a fresh registry write lock fails a concurrent writer with its own stable code; a stale lock is reclaimed", () => {
	const dir = mkTarget("lock");
	registerPrincipal(dir, { id: "a", principalKind: "human" });

	// A lock young enough to be live: the second writer fails closed with the
	// conflict code, never racing the in-flight append.
	const lockPath = path.join(dir, ".amber", "principals", "registry.lock");
	fs.writeFileSync(lockPath, "");
	const conflicted = registerPrincipal(dir, { id: "b", principalKind: "human" });
	assert.equal(conflicted.ok, false);
	assert.equal(conflicted.code, "AMBER_E_PRINCIPAL_REGISTRY_LOCK");
	assert.match(conflicted.errors[0], /another principal registry write is in flight/i);
	const conflictedRevoke = revokePrincipal(dir, { id: "a" });
	assert.equal(conflictedRevoke.ok, false);
	assert.equal(conflictedRevoke.code, "AMBER_E_PRINCIPAL_REGISTRY_LOCK");
	assert.equal(
		JSON.parse(fs.readFileSync(registryPathOf(dir), "utf8").trim().split("\n").at(-1)).principal.id,
		"a",
		"no event was appended while the lock was held",
	);

	// A lock older than the stale window belongs to a crashed holder — the
	// registry is not bricked by a leftover lock file.
	const stale = new Date(Date.now() - 60_000);
	fs.utimesSync(lockPath, stale, stale);
	const reclaimed = registerPrincipal(dir, { id: "b", principalKind: "human" });
	assert.equal(reclaimed.ok, true, (reclaimed.errors || []).join("; "));
	assert.equal(fs.existsSync(lockPath), false, "the reclaimed lock is removed on release");
	assert.equal(
		JSON.parse(fs.readFileSync(registryPathOf(dir), "utf8").trim().split("\n").at(-1)).principal.id,
		"b",
	);
});

test("scope is a first-class registry field: stored, folded, and snapshotted for Decision binding", () => {
	const dir = mkTarget("scope");
	const result = registerPrincipal(dir, {
		id: "carol",
		principalKind: "human",
		role: "tech-lead",
		scope: "team-a",
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.record.scope, "team-a");

	assert.equal(showPrincipal(dir, "carol").scope, "team-a");
	const resolved = resolveActivePrincipal(dir, "carol", { now: NOW });
	assert.equal(resolved.ok, true);
	assert.equal(resolved.principal.scope, "team-a");

	const bad = registerPrincipal(dir, { id: "dave", principalKind: "human", scope: "" });
	assert.equal(bad.ok, false);
	assert.equal(bad.code, "AMBER_E_INVALID_ARG");
	assert.match(bad.errors[0], /scope must be a non-empty string or null/);
});

test("a date-time without an explicit zone is rejected (windows must not be machine-timezone-dependent)", () => {
	const dir = mkTarget("zone");
	const zoneless = registerPrincipal(dir, {
		id: "a",
		principalKind: "human",
		validFrom: "2026-01-01T09:00:00",
	});
	assert.equal(zoneless.ok, false);
	assert.equal(zoneless.code, "AMBER_E_INVALID_ARG");
	assert.match(zoneless.errors[0], /carrying an explicit zone/);
	assert.equal(fs.existsSync(registryPathOf(dir)), false, "no durable state was touched");

	// Bare dates still parse (UTC midnight); zoned date-times parse; only the
	// zoneless date-TIME is ambiguous and therefore refused.
	const bareDate = registerPrincipal(dir, {
		id: "b",
		principalKind: "human",
		validFrom: "2026-01-01",
	});
	assert.equal(bareDate.ok, true, (bareDate.errors || []).join("; "));
	const zoned = registerPrincipal(dir, {
		id: "c",
		principalKind: "human",
		validTo: "2027-01-01T00:00:00+02:00",
	});
	assert.equal(zoned.ok, true, (zoned.errors || []).join("; "));
});
