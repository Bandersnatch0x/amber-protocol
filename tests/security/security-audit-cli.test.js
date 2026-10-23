"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { generateAuditReport } = require("../../src/security/audit-report");
const { generateSecurityAuditReport } = require("../../scripts/lib/security-commands");

const CLI = path.resolve(__dirname, "../../scripts/amber.js");
const passed = { pass: true, summary: "ok", vulnerabilities: [], findings: [] };

function run(command, args, cwd, env = process.env) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout: 45_000,
	});
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	return result.stdout;
}

function fixture(t) {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-security-audit-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	fs.mkdirSync(path.join(target, ".claude"));
	fs.writeFileSync(
		path.join(target, ".claude/settings.json"),
		JSON.stringify({ permissions: { allow: [] } }),
	);
	fs.writeFileSync(
		path.join(target, "package.json"),
		JSON.stringify({ name: "audit-fixture", version: "1.0.0" }),
	);
	fs.writeFileSync(
		path.join(target, "package-lock.json"),
		JSON.stringify({
			name: "audit-fixture",
			version: "1.0.0",
			lockfileVersion: 3,
			packages: { "": { name: "audit-fixture", version: "1.0.0" } },
		}),
	);
	run("git", ["init", "--quiet"], target);
	run("git", ["add", "."], target);
	return target;
}

function audit(target, args = [], env = process.env) {
	return JSON.parse(
		run(
			process.execPath,
			[CLI, "security", "audit", "--target", target, "--json", ...args],
			target,
			env,
		),
	);
}

test(
	"security audit detects a tracked fake secret and remains report-only",
	{ timeout: 60_000 },
	(t) => {
		const target = fixture(t);
		fs.writeFileSync(path.join(target, "config.js"), `const api_key = "sk-${"x".repeat(24)}";\n`);
		run("git", ["add", "config.js"], target);
		const before = run("git", ["status", "--porcelain"], target);
		const result = audit(target);
		assert.match(result.text, /Overall Status:\*\* ❌ \*\*FAIL\*\*/);
		assert.match(result.text, /API Key.*config\.js:1/);
		assert.deepEqual(result.errors, []);
		assert.equal(run("git", ["status", "--porcelain"], target), before);
		assert.deepEqual(fs.readdirSync(target).sort(), [
			".claude",
			".git",
			"config.js",
			"package-lock.json",
			"package.json",
		]);
	},
);

test(
	"security audit reports PASS after real scans of a clean fixture",
	{ timeout: 60_000 },
	(t) => {
		const result = audit(fixture(t));
		assert.match(result.text, /Overall Status:\*\* ✅ \*\*PASS\*\*/);
		assert.doesNotMatch(result.text, /unscanned|skeleton|placeholder/i);
	},
);

test(
	"security audit does not write npm cache or logs inside the target",
	{ timeout: 60_000 },
	(t) => {
		const target = fixture(t);
		fs.writeFileSync(path.join(target, ".npmrc"), "cache=./audit-cache\nlogs-dir=./audit-logs\n");
		run("git", ["add", ".npmrc"], target);
		const before = fs.readdirSync(target).sort();
		const result = audit(target);
		assert.match(result.text, /Overall Status:\*\* ✅ \*\*PASS\*\*/);
		assert.deepEqual(fs.readdirSync(target).sort(), before);
	},
);

test("security audit passes real settings to the permission scanner", { timeout: 60_000 }, (t) => {
	const target = fixture(t);
	fs.writeFileSync(
		path.join(target, ".claude/settings.json"),
		JSON.stringify({ permissions: { allow: [{ tool: "read", paths: ["**"] }] } }),
	);
	const result = audit(target);
	assert.match(result.text, /Overall Status:\*\* ❌ \*\*FAIL\*\*/);
	assert.match(result.text, /overly_broad/);
});

test("security audit reports missing dependency inputs as unscanned", { timeout: 60_000 }, (t) => {
	const target = fixture(t);
	fs.unlinkSync(path.join(target, "package-lock.json"));
	const result = audit(target);
	assert.match(result.text, /Overall Status:\*\* ⚠️ \*\*UNSCANNED\*\*/);
	assert.match(result.text, /Dependency Scan\n\n\*\*Status:\*\* ⚠️ UNSCANNED/);
});

