const fs = require("fs");

// Read a JSONL timeline file into an array of event objects.
//
// Options:
//   strict: when true, throw on the first unparseable line. When false
//           (default), corrupt lines are skipped so a partially-written
//           timeline (e.g. after a crash) is still inspectable.
function readTimeline(filePath, { strict = false } = {}) {
	if (!fs.existsSync(filePath)) {
		return [];
	}

	const raw = fs.readFileSync(filePath, "utf8");
	const events = [];

	const lines = raw.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === "") continue;

		try {
			events.push(JSON.parse(line));
		} catch (err) {
			if (strict) {
				throw new Error(`Corrupt timeline at line ${i + 1}: ${err.message}`);
			}
		}
	}

	return events;
}

module.exports = { readTimeline };
