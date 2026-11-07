import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
  createRunnerControlRequest,
  waitForRunnerAck,
  writeRunnerAck,
} from '@server/lib/runner-ack';

const originalRepoRoot = process.env.AMBER_REPO_ROOT;
let testRoot: string;

function sessionDir(sessionId: string): string {
  return path.join(testRoot, '.amber', 'sessions', sessionId);
}

describe('runner-ack', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-runner-ack-'));
    process.env.AMBER_REPO_ROOT = testRoot;
  });

  afterEach(() => {
    if (originalRepoRoot === undefined) {
      delete process.env.AMBER_REPO_ROOT;
    } else {
      process.env.AMBER_REPO_ROOT = originalRepoRoot;
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('reads a durable runner ACK file for a control request', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000011';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'resume',
      requestedStatus: 'executing',
      requestId: 'resume-request-1',
    });
    await writeRunnerAck(sessionId, {
      requestId: 'resume-request-1',
      action: 'resume',
      status: 'acked',
      requestedStatus: 'executing',
      source: 'fixture-runner',
      message: 'accepted',
    });

    const ack = await waitForRunnerAck(request, { timeoutMs: 0 });

    expect(ack).toMatchObject({
      requestId: 'resume-request-1',
      action: 'resume',
      status: 'acked',
      requestedStatus: 'executing',
      source: 'fixture-runner',
      message: 'accepted',
    });
    expect(ack.receivedAt).toBeDefined();
  });

  it('returns a timeout outcome when no runner ACK file appears', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000012';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'pause',
      requestedStatus: 'paused',
      requestId: 'pause-request-1',
    });

    const ack = await waitForRunnerAck(request, { timeoutMs: 0 });

    expect(ack).toMatchObject({
      requestId: 'pause-request-1',
      action: 'pause',
      status: 'timeout',
      requestedStatus: 'paused',
      source: 'runner-ack-timeout',
    });
    expect(ack.message).toContain('No runner ACK observed');
  });

  it('waits for a delayed runner ACK using the default wait window', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000015';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'resume',
      requestedStatus: 'executing',
      requestId: 'resume-request-delayed',
    });

    setTimeout(() => {
      void writeRunnerAck(sessionId, {
        requestId: 'resume-request-delayed',
        action: 'resume',
        status: 'acked',
        requestedStatus: 'executing',
        source: 'delayed-runner',
      });
    }, 20);

    const ack = await waitForRunnerAck(request, { pollMs: 5 });

    expect(ack).toMatchObject({
      requestId: 'resume-request-delayed',
      action: 'resume',
      status: 'acked',
      requestedStatus: 'executing',
      source: 'delayed-runner',
    });
  });

  it('rejects an ACK file that does not match the requested action and status', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000014';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'resume',
      requestedStatus: 'executing',
      requestId: 'resume-request-1',
    });
    await writeRunnerAck(sessionId, {
      requestId: 'resume-request-1',
      action: 'abort',
      status: 'acked',
      requestedStatus: 'aborted',
      source: 'fixture-runner',
    });

    const ack = await waitForRunnerAck(request, { timeoutMs: 0 });

    expect(ack).toMatchObject({
      requestId: 'resume-request-1',
      action: 'resume',
      status: 'rejected',
      requestedStatus: 'executing',
      source: 'runner-ack-file',
      message: 'Runner ACK file did not match the control request.',
    });
  });

  it('rejects malformed ACK JSON instead of throwing', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000016';
    fs.mkdirSync(path.join(sessionDir(sessionId), 'runner-acks'), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'abort',
      requestedStatus: 'aborted',
      requestId: 'abort-request-malformed',
    });
    fs.writeFileSync(
      path.join(sessionDir(sessionId), 'runner-acks', 'abort-request-malformed.json'),
      '{"requestId":',
      'utf8',
    );

    const ack = await waitForRunnerAck(request, { timeoutMs: 0 });

    expect(ack).toMatchObject({
      requestId: 'abort-request-malformed',
      action: 'abort',
      status: 'rejected',
      requestedStatus: 'aborted',
      source: 'runner-ack-file',
      message: 'Runner ACK file could not be parsed.',
    });
  });

  it('publishes ACK files atomically so a reader never observes a partial write', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000017';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'resume',
      requestedStatus: 'executing',
      requestId: 'resume-request-atomic',
    });

    // Deterministically hold the FIRST writeFile open after half of the bytes
    // have landed — exactly the truncate→write window a direct write exposes.
    // With an atomic publish the destination path does not exist until the
    // rename, so the waiter keeps polling and observes the complete ACK. With
    // a direct write the waiter reads the half file, and readRunnerAck treats
    // an unparseable file as a TERMINAL rejection, so the assertion below goes
    // red. No timing luck is involved: the partial state is held until the
    // test releases it.
    const realWriteFile = fsp.writeFile.bind(fsp);
    let markHalfLanded: () => void = () => {};
    const halfLanded = new Promise<void>((resolve) => {
      markHalfLanded = resolve;
    });
    let releaseHalfWrite: () => void = () => {};
    const halfWriteHeld = new Promise<void>((resolve) => {
      releaseHalfWrite = resolve;
    });
    let writeCalls = 0;
    const spy = vi.spyOn(fsp, 'writeFile');
    spy.mockImplementation((async (
      file: Parameters<typeof fsp.writeFile>[0],
      data: Parameters<typeof fsp.writeFile>[1],
    ) => {
      writeCalls += 1;
      if (writeCalls > 1) return realWriteFile(file, data);
      const text = String(data);
      await realWriteFile(file, text.slice(0, Math.floor(text.length / 2)));
      markHalfLanded();
      await halfWriteHeld;
      await realWriteFile(file, text);
    }) as unknown as typeof fsp.writeFile);

    try {
      const write = writeRunnerAck(sessionId, {
        requestId: 'resume-request-atomic',
        action: 'resume',
        status: 'acked',
        requestedStatus: 'executing',
        source: 'atomic-runner',
      });
      await Promise.race([
        halfLanded,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('writeFile spy did not intercept')), 2_000),
        ),
      ]);
      const pendingAck = waitForRunnerAck(request, { pollMs: 5, timeoutMs: 5_000 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseHalfWrite();
      await write;
      const ack = await pendingAck;
      expect(ack).toMatchObject({
        requestId: 'resume-request-atomic',
        action: 'resume',
        status: 'acked',
        requestedStatus: 'executing',
        source: 'atomic-runner',
      });
    } finally {
      releaseHalfWrite();
      spy.mockRestore();
    }
  });

  it('publishes atomically from the real CLI writer (cross-boundary handshake)', async () => {
    // The production ACK writer is scripts/lib/runner-ack.js, called by
    // `amber session ...`; the Web reader polls the same path. The child holds
    // its write open after half the bytes and BLOCKS on stdin until this
    // process has performed one real reader observation, then releases it. No
    // fixed sleep window: the partial state is held for exactly as long as the
    // observation takes.
    const sessionId = '00000000-0000-0000-0000-000000000018';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    const request = createRunnerControlRequest({
      sessionId,
      action: 'resume',
      requestedStatus: 'executing',
      requestId: 'resume-request-cli',
    });
    const cliWriterPath = fileURLToPath(
      new URL('../../../../scripts/lib/runner-ack.js', import.meta.url),
    );
    const helperPath = path.join(testRoot, 'gated-cli-writer.cjs');
    fs.writeFileSync(
      helperPath,
      [
        '"use strict";',
        "const fs = require('node:fs');",
        'const [root, sessionId, requestId, cliPath] = process.argv.slice(2);',
        'const realWriteFileSync = fs.writeFileSync.bind(fs);',
        'let first = true;',
        'fs.writeFileSync = (file, data, ...rest) => {',
        "  if (first && String(file).includes('runner-acks')) {",
        '    first = false;',
        '    const text = String(data);',
        '    realWriteFileSync(file, text.slice(0, Math.floor(text.length / 2)));',
        "    process.stdout.write('HALF\\n');",
        '    const release = Buffer.alloc(1);',
        '    fs.readSync(0, release, 0, 1, null);',
        '    realWriteFileSync(file, text);',
        '    return;',
        '  }',
        '  return realWriteFileSync(file, data, ...rest);',
        '};',
        'const { writeRunnerAck } = require(cliPath);',
        'writeRunnerAck(root, sessionId, {',
        '  requestId,',
        "  action: 'resume',",
        "  status: 'acked',",
        "  requestedStatus: 'executing',",
        "  source: 'cli-runner',",
        '});',
      ].join('\n'),
      'utf8',
    );

    const child = spawn(
      process.execPath,
      [helperPath, testRoot, sessionId, request.requestId, cliWriterPath],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
      ]);

    try {
      // 1. Wait (bounded) for the child to report its half-write.
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          let buffer = '';
          child.stdout?.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes('HALF')) resolve();
          });
          child.once('exit', (code) =>
            reject(new Error(`CLI helper exited with ${code} before its half-write`)),
          );
        }),
        10_000,
        'CLI helper never reported its partial write',
      );

      // 2. One real reader observation while the writer is provably open. An
      // atomic publish leaves the destination absent (timeout outcome); a
      // direct write exposes half-written JSON and comes back as a terminal
      // `rejected` — the assertion below is the regression.
      const observed = await waitForRunnerAck(request, { timeoutMs: 0 });
      expect(observed.status).toBe('timeout');

      // 3. Explicit release, then the reader must see the complete ACK.
      child.stdin?.write('R');
      const ack = await waitForRunnerAck(request, { pollMs: 5, timeoutMs: 5_000 });
      expect(await withTimeout(exited, 10_000, 'CLI helper did not exit')).toBe(0);
      expect(ack).toMatchObject({
        requestId: 'resume-request-cli',
        action: 'resume',
        status: 'acked',
        requestedStatus: 'executing',
        source: 'cli-runner',
      });
    } finally {
      child.stdin?.destroy();
      child.kill();
    }
  });

  it('does not let request ids escape the runner ACK directory', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000013';
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });

    await expect(
      writeRunnerAck(sessionId, {
        requestId: '../evil',
        action: 'start',
        status: 'acked',
        requestedStatus: 'executing',
      }),
    ).rejects.toThrow('Invalid runner ACK request id');
  });
});
