"use strict";

// Single tools/list description surface (F018 + F058).
// The MCP server and the instruction-surface Eval must advertise through this
// module so a description cannot drift from the Action Type / Function contract.

const {
	composeMcpToolDescription,
	composeFunctionToolDescription,
} = require("./mcp-tool-description");

function advertisedToolDescriptions(actions, functions) {
	const advertised = {};
	for (const action of actions || []) {
		advertised[action.actionTypeId] = composeMcpToolDescription(action);
	}
	for (const fn of functions || []) {
		advertised[fn.name] = composeFunctionToolDescription(fn);
	}
	return advertised;
}

function mcpActionTool(action, schemas = {}) {
	return {
		name: action.actionTypeId,
		description: composeMcpToolDescription(action),
		...schemas,
	};
}

function mcpFunctionTool(fn, schemas = {}) {
	return {
		name: fn.name,
		description: composeFunctionToolDescription(fn),
		...schemas,
	};
}

module.exports = {
	advertisedToolDescriptions,
	mcpActionTool,
	mcpFunctionTool,
};
