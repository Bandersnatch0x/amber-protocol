"use strict";

// Minimal YAML loader/escaper for plan files, extracted from knowledge-plan.js
// so YAML mechanics stop interleaving with plan/knowledge-base domain logic.
// Supports only the common structures the knowledge plan uses (kv / lists /
// nesting); no multi-line strings, anchors, or complex YAML. Dependency-free
// apart from the generic pathExists/readText helpers.

const { pathExists, readText } = require("./fs-utils");

// 仅支持简单结构(kv/列表/嵌套),不支持多行字符串/锚点/复杂 YAML;复杂 plan 请用 json
function parseSimpleYaml(text) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const root = {};
	let stack = [{ indent: -1, obj: root, keyName: null, listKey: null }];
	let currentKey = null;

	function current() {
		return stack[stack.length - 1].obj;
	}

	for (let raw of lines) {
		const line = raw;
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const indent = line.match(/^(\s*)/)[1].length;
		const trimmed = line.trim();

		// pop stack for dedent
		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
			stack.pop();
		}

		if (trimmed.startsWith("- ")) {
			// list item
			let listOwner = current();
			let listKey = currentKey;
			const topEntry = stack[stack.length - 1];
			if (topEntry && topEntry.listKey) {
				listKey = topEntry.listKey;
			}
			if (topEntry && topEntry.keyName && Object.keys(listOwner).length === 0) {
				// The prior block "key:" was actually a list starter (e.g. knowledgeCards:, notes:, tags:).
				// Convert: pop the temp {} container and attach [] to the real owner.
				stack.pop();
				listOwner = current();
				listKey = topEntry.keyName;
			}
			if (!Array.isArray(listOwner[listKey])) {
				listOwner[listKey] = [];
			}
			const ownerIdx = stack.length - 1;
			stack[ownerIdx].listKey = listKey;
			currentKey = listKey;
			const itemText = trimmed.slice(2).trim();
			if (itemText.includes(":")) {
				// list of objects: - title: "foo"
				const obj = {};
				listOwner[listKey].push(obj);
				stack.push({ indent, obj, keyName: null, listKey: null });
				// parse inline first kv on same line if present
				const firstKv = itemText;
				const m = firstKv.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
				if (m) {
					let val = m[2].trim();
					if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
						val = val.slice(1, -1);
					}
					obj[m[1]] = val;
				}
			} else {
				// simple list of scalars
				let val = itemText;
				if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
				listOwner[listKey].push(val);
			}
			continue;
		}

		const kv = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
		if (kv) {
			let [, key, val] = kv;
			val = val.trim();
			if (val === "" || val === "|" || val === ">") {
				// start of block (object or list-of)
				const obj = current();
				const child = {};
				obj[key] = child;
				stack.push({ indent, obj: child, keyName: key, listKey: null });
				currentKey = null;
				continue;
			}
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			} else if (val === "[]" || val === "{}") {
				val = val === "[]" ? [] : {};
			} else if (/^-?\d+$/.test(val)) {
				val = parseInt(val, 10);
			}
			const obj = current();
			obj[key] = val;
			currentKey = key;
		}
	}

	return root;
}

function loadYamlFile(filePath) {
	if (!pathExists(filePath)) return null;
	const text = readText(filePath);
	try {
		return parseSimpleYaml(text);
	} catch (e) {
		throw new Error(`Failed to parse YAML at ${filePath}: ${e.message}`);
	}
}

function escapeYaml(s) {
	return String(s || "").replace(/"/g, '\\"');
}

module.exports = { parseSimpleYaml, loadYamlFile, escapeYaml };
