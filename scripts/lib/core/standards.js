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

// Inspect the ACTUAL governance controls deployed in the target repo (not just
// labels). Each control backs one or more ASI risks; a risk is `present` only if
// its specific control is genuinely in place. Runtime-only risks carry no
// `control` field and are therefore never present (Amber cannot deploy them).
function inspectControls(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");

	let rules = [];
	if (fs.existsSync(rulesPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
			if (parsed && Array.isArray(parsed.rules)) rules = parsed.rules;
		} catch {
			/* unparseable rules count as no rules */
		}
	}
	const hasDenyRule = rules.some((r) => r && r.action === "deny");
	const hasAllowRule = rules.some((r) => r && r.action === "allow");

	// Scan all hash-chain ledger homes: loops, routes, AND sessions.
	let hasHashChainLedger = false;
	let hasApprovalRecord = false;
	const ledgerHomes = [
		path.join(stateDir, "loops"), // .amber/loops/<contract>/ledger.jsonl
		path.join(stateDir, "routes"), // .amber/routes/<routeId>/ledger.jsonl
		path.join(stateDir, "sessions"), // .amber/sessions/<id>/ledger.jsonl
	];
	for (const home of ledgerHomes) {
		if (!fs.existsSync(home)) continue;
		for (const sub of fs.readdirSync(home)) {
			const ledgerPath = path.join(home, sub, "ledger.jsonl");
			if (!fs.existsSync(ledgerPath)) continue;
			const raw = fs.readFileSync(ledgerPath, "utf8");
			const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
			if (lines.length > 0) hasHashChainLedger = true;
			for (const line of lines) {
				try {
					const rec = JSON.parse(line);
					if (rec.kind === "approved" || rec.kind === "gate_passed") hasApprovalRecord = true;
				} catch {
					/* skip unparseable ledger line */
				}
			}
			if (hasApprovalRecord) break;
		}
		if (hasApprovalRecord) break;
	}

	return {
		hasPolicyRules: rules.length > 0,
		hasDenyRule,
		hasAllowRule,
		hasHashChainLedger,
		hasApprovalRecord,
	};
}

function mapStandards(targetRoot, framework = "owasp-agentic") {
	let def;
	try {
		def = loadFramework(framework);
	} catch (e) {
		return { target: targetRoot, framework, risks: [], errors: [`Unknown framework: ${framework}`], warnings: [] };
	}
	const controls = inspectControls(targetRoot);
	const risks = def.risks.map((r) => {
		// A risk is "present" only if it declares a control AND that control is deployed.
		// Runtime-only risks (no `control` field) are never present.
		const present = r.control ? Boolean(controls[r.control]) : false;
		return { ...r, present };
	});
	return {
		target: targetRoot,
		framework: def.framework,
		disclaimer: def.disclaimer,
		source: def.source,
		controls,
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

module.exports = { mapStandards, loadFramework, inspectControls };
