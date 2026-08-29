"use strict";

// F060 phase 1 (#262; ADR-0025): deterministic code-corpus extractor.
//
// One product source file becomes one Code Node (kind `code`, implementation
// layer, id `code:<POSIX path>`); file-level dependencies become `imports`
// edges aggregated per file pair. The extractor is a pure function of the
// committed tree: discovery is a sorted directory walk, parsing is the
// TypeScript compiler API in syntax-only mode (no ts.Program, no type
// checker), and module resolution probes only the walked corpus set — an
// edge can never point at a file the walk did not admit, which keeps ids
// case-exact and byte-stable across platforms.
//
// Determinism discipline (ticket #262):
//   - paths normalized to POSIX; content normalized CRLF -> LF before
//     parsing so positions match across checkout line endings;
//   - exported-symbol tables sorted by (startLine, startCol, name) and
//     deduplicated by name;
//   - `export * from` re-exports resolve through a monotone closure with a
//     unique fixpoint (iteration order cannot change the result);
//   - incremental indexing is file-level content-hash skipping (the
//     normHash pattern), never editor-style incremental parsing;
//   - the exact `typescript` version is reported for graph provenance.
//
// Scope rule (the "product source file" contract): files with a JS/TS
// extension, excluding hidden directories, dependency/build output
// (node_modules, dist, build, coverage, output, tmp), test containers
// (tests, test, __tests__, e2e), *.test.* / *.spec.* files, and .d.ts
// declarations. Tests stay out of the graph (ADR-0025). The top-level
// docs/ tree is document territory — code files inside it (reference
// drafts, examples) are documentation payload, never Code Nodes.

const fs = require("node:fs");
const path = require("node:path");

const { sha256Hex } = require("./context-hash");
const { typedError } = require("./error-catalog");

const ERROR_CODES = Object.freeze({
	toolchain: "AMBER_E_KNOWLEDGE_TOOLCHAIN_MISSING",
	source: "AMBER_E_KNOWLEDGE_GRAPH_SOURCE",
});

