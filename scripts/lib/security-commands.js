"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const childProcess = require("node:child_process");
const { generateAuditReport } = require("../../src/security/audit-report");
const { dependencyScan, parseAuditOutput } = require("../../src/security/dependency-scan");
const { scanForSecrets } = require("../../src/security/secret-scan");
const { reviewPermissions } = require("../../src/security/permission-review");
const { toSpawnArgv } = require("./core/loop-policy");

const REPORT_ONLY_NOTICE = [
	"> **Report-only.** Scans do not modify target files or block other commands.",
	"> Secret scan covers Git-tracked working-tree files. Permission review checks",
	"> `.claude/settings.json` statically; tool usage logs are not evaluated.",
	"",
	"",
].join("\n");

function readTargetFile(target, relativePath) {
	const file = fs.realpathSync(path.resolve(target, relativePath));
	const relative = path.relative(fs.realpathSync(target), file);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Scan input escapes target: ${relativePath}`);
	}
	return fs.readFileSync(file, "utf8");
}

function scanCategory(scan) {
	try {
		return scan();
	} catch (error) {
		return { status: "unscanned", summary: error.message };
	}
}

function scanDependencies(target) {
	readTargetFile(target, "package.json");
	const lock = fs.existsSync(path.join(target, "npm-shrinkwrap.json"))
		? "npm-shrinkwrap.json"
		: "package-lock.json";
	readTargetFile(target, lock);
	const [command, ...args] = toSpawnArgv([
		"npm",
		"audit",
		"--json",
		"--ignore-scripts",
		"--fetch-retries=0",
		"--include=prod",
		"--include=dev",
		"--include=optional",
		"--include=peer",
	]);
	// Target npm settings may otherwise place cache and logs inside the repository.
	const cache = fs.mkdtempSync(path.join(os.tmpdir(), "amber-security-cache-"));
	let result;
	try {
		result = childProcess.spawnSync(command, [...args, "--cache", cache, "--logs-dir", cache], {
			cwd: target,
			encoding: "utf8",
			timeout: 30_000,
			maxBuffer: 16 * 1024 * 1024,
		});
	} finally {
		fs.rmSync(cache, { recursive: true, force: true });
	}
	if (result.error) throw result.error;
	const audit = JSON.parse(result.stdout);
	if (
		audit.error ||
		!audit.vulnerabilities ||
		typeof audit.vulnerabilities !== "object" ||
		Array.isArray(audit.vulnerabilities) ||
		Object.values(audit.vulnerabilities).some(
			(value) =>
				!value ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				!["info", "low", "moderate", "high", "critical"].includes(value.severity),
		) ||
		![0, 1].includes(result.status)
	) {
		throw new Error(
			`npm audit did not return a vulnerability report (${audit.error?.code || result.status})`,
		);
	}
	return dependencyScan(parseAuditOutput(result.stdout));
}

function scanTrackedSecrets(target) {
	const result = childProcess.spawnSync("git", ["ls-files", "--cached", "-z", "--", "."], {
		cwd: target,
		encoding: "utf8",
		timeout: 30_000,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error("Git-tracked files could not be enumerated");
	const files = result.stdout
		.split("\0")
		.filter(Boolean)
		.map((file) => ({
			path: file,
			content: readTargetFile(target, file),
		}));
	return scanForSecrets(files);
}

function scanPermissions(target) {
	const settings = JSON.parse(readTargetFile(target, ".claude/settings.json"));
	const allow = settings?.permissions?.allow;
	if (
		!Array.isArray(allow) ||
		allow.some(
			(entry) =>
				!entry ||
				typeof entry.tool !== "string" ||
				!Array.isArray(entry.paths) ||
				entry.paths.some((item) => typeof item !== "string"),
		)
	) {
		throw new Error("Permission review requires permissions.allow entries with tool and paths");
	}
	return reviewPermissions(settings, []);
}

function generateSecurityAuditReport(targetRoot, options = {}) {
	const target = path.resolve(targetRoot || ".");
	const depResult = scanCategory(() => scanDependencies(target));
	const secretResult = scanCategory(() => scanTrackedSecrets(target));
	const permResult = scanCategory(() => scanPermissions(target));
	const report = REPORT_ONLY_NOTICE + generateAuditReport(depResult, secretResult, permResult);

	if (options.output) {
		const outputPath = path.resolve(options.output);
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, report);
		return {
			text: `Security audit written: ${outputPath}`,
			target,
			outputPath,
			errors: [],
			warnings: [],
		};
	}

	return { text: report, target, errors: [], warnings: [] };
}

module.exports = { generateSecurityAuditReport };
