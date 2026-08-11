"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const schemaPath = path.join(__dirname, "../../schemas/loop-contract.schema.json");
const packPath = path.join(__dirname, "../../workflow-packs/safe-amber-bootstrap.pack.json");

function compile(schema) {
	const ajv = new Ajv();
	addFormats(ajv);
	return ajv.compile(schema);
}

test("amber-doctor-check contract declares governed.command and validates against the schema", () => {
	const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
	const contract = pack.loopContracts.find((c) => c.id === "amber-doctor-check");
	assert.ok(contract, "amber-doctor-check contract present");
	assert.equal(contract.governed.command, "node scripts/amber.js doctor --target .");
	assert.equal(contract.execution.executesAnything, false, "executesAnything stays false");

	const validate = compile(schema);
	const ok = validate(contract);
	assert.equal(ok, true, JSON.stringify(validate.errors));
});

test("governed block is optional — a contract without it still validates", () => {
	const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	const minimal = {
		id: "x",
		trigger: { type: "manual", enabled: false },
		cadence: "on-demand",
		stateSpine: ".amber/loops/x/state.json",
		hardStops: { maxIterations: 1 },
	};
	const validate = compile(schema);
	assert.equal(validate(minimal), true, JSON.stringify(validate.errors));
});
