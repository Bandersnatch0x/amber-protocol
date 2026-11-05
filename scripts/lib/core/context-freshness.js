"use strict";

// Context freshness policy (ADR-0109): one deterministic place that answers
// "how old is this page?" and "what does recorded feedback do to its
// confidence?". Verify, refresh, Loadout assembly, and assurance all read the
// same answer — no consumer re-derives an expiry or a decay rule.

const { expiresAtFromTtl } = require("./classification");
const { readPage, appendEvent } = require("./context-store");

const FEEDBACK_VERDICTS = Object.freeze(["contradicted", "confirmed"]);
const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);

// Two page clocks, both read from the append-only event log:
//   - the latest accepted/no-change ingest is the page's current revision
//     instant (TTL base and feedback window start);
//   - the latest page-written event is the fallback when a page predates
//     ingest evidence.
function summarizeFreshnessActivity(events) {
	const latestIngestAtByPage = {};
	const latestWriteAtByPage = {};
	for (const event of events) {
		if (!event || !event.at || !event.pageId) continue;
		if (
			event.kind === "ingest" &&
			(event.outcome === "accepted" || event.outcome === "no-change")
		) {
			const previous = latestIngestAtByPage[event.pageId];
			if (!previous || event.at > previous) latestIngestAtByPage[event.pageId] = event.at;
		} else if (event.kind === "page-written") {
			const previous = latestWriteAtByPage[event.pageId];
			if (!previous || event.at > previous) latestWriteAtByPage[event.pageId] = event.at;
		}
	}
	return { latestIngestAtByPage, latestWriteAtByPage };
}

// The TTL base is the page's ingest/refresh instant, exactly as the page
// schema describes it. A stored created_at only applies to pages that carry no
// ingest evidence (pre-existing pages and hand-written fixtures).
//
// A raw-only rebase is not a re-distillation, so it does not restart the
// window: cosmetic source edits still let the page expire on wall-clock time.
// Re-ingest is the operation that restarts it, because it writes an accepted
// ingest event.
function pageBaseInstant(page, activity) {
	const ingestAt = activity.latestIngestAtByPage[page.pageId];
	if (ingestAt) return ingestAt;
	if (typeof page.created_at === "string" && page.created_at.trim() !== "") {
		return page.created_at;
	}
	return activity.latestWriteAtByPage[page.pageId] || null;
}

function pageExpiresAt(page, activity) {
	return expiresAtFromTtl(page, pageBaseInstant(page, activity));
}

function isTimeExpired(expiresAt, now = new Date()) {
	if (!expiresAt) return false;
	const expiry = Date.parse(expiresAt);
	const instant = now instanceof Date ? now.getTime() : Date.parse(now);
	if (!Number.isFinite(expiry) || !Number.isFinite(instant)) return false;
	return expiry <= instant;
}

// Feedback counts since the page's current revision. A re-ingest starts a new
// revision, so an old contradiction cannot keep decaying a freshly distilled
// page.
function feedbackForPage(events, pageId, sinceInstant) {
	const counts = { contradicted: 0, confirmed: 0 };
	for (const event of events) {
		if (event.kind !== "knowledge-feedback" || event.pageId !== pageId) continue;
		if (sinceInstant && event.at && !(event.at > sinceInstant)) continue;
		if (event.verdict === "contradicted") counts.contradicted += 1;
		else if (event.verdict === "confirmed") counts.confirmed += 1;
	}
	return counts;
}

// Deterministic decay: each recorded contradiction drops one level, floored at
// low. An unspecified stored confidence becomes low once contradicted. No
// weights, no age score — age is already expressed as freshness.
function effectiveConfidence(stored, contradictions) {
	if (!Number.isInteger(contradictions) || contradictions <= 0) return stored || null;
	const index = CONFIDENCE_LEVELS.indexOf(stored);
	if (index === -1) return "low";
	return CONFIDENCE_LEVELS[Math.max(0, index - contradictions)];
}

/**
 * Record one append-only knowledge-feedback event. Never rewrites the page:
 * the next ingest is what changes content, and the next read derives the
 * effective confidence from the events.
 * @returns {{ok: true, event: Object}|{ok: false, errors: string[]}}
 */
function recordFeedback(targetRoot, { pageId, verdict, note } = {}) {
	const errors = [];
	if (typeof pageId !== "string" || pageId.trim() === "") {
		errors.push("context feedback requires --page <id>.");
	}
	if (!FEEDBACK_VERDICTS.includes(verdict)) {
		errors.push(`--verdict must be one of ${FEEDBACK_VERDICTS.join(", ")}.`);
	}
	if (note !== undefined && (typeof note !== "string" || note.trim() === "")) {
		errors.push("--note must be a non-empty string when provided.");
	}
	if (errors.length > 0) return { ok: false, errors };
	if (!readPage(targetRoot, pageId)) {
		return { ok: false, errors: [`page not found: ${pageId}`] };
	}
	const event = appendEvent(targetRoot, {
		kind: "knowledge-feedback",
		pageId,
		verdict,
		...(note === undefined ? {} : { note: note.trim() }),
	});
	return { ok: true, event };
}

module.exports = {
	FEEDBACK_VERDICTS,
	CONFIDENCE_LEVELS,
	summarizeFreshnessActivity,
	pageBaseInstant,
	pageExpiresAt,
	isTimeExpired,
	feedbackForPage,
	effectiveConfidence,
	recordFeedback,
};
