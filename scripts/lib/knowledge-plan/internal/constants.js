"use strict";

const path = require("node:path");

// The yaml alternate lives outside templates/ so no default scaffold
// (harness or wiki) copies it; only `knowledge scaffold --yaml` reads it.
const KNOWLEDGE_PLAN_TEMPLATE_ROOT = path.join(__dirname, "..", "templates");

module.exports = {
	KNOWLEDGE_PLAN_TEMPLATE_ROOT,
};
