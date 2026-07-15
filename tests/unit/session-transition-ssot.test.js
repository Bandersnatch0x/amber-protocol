const { describe, it } = require("node:test");
const assert = require("assert");

// SSOT predicates for session status transitions. Pure functions exported from
// scripts/lib/session-state-machine.js. Web action semantics (start/resume)
// live in the web router and must not invent a second edge table.
const {
	STATES,
	isLegalTransition,
	legalTargets,
	isFinal,
} = require("../../scripts/lib/session-state-machine");

describe("session transition SSOT predicates", () => {
	it("exports isLegalTransition, legalTargets, and isFinal as functions", () => {
		assert.strictEqual(typeof isLegalTransition, "function", "isLegalTransition must be exported");
		assert.strictEqual(typeof legalTargets, "function", "legalTargets must be exported");
		assert.strictEqual(typeof isFinal, "function", "isFinal must be exported as a pure predicate");
	});

	describe("isLegalTransition", () => {
		it("rejects created → executing (must route first)", () => {
			assert.strictEqual(
				isLegalTransition(STATES.CREATED, STATES.EXECUTING),
				false,
			);
		});

		it("allows created → routed", () => {
			assert.strictEqual(
				isLegalTransition(STATES.CREATED, STATES.ROUTED),
				true,
			);
		});

		it("allows routed → executing", () => {
			assert.strictEqual(
				isLegalTransition(STATES.ROUTED, STATES.EXECUTING),
				true,
			);
		});
	});

	describe("legalTargets", () => {
		it("from created includes routed/completed/failed/aborted and excludes executing", () => {
			const targets = legalTargets(STATES.CREATED);
			assert.ok(Array.isArray(targets), "legalTargets must return an array");

			for (const expected of [
				STATES.ROUTED,
				STATES.COMPLETED,
				STATES.FAILED,
				STATES.ABORTED,
			]) {
				assert.ok(
					targets.includes(expected),
					`legalTargets(created) must include ${expected}`,
				);
			}

			assert.ok(
				!targets.includes(STATES.EXECUTING),
				"legalTargets(created) must exclude executing",
			);
		});
	});

	describe("isFinal", () => {
		it("is true for completed, failed, and aborted", () => {
			assert.strictEqual(isFinal(STATES.COMPLETED), true);
			assert.strictEqual(isFinal(STATES.FAILED), true);
			assert.strictEqual(isFinal(STATES.ABORTED), true);
		});

		it("is false for executing", () => {
			assert.strictEqual(isFinal(STATES.EXECUTING), false);
		});
	});

	// Edge-parity intent (CLI SSOT pin only):
	// Every web-permitted (action, from)->target edge in apps/web/server/routers/
	// session-control.ts (ALLOWED_TRANSITIONS) MUST pass isLegalTransition after
	// legacy idle/running pre-normalization. Web constants are not pure-JS-exportable
	// from this Node unit suite without pulling TS; pin CLI SSOT here and keep the
	// web-side parity suite under apps/web/tests/server/session-status-parity.test.ts
	// (and a future edge-parity test once ALLOWED_TRANSITIONS is deleted in favor of
	// isLegalTransition). Policy: CLI is authoritative — created→executing remains
	// illegal; web start must route through routed, not jump to executing.
	describe("edge-parity intent (CLI SSOT pin)", () => {
		it("documents that every web-normalized edge must pass isLegalTransition", () => {
			// Canonical CLI edges that web start/pause/resume/abort should map onto
			// after idle→created and running→executing normalization.
			const webNormalizedEdges = [
				// start from created/routed ultimately lands via routed → executing
				// (created → executing is illegal; web must not skip routed)
				[STATES.CREATED, STATES.ROUTED],
				[STATES.ROUTED, STATES.EXECUTING],
				// pause: executing → paused
				[STATES.EXECUTING, STATES.PAUSED],
				// resume: paused → executing
				[STATES.PAUSED, STATES.EXECUTING],
				// abort from executing/paused → aborted
				[STATES.EXECUTING, STATES.ABORTED],
				[STATES.PAUSED, STATES.ABORTED],
			];

			for (const [from, to] of webNormalizedEdges) {
				assert.strictEqual(
					isLegalTransition(from, to),
					true,
					`web-normalized edge ${from} → ${to} must be legal on CLI SSOT`,
				);
			}

			// Explicit anti-edge: web must not treat start-from-created as created→executing
			assert.strictEqual(
				isLegalTransition(STATES.CREATED, STATES.EXECUTING),
				false,
				"web must not allow start to skip routed (created → executing illegal)",
			);
		});
	});
});
