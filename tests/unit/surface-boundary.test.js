"use strict";

// F083 — the experimental surface boundary.
//
// Six command families are marked experimental rather than deleted: `harness`,
// `runner`, `retention`, `external`, `breakglass`, and `sync`. They stay
// callable and appear only under `amber --all`, each carrying a visible marker.
//
// This suite asserts the boundary from the registry and from real execution /
// action-type declarations — never from README prose. It is built to fail: the
// `boundaryViolations` predicate is probed against a synthetic core family that
// was given scheduling and detached-process authority, and that probe must
// report the violation. A predicate that cannot reject a core family is not
// evidence.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	COMMANDS,
	COMMAND_STABILITIES,
	COMMAND_DEFINITIONS,
	DEFAULT_COMMANDS,
} = require("../../scripts/lib/command-registry.js");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const ACTION_TYPES_DIR = path.join(ROOT, "action-types");

const VALID_STABILITIES = ["core", "experimental"];

// The literal boundary. Experimental is exactly these six; the default surface
// is exactly the seven primary verbs.
const EXPERIMENTAL_FAMILIES = ["breakglass", "external", "harness", "retention", "runner", "sync"];
const CORE_STABILITY_FAMILIES = [
	"accept",
	"adapter",
	"approval",
	"artifact",
	"audit",
	"break-loop",
	"clean",
	"context",
	"contracts",
	"doctor",
	"drift",
	"eval",
	"evidence",
	"execution",
	"explain",
	"feature",
	"gate",
	"governance",
	"handoff",
	"hooks",
	"init",
	"knowledge",
	"learnings",
	"ledger",
	"loop",
	"maintain",
	"maintenance",
	"memory",
	"migrate",
	"next",
	"pack",
	"phase",
	"plan",
	"policy",
	"principal",
	"profile",
	"projection",
	"release",
	"result",
	"review",
	"route",
	"security",
	"session",
	"status",
	"task",
	"wiki",
	"workflow",
];
const DEFAULT_VISIBLE = ["audit", "init", "doctor", "next", "plan", "handoff", "session"];

// Which command family owns a module that declares execution authority. The
// governed-runner execution seam belongs to the `runner` family; the bounded
// runtime scheduler and its daemon belong to `harness`; the sync transport
// belongs to `sync`. A declaration site in a module absent from this map is
// itself reported as a violation, so a new detached spawn or schedule cannot
// slip in unmapped.
const FAMILY_BY_MODULE = new Map([
	["scripts/amber-runtime.js", "harness"],
	["scripts/lib/harness/runtime-core.js", "harness"],
	["scripts/lib/harness/execution-adapter.js", "harness"],
	["scripts/lib/core/execution-domain-adapter.js", "runner"],
	["scripts/lib/core/governed-runner.js", "runner"],
	["scripts/lib/core/evidence-runner.js", "runner"],
	["scripts/lib/core/sync-transport.js", "sync"],
	["scripts/lib/core/loops.js", "loop"],
	["scripts/lib/core/loop-execution.js", "loop"],
]);

// A fire-and-forget detached process (`detached: true`, e.g. the daemon
// self-spawn with ignored stdio). The awaited `detached: process.platform !==
// "win32"` spawns give a governed child its own process group so a cancellation
// can address the whole tree; they are awaited, not backgrounded, so they are
// deliberately outside this boundary definition.
const DETACHED_PROCESS = /detached:\s*true/;
const SCHEDULES_WORK = /schedulesJobs:\s*true/;

function walkJs(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkJs(full, out);
		else if (entry.name.endsWith(".js")) out.push(full);
	}
	return out;
}

function relative(file) {
	return path.relative(ROOT, file).split(path.sep).join("/");
}

// Real execution declarations: every `schedulesJobs: true` and every
// fire-and-forget `detached: true` in the tracked source, with file and line.
function declaredAuthoritySites() {
	const sites = [];
	for (const file of walkJs(SCRIPTS_DIR)) {
		const rel = relative(file);
		fs.readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, index) => {
				if (SCHEDULES_WORK.test(line)) {
					sites.push({ rel, line: index + 1, capability: "schedulesJobs" });
				}
				if (DETACHED_PROCESS.test(line)) {
					sites.push({ rel, line: index + 1, capability: "detached" });
				}
			});
	}
	return sites;
}

// Real action-type declarations: each Action Type binds an action to one or
// more command families and declares its execution mode and approvers.
function actionTypeDeclarations() {
	return fs
		.readdirSync(ACTION_TYPES_DIR)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			const def = JSON.parse(fs.readFileSync(path.join(ACTION_TYPES_DIR, name), "utf8"));
			const families = new Set();
			const execution = def.execution || {};
			if (typeof execution.command === "string") families.add(execution.command);
			for (const variant of Object.values(execution.variants || {})) {
				if (variant && typeof variant.command === "string") families.add(variant.command);
			}
			return {
				actionTypeId: def.actionTypeId,
				families: [...families],
				mode: def.mode || "interactive",
				approvers: (def.governance && def.governance.approver) || [],
			};
		});
}

