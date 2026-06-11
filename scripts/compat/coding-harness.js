#!/usr/bin/env node
"use strict";
// Legacy bin alias for the renamed amber-protocol package.
if (!process.env.AMBER_SUPPRESS_DEPRECATION) {
	process.stderr.write(
		"[deprecated] `coding-harness` is now `amber` (Amber Protocol). " +
			"This alias will be removed in a future release.\n",
	);
}
const { run } = require("../amber");

run()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((err) => {
		console.error(err.message || err);
		process.exitCode = 1;
	});
