"use strict";

const path = require("node:path");

// Quote a single shell argument so an emitted remedy stays one argument when a
// user copies it into a POSIX shell. Bare safe strings (incl. "." and relative
// paths without spaces) pass through unquoted; anything with spaces or shell
// metacharacters is single-quoted with embedded quotes escaped. Used so target
// and artifact paths containing spaces cannot split a remedy into two args.
function shellQuote(value) {
	const s = String(value ?? "");
	if (s === "") return "''";
	if (/^[A-Za-z0-9@%+=:,./_-]+$/.test(s)) return s;
	return `'${s.replace(/'/g, "'\\''")}'`;
}

function slugify(value) {
	// Preserve original case so that plan titles, task ids, and report
	// filenames match what the user typed. Only replace runs of characters
	// that are not alphanumeric (both cases) with a single dash.
	return (
		String(value || "")
			.replace(/[^a-zA-Z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "plan"
	);
}

function formatList(items, emptyText = "none") {
	if (!Array.isArray(items) || items.length === 0) {
		return [`- ${emptyText}`];
	}
	return items.map((item) => `- ${item}`);
}

function formatCommandList(commands, emptyText = "none") {
	if (!Array.isArray(commands) || commands.length === 0) {
		return [`- ${emptyText}`];
	}
	return commands.map((command) => `- ${command.source}: ${command.name} -> ${command.command}`);
}

function timestampForFileName(date = new Date()) {
	return date.toISOString().replace(/[:.]/g, "-").toLowerCase();
}

function escapeMarkdownTableCell(value) {
	return String(value || "")
		.replace(/\r?\n/g, " ")
		.replace(/\|/g, "\\|");
}

function extractMarkdownLinks(markdown) {
	const links = [];
	const pattern = /!?\[[^\]]*]\(([^)]+)\)/g;
	let match;

	while ((match = pattern.exec(markdown)) !== null) {
		const raw = match[1].trim();
		if (!raw) {
			continue;
		}
		const target = raw.split(/\s+/)[0].replace(/^<|>$/g, "");
		links.push(target);
	}

	return links;
}

function isInsideDirectory(parentDir, childPath) {
	const relativePath = path.relative(parentDir, childPath);
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isExternalLink(link) {
	return /^(https?:|mailto:|tel:|#)/i.test(link);
}

function stripAnchorAndQuery(link) {
	return link.split("#")[0].split("?")[0];
}

function getSectionBody(markdown, heading) {
	const lines = markdown.split(/\r?\n/);
	const headingPattern = new RegExp(
		`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
		"i",
	);
	const start = lines.findIndex((line) => headingPattern.test(line));
	if (start === -1) {
		return null;
	}

	const body = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^##\s+/.test(lines[index])) {
			break;
		}
		body.push(lines[index]);
	}

	return body.join("\n");
}

function hasSectionWithBody(markdown, heading) {
	const body = getSectionBody(markdown, heading);
	return body !== null && body.trim().length > 0;
}

function extractMarkdownListUnderSubheading(markdown, heading) {
	const lines = markdown.split(/\r?\n/);
	const headingPattern = new RegExp(
		`^###\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
		"i",
	);
	const start = lines.findIndex((line) => headingPattern.test(line));
	if (start === -1) {
		return [];
	}

	const items = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^#{2,3}\s+/.test(line)) {
			break;
		}
		const match = line.match(/^\s*-\s+(.+?)\s*$/);
		if (match && match[1].toLowerCase() !== "none") {
			items.push(match[1]);
		}
	}
	return items;
}

module.exports = {
	shellQuote,
	slugify,
	formatList,
	formatCommandList,
	timestampForFileName,
	escapeMarkdownTableCell,
	extractMarkdownLinks,
	isInsideDirectory,
	isExternalLink,
	stripAnchorAndQuery,
	getSectionBody,
	hasSectionWithBody,
	extractMarkdownListUnderSubheading,
};
