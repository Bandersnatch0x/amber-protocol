import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { resolveStatePath } from './artifact-store';
import { resolveWithin } from './safe-path';
import { SessionStatusSchema, type SessionStatus } from '../types/session-events';

export const RunnerControlActionSchema = z.enum(['start', 'pause', 'resume', 'abort']);
export type RunnerControlAction = z.infer<typeof RunnerControlActionSchema>;

export const RunnerAckStatusSchema = z.enum(['acked', 'rejected', 'timeout']);
export type RunnerAckStatus = z.infer<typeof RunnerAckStatusSchema>;

export interface RunnerControlRequest {
  sessionId: string;
  requestId: string;
  action: RunnerControlAction;
  requestedStatus: SessionStatus;
}

export interface RunnerAckOutcome extends RunnerControlRequest {
  status: RunnerAckStatus;
  source: string;
  receivedAt: string;
  message?: string;
}

interface WaitForRunnerAckOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const DEFAULT_RUNNER_ACK_TIMEOUT_MS = 1_000;
const RUNNER_ACK_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const RunnerAckFileSchema = z.object({
  requestId: z.string(),
  action: RunnerControlActionSchema,
  status: z.enum(['acked', 'rejected']),
  requestedStatus: SessionStatusSchema,
  source: z.string().optional(),
  receivedAt: z.string().optional(),
  message: z.string().optional(),
});

function getSessionDir(sessionId: string): string {
  const sessionDir = resolveStatePath('sessions', sessionId);
  if (!sessionDir) {
    throw new Error('Session not found');
  }
  return sessionDir;
}

function getRunnerAckPath(sessionId: string, requestId: string): string {
  if (!RUNNER_ACK_REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('Invalid runner ACK request id');
  }
  const sessionDir = getSessionDir(sessionId);
  const ackDir = resolveWithin(sessionDir, 'runner-acks');
  const ackPath = ackDir ? resolveWithin(ackDir, `${requestId}.json`) : null;
  if (!ackDir || !ackPath) {
    throw new Error('Invalid runner ACK request id');
  }
  return ackPath;
}

function nowIso(): string {
  return new Date().toISOString();
}

function timeoutOutcome(request: RunnerControlRequest): RunnerAckOutcome {
  return {
    ...request,
    status: 'timeout',
    source: 'runner-ack-timeout',
    receivedAt: nowIso(),
    message: 'No runner ACK observed before timeout.',
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function readRunnerAck(request: RunnerControlRequest): Promise<RunnerAckOutcome | null> {
  const ackPath = getRunnerAckPath(request.sessionId, request.requestId);

  let content: string;
  try {
    content = await fsp.readFile(ackPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return {
      ...request,
      status: 'rejected',
      source: 'runner-ack-file',
      receivedAt: nowIso(),
      message: 'Runner ACK file could not be parsed.',
    };
  }

  const parsed = RunnerAckFileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ...request,
      status: 'rejected',
      source: 'runner-ack-file',
      receivedAt: nowIso(),
      message: 'Runner ACK file could not be parsed.',
    };
  }

  if (
    parsed.data.requestId !== request.requestId ||
    parsed.data.action !== request.action ||
    parsed.data.requestedStatus !== request.requestedStatus
  ) {
    return {
      ...request,
      status: 'rejected',
      source: 'runner-ack-file',
      receivedAt: parsed.data.receivedAt ?? nowIso(),
      message: 'Runner ACK file did not match the control request.',
    };
  }

  return {
    sessionId: request.sessionId,
    requestId: parsed.data.requestId,
    action: parsed.data.action,
    requestedStatus: parsed.data.requestedStatus,
    status: parsed.data.status,
    source: parsed.data.source ?? 'runner-ack-file',
    receivedAt: parsed.data.receivedAt ?? nowIso(),
    message: parsed.data.message,
  };
}

export function createRunnerControlRequest({
  sessionId,
  action,
  requestedStatus,
  requestId,
}: {
  sessionId: string;
  action: RunnerControlAction;
  requestedStatus: SessionStatus;
  requestId?: string;
}): RunnerControlRequest {
  return {
    sessionId,
    action,
    requestedStatus,
    requestId: requestId ?? `${action}-${Date.now()}-${crypto.randomUUID()}`,
  };
}

export async function waitForRunnerAck(
  request: RunnerControlRequest,
  options: WaitForRunnerAckOptions = {},
): Promise<RunnerAckOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUNNER_ACK_TIMEOUT_MS;
  const pollMs = Math.max(options.pollMs ?? 50, 1);
  const deadline = Date.now() + timeoutMs;

  do {
    const ack = await readRunnerAck(request);
    if (ack) return ack;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(deadline - Date.now(), 1)));
  } while (Date.now() <= deadline);

  return timeoutOutcome(request);
}

export async function writeRunnerAck(
  sessionId: string,
  ack: Omit<RunnerAckOutcome, 'sessionId' | 'receivedAt' | 'source' | 'status'> & {
    status: Exclude<RunnerAckStatus, 'timeout'>;
    source?: string;
    receivedAt?: string;
  },
): Promise<void> {
  const ackPath = getRunnerAckPath(sessionId, ack.requestId);
  await fsp.mkdir(path.dirname(ackPath), { recursive: true });
  await fsp.writeFile(
    ackPath,
    JSON.stringify({
      ...ack,
      source: ack.source ?? 'runner',
      receivedAt: ack.receivedAt ?? nowIso(),
    }, null, 2),
    'utf8',
  );
}