// The boundary predicate. A family carries scheduling / detached authority when
// a declaration schedules work, fires a detached process, or lets an action run
// unattended (`autonomous` mode, or a `loop-contract` approver). A declaration
// site whose module has no owning family is reported too — silence is not a pass.
function boundaryViolations({ stabilityByCommand, familyByModule, executionSites, actionTypes }) {
	const violations = [];
	for (const site of executionSites) {
		const family = familyByModule.get(site.rel);
		if (!family) {
			violations.push({
				kind: "unmapped-authority-site",
				rel: site.rel,
				capability: site.capability,
			});
			continue;
		}
		if (stabilityByCommand[family] === "core") {
			violations.push({ kind: `core-${site.capability}`, family, rel: site.rel });
		}
	}
	for (const action of actionTypes) {
		const unattended = action.mode === "autonomous" || action.approvers.includes("loop-contract");
		if (!unattended) continue;
		for (const family of action.families) {
			if (stabilityByCommand[family] === "core") {
				violations.push({
					kind: "core-unattended-action-type",
					family,
					actionTypeId: action.actionTypeId,
				});
			}
		}
	}
	return violations;
}

test("the registry declares the literal core and experimental stability sets", () => {
	assert.deepEqual(Object.keys(COMMAND_STABILITIES), COMMANDS);
	assert.deepEqual(Object.keys(COMMAND_DEFINITIONS), COMMANDS);
	for (const name of COMMANDS) {
		assert.ok(
			VALID_STABILITIES.includes(COMMAND_DEFINITIONS[name].stability),
			`${name} stability must be one of ${VALID_STABILITIES.join(" | ")}`,
		);
		assert.equal(COMMAND_DEFINITIONS[name].stability, COMMAND_STABILITIES[name]);
	}

	const core = COMMANDS.filter((name) => COMMAND_STABILITIES[name] === "core").sort();
	assert.deepEqual(core, CORE_STABILITY_FAMILIES);

	const experimental = COMMANDS.filter(
		(name) => COMMAND_STABILITIES[name] === "experimental",
	).sort();
	assert.deepEqual(experimental, EXPERIMENTAL_FAMILIES);

	// The seven primary verbs remain the default surface, and no experimental
	// family leaks into it — they are reachable only through `amber --all`.
	assert.deepEqual(DEFAULT_COMMANDS, DEFAULT_VISIBLE);
	for (const family of EXPERIMENTAL_FAMILIES) {
		assert.ok(
			!DEFAULT_COMMANDS.includes(family),
			`experimental family ${family} must not appear in the default surface`,
		);
	}
});

test("no core family declares scheduling or detached-process authority", () => {
	const executionSites = declaredAuthoritySites();
	assert.ok(
		executionSites.length > 0,
		"the scanner must find the real declarations; a vacuous scan is not evidence",
	);
	const actionTypes = actionTypeDeclarations();
	assert.ok(actionTypes.length > 0, "the Action Type registry must not be empty");

	const violations = boundaryViolations({
		stabilityByCommand: COMMAND_STABILITIES,
		familyByModule: FAMILY_BY_MODULE,
		executionSites,
		actionTypes,
	});
	assert.deepEqual(
		violations,
		[],
		`core family crossed the surface boundary: ${JSON.stringify(violations)}`,
	);

	// The real declarations are owned by experimental families, and the scheduler
	// plus its detached daemon are the harness family's.
	const ownerFamilies = new Set(executionSites.map((site) => FAMILY_BY_MODULE.get(site.rel)));
	for (const family of ownerFamilies) {
		assert.equal(
			COMMAND_STABILITIES[family],
			"experimental",
			`family ${family} owns a scheduling/detached declaration but is not experimental`,
		);
	}
	assert.ok(ownerFamilies.has("harness"), "the scheduler declaration must be owned by harness");
});

test("the boundary predicate rejects a core family given scheduling authority", () => {
	// The self-check: the same predicate, fed a core family that was given the
	// capabilities, must report them. Otherwise the assertion above proves nothing.
	const probe = boundaryViolations({
		stabilityByCommand: { audit: "core", harness: "experimental" },
		familyByModule: new Map([
			["scripts/x.js", "audit"],
			["scripts/lib/harness/runtime-core.js", "harness"],
		]),
		executionSites: [
			{ rel: "scripts/x.js", capability: "schedulesJobs" },
			{ rel: "scripts/x.js", capability: "detached" },
			{ rel: "scripts/unmapped.js", capability: "schedulesJobs" },
		],
		actionTypes: [
			{
				actionTypeId: "amber.audit.run",
				families: ["audit"],
				mode: "autonomous",
				approvers: ["human"],
			},
		],
	});
	assert.ok(
		probe.some(
			(violation) => violation.kind === "core-schedulesJobs" && violation.family === "audit",
		),
		"a core family that schedules work must be rejected",
	);
	assert.ok(
		probe.some((violation) => violation.kind === "core-detached" && violation.family === "audit"),
		"a core family that fires a detached process must be rejected",
	);
	assert.ok(
		probe.some(
			(violation) =>
				violation.kind === "core-unattended-action-type" && violation.family === "audit",
		),
		"a core family with an unattended action type must be rejected",
	);
	assert.ok(
		probe.some((violation) => violation.kind === "unmapped-authority-site"),
		"a declaration site with no owning family must be rejected",
	);

	// The same declarations under an experimental family are not violations.
	const allowed = boundaryViolations({
		stabilityByCommand: { harness: "experimental" },
		familyByModule: new Map([["scripts/x.js", "harness"]]),
		executionSites: [{ rel: "scripts/x.js", capability: "schedulesJobs" }],
		actionTypes: [
			{
				actionTypeId: "amber.harness.run",
				families: ["harness"],
				mode: "autonomous",
				approvers: ["loop-contract"],
			},
		],
	});
	assert.deepEqual(allowed, []);
});