test(
	"security audit reports unsupported permission inputs as unscanned",
	{ timeout: 60_000 },
	(t) => {
		const target = fixture(t);
		fs.writeFileSync(
			path.join(target, ".claude/settings.json"),
			JSON.stringify({ permissions: { allow: ["Bash(*)"] } }),
		);
		const result = audit(target);
		assert.match(result.text, /Overall Status:\*\* ⚠️ \*\*UNSCANNED\*\*/);
		assert.match(result.text, /Permission Review\n\n\*\*Status:\*\* ⚠️ UNSCANNED/);
	},
);

test("security audit writes the scanned report to an explicit output", { timeout: 60_000 }, (t) => {
	const target = fixture(t);
	const output = path.join(target, "report.md");
	assert.equal(audit(target, ["--output", output]).outputPath, output);
	assert.match(fs.readFileSync(output, "utf8"), /Overall Status:\*\* ✅ \*\*PASS\*\*/);
});

for (const [label, dep, secrets, permissions] of [
	["dependencies", null, [], passed],
	["secrets", passed, null, passed],
	["permissions", passed, [], null],
	[
		"an explicit unavailable scan",
		{ status: "unscanned", summary: "audit unavailable" },
		[],
		passed,
	],
]) {
	test(`audit report never treats ${label} as passed without a scan`, () => {
		const report = generateAuditReport(dep, secrets, permissions);
		assert.match(report, /Overall Status:\*\* ⚠️ \*\*UNSCANNED\*\*/);
		assert.doesNotMatch(report, /All scans pass/);
	});
}

test("audit report preserves a known FAIL when another category is unscanned", () => {
	const report = generateAuditReport(
		null,
		[{ file: "config.js", line: 1, type: "API Key", match: "fake" }],
		passed,
	);
	assert.match(report, /Overall Status:\*\* ❌ \*\*FAIL\*\*/);
	assert.match(report, /UNSCANNED/);
});

for (const [label, stdout, status] of [
	["malformed", "not json", 0],
	["an npm error", JSON.stringify({ error: { code: "ENETUNREACH" } }), 1],
	["an unsupported response", "{}", 0],
	["an invalid vulnerability entry", JSON.stringify({ vulnerabilities: { broken: null } }), 1],
	["a missing severity", JSON.stringify({ vulnerabilities: { broken: { via: [] } } }), 1],
	["a non-string severity", JSON.stringify({ vulnerabilities: { broken: { severity: 3 } } }), 1],
	[
		"an unsupported severity",
		JSON.stringify({ vulnerabilities: { broken: { severity: "unknown" } } }),
		1,
	],
	[
		"an inherited property name as severity",
		JSON.stringify({ vulnerabilities: { broken: { severity: "__proto__" } } }),
		1,
	],
]) {
	test(`security audit cannot turn ${label} dependency output into PASS`, (t) => {
		const target = fixture(t);
		const spawn = childProcess.spawnSync;
		t.mock.method(childProcess, "spawnSync", (command, args, options) => {
			if (args.includes("audit")) return { status, stdout, stderr: "" };
			return spawn(command, args, options);
		});
		const report = generateSecurityAuditReport(target).text;
		assert.match(report, /Overall Status:\*\* ⚠️ \*\*UNSCANNED\*\*/);
	});
}

test("security audit reports high dependency findings even when npm exits 1", (t) => {
	const target = fixture(t);
	const spawn = childProcess.spawnSync;
	t.mock.method(childProcess, "spawnSync", (command, args, options) => {
		if (args.includes("audit")) {
			return {
				status: 1,
				stderr: "",
				stdout: JSON.stringify({
					vulnerabilities: {
						unsafe: { name: "unsafe", severity: "high", via: [{ title: "Fixture vulnerability" }] },
					},
				}),
			};
		}
		return spawn(command, args, options);
	});
	const result = generateSecurityAuditReport(target);
	assert.match(result.text, /Overall Status:\*\* ❌ \*\*FAIL\*\*/);
	assert.match(result.text, /unsafe.*Fixture vulnerability/);
	assert.deepEqual(result.errors, []);
});

