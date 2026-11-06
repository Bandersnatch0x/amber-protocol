"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
	REQUIRED_CONTEXT_CODE,
	REQUIRED_CONTEXT_REASONS,
	normalizeSurfacePath,
	resolveRequiredContext,
} = require("../../scripts/lib/core/context-requirements");
const { parseFreshnessFloor } = require("../../scripts/lib/core/planning");

const FLOOR = parseFreshnessFloor("2026-10-01");

// Minimal page entry shape: only the fields resolution reads.
function entry(pageId, refs, extra = {}) {
	const sources = {};
	refs.forEach((ref, index) => {
		sources[`s${index + 1}`] = { kind: "doc", ref, mutable: false };
	});
	return {
		pageId,
		status: "ok",
		supersededBy: [],
		expiresAt: null,
		revisionAt: "2026-10-15T00:00:00.000Z",
		page: { pageId, sources },
		...extra,
	};
}

function resolve(pageEntries, requiredPaths, extra = {}) {
	return resolveRequiredContext({ pageEntries, requiredPaths, ...extra });
}

describe("normalizeSurfacePath", () => {
	it("folds separators, leading ./ and /, quoting, and case", () => {
		assert.equal(normalizeSurfacePath("./docs/specs/a.md"), "docs/specs/a.md");
		assert.equal(normalizeSurfacePath("docs\\specs\\a.md"), "docs/specs/a.md");
		assert.equal(normalizeSurfacePath("/docs/specs/a.md"), "docs/specs/a.md");
		assert.equal(normalizeSurfacePath('"docs/specs/a.md"'), "docs/specs/a.md");
		assert.equal(normalizeSurfacePath("Docs/Specs/A.MD"), "docs/specs/a.md");
		assert.equal(normalizeSurfacePath("  docs/specs/a.md  "), "docs/specs/a.md");
	});

	it("strips a line-range fragment so a spanning page still covers the path", () => {
		assert.equal(normalizeSurfacePath("docs/specs/a.md#L10-L20"), "docs/specs/a.md");
	});

	it("leaves no glob or prefix semantics behind", () => {
		assert.notEqual(
			normalizeSurfacePath("docs/specs/*.md"),
			normalizeSurfacePath("docs/specs/a.md"),
		);
		assert.notEqual(normalizeSurfacePath("docs"), normalizeSurfacePath("docs/specs/a.md"));
	});
});

describe("resolveRequiredContext — resolution", () => {
	it("resolves every surface to its one current page, sorted and deduplicated", () => {
		const result = resolve(
			[entry("page-b", ["docs/adr/0001.md"]), entry("page-a", ["./docs/specs/contract.md"])],
			["docs/specs/contract.md", "docs/adr/0001.md"],
		);
		assert.deepEqual(result.findings, []);
		assert.deepEqual(result.pageIds, ["page-a", "page-b"]);
	});

	it("deduplicates two surfaces covered by the same page", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md", "docs/b.md"])],
			["docs/a.md", "docs/b.md"],
		);
		assert.deepEqual(result.findings, []);
		assert.deepEqual(result.pageIds, ["page-a"]);
	});

	it("an empty declaration resolves to no pages and no findings", () => {
		const result = resolve([entry("page-a", ["docs/a.md"])], []);
		assert.deepEqual(result.pageIds, []);
		assert.deepEqual(result.findings, []);
		assert.equal(result.surfacesByPageId.size, 0);
	});
});

