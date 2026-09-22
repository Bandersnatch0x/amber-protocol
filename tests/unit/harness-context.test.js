"use strict";

// F069 H3a — Context Firewall (Harness v2 §11/§32): the ContextGrant registry
// and the deterministic report-first check. The check reads labels only,
// denies with closed reasons, and lands denials on the tamper-evident trail.
// TTL is a half-open window evaluated against an injected clock.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { readRunEvents, readHarnessEvents } = require("../../scripts/lib/harness/event-ledger");
const {
	CODE_ALREADY_REVOKED,
	CODE_CORRUPT,
	CODE_IMMUTABLE,
} = require("../../scripts/lib/harness/context-core");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-ctx-"));
}

const GRANT = {
	apiVersion: "amber.dev/v1",
	kind: "ContextGrant",
	metadata: { id: "grant-review", version: "1" },
	subject: "worker",
	resources: ["docs", "plans"],
	purpose: "review",
	classificationCeiling: "internal",
	validFrom: "2026-09-01T00:00:00.000Z",
	validUntil: "2026-10-01T00:00:00.000Z",
	policy: "context-safe",
};

function writeGrant(target, grant, name = "grant.json") {
	const file = path.join(target, name);
	fs.writeFileSync(file, JSON.stringify(grant, null, 2), "utf8");
	return file;
}

function admit(target, grant = GRANT, name = "grant.json") {
	return dispatch("harness", {
		target,
		file: writeGrant(target, grant, name),
		json: true,
		_: ["context", "admit"],
	});
}

function check(target, overrides = {}, now = "2026-09-15T00:00:00.000Z") {
	return dispatch("harness", {
		target,
		json: true,
		subject: "worker",
		resource: "docs/architecture.md",
		purpose: "review",
		now,
		...overrides,
		_: ["context", "check"],
	});
}

