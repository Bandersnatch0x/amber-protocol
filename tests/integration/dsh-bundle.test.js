const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const BUNDLE_ROOT = path.join(ROOT, "dsh");
const QA_MODEL_SCAN_FILES = [
	"apps/web/server/lib/knowledge-qa.ts",
	"apps/web/server/routers/knowledge.ts",
	"apps/web/src/lib/knowledge-dto.ts",
];
const QA_PROVIDER_ADAPTER = "apps/web/server/lib/knowledge-llm.ts";

function read(relativePath) {
	return fs.readFileSync(path.join(BUNDLE_ROOT, relativePath), "utf8");
}

// Hang guard, not a performance assertion (#302). These tests assert WHICH files
// npm ships, never how fast it packs, so the budget only has to outlast a
// legitimately slow run and still catch a truly wedged npm.
//
// Derivation on this repo (measured 2026-08-31):
//   idle, 3 runs each:  cwd=ROOT ~2.05 s (2044/2096/2100 ms) | cwd=dsh ~1.36 s
//   during a full `npm test`, 10 samples at cwd=ROOT:
//     9053 20352 20729 17201 10936 10941 13136 9400 17606 14591 ms
//     => 4.4x-10.1x amplification, peak 20.7 s
// That peak is what killed the old 30 s budget: it left only ~1.45x headroom,
// so adding the parallel worktree runs named in #302 on top of a full suite
// crosses 30 s and both cases die together — which is exactly how they failed,
// in pairs, four times in one day. 120 s is ~5.8x over the measured peak and
// ~57x over idle.
// A retry is deliberately NOT added: the failure is a budget too close to the
// measured peak, not a machine that never calms down, and a retry would double
// the worst case to buy a hypothetical.
const PACK_TIMEOUT_MS = 120_000;

// maxBuffer is deliberately left at the Node default (1 MB): the measured JSON
// output is 41.8 KB for ROOT (373 files) and 0.9 KB for dsh (5 files), a 25x
// headroom, and buffer overflow surfaces as ENOBUFS rather than the ETIMEDOUT
// this ticket tracked. Nothing to fix here.
function packDryRun(cwd) {
	const { execFileSync } = require("node:child_process");
	// Under `npm test`, npm_execpath points at npm-cli.js: invoke it through the
	// current node binary instead of the `npm` shim, which is one process fewer.
	const npmCli = process.env.npm_execpath;
	const command = npmCli ? process.execPath : "npm";
	const args = npmCli ? [npmCli, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
	const raw = execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		timeout: PACK_TIMEOUT_MS,
	});
	return JSON.parse(raw);
}

test("dsh bundle declares its public install contract", () => {
	const manifest = JSON.parse(read("package.json"));
	const amberManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

	assert.equal(manifest.name, "dsh-amber-protocol");
	assert.equal(manifest.version, amberManifest.version);
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.equal(manifest.dependencies?.["amber-protocol"], `^${amberManifest.version}`);
	assert.deepEqual(manifest.files, ["cordis.patch.yml", "runtime.js", "README.md", "LICENSE"]);
});

test("amber-protocol package ships every bundle runtime dependency", () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	const shipped = new Set(manifest.files);

	assert.equal(shipped.has("scripts/"), true);
	assert.equal(shipped.has("schemas/"), true);
	assert.equal(shipped.has("action-types/"), true);
	assert.equal(shipped.has("action-functions/"), true);
	assert.equal(shipped.has("skills/"), true);
	assert.deepEqual(
		manifest.files.filter((entry) => entry.startsWith("apps/web/")),
		QA_MODEL_SCAN_FILES,
	);
	assert.equal(shipped.has(QA_PROVIDER_ADAPTER), false);
});

test("dsh bundle resolves Amber assets without checkout or profile paths", () => {
	const patch = read("cordis.patch.yml");

	assert.match(patch, /name:\s+dsh-amber-protocol\/runtime/);
	assert.match(patch, /id:\s+mcp-amber/);
	assert.match(patch, /name:\s+["']?@deepseek-ai\/dsh-mcp-client["']?/);
	assert.match(patch, /id:\s+amber-skill-filesystem/);
	assert.match(patch, /name:\s+["']?@deepseek-ai\/dsh-skill-filesystem["']?/);
	assert.match(patch, /!!js\s+amberBundlePaths\.mcpScript/);
	assert.match(patch, /!!js\s+amberBundlePaths\.skillsDir/);
	assert.match(patch, /!!js\s+process\.cwd\(\)/);
	assert.doesNotMatch(patch, /\/path\/to|profiles[/\\](?:web|headless)/i);
	assert.doesNotMatch(patch, new RegExp(["coding", "harness"].join("-"), "i"));
});

test("dsh bundle runtime resolves published Amber assets", () => {
	const runtime = require(path.join(BUNDLE_ROOT, "runtime.js"));
	const paths = runtime.resolveAmberBundlePaths();

	assert.equal(paths.mcpScript, path.join(ROOT, "scripts", "amber-mcp.js"));
	assert.equal(paths.skillsDir, path.join(ROOT, "skills"));
	assert.equal(fs.existsSync(paths.mcpScript), true);
	assert.equal(fs.existsSync(paths.skillsDir), true);
});

test("npm pack dry-run ships every QA model scan source without the provider adapter", () => {
	const packed = packDryRun(ROOT);
	const shipped = new Set(packed[0].files.map((entry) => entry.path));

	for (const rel of QA_MODEL_SCAN_FILES) {
		assert.equal(shipped.has(rel), true, `npm pack missing QA scan source: ${rel}`);
	}
	assert.equal(shipped.has(QA_PROVIDER_ADAPTER), false, "npm pack must exclude provider adapter");
});

test("npm pack dry-run ships every declared bundle asset", () => {
	const manifest = JSON.parse(read("package.json"));
	const packed = packDryRun(BUNDLE_ROOT);

	const shipped = new Set();
	for (const entry of packed[0].files) shipped.add(entry.path);

	const required = [...manifest.files, "package.json"];
	for (const rel of required) {
		assert.equal(shipped.has(rel), true, `npm pack missing declared asset: ${rel}`);
	}
});
