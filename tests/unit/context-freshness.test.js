"use strict";

// ADR-0109 context freshness loop: one derived expiry (ttl measured from the
// page's ingest revision), a verify status that reports it, refresh requests
// triggered by it, and append-only knowledge feedback that decays effective
// confidence without rewriting the page.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRequest } = require("../../scripts/lib/core/context-request");
const { ingestPayload } = require("../../scripts/lib/core/context-ingest");
const { verifyPages } = require("../../scripts/lib/core/context-verify");
const { refreshPages } = require("../../scripts/lib/core/context-refresh");
const { computeStats } = require("../../scripts/lib/core/context-stats");
const {
	readPage,
	readEvents,
	eventsPath,
	writePage,
	regenerateIndex,
} = require("../../scripts/lib/core/context-store");
const { previewLoadout } = require("../../scripts/lib/core/context-loadout");
const {
	summarizeFreshnessActivity,
	pageBaseInstant,
	pageExpiresAt,
	isTimeExpired,
	feedbackForPage,
	effectiveConfidence,
	recordFeedback,
} = require("../../scripts/lib/core/context-freshness");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-fresh-"));
	for (const dir of ["docs/wiki/agent", "docs/adr", "scripts/lib/core", "routes"]) {
		fs.mkdirSync(path.join(root, dir), { recursive: true });
	}
	fs.writeFileSync(path.join(root, "docs/adr/0001-x.md"), "# ADR 1\n");
	fs.writeFileSync(path.join(root, "scripts/lib/core/mutable.js"), "const x = 1;\n");
	fs.writeFileSync(
		path.join(root, "routes/probe.route.json"),
		JSON.stringify({ routeId: "probe", schemaVersion: "1.0.0", stages: [] }),
	);
	fs.writeFileSync(path.join(root, "docs/wiki/agent/amber.md"), "# Manual\n");
	fs.writeFileSync(path.join(root, "docs/wiki/agent/context-loadout.md"), "# Loadout\n");
	return root;
}

function cleanup(root) {
	fs.rmSync(root, { recursive: true, force: true });
}

function seedPage(root, pageId, extra = {}) {
	const request = createRequest(root, {
		pageId,
		title: pageId,
		reason: "explicit",
		sources: [{ ref: "docs/adr/0001-x.md" }],
	});
	assert.deepEqual(request.errors, []);
	const source = request.request.sources[0];
	const result = ingestPayload(root, {
		requestId: request.requestId,
		payload: {
			schemaVersion: "1.0.0",
			pageId,
			title: pageId,
			sources: {
				s1: {
					kind: source.kind,
					ref: source.ref,
					rawHash: source.rawHash,
					excerpt: source.excerpt,
					excerptHash: source.excerptHash,
					mutable: false,
				},
			},
			blocks: [{ type: "prose", sources: ["s1"], text: `Content of ${pageId}.` }],
			...extra,
		},
	});
	assert.equal(result.accepted, true, JSON.stringify(result.errors));
	return result;
}