describe("resolveRequiredContext — the six closed reasons", () => {
	it("missing: no page covers the surface", () => {
		const result = resolve([entry("page-a", ["docs/other.md"])], ["docs/specs/contract.md"], {
			role: "implement",
		});
		assert.deepEqual(result.pageIds, []);
		assert.equal(result.findings.length, 1);
		assert.equal(result.findings[0].code, REQUIRED_CONTEXT_CODE);
		assert.equal(result.findings[0].reason, "missing");
		assert.equal(result.findings[0].surface, "docs/specs/contract.md");
		assert.equal(result.findings[0].role, "implement");
	});

	it("ambiguous: two current pages cover one surface", () => {
		const result = resolve(
			[entry("page-b", ["docs/a.md"]), entry("page-a", ["docs/a.md"])],
			["docs/a.md"],
		);
		assert.deepEqual(result.pageIds, []);
		assert.equal(result.findings[0].reason, "ambiguous");
		assert.match(result.findings[0].detail, /page-a, page-b/);
	});

	it("unhealthy: the covering page is stale, tampered, obsolete, or orphaned", () => {
		for (const status of ["stale", "tampered", "obsolete", "orphaned"]) {
			const result = resolve([entry("page-a", ["docs/a.md"], { status })], ["docs/a.md"]);
			assert.equal(result.findings[0].reason, "unhealthy", status);
			assert.match(result.findings[0].detail, new RegExp(`status ${status}`));
		}
	});

	it("superseded: the only covering page has a successor", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md"], { supersededBy: ["page-b"] })],
			["docs/a.md"],
		);
		assert.deepEqual(result.pageIds, []);
		assert.equal(result.findings[0].reason, "superseded");
	});

	it("a superseded page does not make its current successor ambiguous", () => {
		const result = resolve(
			[
				entry("page-a", ["docs/a.md"], { supersededBy: ["page-b"] }),
				entry("page-b", ["docs/a.md"]),
			],
			["docs/a.md"],
		);
		assert.deepEqual(result.findings, []);
		assert.deepEqual(result.pageIds, ["page-b"]);
	});

	it("time-expired: the covering page is past its TTL at build time", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md"], { expiresAt: "2026-10-01T00:00:00.000Z" })],
			["docs/a.md"],
			{ now: new Date("2026-10-01T00:00:00.000Z") },
		);
		assert.deepEqual(result.pageIds, []);
		assert.equal(result.findings[0].reason, "time-expired");
	});

	it("time-expired is not raised while the TTL is still open", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md"], { expiresAt: "2026-10-02T00:00:00.000Z" })],
			["docs/a.md"],
			{ now: new Date("2026-10-01T00:00:00.000Z") },
		);
		assert.deepEqual(result.findings, []);
	});

	it("stale-floor: the covering page predates the role's declared floor", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md"], { revisionAt: "2026-09-30T23:59:59.000Z" })],
			["docs/a.md"],
			{ role: "review", freshnessFloor: FLOOR },
		);
		assert.deepEqual(result.pageIds, []);
		assert.equal(result.findings[0].reason, "stale-floor");
		assert.equal(result.findings[0].role, "review");
	});

	it("a page exactly at the floor satisfies it", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md"], { revisionAt: "2026-10-01T00:00:00.000Z" })],
			["docs/a.md"],
			{ freshnessFloor: FLOOR },
		);
		assert.deepEqual(result.findings, []);
		assert.deepEqual(result.pageIds, ["page-a"]);
	});

	it("a page with no revision instant fails an absolute floor closed", () => {
		const result = resolve([entry("page-a", ["docs/a.md"], { revisionAt: null })], ["docs/a.md"], {
			freshnessFloor: "2026-10-01",
		});
		assert.equal(result.findings[0].reason, "stale-floor");
		assert.match(result.findings[0].detail, /unknown/);
	});

	it("every reason is one of the six closed values", () => {
		assert.deepEqual([...REQUIRED_CONTEXT_REASONS].sort(), [
			"ambiguous",
			"missing",
			"stale-floor",
			"superseded",
			"time-expired",
			"unhealthy",
		]);
	});

	it("reports one finding per failing surface instead of stopping at the first", () => {
		const result = resolve(
			[entry("page-a", ["docs/a.md"], { status: "stale" })],
			["docs/a.md", "docs/missing.md"],
		);
		assert.equal(result.findings.length, 2);
		assert.deepEqual(
			result.findings.map((finding) => finding.reason),
			["unhealthy", "missing"],
		);
	});
});