test("security audit reports subprocess timeouts as unscanned", (t) => {
	const target = fixture(t);
	const spawn = childProcess.spawnSync;
	t.mock.method(childProcess, "spawnSync", (command, args, options) => {
		if (args.includes("audit")) return { error: new Error("npm audit timed out") };
		return spawn(command, args, options);
	});
	const report = generateSecurityAuditReport(target).text;
	assert.match(report, /Overall Status:\*\* ⚠️ \*\*UNSCANNED\*\*/);
	assert.match(report, /npm audit timed out/);
});

test("security audit reports an unreadable tracked file as unscanned", { timeout: 60_000 }, (t) => {
	const target = fixture(t);
	fs.writeFileSync(path.join(target, "removed.js"), "module.exports = 1;\n");
	run("git", ["add", "removed.js"], target);
	fs.unlinkSync(path.join(target, "removed.js"));
	const result = audit(target);
	assert.match(result.text, /Overall Status:\*\* ⚠️ \*\*UNSCANNED\*\*/);
	assert.match(result.text, /Secret Scan\n\n\*\*Status:\*\* ⚠️ UNSCANNED/);
	assert.doesNotMatch(result.text, /No secrets detected/);
});

test(
	"security audit includes development dependencies in production environments",
	{ timeout: 60_000 },
	async (t) => {
		const target = fixture(t);
		const server = childProcess.spawn(
			process.execPath,
			[
				"-e",
				`
		const http = require("node:http");
		const zlib = require("node:zlib");
		const advisory = { id: 182, name: "unsafe-dev", title: "Fixture development vulnerability",
			url: "http://fixture.invalid/advisory/182", severity: "high", vulnerable_versions: "<2.0.0" };
		http.createServer((req, res) => {
			const chunks = [];
			req.on("data", chunk => chunks.push(chunk));
			req.on("end", () => {
				res.setHeader("content-type", "application/json");
				if (req.url.includes("/security/advisories/bulk")) {
					const bytes = Buffer.concat(chunks);
					const body = JSON.parse(req.headers["content-encoding"] === "gzip" ? zlib.gunzipSync(bytes) : bytes);
					res.end(JSON.stringify(body["unsafe-dev"] ? { "unsafe-dev": [advisory] } : {}));
				} else {
					res.end(JSON.stringify({ name: "unsafe-dev", "dist-tags": { latest: "1.0.0" },
						versions: { "1.0.0": { name: "unsafe-dev", version: "1.0.0" } } }));
				}
			});
		}).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
	`,
			],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		t.after(() => server.kill());
		const [ready] = await once(server.stdout, "data");
		const registry = `http://127.0.0.1:${String(ready).trim()}`;
		fs.writeFileSync(
			path.join(target, "package.json"),
			JSON.stringify({
				name: "audit-fixture",
				version: "1.0.0",
				devDependencies: { "unsafe-dev": "1.0.0" },
			}),
		);
		fs.writeFileSync(
			path.join(target, "package-lock.json"),
			JSON.stringify({
				name: "audit-fixture",
				version: "1.0.0",
				lockfileVersion: 3,
				packages: {
					"": {
						name: "audit-fixture",
						version: "1.0.0",
						devDependencies: { "unsafe-dev": "1.0.0" },
					},
					"node_modules/unsafe-dev": {
						version: "1.0.0",
						resolved: `${registry}/unsafe-dev.tgz`,
						dev: true,
					},
				},
			}),
		);
		for (const NODE_ENV of ["development", "production"]) {
			const result = audit(target, [], { ...process.env, NODE_ENV, npm_config_registry: registry });
			assert.match(result.text, /Overall Status:\*\* ❌ \*\*FAIL\*\*/, NODE_ENV);
			assert.match(result.text, /unsafe-dev.*Fixture development vulnerability/);
		}
	},
);
