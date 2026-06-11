"use strict";

const assert = require("node:assert/strict");
const { validateLoopContract } = require('../scripts/lib/amber-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');

test('validateLoopContract - valid contract returns valid=true', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-loop-test-'));
  const contractPath = path.join(tempDir, 'valid.json');
  const validContract = {
    trigger: 'manual',
    cadence: 'daily',
    stateSpine: ['state1', 'state2'],
    hardStops: {
      maxIterations: 10,
      timeout: 3600,
      noProgress: 5,
      budget: 100
    }
  };
  fs.writeFileSync(contractPath, JSON.stringify(validContract, null, 2));

  const result = validateLoopContract(contractPath);

  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.explanation.includes('Loop contract is valid'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('validateLoopContract - missing hardStops returns error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-loop-test-'));
  const contractPath = path.join(tempDir, 'no-hardstops.json');
  const contract = {
    trigger: 'manual',
    cadence: 'daily',
    stateSpine: ['state1']
  };
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

  const result = validateLoopContract(contractPath);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.includes('Missing required field: hardStops'));
  assert.ok(result.explanation.includes('validation failed'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('validateLoopContract - missing hardStops.maxIterations returns error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-loop-test-'));
  const contractPath = path.join(tempDir, 'no-maxiterations.json');
  const contract = {
    trigger: 'manual',
    cadence: 'daily',
    stateSpine: ['state1'],
    hardStops: {
      timeout: 3600
    }
  };
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

  const result = validateLoopContract(contractPath);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.includes('hardStops.maxIterations is required'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('validateLoopContract - missing hardStops.timeout returns error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-loop-test-'));
  const contractPath = path.join(tempDir, 'no-timeout.json');
  const contract = {
    trigger: 'manual',
    cadence: 'daily',
    stateSpine: ['state1'],
    hardStops: {
      maxIterations: 10
    }
  };
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

  const result = validateLoopContract(contractPath);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.includes('hardStops.timeout is required'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('validateLoopContract - invalid maxIterations returns error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-loop-test-'));
  const contractPath = path.join(tempDir, 'invalid-maxiterations.json');
  const contract = {
    trigger: 'manual',
    cadence: 'daily',
    stateSpine: ['state1'],
    hardStops: {
      maxIterations: -1,
      timeout: 3600
    }
  };
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

  const result = validateLoopContract(contractPath);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.includes('hardStops.maxIterations must be > 0'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('validateLoopContract - nonexistent file returns error', () => {
  const result = validateLoopContract('/nonexistent/path.json');

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors[0].includes('Contract file not found'));
});

test('validateLoopContract - invalid JSON returns error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-loop-test-'));
  const contractPath = path.join(tempDir, 'invalid.json');
  fs.writeFileSync(contractPath, '{invalid json');

  const result = validateLoopContract(contractPath);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors[0].includes('Invalid JSON'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

