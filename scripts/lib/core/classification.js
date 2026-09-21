"use strict";

// Trusted-control context/runtime contract §3.1 — the classification
// vocabulary, its deterministic rank order, the stored-field vs
// effective-projection rule, TTL parsing, and the ceiling admission rule.
// Pure module: no fs, no clock — callers pass instants explicitly.

// public(0) < internal(1) < confidential(2) < restricted(3) < secret(4);
// `unknown` carries no rank and never satisfies any ceiling.
const CLASSIFICATION_RANK = Object.freeze({
	public: 0,
	internal: 1,
	confidential: 2,
	restricted: 3,
	secret: 4,
});

const CLASSIFICATIONS = Object.freeze(Object.keys(CLASSIFICATION_RANK));

const CEILING_REFUSALS = Object.freeze({
	UNKNOWN: "classification-unknown",
	CEILING: "classification-ceiling",
});

/**
 * Rank of a classification, or null for anything outside the closed set
 * (including `unknown`) — a rank-less value never satisfies a ceiling.
 * @param {string} classification
 * @returns {number|null}
 */
function rankOf(classification) {
	const rank = CLASSIFICATION_RANK[classification];
	return rank === undefined ? null : rank;
}

/**
 * The §3.1 effective projection. The stored field is canonical and wins; a
 * governed-ingest source (Context Page or Required Artifact — everything in
 * the context store entered through governed ingest, the provenance boundary)
 * without a stored label projects effective `internal`, recorded via
 * `classificationSource: "effective-default"`; anything else is `unknown`,
 * never a defaulted internal.
 * @param {{stored?: string|null, governed?: boolean}} input
 * @returns {{classification: string, classificationSource: "stored"|"effective-default"|"unlabeled"}}
 */
function effectiveClassificationOf(input) {
	const stored = input && input.stored;
	if (typeof stored === "string" && CLASSIFICATION_RANK[stored] !== undefined) {
		return { classification: stored, classificationSource: "stored" };
	}
	if (input && input.governed) {
		return { classification: "internal", classificationSource: "effective-default" };
	}
	return { classification: "unknown", classificationSource: "unlabeled" };
}

/**
 * Deterministic admission under a ceiling: a source is admitted iff
 * rank(classification) ≤ rank(ceiling). `unknown` never satisfies any ceiling
 * (explicit `classification-unknown` refusal, never a silent pass). A null
 * ceiling configures no constraint — nothing is classification-denied.
 * @param {string} classification
 * @param {string|null} maxClassification
 * @returns {{ok: true}|{ok: false, refusal: string}}
 */
function admittedUnderCeiling(classification, maxClassification) {
	if (maxClassification === undefined || maxClassification === null) return { ok: true };
	const sourceRank = rankOf(classification);
	if (sourceRank === null) return { ok: false, refusal: CEILING_REFUSALS.UNKNOWN };
	const ceilingRank = rankOf(maxClassification);
	if (ceilingRank === null) return { ok: false, refusal: CEILING_REFUSALS.UNKNOWN };
	if (sourceRank > ceilingRank) return { ok: false, refusal: CEILING_REFUSALS.CEILING };
	return { ok: true };
}

// ISO-8601 durations (the page `ttl` surface): PnY nM nD (and the time half),
// weeks allowed. At least one component must be present.
const ISO_DURATION_PATTERN =
	/^P(?=(\d|T\d))(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?=(\d))?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * Parse an ISO-8601 duration into milliseconds. Years use the 365-day
 * commercial year and months the 30-day commercial month — the precision is
 * deliberate (a hard expiry needs a deterministic conversion, not calendar
 * arithmetic); days/hours/minutes/seconds are exact.
 * @param {string} text
 * @returns {number|null} milliseconds, or null when the text is not a duration
 */
function parseIsoDuration(text) {
	if (typeof text !== "string") return null;
	const match = ISO_DURATION_PATTERN.exec(text);
	if (!match) return null;
	const [, , years, months, days, _tGuard, hours, minutes, seconds] = match;
	const ms =
		(Number(years ?? 0) * 365 * 24 * 3600 +
			Number(months ?? 0) * 30 * 24 * 3600 +
			Number(days ?? 0) * 24 * 3600 +
			Number(hours ?? 0) * 3600 +
			Number(minutes ?? 0) * 60 +
			Number(seconds ?? 0)) *
		1000;
	return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * The effective hard deadline for a source with a `ttl`: base instant plus
 * the duration. A source without a ttl carries null (content staleness only).
 * @param {{ttl?: string|null}} metadata
 * @param {string|Date} base - the page's ingest/refresh instant
 * @returns {string|null} RFC3339 expiry, or null when no ttl applies
 */
function expiresAtFromTtl(metadata, base) {
	const ttl = metadata && metadata.ttl;
	const ms = parseIsoDuration(ttl);
	if (ms === null) return null;
	const baseTime = base instanceof Date ? base.getTime() : Date.parse(base);
	if (!Number.isFinite(baseTime)) return null;
	return new Date(baseTime + ms).toISOString();
}

module.exports = {
	CLASSIFICATIONS,
	CLASSIFICATION_RANK,
	CEILING_REFUSALS,
	rankOf,
	effectiveClassificationOf,
	admittedUnderCeiling,
	parseIsoDuration,
	expiresAtFromTtl,
};
