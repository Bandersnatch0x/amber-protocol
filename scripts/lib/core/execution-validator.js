const fs = require("fs");
const path = require("path");

function validateLoopContract(contractPath) {
	const errors = [];
	const warnings = [];

	if (!fs.existsSync(contractPath)) {
		return {
			valid: false,
			errors: [`Contract file not found: ${contractPath}`],
			warnings: [],
			explanation: "Contract file does not exist.",
		};
	}

	let contract;
	try {
		contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
	} catch (e) {
		return {
			valid: false,
			errors: [`Invalid JSON: ${e.message}`],
			warnings: [],
			explanation: "Contract file contains invalid JSON.",
		};
	}

	// JSON.parse succeeds on a literal `null`/scalar/array, so the catch above
	// does not protect the contract.trigger / contract.hardStops reads below.
	// Reject a non-object body the same way as unparseable JSON.
	if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
		return {
			valid: false,
			errors: ["Contract must be a JSON object"],
			warnings: [],
			explanation: "Contract file does not contain a JSON object.",
		};
	}

	// Validate required fields
	if (!contract.trigger) errors.push("Missing required field: trigger");
	// Top-level cadence is deprecated in favor of trigger.cadence (see loop-contract.schema.json),
	// so its absence is a warning, not an error — a contract using trigger.cadence is still valid.
	if (!contract.cadence) warnings.push("Top-level cadence not set; prefer trigger.cadence");
	if (!contract.stateSpine) errors.push("Missing required field: stateSpine");
	if (!contract.hardStops) {
		errors.push("Missing required field: hardStops");
	} else {
		// Validate hardStops structure
		const { maxIterations, timeout, noProgress, budget } = contract.hardStops;

		if (maxIterations === undefined)
			errors.push("hardStops.maxIterations is required");
		else if (typeof maxIterations !== "number" || maxIterations <= 0)
			errors.push("hardStops.maxIterations must be > 0");

		if (timeout === undefined) errors.push("hardStops.timeout is required");
		else if (typeof timeout !== "number" || timeout <= 0)
			errors.push("hardStops.timeout must be > 0");

		if (noProgress === undefined) warnings.push("hardStops.noProgress not set");
		if (budget === undefined) warnings.push("hardStops.budget not set");
	}

	const valid = errors.length === 0;
	const explanation = valid
		? `Loop contract is valid. Trigger: ${contract.trigger || "N/A"}, cadence: ${contract.cadence || "N/A"}, hard stops: maxIterations=${contract.hardStops?.maxIterations}, timeout=${contract.hardStops?.timeout}s.`
		: `Loop contract validation failed. ${errors.length} error(s) found.`;

	return { valid, errors, warnings, explanation };
}

