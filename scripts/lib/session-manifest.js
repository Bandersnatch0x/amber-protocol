const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { SCHEMA_VERSION } = require("./schema-version-checker");
const { compileSchema } = require("./core/schema-contract");

// Compiled at module scope so a broken schema install throws at require time,
// not on first validation.
const validate = compileSchema("session-manifest");

let lastTimestampMs = 0;
// Monotonic timestamp: stamps in the same millisecond (fast CLI sequences /
// tests) must not share a value, else the "newest session" sort in
// readAllSessionManifests ties and falls back to readdirSync order — which
// differs across filesystems and caused the continue-recovery flake (#58).
// Bump +1ms in-process so a later stamp always exceeds an earlier one. Shared
// by createManifest (createdAt) AND writeSessionManifest (updatedAt) so an
// updatedAt never lands before its own createdAt.
function monotonicNowMs() {
	let nowMs = Date.now();
	if (nowMs <= lastTimestampMs) nowMs = lastTimestampMs + 1;
	lastTimestampMs = nowMs;
	return nowMs;
}
function createManifest({ route, goal, budget, feature, agent }) {
	const now = new Date(monotonicNowMs()).toISOString();
	return {
		sessionId: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		createdAt: now,
		updatedAt: now,
		route,
		goal,
		status: "created",
		completedStages: [],
		...(feature ? { feature } : {}),
		...(budget != null && { budget: { total: budget, used: 0 } }),
		...(agent ? { agentId: agent, agentClaimedAt: now } : {}),
	};
}

function validateManifest(manifest) {
	const valid = validate(manifest);
	if (!valid) {
		return {
			valid: false,
			errors: validate.errors.map((e) => `${e.instancePath} ${e.message}`),
		};
	}
	return { valid: true, errors: [] };
}

// Read one session manifest by its session directory. Returns
// { manifest, sessionDir, manifestPath } on success,
// { manifest: null, sessionDir, manifestPath, corrupt: true } when the file is
// present but unparseable (half-written), or null when absent.
function readSessionManifest(sessionDir) {
	const manifestPath = path.join(sessionDir, "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		return null;
	}
	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		return { manifest, sessionDir, manifestPath };
	} catch {
		return { manifest: null, sessionDir, manifestPath, corrupt: true };
	}
}

// Enumerate every session manifest under sessionsDir, newest first. Corrupt
// manifests are skipped so one bad file cannot crash enumeration. [] when the
// dir is absent or empty.
function readAllSessionManifests(sessionsDir) {
	if (!fs.existsSync(sessionsDir)) {
		return [];
	}
	return fs
		.readdirSync(sessionsDir)
		.map((name) => readSessionManifest(path.join(sessionsDir, name)))
		.filter((result) => result && result.manifest)
		.map((result) => result.manifest)
		.sort((a, b) => {
			// Newest createdAt first; a deterministic sessionId tiebreak ensures
			// equal timestamps (cross-process same-ms) never fall back to
			// readdirSync order, which differs across filesystems (#58).
			const t = new Date(b.createdAt) - new Date(a.createdAt);
			if (t !== 0) return t;
			return a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0;
		});
}

// Persist a session manifest, stamping updatedAt immutably. Replaces the
// hand-rolled `fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))`
// that 5 call sites used (bypassing writeJson). Does not mutate the input.
// Returns the persisted manifest.
//
// The write is temp+rename so a crash mid-write can never leave a half-written
// manifest — F062's projection refresh is specified as atomic ("atomically
// refresh manifest and timeline projections").
function writeSessionManifest(sessionDir, manifest) {
	const persisted = { ...manifest, updatedAt: new Date(monotonicNowMs()).toISOString() };
	const manifestPath = path.join(sessionDir, "manifest.json");
	const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
	// The replaced writeJson created the directory; keep that contract or a
	// first write into a fresh session dir ENOENTs on the temp file.
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(tempPath, JSON.stringify(persisted, null, 2));
	try {
		fs.renameSync(tempPath, manifestPath);
	} catch (error) {
		try {
			fs.unlinkSync(tempPath);
		} catch {
			// the temp name is already gone
		}
		throw error;
	}
	return persisted;
}

