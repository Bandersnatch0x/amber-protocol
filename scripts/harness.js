#!/usr/bin/env node
"use strict";
// Legacy entrypoint. The CLI moved to scripts/amber.js (Amber Protocol rename).
const { run } = require("./amber");

run()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((err) => {
		console.error(err.message || err);
		process.exitCode = 1;
	});
