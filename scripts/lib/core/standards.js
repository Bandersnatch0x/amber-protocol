"use strict";

// GLX standards mapping (A): an HONEST coverage report of Amber's governance
// controls against the OWASP Top 10 for Agentic Applications 2026. Amber is a
// static, non-runtime layer, so most ASI risks are out-of-scope by design — the
// report must never claim "covered" for a runtime-only risk.
const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("../state-dir-resolver");

const FRAMEWORK_FILES = {
	"owasp-agentic": "owasp-agentic-2026",
	"owasp-agentic-2026": "owasp-agentic-2026",
};

function loadFramework(framework) {
	const base = FRAMEWORK_FILES[framework] || framework;
	const file = path.join(__dirname, "..", "..", "..", "standards", `${base}.json`);
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Which ASI ids does the target's own rules.json reference via rule.mapsTo?
function referencedRiskIds(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");
	const ids = new Set();
	if (!fs.existsSync(rulesPath)) return ids;
	try {
		const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
		for (const rule of parsed.rules || []) {
			for (const id of rule.mapsTo || []) ids.add(id);
		}
	} catch {
		/* ignore unparseable rules */
	}
	return ids;
}

function mapStandards(targetRoot, framework = "owasp-agentic") {
	let def;
	try {
		def = loadFramework(framework);
	} catch (e) {
		return { target: targetRoot, framework, risks: [], errors: [`Unknown framework: ${framework}`], warnings: [] };
	}
	const referenced = referencedRiskIds(targetRoot);
	const risks = def.risks.map((r) => ({ ...r, present: referenced.has(r.id) }));
	return {
		target: targetRoot,
		framework: def.framework,
		disclaimer: def.disclaimer,
		source: def.source,
		risks,
		summary: {
			governance: risks.filter((r) => r.amberCoverage === "governance").length,
			partial: risks.filter((r) => r.amberCoverage === "partial").length,
			outOfScope: risks.filter((r) => r.amberCoverage === "out-of-scope").length,
		},
		errors: [],
		warnings: [],
	};
}

module.exports = { mapStandards, loadFramework };
