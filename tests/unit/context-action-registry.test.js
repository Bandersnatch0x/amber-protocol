"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveContextAction } = require("../../scripts/lib/context/action-registry");
const { contextDispatch } = require("../../scripts/lib/context/adapters/command");

test("Context Action aliases resolve to canonical variant contracts", () => {
	assert.deepEqual(resolveContextAction("projection-status"), {
		name: "projection",
		variant: "status",
		effect: "read",
		evidence: ["context-projection"],
		approvalRequired: false,
	});
	assert.deepEqual(resolveContextAction("projection-rebuild"), {
		name: "projection",
		variant: "rebuild",
		effect: "write",
		evidence: ["context-projection"],
		approvalRequired: true,
	});
});

test("Context Action projection subcommands select distinct contracts", () => {
	assert.equal(resolveContextAction("projection", { _: ["projection", "status"] }).effect, "read");
	assert.equal(
		resolveContextAction("projection", { _: ["projection", "rebuild"] }).effect,
		"write",
	);
});

test("Context Action projection aliases execute their canonical variants", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-context-alias-"));
	try {
		const rebuilt = contextDispatch("projection-rebuild", {
			target,
			_: ["context", "projection-rebuild"],
		});
		assert.equal(rebuilt.exitCode, 0, JSON.stringify(rebuilt.result.errors));

		const status = contextDispatch("projection-status", {
			target,
			_: ["context", "projection-status"],
		});
		assert.equal(status.exitCode, 0, JSON.stringify(status.result.errors));
		assert.equal(status.result.manifest.pageCount, 0);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("Context Action preview assembles a Loadout without persisting it", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-context-preview-"));
	try {
		const fixtures = {
			"routes/feature-standard.route.json": {
				routeId: "feature-standard",
				schemaVersion: "1.0.0",
				stages: [],
			},
			"docs/wiki/agent/amber.md": "# Amber\n",
			"docs/wiki/agent/context-loadout.md": "# Context Loadout\n",
		};
		for (const [relative, value] of Object.entries(fixtures)) {
			const full = path.join(target, relative);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value), "utf8");
		}

		const preview = contextDispatch("preview", {
			target,
			_: ["context", "preview"],
			route: "feature-standard",
			json: true,
		});
		assert.equal(preview.exitCode, 0, JSON.stringify(preview.result.errors));
		assert.equal(preview.result.loadout.route, "feature-standard");
		assert.equal(preview.result.loadoutPath, undefined);
		assert.equal(fs.existsSync(path.join(target, ".amber")), false);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