test("a grant admits immutably; an inverted TTL refuses in core", () => {
	const target = tmpTarget();
	try {
		const first = admit(target);
		assert.equal(first.exitCode, 0);
		assert.match(first.result.snapshotHash, /^sha256:[0-9a-f]{64}$/);
		const identical = admit(target, GRANT, "again.json");
		assert.equal(identical.result.idempotent, true);

		fs.writeFileSync(
			writeGrant(
				target,
				{
					...GRANT,
					metadata: { id: "grant-inverted", version: "1" },
					validFrom: "2026-10-01T00:00:00.000Z",
					validUntil: "2026-09-01T00:00:00.000Z",
				},
				"inverted.json",
			),
			JSON.stringify(
				{
					...GRANT,
					metadata: { id: "grant-inverted", version: "1" },
					validFrom: "2026-10-01T00:00:00.000Z",
					validUntil: "2026-09-01T00:00:00.000Z",
				},
				null,
				2,
			),
			"utf8",
		);
		const inverted = dispatch("harness", {
			target,
			file: "inverted.json",
			json: true,
			_: ["context", "admit"],
		});
		assert.equal(inverted.exitCode, 1);
		assert.match(inverted.result.errors[0], /validUntil must be after validFrom/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the check allows inside the window with the covering grant pointer", () => {
	const target = tmpTarget();
	try {
		const admitted = admit(target);
		const { result, exitCode } = check(target);
		assert.equal(exitCode, 0);
		assert.equal(result.verdict, "allow");
		assert.equal(result.grant, "grant-review");
		assert.equal(result.grantPointer, `context-grant:grant-review#${admitted.result.snapshotHash}`);
		assert.equal(result.validUntil, GRANT.validUntil);
		assert.equal(result.reportOnly, true);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the check denies with closed reasons: no-grant, expired, purpose-mismatch", () => {
	const target = tmpTarget();
	try {
		admit(target);
		// A different subject has no grant at all.
		const stranger = dispatch("harness", {
			target,
			json: true,
			subject: "intruder",
			resource: "docs/architecture.md",
			purpose: "review",
			now: "2026-09-15T00:00:00.000Z",
			_: ["context", "check"],
		});
		assert.equal(stranger.result.verdict, "deny");
		assert.equal(stranger.result.reason, "no-grant");

		// After the window: expired (read-time projection; the record is untouched).
		const late = check(target, {}, "2026-11-01T00:00:00.000Z");
		assert.equal(late.result.verdict, "deny");
		assert.equal(late.result.reason, "expired");

		// Same subject and resource, but a different purpose.
		const wrongPurpose = check(target, { purpose: "deploy" });
		assert.equal(wrongPurpose.result.verdict, "deny");
		assert.equal(wrongPurpose.result.reason, "purpose-mismatch");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the classification ceiling denies above and allows at-or-below; unknown fails closed", () => {
	const target = tmpTarget();
	try {
		admit(target);
		const confidential = check(target, { classification: "confidential" });
		assert.equal(confidential.result.verdict, "deny");
		assert.equal(confidential.result.reason, "classification-above-ceiling");

		const internal = check(target, { classification: "internal" });
		assert.equal(internal.result.verdict, "allow");

		const unrated = check(target, { classification: "unknown" });
		assert.equal(unrated.result.verdict, "deny");
		assert.equal(unrated.result.reason, "classification-above-ceiling");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("revocation is terminal, visible forever, and denies with its own reason", () => {
	const target = tmpTarget();
	try {
		admit(target);
		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			grant: "grant-review",
			revoker: "alice@example.com",
			reason: "offboarding",
			_: ["context", "revoke"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.revokedAt.length > 0, true);

		const second = dispatch("harness", {
			target,
			json: true,
			grant: "grant-review",
			revoker: "alice@example.com",
			_: ["context", "revoke"],
		});
		assert.equal(second.exitCode, 1);
		assert.equal(second.result.code, CODE_ALREADY_REVOKED);

		const denied = check(target);
		assert.equal(denied.result.verdict, "deny");
		assert.equal(denied.result.reason, "revoked");

		const listed = dispatch("harness", { target, json: true, _: ["context", "list"] });
		assert.equal(listed.result.grants.length, 1, "revoked grants stay listable");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("grant, denial, and revocation events land on the trail; --run scopes a denial", () => {
	const target = tmpTarget();
	try {
		admit(target);
		// A denial scoped to a run lands on that run's trail with its runId.
		// (The check as granted would ALLOW — a wrong purpose denies.)
		check(target, { purpose: "deploy", run: "run-ctx-1" });
		const runEvents = readRunEvents(target, "run-ctx-1").map((event) => event.kind);
		assert.deepEqual(runEvents, ["context.denied"]);
		const denial = readRunEvents(target, "run-ctx-1")[0];
		assert.equal(denial.decision.result, "deny");
		assert.equal(denial.decision.policy, "context-firewall");

		// Revoke and verify the revocation event.
		dispatch("harness", {
			target,
			json: true,
			grant: "grant-review",
			revoker: "alice@example.com",
			_: ["context", "revoke"],
		});
		// Revocation is not run-scoped — it lands on the ledger as a whole.
		const allKinds = readHarnessEvents(target).map((event) => event.kind);
		assert.ok(allKinds.includes("context.revoked"));

		// A tampered grant record refuses its single read closed.
		const grantFile = path.join(target, ".amber", "harness", "context-grants", "grant-review.json");
		const stored = JSON.parse(fs.readFileSync(grantFile, "utf8"));
		stored.grant.purpose = "tampered";
		fs.writeFileSync(grantFile, JSON.stringify(stored, null, "\t"), "utf8");
		const inspected = dispatch("harness", {
			target,
			json: true,
			grant: "grant-review",
			_: ["context", "inspect"],
		});
		assert.equal(inspected.exitCode, 1);
		assert.equal(inspected.result.code, CODE_CORRUPT);
		assert.equal(CODE_IMMUTABLE, "AMBER_E_HARNESS_CTX_IMMUTABLE");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
