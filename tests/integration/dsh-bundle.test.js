const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const BUNDLE_ROOT = path.join(ROOT, "dsh");

function read(relativePath) {
	return fs.readFileSync(path.join(BUNDLE_ROOT, relativePath), "utf8");
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

test("npm pack dry-run ships every declared bundle asset", () => {
	const { execFileSync } = require("node:child_process");
	const manifest = JSON.parse(read("package.json"));

	let packed;
	try {
		const raw = execFileSync(
			process.execPath,
			["../../node_modules/npm/bin/npm-cli.js", "pack", "--dry-run", "--json"],
			{ cwd: BUNDLE_ROOT, encoding: "utf8", timeout: 30000 },
		);
		packed = JSON.parse(raw);
	} catch (error) {
		// Fallback: invoke npm directly (global install / npx)
		const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
			cwd: BUNDLE_ROOT,
			encoding: "utf8",
			timeout: 30000,
		});
		packed = JSON.parse(raw);
	}

	const shipped = new Set();
	for (const entry of packed[0].files) shipped.add(entry.path);

	const required = [...manifest.files, "package.json"];
	for (const rel of required) {
		assert.equal(shipped.has(rel), true, `npm pack missing declared asset: ${rel}`);
	}
});
