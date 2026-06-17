"use strict";

// Export the wiki as an OKF bundle: copied Markdown pages, an okf.json
// manifest (concepts + links = the knowledge graph), and a single
// self-contained HTML visualizer. Mirrors Google OKF's reference shape
// (a directory of Markdown + a static, backend-free graph view).

const fs = require("node:fs");
const path = require("node:path");

const {
	pathExists,
	readText,
	relativeSlash,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");
const {
	extractMarkdownLinks,
	isExternalLink,
	stripAnchorAndQuery,
} = require("./text-utils");
const { parseOkfFrontmatter, OKF_VERSION } = require("./okf-frontmatter");

function deriveTitle(data, body, fallbackId) {
	if (data && typeof data.title === "string" && data.title.trim()) {
		return data.title.trim();
	}
	const match = /^#\s+(.+)$/m.exec(body || "");
	return match ? match[1].trim() : fallbackId;
}

function listWikiFiles(wikiRoot) {
	return walkFiles(wikiRoot).filter((file) => file.toLowerCase().endsWith(".md"));
}

function buildOkfGraph(target) {
	const targetRoot = resolveTarget(target);
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	const warnings = [];

	if (!pathExists(wikiRoot)) {
		return {
			target: targetRoot,
			nodes: [],
			edges: [],
			errors: ["docs/wiki directory is missing."],
			warnings,
		};
	}

	const files = listWikiFiles(wikiRoot);
	const nodes = [];
	const nodeIds = new Set();

	for (const filePath of files) {
		const id = relativeSlash(wikiRoot, filePath);
		const { data, body } = parseOkfFrontmatter(readText(filePath));
		nodes.push({
			id,
			type: data && typeof data.type === "string" ? data.type : null,
			title: deriveTitle(data, body, id),
		});
		nodeIds.add(id);
	}

	const edges = [];
	for (const filePath of files) {
		const sourceId = relativeSlash(wikiRoot, filePath);
		const fileDir = path.dirname(filePath);
		for (const link of extractMarkdownLinks(readText(filePath))) {
			if (isExternalLink(link)) {
				continue;
			}
			const withoutAnchor = stripAnchorAndQuery(link);
			if (!withoutAnchor) {
				continue;
			}
			const targetId = relativeSlash(wikiRoot, path.resolve(fileDir, withoutAnchor));
			if (nodeIds.has(targetId) && targetId !== sourceId) {
				edges.push({ source: sourceId, target: targetId });
			}
		}
	}

	return { target: targetRoot, nodes, edges, errors: [], warnings };
}

function buildVisualizerHtml(graph) {
	const json = JSON.stringify({ nodes: graph.nodes, edges: graph.edges }).replace(/</g, "\\u003c");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OKF Knowledge Graph</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
  header { padding: 12px 16px; border-bottom: 1px solid #1e293b; }
  h1 { font-size: 16px; margin: 0; }
  p { margin: 4px 0 0; font-size: 12px; color: #94a3b8; }
  svg { width: 100vw; height: calc(100vh - 64px); }
  .edge { stroke: #334155; stroke-width: 1; }
  .node circle { fill: #2563eb; stroke: #0f172a; stroke-width: 2; cursor: pointer; }
  .node text { fill: #e2e8f0; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>OKF Knowledge Graph</h1>
  <p>Self-contained visualization. No backend; no data leaves this page.</p>
</header>
<svg id="graph"></svg>
<script>
const DATA = ${json};
const svg = document.getElementById('graph');
const W = svg.clientWidth || 960, H = svg.clientHeight || 600;
const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 80;
const pos = {};
DATA.nodes.forEach((n, i) => {
  const a = (2 * Math.PI * i) / Math.max(DATA.nodes.length, 1);
  pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
});
const NS = 'http://www.w3.org/2000/svg';
DATA.edges.forEach((e) => {
  const a = pos[e.source], b = pos[e.target];
  if (!a || !b) return;
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('class', 'edge');
  line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
  line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
  svg.appendChild(line);
});
DATA.nodes.forEach((n) => {
  const p = pos[n.id];
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'node');
  g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('r', 7);
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', 10); t.setAttribute('y', 4);
  t.textContent = n.title + (n.type ? ' (' + n.type + ')' : '');
  g.appendChild(c); g.appendChild(t);
  svg.appendChild(g);
});
</script>
</body>
</html>
`;
}

function exportOkfBundle(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	const graph = buildOkfGraph(targetRoot);

	if (graph.errors.length > 0) {
		return {
			target: targetRoot,
			outputDir: options.outputDir || null,
			okfVersion: OKF_VERSION,
			nodeCount: 0,
			edgeCount: 0,
			files: [],
			errors: graph.errors,
			warnings: graph.warnings,
		};
	}

	const outputDir = options.outputDir
		? path.resolve(targetRoot, options.outputDir)
		: path.join(targetRoot, "docs", "okf-bundle");

	fs.mkdirSync(outputDir, { recursive: true });
	const files = [];

	for (const filePath of listWikiFiles(wikiRoot)) {
		const rel = relativeSlash(wikiRoot, filePath);
		const dest = path.join(outputDir, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(filePath, dest);
		files.push(rel);
	}

	const manifest = {
		okfVersion: OKF_VERSION,
		generatedBy: "amber wiki export --okf",
		concepts: graph.nodes.map((node) => ({ id: node.id, type: node.type, title: node.title })),
		links: graph.edges,
	};
	fs.writeFileSync(path.join(outputDir, "okf.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	files.push("okf.json");

	fs.writeFileSync(path.join(outputDir, "graph.html"), buildVisualizerHtml(graph));
	files.push("graph.html");

	return {
		target: targetRoot,
		outputDir,
		okfVersion: OKF_VERSION,
		nodeCount: graph.nodes.length,
		edgeCount: graph.edges.length,
		files,
		errors: [],
		warnings: graph.warnings,
	};
}

module.exports = {
	buildOkfGraph,
	buildVisualizerHtml,
	exportOkfBundle,
};
