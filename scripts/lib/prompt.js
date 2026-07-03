"use strict";

const readline = require("node:readline");

// Ask a yes/no question on the terminal. Resolves true only for an explicit
// y / yes (case-insensitive). Anything else — including a bare Enter — is false.
function promptYesNo(question) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(question, (answer) => {
			rl.close();
			resolve(/^y(es)?$/i.test(String(answer).trim()));
		});
	});
}

module.exports = { promptYesNo };
