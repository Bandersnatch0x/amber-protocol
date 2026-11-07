"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("./state-dir-resolver");

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]+$/;
const VALID_ACTIONS = new Set(["start", "pause", "resume", "abort"]);
const VALID_STATUSES = new Set(["acked", "rejected"]);
const VALID_SESSION_STATUSES = new Set([
	"idle",
	"running",
	"created",
	"routed",
	"executing",
	"paused",
	"completed",
	"failed",
	"aborted",
]);

function resolveWithin(baseDir, ...segments) {
	const base = path.resolve(baseDir);
	const resolved = path.resolve(base, ...segments);
	const rel = path.relative(base, resolved);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
		return null;
	}
	return resolved;
}

function getRunnerAckPath(projectRoot, sessionId, requestId) {
	if (!VALID_REQUEST_ID.test(String(requestId || ""))) {
		throw new Error("Invalid runner ACK request id");
	}

	const sessionsDir = path.join(resolveStateDirForRead(projectRoot), "sessions");
	const sessionDir = resolveWithin(sessionsDir, sessionId);
	const ackDir = sessionDir ? resolveWithin(sessionDir, "runner-acks") : null;
	const ackPath = ackDir ? resolveWithin(ackDir, `${requestId}.json`) : null;
	if (!sessionDir || !ackDir || !ackPath) {
		throw new Error("Invalid runner ACK path");
	}
	return ackPath;
}

function validateAck(ack) {
	if (!VALID_ACTIONS.has(ack.action)) {
		throw new Error(`Invalid runner ACK action: ${ack.action}`);
	}
	if (!VALID_STATUSES.has(ack.status)) {
		throw new Error(`Invalid runner ACK status: ${ack.status}`);
	}
	if (!VALID_SESSION_STATUSES.has(ack.requestedStatus)) {
		throw new Error(`Invalid runner ACK requested status: ${ack.requestedStatus}`);
	}
}

function writeRunnerAck(projectRoot, sessionId, ack) {
	validateAck(ack);
	const ackPath = getRunnerAckPath(projectRoot, sessionId, ack.requestId);
	const payload = {
		requestId: ack.requestId,
		action: ack.action,
		status: ack.status,
		requestedStatus: ack.requestedStatus,
		source: ack.source || "amber-runner",
		receivedAt: ack.receivedAt || new Date().toISOString(),
		...(ack.message ? { message: ack.message } : {}),
	};

	// F-01: publish atomically. A direct writeFileSync exposes a truncate→write
	// window; the Web reader (apps/web/server/lib/runner-ack.ts) treats an
	// unparseable file as a TERMINAL rejection, so a reader polling while the
	// CLI publishes would report a spurious `rejected` ACK. Write a sibling
	// temp file, then rename it into place: the ACK path is either absent or
	// complete. Same pattern as apps/web/server/lib/session-writer.ts.
	fs.mkdirSync(path.dirname(ackPath), { recursive: true });
	const tempPath = `${ackPath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
	fs.renameSync(tempPath, ackPath);
	return payload;
}

function readRunnerAck(projectRoot, sessionId, requestId) {
	const ackPath = getRunnerAckPath(projectRoot, sessionId, requestId);
	return JSON.parse(fs.readFileSync(ackPath, "utf8"));
}

module.exports = {
	readRunnerAck,
	writeRunnerAck,
};
