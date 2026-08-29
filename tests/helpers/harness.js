"use strict";

// Shared test fixture builders (architecture review #3).
//
// 18 unit-test files each re-implemented a local mkTarget / makeTarget /
// mkRepo builder with drifting shape; the context-page writers (addPage) were
// byte-identical across governance-graph and knowledge-base tests. This is
// the single home for the standard shapes:
//
//   mkTarget(label, { git, profile, amber, subdirs }) — temp dir + .amber
//   gitInit(dir)                                       — init + identity
//   addPage(root, pageId, { title, sources, blocks, createdAt })
//   writeProfile(root, deploymentProfile)
//   writeJson / readJson / readJsonl
//
// The governed-ledger registry suites (maintain / retention / external /
// breakglass; ST-9) additionally share:
//
//   mkLedgerTarget(prefix)                — bare temp-dir factory per suite
//   readEvents / writeEvents(ledgerPath)  — chained-ledger JSONL round-trip
//   seedDecisionFixture(dir, opts)        — principal + intent + Decisions
//
// Custom per-suite builders (e.g. context-adapter's makeTarget with routes,
// artifact-drift's mkRepo with feature_list) stay local — they encode their
// own fixture layout and migrating them would be churn without deepening.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/**
 * Create a temp fixture root, optionally a git repo, with .amber created.
 * @param {string} label - Temp-dir label (uniqueness only).
 * @param {{git?: boolean, profile?: string|null, amber?: boolean, subdirs?: string[]}} [opts]
 * @returns {string} Fixture root.
 */
function mkTarget(label, { git = false, profile = null, amber = true, subdirs = [] } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-${label}-`));
	if (git) gitInit(dir);
	if (amber) fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	for (const sub of subdirs) fs.mkdirSync(path.join(dir, sub), { recursive: true });
	if (profile) writeProfile(dir, profile);
	return dir;
}

/**
 * Initialize a git repo with a deterministic test identity.
 * @param {string} dir - Repo root.
 */
function gitInit(dir) {
	for (const args of [
		["init"],
		["config", "user.email", "test@example.com"],
		["config", "user.name", "Test User"],
	]) {
		spawnSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore"] });
	}
}

/**
 * Write a canonical context page under .amber/context/pages/.
 * @param {string} root - Fixture root.
 * @param {string} pageId - Kebab-case page id.
 * @param {{title?: string, sources?: object, blocks?: Array<object>, createdAt?: string|null}} [opts]
 * @returns {object} The written page.
 */
function addPage(root, pageId, { title, sources = {}, blocks = [], createdAt = null } = {}) {
	const pagesDir = path.join(root, ".amber", "context", "pages");
	fs.mkdirSync(pagesDir, { recursive: true });
	const page = { pageId, title: title || pageId, sources, blocks };
	if (createdAt) page.createdAt = createdAt;
	fs.writeFileSync(path.join(pagesDir, `${pageId}.json`), JSON.stringify(page));
	return page;
}

/**
 * Declare a deployment profile at .amber/profile.json.
 * Accepts a profile id string ({"deploymentProfile": <id>}) or a full
 * profile-file object.
 * @param {string} root - Fixture root.
 * @param {string|object} deploymentProfile - Profile id or file content.
 */
function writeProfile(root, deploymentProfile) {
	const content =
		deploymentProfile && typeof deploymentProfile === "object"
			? deploymentProfile
			: { deploymentProfile };
	fs.mkdirSync(path.join(root, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".amber", "profile.json"),
		JSON.stringify(content, null, 2) + "\n",
	);
}

/** Write a JSON file (parent dirs created). */
function writeJson(root, relPath, value) {
	const file = path.join(root, relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
	return file;
}

/** Read a JSON file, or null when missing. */
function readJson(file) {
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Read a JSONL file into objects (empty when missing). */
function readJsonl(file) {
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Bind a suite's temp-dir prefix once, yielding its classic `mkTarget(label)`
 * — a bare mkdtemp fixture root (no .amber, no git), exactly what the
 * governed-ledger registry suites build for every test.
 * @param {string} prefix - Suite prefix, e.g. "amber-maintain".
 * @returns {(label: string) => string} Fixture-root factory.
 */
function mkLedgerTarget(prefix) {
	return (label) => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${label}-`));
}

/** Read a chained-ledger JSONL file into its events (blank lines skipped). */
function readEvents(ledgerPath) {
	return fs
		.readFileSync(ledgerPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

/** Rewrite a chained-ledger JSONL file from events (tamper/forgery tests). */
function writeEvents(ledgerPath, events) {
	fs.writeFileSync(ledgerPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

/**
 * Seed the governance anchors the ledger suites share: register one human
 * principal, admit one anchor intent, and admit one committed approval
 * Decision per identity tracing decides -> that intent. Every step is
 * asserted ok, so a broken fixture fails loudly at the seeding site.
 * @param {string} dir - Fixture root.
 * @param {{principal: string, intent: string, identities: string[], body?: string}} opts
 *   principal — human principal id; intent — anchor intent identity;
 *   identities — one committed Decision per entry (body `# <identity>\n`);
 *   body — the anchor intent's Body.
 */
function seedDecisionFixture(dir, { principal, intent, identities, body = "# Intent\n" }) {
	const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
	const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
	assert.equal(registerPrincipal(dir, { id: principal, principalKind: "human" }).ok, true);
	assert.equal(admitArtifact(dir, { type: "intent", identity: intent, body }).ok, true);
	for (const identity of identities) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal,
			traces: [{ type: "decides", to: { type: "intent", identity: intent } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
}

module.exports = {
	mkTarget,
	gitInit,
	addPage,
	writeProfile,
	writeJson,
	readJson,
	readJsonl,
	mkLedgerTarget,
	readEvents,
	writeEvents,
	seedDecisionFixture,
};
