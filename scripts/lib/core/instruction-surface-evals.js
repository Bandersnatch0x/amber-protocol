"use strict";

// F058 instruction-surface Eval suite. Deterministic, model-independent,
// target-read-only. Results supply F050 Evidence with assurance `replayable`;
// they are not Approval and cannot widen execution authority.

const fs = require("node:fs");
const path = require("node:path");

const { loadActionTypes, loadFunctions } = require("../mcp-registry-loader");
const { isReadOnlyExecutable } = require("../mcp-action-contracts");
const {
	composeMcpToolDescription,
	composeFunctionToolDescription,
	findInstructionOverride,
	findUnauthorizedMutatingClaim,
} = require("../mcp-tool-description");
const { advertisedToolDescriptions } = require("../mcp-tool-surface");
const {
	SOURCE_QUOTE_BOUNDARY,
	DEFAULT_INSTRUCTIONS,
	DEFAULT_CONTRACT_CONSTRAINTS,
	SCHEMA_VERSION,
} = require("./context-request");
const { requiredArtifactSpecs, loadoutsDir } = require("./context-loadout");
const { listPages, readPage, requestsDir } = require("./context-store");
const {
	BREADCRUMB_OPEN,
	printBreadcrumb,
	verifyPrintedBreadcrumb,
} = require("../hooks-command");

const ROOT = path.resolve(__dirname, "../../..");
const SUITE_ID = "instruction-surface";
const SUITE_VERSION = 1;
const ASSURANCE = "replayable";

const EVAL_IDS = Object.freeze({
	mcp: "eval.instruction-surface.mcp-tool-description",
	context: "eval.instruction-surface.context-quote-boundary",
	breadcrumb: "eval.instruction-surface.breadcrumb-authenticity",
});

const REQUIRED_ARTIFACT_KINDS = Object.freeze([
	"operating-manual",
	"route-manifest",
	"loadout-definition",
]);

function finding(code, detail, subject) {
	return { code, detail, subject };
}

function evalResult(evalId, findings) {
	return {
		evalId,
		version: 1,
		status: findings.length === 0 ? "pass" : "fail",
		assurance: ASSURANCE,
		findings,
	};
}

