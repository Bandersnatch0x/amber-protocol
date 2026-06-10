"use strict";

/**
 * Permission reviewer — validates hook/tool permissions and flags issues.
 */

const SENSITIVE_PATHS = [
	"package.json",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"node_modules/**",
	".git/**",
	".env",
	".env.*",
	"*.pem",
	"*.key",
	"secrets/**",
	"credentials/**",
];

/**
 * Check if a path matches a glob pattern (simple glob matching).
 */
function pathMatches(pattern, testPath) {
	// Convert glob to regex
	const regexStr = pattern
		.replace(/\./g, "\\.")
		.replace(/\*\*/g, "___DOUBLESTAR___")
		.replace(/\*/g, "[^/]*")
		.replace(/___DOUBLESTAR___/g, ".*")
		.replace(/\?/g, ".");

	const regex = new RegExp(`^${regexStr}$`);
	return regex.test(testPath);
}

/**
 * @param {object} settings - with permissions.allow array
 * @param {Array<{tool: string, path: string}>} usageLog - actual tool usage
 * @returns {{ findings: Array, pass: boolean }}
 */
function reviewPermissions(settings, usageLog) {
	const findings = [];
	const permissions =
		(settings && settings.permissions && settings.permissions.allow) || [];

	// Check for overly broad permissions
	for (const perm of permissions) {
		const paths = perm.paths || [];
		for (const p of paths) {
			if (p === "**" || p === "*") {
				findings.push({
					issue: "overly_broad",
					severity: "warning",
					tool: perm.tool,
					pattern: p,
					message: `Overly broad permission: tool "${perm.tool}" has pattern "${p}" which grants unrestricted access`,
				});
			}

			// Check sensitive path write access
			if (
				perm.tool === "write" ||
				perm.tool === "delete" ||
				perm.tool === "exec"
			) {
				for (const sensitive of SENSITIVE_PATHS) {
					if (
						paths.some(
							(pp) =>
								pp === sensitive || pp.includes(sensitive.replace(/\*+/g, "")),
						)
					) {
						findings.push({
							issue: "sensitive_path",
							severity: "warning",
							tool: perm.tool,
							path: sensitive,
							message: `${perm.tool} access to sensitive path: ${sensitive}`,
						});
					}
				}
			}
		}
	}

	// Check unused permissions
	for (const perm of permissions) {
		const isUsed = usageLog.some(
			(u) =>
				u.tool === perm.tool && perm.paths.some((p) => pathMatches(p, u.path)),
		);

		if (!isUsed && usageLog.length > 0) {
			findings.push({
				issue: "unused_permission",
				severity: "info",
				tool: perm.tool,
				paths: perm.paths,
				message: `Unused permission: tool "${perm.tool}" is never exercised in usage log`,
			});
		}
	}

	// Check for usage without permissions
	for (const usage of usageLog) {
		const hasPermission = permissions.some(
			(p) =>
				p.tool === usage.tool &&
				p.paths.some((pp) => pathMatches(pp, usage.path)),
		);

		if (!hasPermission) {
			findings.push({
				issue: "missing_permission",
				severity: "error",
				tool: usage.tool,
				path: usage.path,
				message: `No permission found for tool "${usage.tool}" accessing "${usage.path}"`,
			});
		}
	}

	// Deduplicate findings
	const seen = new Set();
	const unique = findings.filter((f) => {
		const key = `${f.issue}:${f.tool}:${f.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const hasErrors = unique.some((f) => f.severity === "error");

	return {
		findings: unique,
		pass: !hasErrors && unique.length === 0,
	};
}

module.exports = { reviewPermissions };
