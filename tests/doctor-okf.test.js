"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { doctor } = require("../scripts/lib/core/doctor");
const { scaffoldHarness } = require("../scripts/lib/core/scaffold");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-doctor-okf-${name}-`));
}

test("doctor with okf option flags a non-conformant wiki page", () => {
	const target = tempDir("bad");
	scaffoldHarness(target);
	fs.writeFileSync(path.join(target, "docs", "wiki", "orphan.md"), "# Orphan\n\nno frontmatter\n");

	const result = doctor(target, { okf: true });

	assert.ok(
		result.errors.some((error) => /orphan\.md/.test(error) && /frontmatter|type/i.test(error)),
		`expected an OKF error from doctor, got: ${JSON.stringify(result.errors)}`,
	);
});

test("doctor without okf option ignores OKF conformance (backward compatible)", () => {
	const target = tempDir("default");
	scaffoldHarness(target);
	fs.writeFileSync(path.join(target, "docs", "wiki", "orphan.md"), "# Orphan\n\nno frontmatter\n");

	const result = doctor(target);

	assert.ok(!result.errors.some((error) => /frontmatter/i.test(error)));
});
