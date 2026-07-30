"use strict";

// ADR-0008: provider-neutral observation contract. P1 ships only the
// capability registry — no session-observation normalization fields (YAGNI;
// those land with P2 session providers). amber-native is the only supported
// provider in P1; all others declare unsupported so the assessor fails closed
// rather than fabricating coverage from another host's cache.

// ponytail: capability fields described in Amber governance/readiness
// vocabulary, not any external project's enum.

const CAPABILITY_KEYS = [
	"agentAssets", // configured agent docs/skills/AGENTS.md present and parseable
	"sessions", // session runtime telemetry readable
	"usage", // token/duration signals available
	"permissions", // approval/deny evidence available
	"outputs", // command/verifier output evidence available
	"mutation", // provider can mutate target repo (always unsupported for read-only assessment)
];

const PROVIDERS = [
	{
		providerId: "amber-native",
		capabilities: {
			agentAssets: "supported",
			sessions: "supported", // declared supported; P1 assess does not consume session events
			usage: "unsupported",
			permissions: "supported",
			outputs: "supported",
			mutation: "unsupported",
		},
		available: () => true, // amber-native artifacts live in-repo; always reachable (targetRoot-independent)
	},
	{
		providerId: "claude",
		capabilities: {
			agentAssets: "unsupported",
			sessions: "unsupported", // P2b wiring pending: buildReport consumes amber-native only; declared unsupported until claude session evidence is actually merged into coverage (fail-closed per ADR-0008 §Consequences).
			usage: "unsupported",
			permissions: "unsupported",
			outputs: "supported",
			mutation: "unsupported",
		},
		available: (targetRoot) => {
			// Detect ~/.claude/projects/<encoded-target> existence, bound to the
			// assessed target (not process.cwd()) so cross-repo assessment reports
			// availability for the right repo.
			const { repoTranscriptDir } = require("./providers/claude-transcript");
			const fs = require("node:fs");
			const path = require("node:path");
			try {
				return fs.existsSync(repoTranscriptDir(path.resolve(targetRoot || process.cwd())));
			} catch {
				return false;
			}
		},
	},
	{
		providerId: "codex",
		capabilities: {
			agentAssets: "unsupported",
			sessions: "unsupported",
			usage: "unsupported",
			permissions: "unsupported",
			outputs: "unsupported",
			mutation: "unsupported",
		},
		available: () => false, // P3: pending stable documented data source
	},
	{
		providerId: "cursor",
		capabilities: {
			agentAssets: "unsupported",
			sessions: "unsupported",
			usage: "unsupported",
			permissions: "unsupported",
			outputs: "unsupported",
			mutation: "unsupported",
		},
		available: () => false, // P3: pending stable documented data source
	},
];

function listProviders(targetRoot) {
	return PROVIDERS.map((p) => ({
		providerId: p.providerId,
		capabilities: { ...p.capabilities },
		available: p.available(targetRoot),
	}));
}

function providerById(providerId, targetRoot) {
	const p = PROVIDERS.find((x) => x.providerId === providerId);
	if (!p) return null;
	return {
		providerId: p.providerId,
		capabilities: { ...p.capabilities },
		available: p.available(targetRoot),
	};
}

module.exports = { CAPABILITY_KEYS, listProviders, providerById };
