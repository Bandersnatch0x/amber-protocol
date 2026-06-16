"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_FILES = {
	memory: "MEMORY.md",
	notes: "notes.md",
	tasksReadme: path.join("tasks", "README.md"),
};

function assertSafeTaskId(taskId) {
	if (!/^[A-Za-z0-9._-]+$/.test(taskId || "")) {
		throw new Error("unsafe task id");
	}
}

const TEMPLATE_ROOT = path.join(__dirname, "..", "..", "templates");

function readTemplateOrDefault(relativePath, defaultContent) {
	const templatePath = path.join(TEMPLATE_ROOT, relativePath);
	if (fs.existsSync(templatePath)) {
		return fs.readFileSync(templatePath, "utf8");
	}
	return defaultContent;
}

function writeIfMissing(filePath, content) {
	if (!fs.existsSync(filePath)) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
}

function ensureContinuitySurfaces(projectRoot) {
	const root = path.resolve(projectRoot || ".");
	const files = {
		memory: path.join(root, DEFAULT_FILES.memory),
		notes: path.join(root, DEFAULT_FILES.notes),
		tasksReadme: path.join(root, DEFAULT_FILES.tasksReadme),
	};

	writeIfMissing(
		files.memory,
		readTemplateOrDefault(
			"MEMORY.md",
			"# Memory\n\nDurable project knowledge selected by humans. Add constraints, architecture decisions, and facts that should survive across sessions.\n",
		),
	);
	writeIfMissing(
		files.notes,
		readTemplateOrDefault(
			"notes.md",
			"# Notes\n\nSession-local notes awaiting review. These are scratchpad-style entries; promote anything durable to MEMORY.md or a task progress file.\n",
		),
	);
	writeIfMissing(
		files.tasksReadme,
		readTemplateOrDefault(
			path.join("tasks", "README.md"),
			"# Tasks\n\nTask progress files live here. Each task gets its own directory with a `progress.md` file that records recovery state and next actions.\n",
		),
	);

	return {
		memory: DEFAULT_FILES.memory,
		notes: DEFAULT_FILES.notes,
		tasksReadme: DEFAULT_FILES.tasksReadme.replace(/\\/g, "/"),
	};
}

function appendTaskProgress(projectRoot, taskId, entry) {
	assertSafeTaskId(taskId);
	const root = path.resolve(projectRoot || ".");
	const relativePath = path.join("tasks", taskId, "progress.md");
	const filePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.appendFileSync(filePath, `${entry.trim()}\n`);
	return relativePath.replace(/\\/g, "/");
}

module.exports = { ensureContinuitySurfaces, appendTaskProgress };
