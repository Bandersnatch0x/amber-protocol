"use strict";

// Owns the sync command's core orchestration: scaffold drift + artifact drift +
// conditional amber-owned refresh. Presentation (lines[] text, result.sync
// envelope) stays in the CLI handler so the public text surface stays
// byte-identical. Exposes `artifact` for future non-CLI callers (web adapter).
//
// Note semantics fix the latent handleSync bug: when artifact detection is
// unavailable (non-git / product-repo / missing feature_list), the note must
// say so explicitly and must NOT fall through to the aligned "none detected"
// message.

const { detectScaffoldDrift, refreshAmberOwnedFiles } = require("./scaffold-version-drift");
const { detectArtifactDrift } = require("./artifact-drift");

const ALIGNED_NOTE =
	"Artifact drift: none detected. (aligned = code not newer than evidence; not a re-verification)";

function buildArtifactNote(artifact) {
	if (!artifact || !artifact.available) {
		const detail = artifact && artifact.note ? artifact.note : "not available";
		return `Artifact drift: ${detail}`;
	}
	if (artifact.counts && artifact.counts.drifted > 0) {
		return `Artifact drift: ${artifact.counts.drifted} drifted — re-verify with \`amber feature verify --feature <id>\`.`;
	}
	return ALIGNED_NOTE;
}

/**
 * @param {string} targetRoot
 * @param {{ execute?: boolean, templateRoot?: string }} [options]
 * @returns {{ drift: object, artifact: object, refresh: object|null, note: string }}
 */
function syncProject(targetRoot, { execute = false, templateRoot } = {}) {
	const opts = templateRoot ? { templateRoot } : {};
	const drift = detectScaffoldDrift(targetRoot, opts);
	const artifact = detectArtifactDrift(targetRoot);
	const note = buildArtifactNote(artifact);
	const refresh = execute ? refreshAmberOwnedFiles(targetRoot, opts) : null;
	return { drift, artifact, refresh, note };
}

module.exports = { syncProject };