const MODEL_NETWORK_RE =
	/\b(openai|openrouter|anthropic|@ai-sdk|axios|node-fetch|https?\.(request|get)|fetch\s*\()\b/i;

const MCP_SOURCE_MARKERS = ["mcp-tool-surface", "mcpActionTool", "mcpFunctionTool"];

function loadRegistries(opts = {}) {
	const actionTypesDir = opts.actionTypesDir || path.join(ROOT, "action-types");
	const actionFunctionsDir = opts.actionFunctionsDir || path.join(ROOT, "action-functions");
	const actions = loadActionTypes({ directory: actionTypesDir, schemaName: "action.type" });
	const functions = loadFunctions({ directory: actionFunctionsDir });
	return { actions, functions };
}

function inspectAdvertisedTool(findings, tool) {
	const { id, contractText, composed, advertised, readOnly } = tool;
	const override = findInstructionOverride(contractText) || findInstructionOverride(composed);
	if (override) {
		findings.push(
			finding(
				"AMBER_E_EVAL_MCP_INSTRUCTION_OVERRIDE",
				`MCP description carries instruction-override language ${JSON.stringify(override)}`,
				id,
			),
		);
	}
	if (readOnly) {
		const claim =
			findUnauthorizedMutatingClaim(contractText) || findUnauthorizedMutatingClaim(composed);
		if (claim) {
			findings.push(
				finding(
					"AMBER_E_EVAL_MCP_AUTHORITY_CLAIM",
					`read-only tool claims unauthorized capability ${JSON.stringify(claim)}`,
					id,
				),
			);
		}
	}
	if (advertised !== undefined && advertised !== composed) {
		findings.push(
			finding(
				"AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT",
				"tools/list description drifted from the contract composer",
				id,
			),
		);
	}
}

function evalMcpSourceCoupling(mcpSourcePath, findings) {
	let src;
	try {
		src = fs.readFileSync(mcpSourcePath, "utf8");
	} catch (error) {
		findings.push(
			finding(
				"AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT",
				`MCP server source unreadable: ${error.message}`,
				path.basename(mcpSourcePath),
			),
		);
		return;
	}
	for (const marker of MCP_SOURCE_MARKERS) {
		if (!src.includes(marker)) {
			findings.push(
				finding(
					"AMBER_E_EVAL_MCP_DESCRIPTION_DRIFT",
					`MCP server does not advertise tools/list through ${marker}`,
					path.basename(mcpSourcePath),
				),
			);
		}
	}
}

function evalModelIndependence(files, findings) {
	for (const file of files) {
		let src;
		try {
			src = fs.readFileSync(file, "utf8");
		} catch (error) {
			findings.push(
				finding(
					"AMBER_E_EVAL_MODEL_DEPENDENCY",
					`Eval source unreadable: ${error.message}`,
					path.basename(file),
				),
			);
			continue;
		}
		if (MODEL_NETWORK_RE.test(src)) {
			findings.push(
				finding(
					"AMBER_E_EVAL_MODEL_DEPENDENCY",
					"Eval source references a model or network client",
					path.basename(file),
				),
			);
		}
	}
}

function evalMcpToolDescriptions(opts = {}) {
	const findings = [];
	const { actions, functions } = loadRegistries(opts);
	const advertised =
		opts.advertisedDescriptions || advertisedToolDescriptions(actions, functions);
	for (const action of actions) {
		inspectAdvertisedTool(findings, {
			id: action.actionTypeId,
			contractText: action.goal,
			composed: composeMcpToolDescription(action),
			advertised: advertised[action.actionTypeId],
			readOnly: isReadOnlyExecutable(action),
		});
	}
	for (const fn of functions) {
		inspectAdvertisedTool(findings, {
			id: fn.name,
			contractText: fn.description,
			composed: composeFunctionToolDescription(fn),
			advertised: advertised[fn.name],
			readOnly: true,
		});
	}
	evalMcpSourceCoupling(opts.mcpSourcePath || path.join(ROOT, "scripts", "amber-mcp.js"), findings);
	evalModelIndependence(
		opts.modelScanFiles || [
			path.join(ROOT, "scripts", "lib", "mcp-tool-description.js"),
			path.join(ROOT, "scripts", "lib", "mcp-tool-surface.js"),
			path.join(ROOT, "scripts", "lib", "eval-commands.js"),
		],
		findings,
	);
	return evalResult(EVAL_IDS.mcp, findings);
}

function contextRequestSchemaPath(opts = {}) {
	return opts.contextRequestSchema || path.join(ROOT, "schemas", "context-request.schema.json");
}

function evalContextQuoteBoundary(targetRoot, opts = {}) {
	const findings = [];
	if (!DEFAULT_INSTRUCTIONS.includes(SOURCE_QUOTE_BOUNDARY)) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
				"Distillation Contract instructions omit the source quote-boundary rule",
				"DEFAULT_INSTRUCTIONS",
			),
		);
	}
	if (DEFAULT_CONTRACT_CONSTRAINTS.treatSourcesAsQuotedEvidence !== true) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
				"Distillation Contract constraints do not set treatSourcesAsQuotedEvidence",
				"DEFAULT_CONTRACT_CONSTRAINTS",
			),
		);
	}
	let schema;
	try {
		schema = JSON.parse(fs.readFileSync(contextRequestSchemaPath(opts), "utf8"));
	} catch (error) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
				`context-request schema unreadable: ${error.message}`,
				"schemas/context-request.schema.json",
			),
		);
		schema = null;
	}
	const constraintProps =
		schema &&
		schema.properties &&
		schema.properties.contract &&
		schema.properties.contract.properties &&
		schema.properties.contract.properties.constraints &&
		schema.properties.contract.properties.constraints.properties;
	const versionEnum =
		schema && schema.properties && schema.properties.schemaVersion && schema.properties.schemaVersion.enum;
	if (schema && (!Array.isArray(versionEnum) || !versionEnum.includes(SCHEMA_VERSION))) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
				`context-request schema does not accept Distillation Contract ${SCHEMA_VERSION}`,
				"schemas/context-request.schema.json",
			),
		);
	}
	if (schema && (!constraintProps || !constraintProps.treatSourcesAsQuotedEvidence)) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
				"context-request schema does not declare treatSourcesAsQuotedEvidence",
				"schemas/context-request.schema.json",
			),
		);
	}
	const quoteGate = JSON.stringify(schema && schema.allOf ? schema.allOf : []);
	if (
		schema &&
		(!quoteGate.includes("treatSourcesAsQuotedEvidence") || !quoteGate.includes('"const":true'))
	) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
				"context-request schema does not require treatSourcesAsQuotedEvidence=true on 1.3.0 contracts",
				"schemas/context-request.schema.json",
			),
		);
	}
	const specs = requiredArtifactSpecs("feature-standard");
	const kinds = specs.map((spec) => spec.kind);
	if (JSON.stringify(kinds) !== JSON.stringify(REQUIRED_ARTIFACT_KINDS)) {
		findings.push(
			finding(
				"AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE",
				`Required Artifact kinds drifted from the closed set ${REQUIRED_ARTIFACT_KINDS.join(",")}`,
				"requiredArtifactSpecs",
			),
		);
	}
	for (const spec of specs) {
		const normalized = String(spec.path || "").replace(/\\/g, "/");
		if (normalized.includes(".amber/context/pages/") || normalized.startsWith(".amber/context/pages")) {
			findings.push(
				finding(
					"AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE",
					`Required Artifact path occupies the Context Page store: ${spec.path}`,
					spec.kind,
				),
			);
		}
	}
	if (targetRoot) {
		let dir;
		try {
			dir = loadoutsDir(targetRoot);
		} catch (error) {
			findings.push(
				finding(
					"AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE",
					`Loadouts directory is not target-local: ${error.message}`,
					"loadouts",
				),
			);
			dir = null;
		}
		if (dir && fs.existsSync(dir)) {
			for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".json"))) {
				let loadout;
				try {
					loadout = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				} catch (error) {
					findings.push(
						finding(
							"AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE",
							`Loadout ${name} is unreadable: ${error.message}`,
							name,
						),
					);
					continue;
				}
				const required = (loadout.artifacts && loadout.artifacts.required) || [];
				for (const artifact of required) {
					const artifactPath = String(artifact.path || "").replace(/\\/g, "/");
					if (artifactPath.includes(".amber/context/pages/")) {
						findings.push(
							finding(
								"AMBER_E_EVAL_CONTEXT_REQUIRED_ARTIFACT_ROLE",
								`Loadout ${name} lists a Context Page as a Required Artifact`,
								artifactPath,
							),
						);
					}
				}
			}
		}
	}
	if (targetRoot) {
		let requestDir;
		try {
			requestDir = requestsDir(targetRoot);
		} catch (error) {
			findings.push(
				finding(
					"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
					`Distillation Contract directory is not target-local: ${error.message}`,
					"requests",
				),
			);
			requestDir = null;
		}
		if (requestDir && fs.existsSync(requestDir)) {
			for (const name of fs.readdirSync(requestDir).filter((file) => file.endsWith(".json"))) {
				let request;
				try {
					request = JSON.parse(fs.readFileSync(path.join(requestDir, name), "utf8"));
				} catch (error) {
					findings.push(
						finding(
							"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
							`Distillation Contract ${name} is unreadable: ${error.message}`,
							name,
						),
					);
					continue;
				}
				const flag =
					request &&
					request.contract &&
					request.contract.constraints &&
					request.contract.constraints.treatSourcesAsQuotedEvidence;
				if (flag !== true) {
					findings.push(
						finding(
							"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
							`Distillation Contract ${name} does not set treatSourcesAsQuotedEvidence`,
							request.requestId || name,
						),
					);
				}
				const instructions =
					request && request.contract && typeof request.contract.instructions === "string"
						? request.contract.instructions
						: "";
				if (!instructions.includes(SOURCE_QUOTE_BOUNDARY)) {
					findings.push(
						finding(
							"AMBER_E_EVAL_CONTEXT_QUOTE_BOUNDARY_MISSING",
							`Distillation Contract ${name} instructions omit the source quote-boundary rule`,
							request.requestId || name,
						),
					);
				}
			}
		}
	}
	return evalResult(EVAL_IDS.context, findings);
}