// Rewrite every event's timestamp so the page's revision instant is old.
function backdateEvents(root, pageId, at) {
	const file = eventsPath(root);
	const lines = fs
		.readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.map((line) => {
			const event = JSON.parse(line);
			if (event.pageId === pageId) event.at = at;
			return JSON.stringify(event);
		});
	fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

describe("context freshness policy", () => {
	it("prefers the latest ingest instant over the stored created_at", () => {
		const activity = {
			latestIngestAtByPage: { p: "2026-05-01T00:00:00.000Z" },
			latestWriteAtByPage: { p: "2026-06-01T00:00:00.000Z" },
		};
		const page = { pageId: "p", created_at: "2026-01-01T00:00:00.000Z" };
		assert.equal(pageBaseInstant(page, activity), "2026-05-01T00:00:00.000Z");
	});

	it("falls back to created_at only when no ingest evidence exists", () => {
		const activity = {
			latestIngestAtByPage: {},
			latestWriteAtByPage: { p: "2026-06-01T00:00:00.000Z" },
		};
		assert.equal(
			pageBaseInstant({ pageId: "p", created_at: "2026-01-01T00:00:00.000Z" }, activity),
			"2026-01-01T00:00:00.000Z",
		);
		assert.equal(pageBaseInstant({ pageId: "p" }, activity), "2026-06-01T00:00:00.000Z");
	});

	it("derives the expiry from ttl plus the revision instant", () => {
		const activity = {
			latestIngestAtByPage: { p: "2026-05-01T00:00:00.000Z" },
			latestWriteAtByPage: {},
		};
		assert.equal(pageExpiresAt({ pageId: "p", ttl: "P1D" }, activity), "2026-05-02T00:00:00.000Z");
		assert.equal(pageExpiresAt({ pageId: "p" }, activity), null);
	});

	it("treats the expiry instant as expired (half-open at the boundary)", () => {
		assert.equal(isTimeExpired("2026-05-02T00:00:00.000Z", "2026-05-02T00:00:00.000Z"), true);
		assert.equal(isTimeExpired("2026-05-02T00:00:00.000Z", "2026-05-01T23:59:59.000Z"), false);
		assert.equal(isTimeExpired(null, new Date()), false);
	});

	it("counts only feedback recorded since the page's current revision", () => {
		const events = [
			{
				kind: "knowledge-feedback",
				pageId: "p",
				verdict: "contradicted",
				at: "2026-01-01T00:00:00.000Z",
			},
			{
				kind: "knowledge-feedback",
				pageId: "p",
				verdict: "contradicted",
				at: "2026-06-01T00:00:00.000Z",
			},
			{
				kind: "knowledge-feedback",
				pageId: "q",
				verdict: "confirmed",
				at: "2026-06-01T00:00:00.000Z",
			},
		];
		assert.deepEqual(feedbackForPage(events, "p", "2026-05-01T00:00:00.000Z"), {
			contradicted: 1,
			confirmed: 0,
		});
		assert.deepEqual(feedbackForPage(events, "p"), { contradicted: 2, confirmed: 0 });
	});

	it("decays confidence one level per contradiction, floored at low", () => {
		assert.equal(effectiveConfidence("high", 0), "high");
		assert.equal(effectiveConfidence("high", 1), "medium");
		assert.equal(effectiveConfidence("high", 2), "low");
		assert.equal(effectiveConfidence("high", 9), "low");
		assert.equal(effectiveConfidence("medium", 3), "low");
		assert.equal(effectiveConfidence(null, 1), "low");
		assert.equal(effectiveConfidence(null, 0), null);
	});

	it("summarizeFreshnessActivity folds ingest and page-written events per page", () => {
		const activity = summarizeFreshnessActivity([
			{ kind: "ingest", pageId: "p", outcome: "accepted", at: "2026-01-01T00:00:00.000Z" },
			{ kind: "ingest", pageId: "p", outcome: "accepted", at: "2026-02-01T00:00:00.000Z" },
			{ kind: "ingest", pageId: "p", outcome: "rejected", at: "2026-03-01T00:00:00.000Z" },
			{ kind: "page-written", pageId: "p", at: "2026-04-01T00:00:00.000Z" },
		]);
		assert.equal(activity.latestIngestAtByPage.p, "2026-02-01T00:00:00.000Z");
		assert.equal(activity.latestWriteAtByPage.p, "2026-04-01T00:00:00.000Z");
	});
});

describe("verify reports the derived expiry", () => {
	it("marks a page whose ttl elapsed with no source change as stale-by-time", () => {
		const root = makeTarget();
		try {
			seedPage(root, "aging", { ttl: "PT1H" });
			backdateEvents(root, "aging", "2026-01-01T00:00:00.000Z");
			const result = verifyPages(root);
			const page = result.pages.find((p) => p.pageId === "aging");
			assert.equal(page.status, "stale-by-time");
			assert.ok(page.findings.some((f) => f.code === "AMBER_E_CONTEXT_PAGE_TIME_STALE"));
			assert.match(page.expiresAt, /^2026-01-01T01:00:00/);
			assert.equal(result.summary.timeStale, 1);
		} finally {
			cleanup(root);
		}
	});

	it("keeps a fresh page ok and reports no expiry when no ttl is declared", () => {
		const root = makeTarget();
		try {
			seedPage(root, "fresh");
			const result = verifyPages(root);
			const page = result.pages.find((p) => p.pageId === "fresh");
			assert.equal(page.status, "ok");
			assert.equal(page.expiresAt, null);
			assert.equal(result.summary.timeStale, 0);
		} finally {
			cleanup(root);
		}
	});

	it("source staleness outranks the time status while keeping the finding", () => {
		const root = makeTarget();
		try {
			seedPage(root, "both", { ttl: "PT1H" });
			backdateEvents(root, "both", "2026-01-01T00:00:00.000Z");
			// Rewrite the page with a mutable source whose hash no longer matches.
			const page = readPage(root, "both");
			page.sources = {
				s1: {
					kind: "code",
					ref: "scripts/lib/core/mutable.js",
					rawHash: "sha256:" + "a".repeat(64),
					normHash: "sha256:" + "b".repeat(64),
					mutable: true,
				},
			};
			writePage(root, page);
			regenerateIndex(root);
			const result = verifyPages(root);
			const checked = result.pages.find((p) => p.pageId === "both");
			assert.equal(checked.status, "stale");
			assert.ok(checked.findings.some((f) => f.code === "AMBER_E_CONTEXT_PAGE_TIME_STALE"));
			assert.equal(result.summary.timeStale, 0);
		} finally {
			cleanup(root);
		}
	});

	it("accepts an injected clock so expiry is testable without waiting", () => {
		const root = makeTarget();
		try {
			seedPage(root, "dated", { ttl: "P1D" });
			const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
			const page = verifyPages(root, { now: future }).pages.find((p) => p.pageId === "dated");
			assert.equal(page.status, "stale-by-time");
		} finally {
			cleanup(root);
		}
	});
});

describe("refresh is driven by ttl as well as source change", () => {
	it("requests a refresh for an expired page with unchanged sources", () => {
		const root = makeTarget();
		try {
			seedPage(root, "expired", { ttl: "PT1H" });
			backdateEvents(root, "expired", "2026-01-01T00:00:00.000Z");
			const result = refreshPages(root);
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.equal(result.requests.length, 1);
			assert.equal(result.requests[0].reason, "ttl-expired");
			assert.equal(result.requests[0].expiredAt, "2026-01-01T01:00:00.000Z");
			const triggers = readEvents(root).filter((e) => e.kind === "request-created");
			assert.equal(triggers[triggers.length - 1].trigger, "ttl-expired");
		} finally {
			cleanup(root);
		}
	});

	it("leaves a page with a live ttl and unchanged sources alone", () => {
		const root = makeTarget();
		try {
			seedPage(root, "alive", { ttl: "P30D" });
			const result = refreshPages(root);
			assert.deepEqual(result.requests, []);
			assert.deepEqual(result.errors, []);
		} finally {
			cleanup(root);
		}
	});

	it("reports a source change as the reason when both changed", () => {
		const root = makeTarget();
		try {
			seedPage(root, "moving", { ttl: "PT1H" });
			const page = readPage(root, "moving");
			page.sources = {
				s1: {
					kind: "code",
					ref: "scripts/lib/core/mutable.js",
					rawHash: "sha256:" + "a".repeat(64),
					normHash: "sha256:" + "b".repeat(64),
					mutable: true,
				},
			};
			writePage(root, page);
			regenerateIndex(root);
			backdateEvents(root, "moving", "2026-01-01T00:00:00.000Z");
			const result = refreshPages(root);
			assert.equal(result.requests.length, 1);
			assert.equal(result.requests[0].reason, "source-change");
		} finally {
			cleanup(root);
		}
	});

	it("a re-ingest resets the ttl window rather than keeping the old expiry", () => {
		const root = makeTarget();
		try {
			seedPage(root, "renewed", { ttl: "P1D" });
			backdateEvents(root, "renewed", "2026-01-01T00:00:00.000Z");
			assert.equal(refreshPages(root).requests.length, 1);
			// Re-ingest the same page through its refresh request, then re-check.
			const refreshRequest = readEvents(root)
				.filter((e) => e.kind === "request-created")
				.pop();
			const request = JSON.parse(
				fs.readFileSync(
					path.join(root, ".amber", "context", "requests", `${refreshRequest.requestId}.json`),
					"utf8",
				),
			);
			const source = request.sources[0];
			const payload = {
				schemaVersion: "1.0.0",
				pageId: "renewed",
				title: "renewed",
				ttl: "P1D",
				sources: {
					s1: {
						kind: source.kind,
						ref: source.ref,
						rawHash: source.rawHash,
						excerpt: source.excerpt,
						excerptHash: source.excerptHash,
						mutable: false,
					},
				},
				blocks: [{ type: "prose", sources: ["s1"], text: "Renewed content." }],
			};
			const accepted = ingestPayload(root, {
				requestId: refreshRequest.requestId,
				payload,
			});
			assert.equal(accepted.accepted, true, JSON.stringify(accepted.errors));
			assert.deepEqual(refreshPages(root).requests, []);
		} finally {
			cleanup(root);
		}
	});
});

describe("knowledge feedback", () => {
	it("records an append-only event and decays effective confidence", () => {
		const root = makeTarget();
		try {
			seedPage(root, "drifted", { assurance: { confidence: "high", maturity: "reviewed" } });
			const before = verifyPages(root).pages.find((p) => p.pageId === "drifted");
			assert.equal(before.assurance.confidence, "high");

			const recorded = recordFeedback(root, {
				pageId: "drifted",
				verdict: "contradicted",
				note: "page predates the new gate",
			});
			assert.equal(recorded.ok, true, JSON.stringify(recorded.errors));

			const after = verifyPages(root).pages.find((p) => p.pageId === "drifted");
			assert.equal(after.assurance.confidence, "medium");
			assert.equal(after.assurance.storedConfidence, "high");
			assert.deepEqual(after.assurance.feedback, { contradicted: 1, confirmed: 0 });
			// The page itself is untouched: feedback is an event, not a write.
			assert.equal(readPage(root, "drifted").assurance.confidence, "high");
		} finally {
			cleanup(root);
		}
	});

	it("refuses unknown pages, verdicts, and empty notes without appending", () => {
		const root = makeTarget();
		try {
			seedPage(root, "known");
			const before = readEvents(root).length;
			assert.equal(recordFeedback(root, { pageId: "missing", verdict: "contradicted" }).ok, false);
			assert.equal(recordFeedback(root, { pageId: "known", verdict: "maybe" }).ok, false);
			assert.equal(
				recordFeedback(root, { pageId: "known", verdict: "confirmed", note: "  " }).ok,
				false,
			);
			assert.equal(readEvents(root).length, before);
		} finally {
			cleanup(root);
		}
	});

	it("a re-ingest clears prior decay because the revision restarts the window", () => {
		const root = makeTarget();
		try {
			seedPage(root, "revised", { assurance: { confidence: "high" } });
			recordFeedback(root, { pageId: "revised", verdict: "contradicted" });
			assert.equal(
				verifyPages(root).pages.find((p) => p.pageId === "revised").assurance.confidence,
				"medium",
			);
			// Simulate a fresh ingest instant after the feedback event.
			const future = new Date(Date.now() + 1000).toISOString();
			appendFutureIngest(root, "revised", future);
			assert.equal(
				verifyPages(root).pages.find((p) => p.pageId === "revised").assurance.confidence,
				"high",
			);
		} finally {
			cleanup(root);
		}
	});

	it("stats counts recorded feedback per verdict", () => {
		const root = makeTarget();
		try {
			seedPage(root, "counted");
			recordFeedback(root, { pageId: "counted", verdict: "contradicted" });
			recordFeedback(root, { pageId: "counted", verdict: "contradicted" });
			recordFeedback(root, { pageId: "counted", verdict: "confirmed" });
			const stats = computeStats(root);
			assert.deepEqual(stats.feedback, { contradicted: 2, confirmed: 1 });
		} finally {
			cleanup(root);
		}
	});
});

describe("loadout and verify agree on the derived expiry", () => {
	it("previews the same expiresAt the verify surface reports", () => {
		const root = makeTarget();
		try {
			seedPage(root, "shared", { ttl: "P1D", classification: "internal" });
			const verified = verifyPages(root).pages.find((p) => p.pageId === "shared");
			const preview = previewLoadout(root, { route: "probe", budget: 4000 });
			assert.deepEqual(preview.errors, [], JSON.stringify(preview.errors));
			assert.equal(preview.loadout.pages["shared"].expiresAt, verified.expiresAt);
		} finally {
			cleanup(root);
		}
	});

	it("excludes a time-expired page from every tier", () => {
		const root = makeTarget();
		try {
			seedPage(root, "gone", { ttl: "PT1H" });
			backdateEvents(root, "gone", "2026-01-01T00:00:00.000Z");
			const preview = previewLoadout(root, { route: "probe", budget: 4000 });
			assert.deepEqual(preview.errors, [], JSON.stringify(preview.errors));
			assert.equal(preview.loadout.pages["gone"], undefined);
			assert.equal(preview.loadout.excluded.find((e) => e.pageId === "gone").reason, "expired");
		} finally {
			cleanup(root);
		}
	});
});

function appendFutureIngest(root, pageId, at) {
	// appendEvent stamps its own clock, so the revision instant is written
	// directly into the append-only log — the same shape a real ingest writes.
	const line = JSON.stringify({
		kind: "ingest",
		requestId: `revision-${pageId}`,
		pageId,
		outcome: "accepted",
		at,
	});
	fs.appendFileSync(eventsPath(root), `${line}\n`);
}
