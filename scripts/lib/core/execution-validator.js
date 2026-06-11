const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

	// Validate required fields
	if (!contract.trigger) errors.push("Missing required field: trigger");
	if (!contract.cadence) errors.push("Missing required field: cadence");
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

function validateIntegration(integrationPath) {
	const warnings = [];
	const sideEffects = [];
	const permissionGates = [];

	if (!fs.existsSync(integrationPath)) {
		return {
			valid: false,
			sideEffects: [],
			credentialsRequired: false,
			permissionGates: [],
			warnings: [`Integration file not found: ${integrationPath}`],
		};
	}

	let config;
	try {
		config = JSON.parse(fs.readFileSync(integrationPath, "utf8"));
	} catch (e) {
		return {
			valid: false,
			sideEffects: [],
			credentialsRequired: false,
			permissionGates: [],
			warnings: [`Invalid JSON: ${e.message}`],
		};
	}

	const configStr = JSON.stringify(config);

	// Detect side effects
	if (/\bfile[:.]write|writeFile|createWriteStream|fs\.write/i.test(configStr))
		sideEffects.push("file_write");
	if (/\bnetwork|http[s]?:|fetch|axios|request\b/i.test(configStr))
		sideEffects.push("network_call");
	if (/\bspawn|exec|child_process|shell\b/i.test(configStr))
		sideEffects.push("process_spawn");
	if (/\bdb|database|sql|query|transaction\b/i.test(configStr))
		sideEffects.push("database_operation");

	// Check credentials requirement
	const credentialsRequired =
		/\bapi[_-]?key|token|secret|password|credential|auth\b/i.test(configStr);

	// Detect permission gates
	if (config.permissions || /\bpermission[s]?:|requires\b/i.test(configStr)) {
		permissionGates.push("explicit_permissions_declared");
	}

	// Warnings
	if (sideEffects.length > 0 && !config.sideEffects) {
		warnings.push("Side effects detected but not declared in config");
	}
	if (credentialsRequired && !config.credentials && !config.auth) {
		warnings.push("Credentials required but not documented in config");
	}

	return {
		valid: true,
		sideEffects,
		credentialsRequired,
		permissionGates,
		warnings,
	};
}

function checkExecutionReadiness(projectRoot, planPath) {
	const blockers = [];
	const warnings = [];
	const checks = {
		plan: false,
		worktree: false,
		policy: false,
		env: false,
		integrations: false,
	};

	// Check plan exists and is approved
	if (!fs.existsSync(planPath)) {
		blockers.push(`Plan file not found: ${planPath}`);
	} else {
		try {
			const planContent = fs.readFileSync(planPath, "utf8");
			const hasApproval =
				/<!-- gate: approved -->|<!-- approved -->/i.test(planContent) ||
				fs.existsSync(planPath.replace(/\.md$/, ".approved"));
			if (!hasApproval) {
				blockers.push(
					"Plan not approved (missing approval marker or .approved file)",
				);
			} else {
				checks.plan = true;
			}
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
				// Check for uncommitted changes via git status --porcelain
				try {
					const status = execFileSync("git", ["status", "--porcelain"], {
						cwd: projectRoot,
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
						timeout: 10000,
					}).trim();
					if (status.length > 0) {
						const lines = status.split("\n").length;
						warnings.push(
							`Worktree has ${lines} uncommitted change(s) (git status --porcelain)`,
						);
					} else {
						checks.worktree = true;
					}
				} catch (e) {
					warnings.push(`Cannot check worktree state via git: ${e.message}`);
				}
			}
		} catch (e) {
			warnings.push(`Cannot check worktree state: ${e.message}`);
		}
	} else {
		// Not a git repo - consider clean for readiness purposes
		checks.worktree = true;
	}

	// Load policy
	const policyPath = path.join(projectRoot, "autonomous-policy.json");
	let policy = null;
	if (fs.existsSync(policyPath)) {
		try {
			policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
			checks.policy = true;
		} catch (e) {
			warnings.push(`Cannot load policy: ${e.message}`);
		}
	} else {
		warnings.push("No autonomous-policy.json found");
	}

	// Check env vars required by plan
	if (fs.existsSync(planPath)) {
		try {
			const planContent = fs.readFileSync(planPath, "utf8");
			const envVars = [
				...planContent.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g),
			].map((m) => m[1]);
			const missing = envVars.filter((v) => !process.env[v]);
			if (missing.length > 0) {
				blockers.push(`Missing env vars: ${missing.join(", ")}`);
			} else if (envVars.length > 0) {
				checks.env = true;
			} else {
				checks.env = true; // no env vars required
			}
		} catch (e) {
			warnings.push(`Cannot check env vars: ${e.message}`);
		}
	}

	// Validate integrations declared in plan
	if (fs.existsSync(planPath)) {
		try {
			const planContent = fs.readFileSync(planPath, "utf8");
			const integrations = [
				...planContent.matchAll(/integration:\s*([^\s,]+)/gi),
			].map((m) => m[1]);
			if (integrations.length > 0) {
				const integrationsDir = path.join(projectRoot, "integrations");
				const invalid = integrations.filter((name) => {
					const intPath = path.join(integrationsDir, `${name}.json`);
					return !fs.existsSync(intPath);
				});
				if (invalid.length > 0) {
					blockers.push(`Integration files not found: ${invalid.join(", ")}`);
				} else {
					checks.integrations = true;
				}
			} else {
				checks.integrations = true; // no integrations declared
			}
		} catch (e) {
			warnings.push(`Cannot validate integrations: ${e.message}`);
		}
	}

	return {
		ready: blockers.length === 0,
		blockers,
		warnings,
		checks,
	};
}

module.exports = {
	validateLoopContract,
	validateWorkflowPack,
	validateIntegration,
	checkExecutionReadiness,
};
