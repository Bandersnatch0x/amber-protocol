"use strict";

// F058 — instruction-surface Eval CLI (run / list / show). Report-only.
// Envelope, routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget } = require("./command-helpers");
const {
	SUITE_ID,
	runInstructionSurfaceEvals,
	listInstructionSurfaceEvals,
	showInstructionSurfaceEval,
} = require("./core/instruction-surface-evals");

function formatSuite(suite) {
	const lines = [`${suite.suiteId}  ${suite.overall}  (assurance ${suite.assurance})`];
	for (const item of suite.evals) {
		const count = item.findings.length;
		const suffix = item.status === "fail" ? `  ${count} finding${count === 1 ? "" : "s"}` : "";
		// D-2 (grill G-1): every pass states the population it was earned over.
		const scannedSummary = Object.entries(item.scanned || {})
			.map(([scope, total]) => `${total} ${scope}`)
			.join(", ");
		lines.push(
			`  ${item.evalId}  ${item.status}${suffix}${scannedSummary ? `  scanned ${scannedSummary}` : ""}`,
		);
		for (const finding of item.findings) {
			lines.push(`    ${finding.code}  ${finding.subject}: ${finding.detail}`);
		}
	}
	return lines.join("\n");
}

const dispatch = defineCommand({
	command: "eval",
	actions: ["run", "list", "show"],
	handlers: {
		run: (args) => {
			const suiteName = args.suite ? String(args.suite) : SUITE_ID;
			if (suiteName !== SUITE_ID) {
				return {
					text: "",
					errors: [
						`unknown eval suite ${JSON.stringify(suiteName)} (expected "${SUITE_ID}") [AMBER_E_INVALID_ARG] → fix: amber eval run --suite ${SUITE_ID} --target <repo>`,
					],
					warnings: [],
					exitCode: 1,
				};
			}
			const targetRoot = resolveTarget(args);
			const suite = runInstructionSurfaceEvals(targetRoot);
			return {
				text: args.json ? JSON.stringify(suite, null, 2) : formatSuite(suite),
				errors: [],
				warnings: [],
				exitCode: suite.overall === "pass" ? 0 : 1,
			};
		},
		list: () => {
			const listed = listInstructionSurfaceEvals();
			return {
				text: JSON.stringify({ suiteId: SUITE_ID, evals: listed }, null, 2),
				errors: [],
				warnings: [],
				exitCode: 0,
			};
		},
		show: (args) => {
			const evalId = args.id || args._?.[1];
			if (!evalId) {
				return {
					text: "",
					errors: [
						"eval show requires --id <evalId> [AMBER_E_INVALID_ARG] → fix: amber eval list --target <repo>",
					],
					warnings: [],
					exitCode: 1,
				};
			}
			const shown = showInstructionSurfaceEval(String(evalId));
			if (!shown) {
				return {
					text: "",
					errors: [`unknown eval ${JSON.stringify(evalId)}`],
					warnings: [],
					exitCode: 1,
				};
			}
			return {
				text: JSON.stringify(shown, null, 2),
				errors: [],
				warnings: [],
				exitCode: 0,
			};
		},
	},
});

function evalDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { evalDispatch };
