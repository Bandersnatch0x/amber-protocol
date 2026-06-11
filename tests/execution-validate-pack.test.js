"use strict";

const assert = require("node:assert/strict");
const { validateWorkflowPack } = require('../scripts/lib/core/execution-validator');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');

test('validateWorkflowPack - pack with eval() detects unsafePatterns', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-pack-test-'));
  const packPath = path.join(tempDir, 'unsafe.pack.json');
  const unsafePack = {
    schemaVersion: '1.0',
    workflow: [
      { action: 'run', command: 'node -e "eval(userInput)"' }
    ]
  };
  fs.writeFileSync(packPath, JSON.stringify(unsafePack, null, 2));

  const result = validateWorkflowPack(packPath);

  assert.ok(result.unsafePatterns.includes('eval() detected'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('validateWorkflowPack - valid pack returns no errors', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-pack-test-'));
  const packPath = path.join(tempDir, 'valid.pack.json');
  const validPack = {
    schemaVersion: '1.0',
    workflow: [
      { action: 'run', command: 'echo hello' }
    ]
  };
  fs.writeFileSync(packPath, JSON.stringify(validPack, null, 2));

  const result = validateWorkflowPack(packPath);

  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.unsafePatterns, []);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
