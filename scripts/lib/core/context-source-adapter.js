"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { sha256 } = require("./context-hash");
const { bundleSource } = require("./context-request");
const { resolvePathWithin } = require("./fs-utils");
const { redactSecrets } = require("./redaction");
const { compileSchema } = require("./schema-contract");

const ADAPTER_ID = "local-fixture";

function getFixtureValidator() {
	return compileSchema("context-source-adapter");
}

function failure(code, detail) {
	return { ok: false, code, detail };
}

function schemaDetail(validate) {
	return validate.errors
		.slice(0, 5)
		.map((error) => `${error.instancePath || "/"} ${error.message}`)
		.join("; ");
}

function sourceTargetBinding(targetRoot) {
	const canonical = fs.realpathSync(path.resolve(targetRoot));
	const normalized = canonical.replace(/\\/g, "/");
	return sha256(process.platform === "win32" ? normalized.toLowerCase() : normalized);
}

function loadFixture(targetRoot, fixturePath) {
	try {
		const fullPath = resolvePathWithin(targetRoot, fixturePath, {
			label: "Context Source Adapter fixture",
		});
		const fixture = JSON.parse(fs.readFileSync(fullPath, "utf8"));
		const validate = getFixtureValidator();
		if (!validate(fixture)) {
			return failure("AMBER_E_CONTEXT_SOURCE_INVALID", schemaDetail(validate));
		}
		const expectedTarget = sourceTargetBinding(targetRoot);
		if (fixture.target && fixture.target !== expectedTarget) {
			return failure(
				"AMBER_E_CONTEXT_SOURCE_INVALID",
				`target binding mismatch: expected ${expectedTarget}`,
			);
		}
		return { ok: true, fixture, target: expectedTarget };
	} catch (error) {
		return failure("AMBER_E_CONTEXT_SOURCE_INVALID", error.message || String(error));
	}
}

function hashMismatch(source, actual) {
	for (const field of ["rawHash", "normHash", "excerptHash"]) {
		if (source[field] && source[field] !== actual[field]) {
			return `${field} mismatch for ${source.ref}`;
		}
	}
	return null;
}

function importSource(targetRoot, source, allowTranscript) {
	if (source.kind === "transcript" && !allowTranscript) {
		return failure(
			"AMBER_E_CONTEXT_TRANSCRIPT_OPT_IN",
			"transcript sources require explicit --allow-transcript authorization",
		);
	}

	try {
		if (source.kind !== "transcript") {
			const bundled = bundleSource(targetRoot, source.ref);
			if (!bundled) {
				return failure("AMBER_E_CONTEXT_SOURCE_MISSING", `source not found: ${source.ref}`);
			}
			const mismatch = hashMismatch(source, bundled);
			if (mismatch) return failure("AMBER_E_CONTEXT_SOURCE_INVALID", mismatch);
			return {
				ok: true,
				source: { ...bundled, kind: source.kind },
			};
		}

		const fullPath = resolvePathWithin(targetRoot, source.ref, {
			label: "Context Source Adapter source",
		});
		if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
			return failure("AMBER_E_CONTEXT_SOURCE_MISSING", `source not found: ${source.ref}`);
		}
		const content = fs.readFileSync(fullPath, "utf8");
		const excerpt = redactSecrets(content);
		const hashes = {
			rawHash: sha256(content),
			excerptHash: sha256(excerpt),
		};
		const mismatch = hashMismatch(source, hashes);
		if (mismatch) return failure("AMBER_E_CONTEXT_SOURCE_INVALID", mismatch);
		return {
			ok: true,
			source: {
				ref: source.ref,
				kind: source.kind,
				rawHash: hashes.rawHash,
				mutable: false,
				excerpt,
				excerptHash: hashes.excerptHash,
			},
		};
	} catch (error) {
		return failure("AMBER_E_CONTEXT_SOURCE_INVALID", error.message || String(error));
	}
}

function importSourceBundle(targetRoot, options = {}) {
	if (options.enable !== true) {
		return failure(
			"AMBER_E_CONTEXT_ADAPTER_DISABLED",
			"Context Source Adapters are disabled unless explicitly enabled",
		);
	}
	const loaded = loadFixture(targetRoot, options.fixture);
	if (!loaded.ok) return loaded;

	const sources = [];
	for (const source of loaded.fixture.sources) {
		const imported = importSource(targetRoot, source, options.allowTranscript === true);
		if (!imported.ok) return imported;
		sources.push(imported.source);
	}
	return {
		ok: true,
		bundle: {
			schemaVersion: "1.0.0",
			adapterId: ADAPTER_ID,
			target: loaded.target,
			sources,
		},
	};
}

module.exports = { ADAPTER_ID, importSourceBundle, sourceTargetBinding };
