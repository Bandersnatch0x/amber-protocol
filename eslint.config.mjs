// Amber Protocol ESLint config (flat).
// Scope: the Node.js/CommonJS toolkit under scripts/, tests/, src/migration/.
// Excluded: apps/web (own TS toolchain), templates (shipped starters, not our
// code), test-workflows/ + test-reports/ (workflow DSL scripts and their
// outputs — not lintable node code; they use agent()/parallel()/phase()
// globals that aren't node globals). sourceType defaults to "module" so the
// ESM files we do keep (this config) parse; CommonJS files parse fine too
// since require/module/__dirname resolve via the node globals below.
import js from "@eslint/js";
import globals from "globals";

export default [
	{
		ignores: [
			"node_modules/",
			"apps/web/",
			"coverage/",
			"tests/fixtures/",
			"templates/",
			"test-workflows/",
			"test-reports/",
		],
	},
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2022,
			globals: {
				...globals.node,
			},
		},
		rules: {
			// Mature CommonJS codebase; keep recommended but don't let style-adjacent
			// noise block the lint gate. catch parameters are not checked (commonly
			// unused; the block body is what matters). Tighten over time.
			"no-unused-vars": [
				"warn",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
			],
			// ESLint 10 recommended additions. Existing code has many intentional
			// reassignments and rethrow-without-cause patterns; land the major first,
			// then tighten in follow-up cleanups rather than block the upgrade.
			"no-useless-assignment": "off",
			"preserve-caught-error": "off",
		},
	},
];