// Statuses that mark a session as in-progress (not completed/aborted).
// Shared by mcp-action-runtime (concurrency guard) and mcp-functions (snapshot).
const ACTIVE_SESSION_STATUSES = new Set(["created", "routed", "executing", "paused"]);

// Read + validate a manifest from a parsed JSON object. Throws on corrupt
// manifests so call sites can distinguish "absent" (null) from "corrupt"
// (throws) from "valid" (returns manifest). Used by both Function and Action
// runtimes so the error shape is identical across the MCP seam.
function loadAndValidateManifest(manifest, sessionId) {
	const validation = validateManifest(manifest);
	if (!validation.valid) {
		throw new Error(`corrupt session manifest ${sessionId}: ${validation.errors.join("; ")}`);
	}
	return manifest;
}

// Project the common summary fields from a validated manifest. Both
// sessionSummary (Function) and repoSnapshot (Function) build the same shape;
// centralizing it keeps the two in lockstep.
function manifestProjection(manifest, sessionId) {
	return {
		sessionId,
		status: manifest.status,
		active: ACTIVE_SESSION_STATUSES.has(manifest.status),
		goal: manifest.goal,
		route: manifest.route && manifest.route.id,
		agentId: manifest.agentId || null,
	};
}

// Read all session manifests under a target repo's .amber/sessions/ dir.
// Returns { active, corrupt } where active = sessions with a non-terminal
// status, corrupt = sessions with missing/invalid manifests. This is the
// single read entry point for concurrency guards and summaries — every
// caller goes through here so the fail-closed rule (corrupt manifest =
// refuse, not skip) cannot drift.
//
// sessionsDir: absolute path to .amber/sessions (already containment-checked).
// resolveManifestPath(name): returns the absolute manifest.json path for a
// session directory name, applying containment checks (symlink/junction
// escape). The caller owns resolution so this module stays free of target-repo
// logic.
function readSessionsForConcurrency(sessionsDir, resolveSessionDir) {
	if (!fs.existsSync(sessionsDir)) return { active: [], corrupt: [] };
	const active = [];
	const corrupt = [];
	for (const name of fs.readdirSync(sessionsDir).sort()) {
		const sessionDir = resolveSessionDir(name);
		const result = readSessionManifest(sessionDir);
		if (!result) {
			corrupt.push({ sessionId: name, reason: "missing manifest.json" });
			continue;
		}
		if (result.corrupt) {
			corrupt.push({ sessionId: name, reason: "invalid JSON" });
			continue;
		}
		const validation = validateManifest(result.manifest);
		if (!validation.valid) {
			corrupt.push({ sessionId: name, reason: validation.errors.join("; ") });
			continue;
		}
		if (ACTIVE_SESSION_STATUSES.has(result.manifest.status))
			active.push({ sessionId: name, agentId: result.manifest.agentId || null });
	}
	return { active, corrupt };
}

// Validate + project a parsed session manifest in one call. This is the
// single summary entry point — sessionSummary (Function runtime) and
// repoSnapshot (Function runtime) both call it so the validate-project
// sequence cannot drift between call sites. Accepts the already-parsed
// manifest object so the caller owns the read path (reader injection stays
// at the caller where target resolution lives).
function readSessionSummary(manifest, sessionId) {
	loadAndValidateManifest(manifest, sessionId);
	return manifestProjection(manifest, sessionId);
}

module.exports = {
	createManifest,
	validateManifest,
	readSessionManifest,
	readAllSessionManifests,
	writeSessionManifest,
	ACTIVE_SESSION_STATUSES,
	loadAndValidateManifest,
	manifestProjection,
	readSessionsForConcurrency,
	readSessionSummary,
};