function validateWorkflowPack(packPath) {
	const errors = [];
	const warnings = [];
	const unsafePatterns = [];

	if (!fs.existsSync(packPath)) {
		return {
			valid: false,
			errors: [`Pack file not found: ${packPath}`],
			warnings: [],
			unsafePatterns: [],
		};
	}

	let pack;
	try {
		pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
	} catch (e) {
		return {
			valid: false,
			errors: [`Invalid JSON: ${e.message}`],
			warnings: [],
			unsafePatterns: [],
		};
	}

	// A literal `null`/scalar/array parses cleanly but is not a pack object;
	// guard before the pack.schemaVersion / pack.files reads below.
	if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
		return {
			valid: false,
			errors: ["Pack must be a JSON object"],
			warnings: [],
			unsafePatterns: [],
		};
	}

	// Schema version check
	if (!pack.schemaVersion) warnings.push("Missing schemaVersion field");

	// Detect unsafe patterns in JSON content
	const packStr = JSON.stringify(pack);
	if (/\beval\s*\(/.test(packStr)) unsafePatterns.push("eval() detected");
	if (/\bexec\s*\(/.test(packStr)) unsafePatterns.push("exec() detected");
	if (/\bsh\s+|bash\s+|powershell\s+/.test(packStr))
		unsafePatterns.push("shell script execution detected");

	// Verify referenced files exist
	const packDir = path.dirname(packPath);
	if (pack.files && Array.isArray(pack.files)) {
		pack.files.forEach((file) => {
			const filePath = path.resolve(packDir, file);
			if (!fs.existsSync(filePath))
				errors.push(`Referenced file not found: ${file}`);
		});
	}

	if (pack.workflow && Array.isArray(pack.workflow)) {
		pack.workflow.forEach((step, i) => {
			if (step.script) {
				const scriptPath = path.resolve(packDir, step.script);
				if (!fs.existsSync(scriptPath))
					errors.push(
						`Workflow step ${i} references missing script: ${step.script}`,
					);
			}
		});
	}

	return { valid: errors.length === 0, errors, warnings, unsafePatterns };
}


// Extract all string values from a nested object (recursive).
// Used by validateIntegration to scan only values, not keys.
function collectStringValues(obj, seen = new Set()) {
	const values = [];
	if (!obj || typeof obj !== "object") return values;
	// Prevent infinite recursion on circular refs
	if (seen.has(obj)) return values;
	seen.add(obj);
	for (const value of Object.values(obj)) {
		if (typeof value === "string") {
			values.push(value);
		} else if (typeof value === "object" && value !== null) {
			values.push(...collectStringValues(value, seen));
		}
	}
	return values;
}

function validateIntegration(integrationPath, options = {}) {
	const warnings = [];
	const sideEffects = [];
	const permissionGates = [];
	const explanations = [];

	if (!fs.existsSync(integrationPath)) {
		const explanation = `Integration file not found at path: ${integrationPath}. Ensure the path is correct and the file exists.`;
		return {
			valid: false,
			sideEffects: [],
			credentialsRequired: false,
			permissionGates: [],
			warnings: [`Integration file not found: ${integrationPath}`],
			explanation: options.explain ? explanation : undefined,
		};
	}

	let config;
	try {
		config = JSON.parse(fs.readFileSync(integrationPath, "utf8"));
	} catch (e) {
		const explanation = `Failed to parse integration file as JSON. Error: ${e.message}. Check for syntax errors in the JSON file.`;
		return {
			valid: false,
			sideEffects: [],
			credentialsRequired: false,
			permissionGates: [],
			warnings: [`Invalid JSON: ${e.message}`],
			explanation: options.explain ? explanation : undefined,
		};
	}

	// JSON.parse succeeds on a literal `null`/scalar/array, so the catch above
	// does not protect the config.permissions read below. Treat a non-object
	// body as an invalid integration instead of crashing.
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		const explanation =
			"Integration file does not contain a JSON object. Provide an object with the integration configuration.";
		return {
			valid: false,
			sideEffects: [],
			credentialsRequired: false,
			permissionGates: [],
			warnings: ["Integration config must be a JSON object"],
			explanation: options.explain ? explanation : undefined,
		};
	}

	// Side-effect signals (urls, file paths, shell commands) live in string
	// VALUES, not field names. Scanning only values — via collectStringValues —
	// avoids false positives from a field merely NAMED "network" or a
	// description that mentions "fetch". (Previously this scanned
	// JSON.stringify(config), which matched keys too.)
	const valueText = collectStringValues(config).join("\n");

	// Credentials and permissions are conventionally signaled by FIELD NAMES
	// (apiKey, token, secret, permissions) as much as by values, so those two
	// checks still scan the full serialized config including keys.
	const configStr = JSON.stringify(config);

	// Detect side effects
	if (/\bfile[:.]write|writeFile|createWriteStream|fs\.write/i.test(valueText)) {
		sideEffects.push("file_write");
		if (options.explain) explanations.push("Detected file write operations in integration config.");
	}
	if (/\bnetwork|http[s]?:|fetch|axios|request\b/i.test(valueText)) {
		sideEffects.push("network_call");
		if (options.explain) explanations.push("Detected network/HTTP calls in integration config.");
	}
	if (/\bspawn|exec|child_process|shell\b/i.test(valueText)) {
		sideEffects.push("process_spawn");
		if (options.explain) explanations.push("Detected process spawning or shell execution in integration config.");
	}
	if (/\bdb|database|sql|query|transaction\b/i.test(valueText)) {
		sideEffects.push("database_operation");
		if (options.explain) explanations.push("Detected database operations in integration config.");
	}

	// Check credentials requirement
	const credentialsRequired =
		/\bapi[_-]?key|token|secret|password|credential|auth\b/i.test(configStr);
	if (credentialsRequired && options.explain) {
		explanations.push("Integration requires credentials (API keys, tokens, or passwords).");
	}

	// Detect permission gates
	if (config.permissions || /\bpermission[s]?:|requires\b/i.test(configStr)) {
		permissionGates.push("explicit_permissions_declared");
		if (options.explain) explanations.push("Integration declares explicit permission requirements.");
	}

	// Warnings
	if (sideEffects.length > 0 && !config.sideEffects) {
		warnings.push("Side effects detected but not declared in config");
		if (options.explain) explanations.push("Warning: Side effects found but not documented in the config file. Add a 'sideEffects' field.");
	}
	if (credentialsRequired && !config.credentials && !config.auth) {
		warnings.push("Credentials required but not documented in config");
		if (options.explain) explanations.push("Warning: Credentials required but no 'credentials' or 'auth' field found in config.");
	}

	const result = {
		valid: true,
		sideEffects,
		credentialsRequired,
		permissionGates,
		warnings,
	};

	if (options.explain) {
		result.explanation = explanations.length > 0
			? explanations.join(" ")
			: "Integration is valid with no issues detected.";
	}

	return result;
}

