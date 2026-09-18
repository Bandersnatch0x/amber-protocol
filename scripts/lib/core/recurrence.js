"use strict";

// Recurrence measurement (trusted-control evolution contract §9, spec E8;
// implementation plan Slice 4).
//
// Recurrence is a RATE: fingerprint occurrences divided by an exposure
// denominator over the SAME bounded window. A raw count drop caused by lower
// usage is not improvement, so no before/after comparison is computed here or
// anywhere else — this module derives one window's numbers and nothing else.
// When the denominator is zero or unavailable the report says `unknown`; a
// number is never fabricated.
//
// The window is the one the F064 collector already declares: the newest
// `ceiling` transcript files per host home (F064 §3 "a host file ceiling
// bounds how many recent transcripts are scanned"). This module measures that
// declared window; it does not widen it.

// The denominator state is a closed set. `unknown` is not an error and not a
// zero: a zero denominator means "the window was scanned and held nothing",
// unknown means "the window could not be established" — the two must never be
// conflated (contract E7 discipline: unknown ≠ empty).
const RECURRENCE_DENOMINATOR_STATES = Object.freeze(["measured", "unknown"]);

/**
 * Derive one window's recurrence evidence.
 *
 * @param {{ occurrences?: unknown, transcriptsScanned?: unknown, window?: unknown }} input
 *   `occurrences` — fingerprint occurrence count inside the window.
 *   `transcriptsScanned` — the exposure denominator for the SAME window.
 *   `window` — a short human-readable description of the bounded window.
 * @returns {{
 *   occurrences: number,
 *   transcriptsScanned: number | null,
 *   recurrenceRate: number | null,
 *   denominator: "measured" | "unknown",
 *   window: string,
 * }}
 *   `recurrenceRate` is `null` — reported as `unknown` — whenever the
 *   denominator is absent, non-finite, or zero. It is never 0 as a stand-in
 *   for "cannot be computed".
 */
function deriveRecurrence(input) {
	const source = input && typeof input === "object" ? input : {};
	const occurrences =
		Number.isFinite(source.occurrences) && source.occurrences >= 0
			? Math.trunc(source.occurrences)
			: 0;
	const denominatorUsable =
		Number.isFinite(source.transcriptsScanned) && source.transcriptsScanned > 0;
	const transcriptsScanned = denominatorUsable ? Math.trunc(source.transcriptsScanned) : null;
	return {
		occurrences,
		transcriptsScanned,
		recurrenceRate: denominatorUsable ? occurrences / transcriptsScanned : null,
		denominator: denominatorUsable ? "measured" : "unknown",
		window: typeof source.window === "string" && source.window !== "" ? source.window : "unknown",
	};
}

/**
 * The declared F064 window, as a short description: the newest `ceiling`
 * transcript files per host home (the same bound the collector applies).
 *
 * @param {number} ceiling
 * @returns {string}
 */
function transcriptWindowLabel(ceiling) {
	return `newest ${ceiling} transcript files per host home`;
}

module.exports = {
	RECURRENCE_DENOMINATOR_STATES,
	deriveRecurrence,
	transcriptWindowLabel,
};