function evalBreadcrumbAuthenticity(targetRoot) {
	const findings = [];
	if (!targetRoot) {
		findings.push(
			finding(
				"AMBER_E_EVAL_BREADCRUMB_BINDING",
				"breadcrumb authenticity requires --target",
				"target",
			),
		);
		return evalResult(EVAL_IDS.breadcrumb, findings);
	}
	const printed = printBreadcrumb(targetRoot, { format: "text", force: true });
	if (printed.errors && printed.errors.length > 0) {
		findings.push(
			finding(
				"AMBER_E_EVAL_BREADCRUMB_BINDING",
				printed.errors[0],
				"hooks breadcrumb print",
			),
		);
	} else if (!printed.text) {
		findings.push(
			finding(
				"AMBER_E_EVAL_BREADCRUMB_BINDING",
				"breadcrumb print returned empty text",
				"hooks breadcrumb print",
			),
		);
	} else {
		const verified = verifyPrintedBreadcrumb(printed.text, targetRoot);
		if (!verified.ok) {
			findings.push(
				finding(
					"AMBER_E_EVAL_BREADCRUMB_BINDING",
					verified.reason || "printed breadcrumb binding did not verify",
					"hooks breadcrumb print",
				),
			);
		}
	}
	let pages;
	try {
		pages = listPages(targetRoot);
	} catch (error) {
		findings.push(
			finding(
				"AMBER_E_EVAL_BREADCRUMB_IMITATION",
				`Context Pages could not be listed: ${error.message}`,
				"pages",
			),
		);
		return evalResult(EVAL_IDS.breadcrumb, findings);
	}
	for (const entry of pages) {
		let page;
		try {
			page = readPage(targetRoot, entry.pageId);
		} catch (error) {
			findings.push(
				finding(
					"AMBER_E_EVAL_BREADCRUMB_IMITATION",
					`Context Page is unreadable: ${error.message}`,
					entry.pageId,
				),
			);
			continue;
		}
		if (!page || !Array.isArray(page.blocks)) continue;
		for (const block of page.blocks) {
			if (block && typeof block.text === "string" && block.text.includes(BREADCRUMB_OPEN)) {
				findings.push(
					finding(
						"AMBER_E_EVAL_BREADCRUMB_IMITATION",
						"Context Page embeds <amber-workflow-state>; knowledge is never next-step authority",
						page.pageId || entry.pageId,
					),
				);
				break;
			}
		}
	}
	return evalResult(EVAL_IDS.breadcrumb, findings);
}

