const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
	findBackups,
	rollback,
	createBackup,
} = require("../../src/migration/rollback");

describe("findBackups", () => {
	const tmpDir = path.join(os.tmpdir(), "migration-test-" + Date.now());

	beforeEach(() => {
		fs.mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch (e) {
			/* ignore */
		}
	});

	it("lists all backup files sorted by timestamp (newest first)", () => {
		fs.writeFileSync(path.join(tmpDir, ".backup-2026-05-01-120000.json"), "{}");
		fs.writeFileSync(path.join(tmpDir, ".backup-2026-06-01-120000.json"), "{}");
		fs.writeFileSync(path.join(tmpDir, ".backup-2026-04-01-120000.json"), "{}");
		fs.writeFileSync(path.join(tmpDir, "other-file.json"), "{}");

		const result = findBackups(tmpDir);

		assert.ok(result.length >= 3, "Should find at least 3 backups");
		// Verify sorted newest first
		const dates = result.map((b) => b.timestamp);
		for (let i = 1; i < dates.length; i++) {
			assert.ok(dates[i - 1] >= dates[i], "Should be sorted newest first");
		}
	});

	it("returns empty array when no backups exist", () => {
		const result = findBackups(tmpDir);
		assert.deepStrictEqual(result, []);
	});

	it("validates backup filenames match expected pattern", () => {
		fs.writeFileSync(path.join(tmpDir, ".backup-2026-01-01-000000.json"), "{}");
		fs.writeFileSync(path.join(tmpDir, ".backup-invalid.json"), "{}");
		fs.writeFileSync(path.join(tmpDir, "backup-2026-01-01-000000.json"), "{}"); // no leading dot

		const result = findBackups(tmpDir);
		assert.strictEqual(
			result.length,
			1,
			"Only valid backup filenames should be returned",
		);
	});
});

describe("createBackup", () => {
	const tmpDir = path.join(os.tmpdir(), "migration-backup-test-" + Date.now());

	beforeEach(() => {
		fs.mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch (e) {
			/* ignore */
		}
	});

	it("copies settings to a timestamped backup file", () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({ version: "5.5", data: "test" }),
		);

		const backupPath = createBackup(settingsPath);

		assert.ok(fs.existsSync(backupPath), "Backup file should exist");
		assert.ok(
			backupPath.includes(".backup-"),
			"Backup should include .backup- prefix",
		);
		const backupContent = JSON.parse(fs.readFileSync(backupPath, "utf8"));
		assert.strictEqual(backupContent.version, "5.5");
		assert.strictEqual(backupContent.data, "test");
	});

	it("backup includes timestamp in filename", () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		fs.writeFileSync(settingsPath, "{}");
		const backupPath = createBackup(settingsPath);

		const pattern = /\.backup-\d{4}-\d{2}-\d{2}-\d{6}(?:-\d{3})*\.json$/;
		assert.ok(
			pattern.test(backupPath),
			`Backup filename should match pattern: ${backupPath}`,
		);
	});

	it("creates unique filenames when a backup with the same stamp already exists", () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		fs.writeFileSync(settingsPath, JSON.stringify({ version: "5.5", pass: 1 }));

		const stamp = "2026-06-01-120000-000";
		fs.writeFileSync(
			path.join(tmpDir, `.backup-${stamp}.json`),
			JSON.stringify({ version: "5.5", pass: 0 }),
		);

		const fixed = new Date(2026, 5, 1, 12, 0, 0, 0);
		const OriginalDate = global.Date;
		global.Date = class extends OriginalDate {
			constructor(...args) {
				super(...(args.length ? args : [fixed]));
			}
			static now() {
				return fixed.getTime();
			}
		};

		try {
			const backupPath = createBackup(settingsPath);
			assert.ok(
				backupPath.endsWith("-001.json"),
				`Expected collision suffix, got ${backupPath}`,
			);
			assert.strictEqual(findBackups(tmpDir).length, 2);
		} finally {
			global.Date = OriginalDate;
		}
	});
});

describe("rollback", () => {
	const tmpDir = path.join(
		os.tmpdir(),
		"migration-rollback-test-" + Date.now(),
	);

	beforeEach(() => {
		fs.mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch (e) {
			/* ignore */
		}
	});

	it("restores latest backup to settings.json", () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({ version: "1.0.0", framework: "phase-b" }),
		);

		// Create a backup with V5.5 data
		const backupPath = path.join(tmpDir, ".backup-2026-06-01-000000.json");
		fs.writeFileSync(
			backupPath,
			JSON.stringify({ version: "5.5", original: true }),
		);

		const result = rollback(settingsPath, backupPath);

		assert.strictEqual(result.success, true);
		const restored = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		assert.strictEqual(restored.version, "5.5");
		assert.strictEqual(restored.original, true);
	});

	it("preserves current version as rollback backup before restoring", () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({ version: "1.0.0", framework: "phase-b" }),
		);

		const backupPath = path.join(tmpDir, ".backup-2026-06-01-000000.json");
		fs.writeFileSync(backupPath, JSON.stringify({ version: "5.5" }));

		rollback(settingsPath, backupPath);

		// Should have created a pre-rollback backup
		const allBackups = findBackups(tmpDir);
		assert.ok(
			allBackups.length >= 2,
			"Should have original backup + pre-rollback backup",
		);
	});

	it("validates backup before restoring", () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		fs.writeFileSync(settingsPath, JSON.stringify({ version: "1.0.0" }));

		const invalidBackup = path.join(tmpDir, ".backup-2026-06-01-000000.json");
		fs.writeFileSync(invalidBackup, "not valid json");

		const result = rollback(settingsPath, invalidBackup);
		assert.strictEqual(result.success, false);
		assert.ok(result.error, "Should return error message");
	});
});
