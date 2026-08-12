"use strict";

// Fail-closed registry loader for the Amber MCP adapter. A registry is one
// startup contract: one bad entry invalidates the surface instead of silently
// publishing a partial set of tools.

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

function registryError(kind, findings) {
	return new Error(`${kind} registry is invalid:\n  - ${findings.join("\n  - ")}`);
}

function loadActionTypes({ directory, schemaPath }) {
	if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
		throw new Error(`action registry directory not found: ${directory}`);
	}

	let schema;
	try {
		schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	} catch (err) {
		throw new Error(`action registry schema is invalid: ${schemaPath} (${err.message})`, {
			cause: err,
		});
	}
	const validate = new Ajv({ allErrors: true }).compile(schema);
	const actions = [];
	const findings = [];
	const ids = new Set();

	for (const file of fs
		.readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.sort()) {
		let definition;
		try {
			definition = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
		} catch (err) {
			findings.push(`${file}: invalid JSON (${err.message})`);
			continue;
		}
		if (!validate(definition)) {
			const details = validate.errors
				.map((error) => `${error.instancePath || "/"} ${error.message}`)
				.join("; ");
			findings.push(`${file}: schema violation (${details})`);
			continue;
		}
		if (!definition.execution) {
			findings.push(`${file}: no execution mapping (${definition.actionTypeId})`);
			continue;
		}
		if (ids.has(definition.actionTypeId)) {
			findings.push(`${file}: duplicate actionTypeId ${definition.actionTypeId}`);
			continue;
		}
		ids.add(definition.actionTypeId);
		actions.push(definition);
	}

	if (findings.length > 0) throw registryError("action", findings);
	return actions;
}

function loadFunctions({ directory }) {
	if (!fs.existsSync(directory)) return [];
	if (!fs.statSync(directory).isDirectory()) {
		throw new Error(`function registry path is not a directory: ${directory}`);
	}

	const functions = [];
	const findings = [];
	const names = new Set();
	for (const file of fs
		.readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.sort()) {
		let fn;
		try {
			fn = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
		} catch (err) {
			findings.push(`${file}: invalid JSON (${err.message})`);
			continue;
		}
		if (!/^amber\.fn\./.test(fn.name || "")) {
			findings.push(`${file}: name must start with amber.fn.`);
			continue;
		}
		if (typeof fn.description !== "string" || fn.description.trim() === "") {
			findings.push(`${file}: missing description`);
			continue;
		}
		if (!fn.inputSchema || typeof fn.inputSchema !== "object") {
			findings.push(`${file}: missing inputSchema`);
			continue;
		}
		try {
			new Ajv({ allErrors: true }).compile(fn.inputSchema);
		} catch (err) {
			findings.push(`${file}: inputSchema is not valid JSON Schema (${err.message})`);
			continue;
		}
		if (names.has(fn.name)) {
			findings.push(`${file}: duplicate Function name ${fn.name}`);
			continue;
		}
		names.add(fn.name);
		functions.push(fn);
	}

	if (findings.length > 0) throw registryError("function", findings);
	return functions;
}

module.exports = { loadActionTypes, loadFunctions };