const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const EXCLUDED_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"coverage",
	"output",
	"tmp",
	"tests",
	"test",
	"__tests__",
	"e2e",
]);
// Resolution probe order: TypeScript sources shadow their emitted-extension
// twins, matching the compiler's own extension priority.
const PROBE_EXTENSIONS = Object.freeze([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const JS_TO_TS = Object.freeze({
	".js": [".ts", ".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
});

let tsModule = null;

function loadTypeScript() {
	if (tsModule) return tsModule;
	try {
		tsModule = require("typescript");
		return tsModule;
	} catch {
		throw typedError(
			ERROR_CODES.toolchain,
			"the knowledge graph code layer requires the TypeScript compiler API and no `typescript` module is installed — run `npm install` at the amber-protocol root",
		);
	}
}

/** The exact compiler version recorded in graph provenance (`toolchain.typescript`). */
function typescriptVersion() {
	return loadTypeScript().version;
}

function toPosix(p) {
	return String(p).replace(/\\/g, "/");
}

function isTestFile(name) {
	return /\.(test|spec)\./.test(name);
}

function isDeclarationFile(name) {
	return /\.d\.(ts|mts|cts)$/.test(name);
}

function hasCodeExtension(name) {
	return CODE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Sorted, symlink-free walk of the target tree. Returns POSIX-relative
 * corpus file paths and every tsconfig*.json (for alias resolution).
 */
function walkCorpus(targetRoot) {
	const files = [];
	const tsconfigs = [];
	const walk = (absDir, relDir) => {
		let entries;
		try {
			entries = fs.readdirSync(absDir, { withFileTypes: true });
		} catch (err) {
			if (err.code === "ENOENT") return;
			throw typedError(ERROR_CODES.source, `could not read directory ${relDir}: ${err.message}`);
		}
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
			const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
			if (entry.isDirectory()) {
				if (EXCLUDED_DIRS.has(entry.name)) continue;
				if (relDir === "" && entry.name === "docs") continue;
				walk(path.join(absDir, entry.name), rel);
				continue;
			}
			if (!entry.isFile()) continue;
			if (/^tsconfig.*\.json$/.test(entry.name)) {
				tsconfigs.push(rel);
				continue;
			}
			if (!hasCodeExtension(entry.name)) continue;
			if (isTestFile(entry.name) || isDeclarationFile(entry.name)) continue;
			files.push(rel);
		}
	};
	walk(path.resolve(targetRoot), "");
	files.sort();
	tsconfigs.sort();
	return { files, tsconfigs };
}

/** Parse tsconfig*.json path aliases: [{ dir, fileName, baseUrl, paths }]. */
function readAliasConfigs(targetRoot, tsconfigs) {
	const ts = loadTypeScript();
	const configs = [];
	for (const rel of tsconfigs) {
		const abs = path.join(targetRoot, rel);
		const parsed = ts.readConfigFile(abs, (file) => {
			try {
				return fs.readFileSync(file, "utf8");
			} catch {
				return undefined;
			}
		});
		const options = parsed.config && parsed.config.compilerOptions;
		if (!options || !options.paths || typeof options.paths !== "object") continue;
		const dir = toPosix(path.dirname(rel));
		configs.push({
			dir: dir === "." ? "" : dir,
			fileName: rel,
			baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : "",
			paths: options.paths,
		});
	}
	// Nearest config directory first; stable file-name order inside one dir.
	configs.sort((a, b) => {
		if (a.dir.length !== b.dir.length) return b.dir.length - a.dir.length;
		if (a.dir !== b.dir) return a.dir < b.dir ? -1 : 1;
		return a.fileName < b.fileName ? -1 : 1;
	});
	return configs;
}

function matchPathsPattern(pattern, specifier) {
	const star = pattern.indexOf("*");
	if (star === -1) return pattern === specifier ? "" : null;
	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);
	if (specifier.length < prefix.length + suffix.length) return null;
	if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
	return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function makeResolver(fileSet, aliasConfigs) {
	const probe = (basePosix) => {
		const normalized = path.posix.normalize(basePosix);
		if (normalized.startsWith("../") || normalized === "..") return null;
		if (fileSet.has(normalized)) return normalized;
		const ext = path.posix.extname(normalized);
		if (JS_TO_TS[ext]) {
			const stem = normalized.slice(0, -ext.length);
			for (const tsExt of JS_TO_TS[ext]) {
				if (fileSet.has(stem + tsExt)) return stem + tsExt;
			}
		}
		for (const probeExt of PROBE_EXTENSIONS) {
			if (fileSet.has(normalized + probeExt)) return normalized + probeExt;
		}
		for (const probeExt of PROBE_EXTENSIONS) {
			if (fileSet.has(`${normalized}/index${probeExt}`)) return `${normalized}/index${probeExt}`;
		}
		return null;
	};

	return (rawSpecifier, importerPosix) => {
		if (typeof rawSpecifier !== "string" || rawSpecifier === "") return null;
		// Bundler suffixes (`./page.tsx?raw`) never change the target file.
		const specifier = rawSpecifier.split("?")[0];
		if (specifier.startsWith("./") || specifier.startsWith("../")) {
			const importerDir = path.posix.dirname(importerPosix);
			return probe(path.posix.join(importerDir, specifier));
		}
		if (specifier.startsWith("node:")) return null;
		for (const config of aliasConfigs) {
			if (config.dir !== "" && !(importerPosix + "/").startsWith(config.dir + "/")) continue;
			const patterns = Object.keys(config.paths).sort((a, b) => {
				const starA = a.indexOf("*") === -1 ? a.length : a.indexOf("*");
				const starB = b.indexOf("*") === -1 ? b.length : b.indexOf("*");
				if (starA !== starB) return starB - starA;
				return a < b ? -1 : a > b ? 1 : 0;
			});
			for (const pattern of patterns) {
				const matched = matchPathsPattern(pattern, specifier);
				if (matched === null) continue;
				const targets = config.paths[pattern];
				if (!Array.isArray(targets)) continue;
				for (const target of targets) {
					const substituted = String(target).replace("*", matched);
					const base = path.posix.join(config.dir, config.baseUrl, substituted);
					const resolved = probe(base);
					if (resolved) return resolved;
				}
			}
		}
		return null;
	};
}

// ── per-file syntax extraction ────────────────────────────────────────

function scriptKindFor(ts, filePosix) {
	if (filePosix.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (/\.(ts|mts|cts)$/.test(filePosix)) return ts.ScriptKind.TS;
	return ts.ScriptKind.JS;
}

function bindingIdentifiers(ts, name, out) {
	if (ts.isIdentifier(name)) {
		out.push(name);
		return;
	}
	if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
		for (const element of name.elements) {
			if (ts.isBindingElement(element)) bindingIdentifiers(ts, element.name, out);
		}
	}
}

function unwrapObjectLiteral(ts, expression) {
	let current = expression;
	while (
		ts.isCallExpression(current) &&
		ts.isPropertyAccessExpression(current.expression) &&
		ts.isIdentifier(current.expression.expression) &&
		current.expression.expression.text === "Object" &&
		["freeze", "assign"].includes(current.expression.name.text) &&
		current.arguments.length > 0
	) {
		current = current.arguments[0];
	}
	return ts.isObjectLiteralExpression(current) ? current : null;
}

function isModuleExports(ts, node) {
	return (
		ts.isPropertyAccessExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === "module" &&
		node.name.text === "exports"
	);
}

/**
 * Syntax-only extraction of one file: import specifiers (static imports,
 * re-exports, require() and import() string literals) and exported symbol
 * names with 1-based positions. `starFrom` records `export * from` targets
 * for the closure pass.
 */
function extractFile(ts, filePosix, content) {
	const sourceFile = ts.createSourceFile(
		filePosix,
		content,
		ts.ScriptTarget.Latest,
		false,
		scriptKindFor(ts, filePosix),
	);
	const imports = [];
	const symbols = [];
	const starFrom = [];
	const positionOf = (node) => {
		const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		return { startLine: line + 1, startCol: character + 1 };
	};
	const addSymbol = (name, node) => {
		if (typeof name !== "string" || name === "") return;
		symbols.push({ name, ...positionOf(node) });
	};
	const addImport = (specifier, node) => {
		if (typeof specifier !== "string" || specifier === "") return;
		imports.push({ specifier, line: positionOf(node).startLine });
	};
	const hasModifier = (node, kind) =>
		Array.isArray(node.modifiers) && node.modifiers.some((m) => m.kind === kind);

	const visit = (node) => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
			addImport(node.moduleSpecifier.text, node);
		} else if (ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
				addImport(node.moduleSpecifier.text, node);
				if (!node.exportClause) {
					const { startLine, startCol } = positionOf(node);
					starFrom.push({ specifier: node.moduleSpecifier.text, startLine, startCol });
				}
			}
			if (node.exportClause) {
				if (ts.isNamedExports(node.exportClause)) {
					for (const element of node.exportClause.elements)
						addSymbol(element.name.text, element.name);
				} else if (ts.isNamespaceExport(node.exportClause)) {
					addSymbol(node.exportClause.name.text, node.exportClause.name);
				}
			}
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference) &&
			ts.isStringLiteralLike(node.moduleReference.expression)
		) {
			addImport(node.moduleReference.expression.text, node);
		} else if (ts.isExportAssignment(node)) {
			addSymbol("default", node);
		} else if (ts.isCallExpression(node)) {
			const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
			const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			if (
				(isRequire || isDynamicImport) &&
				node.arguments.length > 0 &&
				ts.isStringLiteralLike(node.arguments[0])
			) {
				addImport(node.arguments[0].text, node);
			}
		} else if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			const left = node.left;
			if (isModuleExports(ts, left)) {
				const literal = unwrapObjectLiteral(ts, node.right);
				if (literal) {
					for (const property of literal.properties) {
						if (ts.isShorthandPropertyAssignment(property)) {
							addSymbol(property.name.text, property.name);
						} else if (
							(ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) &&
							(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
						) {
							addSymbol(property.name.text, property.name);
						}
					}
				}
			} else if (
				ts.isPropertyAccessExpression(left) &&
				(isModuleExports(ts, left.expression) ||
					(ts.isIdentifier(left.expression) && left.expression.text === "exports"))
			) {
				addSymbol(left.name.text, left.name);
			}
		} else if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
			if (
				ts.isFunctionDeclaration(node) ||
				ts.isClassDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node) ||
				ts.isModuleDeclaration(node)
			) {
				if (hasModifier(node, ts.SyntaxKind.DefaultKeyword) && !node.name) {
					addSymbol("default", node);
				} else if (node.name && ts.isIdentifier(node.name)) {
					addSymbol(
						hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? "default" : node.name.text,
						node.name,
					);
				}
			} else if (ts.isVariableStatement(node)) {
				for (const declaration of node.declarationList.declarations) {
					const names = [];
					bindingIdentifiers(ts, declaration.name, names);
					for (const identifier of names) addSymbol(identifier.text, identifier);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return { imports, symbols, starFrom };
}

// File-level content-hash skipping (the normHash pattern): repeat builds in
// one process re-parse only files whose normalized content changed.
const extractionMemo = new Map();

function readNormalized(absPath, relPosix) {
	try {
		return fs.readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw typedError(ERROR_CODES.source, `could not read ${relPosix}: ${err.message}`);
	}
}

function sortAndDedupSymbols(symbols) {
	const sorted = [...symbols].sort((a, b) => {
		if (a.startLine !== b.startLine) return a.startLine - b.startLine;
		if (a.startCol !== b.startCol) return a.startCol - b.startCol;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
	const seen = new Set();
	const result = [];
	for (const symbol of sorted) {
		if (seen.has(symbol.name)) continue;
		seen.add(symbol.name);
		result.push(symbol);
	}
	return result;
}

/**
 * Extract the deterministic code corpus of a target repository.
 * @param {string} target - Target repository root.
 * @returns {{
 *   files: Array<{sourcePath: string, symbols: Array<{name: string, startLine: number, startCol: number}>}>,
 *   imports: Array<{src: string, dst: string, evidence: Array<{path: string, line: number}>}>,
 * }}
 */
function extractCodeCorpus(target) {
	const ts = loadTypeScript();
	const targetRoot = path.resolve(target || process.cwd());
	const { files, tsconfigs } = walkCorpus(targetRoot);
	const fileSet = new Set(files);
	const resolve = makeResolver(fileSet, readAliasConfigs(targetRoot, tsconfigs));

	const byFile = new Map();
	for (const rel of files) {
		const content = readNormalized(path.join(targetRoot, rel), rel);
		if (content === null) continue; // removed between walk and read
		const hash = sha256Hex(content);
		const memoKey = `${targetRoot}\u0000${rel}`;
		const memo = extractionMemo.get(memoKey);
		if (memo && memo.hash === hash) {
			byFile.set(rel, memo.extraction);
			continue;
		}
		const extraction = extractFile(ts, rel, content);
		extractionMemo.set(memoKey, { hash, extraction });
		byFile.set(rel, extraction);
	}

	// Resolve import specifiers once per file.
	const resolvedImports = new Map();
	const exportNames = new Map();
	const starTargets = new Map();
	for (const [rel, extraction] of byFile) {
		const targets = new Map();
		for (const item of extraction.imports) {
			const dst = resolve(item.specifier, rel);
			if (!dst || dst === rel) continue;
			if (!targets.has(dst)) targets.set(dst, new Set());
			targets.get(dst).add(item.line);
		}
		resolvedImports.set(rel, targets);
		exportNames.set(rel, new Map(extraction.symbols.map((s) => [s.name, s])));
		starTargets.set(
			rel,
			extraction.starFrom
				.map((star) => ({ ...star, target: resolve(star.specifier, rel) }))
				.filter((star) => star.target && star.target !== rel),
		);
	}

	// `export * from` closure: monotone, so the fixpoint is order-independent.
	let changed = true;
	let rounds = 0;
	while (changed && rounds <= byFile.size) {
		changed = false;
		rounds += 1;
		for (const rel of files) {
			const names = exportNames.get(rel);
			if (!names) continue;
			for (const star of starTargets.get(rel) || []) {
				const targetNames = exportNames.get(star.target);
				if (!targetNames) continue;
				for (const name of targetNames.keys()) {
					if (name === "default" || names.has(name)) continue;
					names.set(name, { name, startLine: star.startLine, startCol: star.startCol });
					changed = true;
				}
			}
		}
	}

	const corpusFiles = files
		.filter((rel) => byFile.has(rel))
		.map((rel) => ({
			sourcePath: rel,
			symbols: sortAndDedupSymbols([...exportNames.get(rel).values()]),
		}));

	const importEdges = [];
	for (const rel of corpusFiles.map((f) => f.sourcePath)) {
		const targets = resolvedImports.get(rel);
		for (const [dst, lines] of [...targets.entries()].sort((a, b) =>
			a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
		)) {
			if (!byFile.has(dst)) continue;
			importEdges.push({
				src: rel,
				dst,
				evidence: [...lines].sort((a, b) => a - b).map((line) => ({ path: rel, line })),
			});
		}
	}
	importEdges.sort((a, b) => {
		if (a.src !== b.src) return a.src < b.src ? -1 : 1;
		return a.dst < b.dst ? -1 : 1;
	});

	return { files: corpusFiles, imports: importEdges };
}

module.exports = {
	CODE_EXTENSIONS,
	ERROR_CODES,
	extractCodeCorpus,
	typescriptVersion,
};