// Deep module: pure analysis of a plan document's content. All plan-derived
// readiness logic lives here (approval detection, strict section checks, env
// var extraction, integration extraction). It takes injected resolvers for the
// side-effectful lookups (does a var exist in the environment? does an
// integration file exist? does a .approved sibling exist?) so it stays testable
// without touching the filesystem or process.env.
//
// Returns { blockers, warnings, checks: { plan, env, integrations } }.
function analyzePlanContent(planContent, options = {}) {
	const {
		strict = false,
		hasEnvVar = () => true,
		hasApprovalFile = () => false,
		hasIntegrationFile = () => true,
	} = options;

	const blockers = [];
	const warnings = [];
	const checks = { plan: false, env: false, integrations: false };

	// Approval: either an inline marker or a sibling .approved file.
	const hasMarker =
		/<!-- gate: approved -->|<!-- approved -->/i.test(planContent);
	if (!hasMarker && !hasApprovalFile()) {
		blockers.push(
			"Plan not approved (missing approval marker or .approved file)",
		);
	} else {
		checks.plan = true;
	}

	// Strict mode: required structural sections.
	if (strict) {
		if (!/## Goals?|## Objectives?/i.test(planContent)) {
			blockers.push("Strict: Plan missing Goals or Objectives section");
		}
		if (!/## Implementation|## Steps/i.test(planContent)) {
			blockers.push("Strict: Plan missing Implementation or Steps section");
		}
		if (!/## Test/i.test(planContent)) {
			warnings.push("Strict: Plan missing Test section (recommended)");
		}
	}

	// Referenced environment variables.
	const envVars = [
		...planContent.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g),
	].map((m) => m[1]);
	const missing = envVars.filter((v) => !hasEnvVar(v));
	if (missing.length > 0) {
		blockers.push(`Missing env vars: ${missing.join(", ")}`);
	} else {
		checks.env = true;
	}

	// Referenced integrations.
	const integrations = [
		...planContent.matchAll(/integration:\s*([^\s,]+)/gi),
	].map((m) => m[1]);
	if (integrations.length > 0) {
		const invalid = integrations.filter((name) => !hasIntegrationFile(name));
		if (invalid.length > 0) {
			blockers.push(`Integration files not found: ${invalid.join(", ")}`);
		} else {
			checks.integrations = true;
		}
	} else {
		checks.integrations = true;
	}

	return { blockers, warnings, checks };
}

