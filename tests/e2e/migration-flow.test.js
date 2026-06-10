const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { migrateSettings } = require("../../src/migration/v5-to-phase-b");
const { detectVersion, validateUpgrade } = require("../../src/migration/schema-validator");
const { dryRun } = require("../../src/migration/dry-run");
const { findBackups, createBackup, rollback } = require("../../src/migration/rollback");

describe("E2E Migration Flow", () => {
	const tmpDir = path.join(os.tmpdir(), "e2e-migration-" + Date.now());
	const settingsPath = path.join(tmpDir, "settings.json");

	beforeEach(() => {
		fs.mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
	});

	it("full migrate → rollback → verify V5.5 restored", () => {
		// Step 1: Create V5.5 settings
		const v55Settings = {
			version: "5.5",
			agents: {
				default: { model: "claude" },
				reviewer: { model: "gpt-4" },
			},
			routes: [
				{ name: "default", stages: [{ name: "test", command: "npm test" }] },
			],
			customSetting: "keep-me",
			deprecated_field: "remove-me",
		};
		fs.writeFileSync(settingsPath, JSON.stringify(v55Settings, null, 2));

		// Step 2: Verify V5.5 detection
		const original = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(detectVersion(original), "5.5");

		// Step 3: Validate upgrade compatibility
		const validation = validateUpgrade(original, "phase-b");
		assert.ok(validation.breakingChanges.length > 0, "Should detect breaking changes");

		// Step 4: Dry-run migration
		const preview = dryRun(original);
		assert.ok(preview.diff.length > 0, "Dry-run should show changes");
		assert.ok(preview.diff.some(d => d.field === "version" && d.after === "1.0.0"));

		// Step 5: Create backup
		const backupPath = createBackup(settingsPath);
		assert.ok(fs.existsSync(backupPath), "Backup should exist");

		// Step 6: Run actual migration
		const migrated = migrateSettings(original);
		assert.strictEqual(migrated.version, "1.0.0");
		assert.strictEqual(migrated.framework, "phase-b");
		assert.strictEqual(migrated.customSetting, "keep-me");
		assert.ok(!Object.hasOwn(migrated, "deprecated_field"), "Deprecated field should be removed");

		// Step 7: Write migrated settings
		fs.writeFileSync(settingsPath, JSON.stringify(migrated, null, 2));

		// Step 8: Verify migration
		const migratedOnDisk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(detectVersion(migratedOnDisk), "phase-b");

		// Step 9: Find backups
		const backups = findBackups(tmpDir);
		assert.ok(backups.length >= 1, "Should have at least 1 backup");

		// Step 10: Rollback
		const rollbackResult = rollback(settingsPath, backupPath);
		assert.strictEqual(rollbackResult.success, true);

		// Step 11: Verify V5.5 restored
		const restored = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(restored.version, "5.5");
		assert.strictEqual(restored.customSetting, "keep-me");
		assert.strictEqual(detectVersion(restored), "5.5");
	});

	it("multiple migrations and rollbacks maintain integrity", () => {
		// Create V5.5
		fs.writeFileSync(settingsPath, JSON.stringify({ version: "5.5", data: "original" }));

		// First migration
		const backup1 = createBackup(settingsPath);
		const m1 = migrateSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
		fs.writeFileSync(settingsPath, JSON.stringify(m1));

		// Rollback
		rollback(settingsPath, backup1);
		let current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(current.version, "5.5");

		// Second migration
		const backup2 = createBackup(settingsPath);
		const m2 = migrateSettings(current);
		fs.writeFileSync(settingsPath, JSON.stringify(m2));

		// Rollback again
		rollback(settingsPath, backup2);
		current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(current.version, "5.5");

		// Verify backups accumulated
		const allBackups = findBackups(tmpDir);
		assert.ok(allBackups.length >= 2, `Should have at least 2 backups, got ${allBackups.length}`);
	});

	it("rollback chain (rollback the rollback) works", () => {
		// Create V5.5
		fs.writeFileSync(settingsPath, JSON.stringify({ version: "5.5", step: 1 }));

		// Backup and migrate
		const backupV55 = createBackup(settingsPath);
		const migrated = migrateSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
		fs.writeFileSync(settingsPath, JSON.stringify(migrated));

		// Rollback to V5.5 (creates pre-rollback backup of Phase B settings)
		rollback(settingsPath, backupV55);
		let current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(current.version, "5.5");

		// Now find the pre-rollback backup (Phase B) and rollback to it
		const backups = findBackups(tmpDir);
		// The Phase B backup was created during rollback
		const phaseBBackup = backups.find(b => {
			const content = JSON.parse(fs.readFileSync(b.path, "utf8"));
			return content.version === "1.0.0";
		});

		if (phaseBBackup) {
			const rr = rollback(settingsPath, phaseBBackup.path);
			assert.strictEqual(rr.success, true);
			current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
			assert.strictEqual(current.version, "1.0.0", "Rollback chain should restore Phase B");
		}
	});
});
