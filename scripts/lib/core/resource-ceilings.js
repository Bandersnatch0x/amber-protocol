"use strict";

/**
 * Resource ceiling resolution for Canonical Artifact admission and Governance
 * Graph projection (F049 ticket 06, #223 — bounded resource contracts).
 *
 * Ceilings are the deliberate bound on unbounded-input operations: an
 * admission may refuse an oversized Body/Envelope, and a projection build may
 * refuse a graph beyond its node/edge budget — refusing is the fail-closed
 * alternative to silently emitting truncated output as if it were complete.
 *
 * Every ceiling has a documented default and an environment override so an
 * operator can raise the bound DELIBERATELY for a bigger store. Overrides are
 * validated fail-closed: a set-but-garbage value (non-integer, zero, or
 * negative) is an argument error (AMBER_E_INVALID_ARG), never silently
 * ignored — an operator who wrote AMBER_ARTIFACT_MAX_BODY_BYTES=10MB meant a
 * bound, and a typo'd bound must not degrade into "no bound" or, worse, into
 * a bound of 1 that fails every admission.
 */

const { typedError } = require("./error-catalog");

/**
 * Resolve one positive-integer ceiling from the environment.
 * @param {string} envName - Environment variable to read (e.g.
 *        "AMBER_ARTIFACT_MAX_BODY_BYTES").
 * @param {number} fallback - Default ceiling, a positive integer.
 * @param {string} label - Human-readable label for error messages.
 * @returns {number} The effective ceiling.
 * @throws {Error} Typed AMBER_E_INVALID_ARG when the override is set but is
 *         not a positive integer.
 */
function resolvePositiveIntCeiling(envName, fallback, label) {
	const raw = process.env[envName];
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw typedError(
			"AMBER_E_INVALID_ARG",
			`${envName} (${label}) must be a positive integer when set; got ${JSON.stringify(raw)} — unset it for the default ${fallback} or set an explicit bound`,
		);
	}
	return value;
}

module.exports = { resolvePositiveIntCeiling };