function runInstructionSurfaceEvals(targetRoot, opts = {}) {
	const evals = [
		evalMcpToolDescriptions(opts),
		evalContextQuoteBoundary(targetRoot, opts),
		evalBreadcrumbAuthenticity(targetRoot),
	];
	const failed = evals.filter((item) => item.status === "fail").length;
	const modelIndependent = !evals.some((item) =>
		item.findings.some((entry) => entry.code === "AMBER_E_EVAL_MODEL_DEPENDENCY"),
	);
	return {
		suiteId: SUITE_ID,
		version: SUITE_VERSION,
		assurance: ASSURANCE,
		overall: failed === 0 ? "pass" : "fail",
		evalCount: evals.length,
		failedCount: failed,
		modelIndependent,
		evals,
	};
}

function listInstructionSurfaceEvals() {
	return [
		{
			evalId: EVAL_IDS.mcp,
			surface: "MCP tool descriptions",
			assurance: ASSURANCE,
		},
		{
			evalId: EVAL_IDS.context,
			surface: "Context quote boundary",
			assurance: ASSURANCE,
		},
		{
			evalId: EVAL_IDS.breadcrumb,
			surface: "Breadcrumb authenticity",
			assurance: ASSURANCE,
		},
	];
}

function showInstructionSurfaceEval(evalId) {
	return listInstructionSurfaceEvals().find((item) => item.evalId === evalId) || null;
}

module.exports = {
	SUITE_ID,
	SUITE_VERSION,
	EVAL_IDS,
	REQUIRED_ARTIFACT_KINDS,
	ASSURANCE,
	runInstructionSurfaceEvals,
	listInstructionSurfaceEvals,
	showInstructionSurfaceEval,
};
