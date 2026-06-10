const fs = require("fs");
const path = require("path");

class TimelineWriter {
	constructor(filePath) {
		this.filePath = filePath;
		this.stream = null;
		this.streamError = null;
	}

	_ensureStream() {
		if (this.stream) return;

		const dir = path.dirname(this.filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
		this.stream.on("error", (err) => {
			this.streamError = err;
		});
	}

	async append(event) {
		if (this.streamError) {
			throw this.streamError;
		}

		this._ensureStream();

		const fullEvent = {
			timestamp: new Date().toISOString(),
			...event,
		};
		const line = JSON.stringify(fullEvent) + "\n";

		return new Promise((resolve, reject) => {
			this.stream.write(line, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	async close() {
		if (!this.stream) return;

		const stream = this.stream;
		this.stream = null;

		return new Promise((resolve, reject) => {
			stream.on("error", reject);
			stream.end(() => {
				if (this.streamError) reject(this.streamError);
				else resolve();
			});
		});
	}
}

module.exports = { TimelineWriter };
