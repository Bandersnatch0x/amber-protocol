const fs = require("node:fs");
const path = require("node:path");

const SERVICE_NAME = "amberBundlePaths";

function isAmberProtocolRoot(candidate) {
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
		return manifest.name === "amber-protocol";
	} catch {
		return false;
	}
}

function resolveAmberProtocolRoot() {
	try {
		return path.dirname(require.resolve("amber-protocol/package.json"));
	} catch (error) {
		const checkoutRoot = path.resolve(__dirname, "..");
		if (isAmberProtocolRoot(checkoutRoot)) return checkoutRoot;

		throw new Error(
			`dsh-amber-protocol cannot resolve its amber-protocol dependency: ${error.message}`,
			{ cause: error },
		);
	}
}

function resolveAmberBundlePaths() {
	const root = resolveAmberProtocolRoot();
	const paths = Object.freeze({
		mcpScript: path.join(root, "scripts", "amber-mcp.js"),
		skillsDir: path.join(root, "skills"),
	});

	for (const [label, assetPath] of Object.entries(paths)) {
		if (!fs.existsSync(assetPath)) {
			throw new Error(`dsh-amber-protocol cannot find ${label} at ${assetPath}`);
		}
	}

	return paths;
}

function apply(ctx) {
	ctx.provide(SERVICE_NAME, resolveAmberBundlePaths());
}

module.exports = {
	name: "dsh-amber-protocol-runtime",
	apply,
	resolveAmberBundlePaths,
};
