"use strict";

const fs = require("fs");

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
	fs.rmSync(dirPath, { recursive: true, force: true });
}

module.exports = { ensureDir, removeDir };
