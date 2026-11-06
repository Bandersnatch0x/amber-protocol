"use strict";

// Plan-declared required context (F085, ADR-0110). A plan's `## Context
// manifests` role bullet names knowledge surfaces; this module answers one
// question per surface — "which accepted page covers it, and may that page be
// loaded?" — and refuses with one of six closed reasons otherwise.
//
// Pure: no disk access, no clock reads. The caller passes the page entries it
// already collected and the instant the build runs at, so the resolution is
// testable and the loadout build owns every side effect.

const { stripRange } = require("./context-sources");

const REQUIRED_CONTEXT_CODE = "AMBER_E_CONTEXT_LOADOUT_REQUIRED";
const REQUIRED_CONTEXT_REASONS = Object.freeze([
	"missing",
	"ambiguous",
	"unhealthy",
	"superseded",
	"time-expired",
	"stale-floor",
]);

// Coverage is a source-path match (ADR-0110): exact after normalization, no
// globs, no prefixes, no fuzzy matching. Normalization folds the spellings a
// plan and a page legitimately disagree on — `./`, backslashes, quoting, and
// case — and nothing else.
function normalizeSurfacePath(value) {
	let text = stripRange(String(value == null ? "" : value)).trim();
	text = text.replace(/^["'`]|["'`]$/g, "");
	text = text.replace(/\\/g, "/");
	while (text.startsWith("./")) text = text.slice(2);
	text = text.replace(/^\/+/, "");
	// A trailing slash names a directory, not a file surface.
	text = text.replace(/\/+$/, "");
	return text.toLowerCase();
}

function coveringRefs(page) {
	const sources = page && page.sources;
	if (!sources || typeof sources !== "object") return [];
	const refs = [];
	for (const source of Object.values(sources)) {
		if (source && typeof source.ref === "string") refs.push(source.ref);
	}
	return refs;
}

function refusal(reason, surface, role, detail) {
	return { code: REQUIRED_CONTEXT_CODE, reason, surface, role, detail };
}

function describe(pageIds) {
	return pageIds.join(", ");
}

/**
 * Resolve every declared surface to exactly one loadable page.
 *
 * @param {object} input
 * @param {Array} input.pageEntries  Entries from the loadout's page collection.
 * @param {string[]} input.requiredPaths Declared knowledge surfaces.
 * @param {string} [input.role] Role the surfaces belong to (implement|review).
 * @param {string|null} [input.freshnessFloor] Absolute ISO-8601 floor or null.
 * @param {Date|string} [input.now]
 * @returns {{ pageIds: string[], findings: Array }}
 */
function resolveRequiredContext({
	pageEntries,
	requiredPaths,
	role = null,
	freshnessFloor = null,
	now = new Date(),
}) {
	const entries = Array.isArray(pageEntries) ? pageEntries : [];
	const paths = Array.isArray(requiredPaths) ? requiredPaths : [];
	const instant = now instanceof Date ? now.getTime() : Date.parse(now);
	const floorInstant =
		typeof freshnessFloor === "string" && freshnessFloor.trim() !== ""
			? Date.parse(freshnessFloor)
			: null;
	const pageIds = [];
	const surfacesByPageId = new Map();
	const findings = [];
	for (const surface of paths) {
		const wanted = normalizeSurfacePath(surface);
		if (wanted === "") {
			findings.push(refusal("missing", surface, role, `required surface ${surface} is empty`));
			continue;
		}
		const coverers = entries.filter((entry) =>
			coveringRefs(entry.page).some((ref) => normalizeSurfacePath(ref) === wanted),
		);
		if (coverers.length === 0) {
			findings.push(
				refusal(
					"missing",
					surface,
					role,
					`no accepted Context Page covers required surface ${surface}`,
				),
			);
			continue;
		}
		// A superseded page is not current: it neither satisfies the surface nor
		// makes the successor ambiguous. Only when nothing else covers the
		// surface does the supersession itself become the refusal.
		const current = coverers.filter(
			(entry) => !Array.isArray(entry.supersededBy) || entry.supersededBy.length === 0,
		);
		if (current.length === 0) {
			const ids = coverers.map((entry) => entry.pageId).sort();
			findings.push(
				refusal(
					"superseded",
					surface,
					role,
					`required surface ${surface} is covered only by superseded page ${describe(ids)}`,
				),
			);
			continue;
		}
		if (current.length > 1) {
			const ids = current.map((entry) => entry.pageId).sort();
			findings.push(
				refusal(
					"ambiguous",
					surface,
					role,
					`required surface ${surface} is covered by ${current.length} current pages (${describe(ids)})`,
				),
			);
			continue;
		}
		const page = current[0];
		const expiresAt =
			typeof page.expiresAt === "string" && page.expiresAt.trim() !== ""
				? Date.parse(page.expiresAt)
				: null;
		if (Number.isFinite(expiresAt) && Number.isFinite(instant) && expiresAt <= instant) {
			findings.push(
				refusal(
					"time-expired",
					surface,
					role,
					`page ${page.pageId} covering required surface ${surface} expired at ${page.expiresAt}`,
				),
			);
			continue;
		}
		if (page.status !== "ok") {
			findings.push(
				refusal(
					"unhealthy",
					surface,
					role,
					`page ${page.pageId} covering required surface ${surface} has status ${page.status}`,
				),
			);
			continue;
		}
		if (floorInstant !== null && Number.isFinite(floorInstant)) {
			const revision = page.revisionAt ? Date.parse(page.revisionAt) : NaN;
			// A page with no revision instant cannot prove it meets an absolute
			// floor, and "cannot prove" fails closed like every other requirement.
			if (!Number.isFinite(revision) || revision < floorInstant) {
				findings.push(
					refusal(
						"stale-floor",
						surface,
						role,
						`page ${page.pageId} covering required surface ${surface} has revision ${page.revisionAt || "unknown"}, older than the ${role || "role"} freshness floor ${freshnessFloor}`,
					),
				);
				continue;
			}
		}
		pageIds.push(page.pageId);
		surfacesByPageId.set(page.pageId, surface);
	}
	return { pageIds: [...new Set(pageIds)].sort(), surfacesByPageId, findings };
}

module.exports = {
	REQUIRED_CONTEXT_CODE,
	REQUIRED_CONTEXT_REASONS,
	normalizeSurfacePath,
	resolveRequiredContext,
};