function checkExecutionReadiness(projectRoot, planPath, options = {}) {
	const blockers = [];
	const warnings = [];
	const checks = {
		plan: false,
		worktree: false,
		policy: false,
		env: false,
		integrations: false,
	};

	// Analyze the plan content once (approval, env vars, integrations, strict).
	// The previous implementation read planPath three separate times.
	if (!fs.existsSync(planPath)) {
		blockers.push(`Plan file not found: ${planPath}`);
	} else {
		try {
			const planContent = fs.readFileSync(planPath, "utf8");
			const analysis = analyzePlanContent(planContent, {
				strict: options.strict,
				hasEnvVar: (name) => Boolean(process.env[name]),
				hasApprovalFile: () =>
					fs.existsSync(planPath.replace(/\.md$/, ".approved")),
				hasIntegrationFile: (name) =>
					fs.existsSync(
						path.join(projectRoot, "integrations", `${name}.json`),
					),
			});
			blockers.push(...analysis.blockers);
			warnings.push(...analysis.warnings);
			checks.plan = analysis.checks.plan;
			checks.env = analysis.checks.env;
			checks.integrations = analysis.checks.integrations;
		} catch (e) {
			blockers.push(`Cannot read plan: ${e.message}`);
		}
	}

	// Verify worktree clean (metadata-only: check for git merge state or index changes)
	const gitDir = path.join(projectRoot, ".git");
	if (fs.existsSync(gitDir)) {
		try {
			// Check for active merge/rebase/cherry-pick (conflict state)
			const mergeHead = path.join(gitDir, "MERGE_HEAD");
			const rebaseApply = path.join(gitDir, "rebase-apply");
			const rebaseMerge = path.join(gitDir, "rebase-merge");

			if (
				fs.existsSync(mergeHead) ||
				fs.existsSync(rebaseApply) ||
				fs.existsSync(rebaseMerge)
			) {
				warnings.push(
					"Worktree has active merge/rebase (conflict state detected)",
				);
			} else {
				// Check for uncommitted changes via .git/index mtime heuristic
				// If index was modified within last 60s, assume recent changes
				try {
					const indexPath = path.join(gitDir, "index");
					if (fs.existsSync(indexPath)) {
						const indexStat = fs.statSync(indexPath);
						const indexAge = Date.now() - indexStat.mtimeMs;
						if (indexAge < 60000) {
							warnings.push(
								`Worktree may have uncommitted changes (index modified ${Math.round(indexAge / 1000)}s ago)`,
							);
						} else {
							checks.worktree = true;
						}
					} else {
						// No index file = fresh repo or corrupted
						checks.worktree = true;
					}
				} catch (e) {
					warnings.push(`Cannot check worktree state: ${e.message}`);
				}
			}
		} catch (e) {
			warnings.push(`Cannot check worktree state: ${e.message}`);
		}
	} else {
		// Not a git repo - consider clean for readiness purposes
		checks.worktree = true;
	}

	// Policy surface (post ADR-0001/0005): governed command policy is
	// `.amber/governance/rules.json` with built-in defaults. Autonomous
	// execution is gone — do not require or search for a root-level
	// autonomous-policy.json (that path never matched the real state dir).
	const { resolveStateDirForRead } = require("../state-dir-resolver");
	const { loadPolicyRules } = require("./loop-policy");
	const stateDir = resolveStateDirForRead(projectRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");
	const rules = loadPolicyRules(projectRoot);
	// Defaults always load; presence of rules.json is the explicit on-disk surface.
	checks.policy = true;
	if (!fs.existsSync(rulesPath)) {
		warnings.push(
			"No .amber/governance/rules.json — using built-in deny-wins defaults (run `amber governance rules init`)",
		);
	} else if (!rules || !Array.isArray(rules.rules)) {
		warnings.push("governance rules.json is present but has no rules array");
		checks.policy = false;
	}

	// Leftover autonomous-policy.json is optional compat only. Inspect for
	// unsafe gate claims; never block readiness solely for its absence.
	const autoPath = path.join(stateDir, "autonomous-policy.json");
	if (fs.existsSync(autoPath)) {
		try {
			const autoPolicy = JSON.parse(fs.readFileSync(autoPath, "utf8"));
			if (autoPolicy && autoPolicy.gates && autoPolicy.gates["user-approval"] === "approve") {
				warnings.push(
					"Leftover autonomous-policy.json sets gates['user-approval']=approve — autonomous execution is removed; this cannot auto-approve work",
				);
			}
		} catch (e) {
			warnings.push(`Leftover autonomous-policy.json is unreadable: ${e.message}`);
		}
	}

	// Strict mode: require an explicit on-disk rules.json (not silent defaults).
	if (options.strict) {
		if (!fs.existsSync(rulesPath)) {
			blockers.push(
				"Strict: governance rules.json required (run `amber governance rules init`)",
			);
			checks.policy = false;
		}
		if (rules && rules.defaultAction === "allow") {
			warnings.push(
				"Strict: rules.json defaultAction=allow is unsafe for governed execution",
			);
		}
	}

	return {
		ready: blockers.length === 0,
		blockers,
		warnings,
		checks,
		strictMode: options.strict || false,
	};
}

	collectStringValues,
module.exports = {
	validateLoopContract,
	validateWorkflowPack,
	validateIntegration,
	analyzePlanContent,
	checkExecutionReadiness,
};
