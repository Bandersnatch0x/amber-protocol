import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
