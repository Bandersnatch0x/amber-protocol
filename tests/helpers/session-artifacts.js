"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readSessionArtifacts(target, sessionId) {
	const sessionDir = path.join(target, ".amber", "sessions", sessionId);
	const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
	const timelineText = fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8").trim();
	const timeline = timelineText ? timelineText.split("\n").map((line) => JSON.parse(line)) : [];
	return { manifest, timeline };
}

module.exports = { readSessionArtifacts };
