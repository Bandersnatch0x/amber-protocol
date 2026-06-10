"use strict";

const fs = require("fs");
const path = require("path");
const { readTimeline } = require("./timeline-reader");

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
	fs.rmSync(dirPath, { recursive: true, force: true });
}

function readJSONL(filePath) {
	return readTimeline(filePath);
}

module.exports = { ensureDir, removeDir, readJSONL };
