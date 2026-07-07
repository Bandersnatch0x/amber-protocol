import fs from 'fs/promises';
import path from 'path';
import { Gate, GateStatus, GateFilters, GateDecision } from './types/gate';
import { resolveStatePath, readJsonSafeAsync } from './artifact-store';

// Filesystem layout: .amber/sessions/{sessionId}/gates/{gateId}.gate.json
// Decision files: .amber/sessions/{sessionId}/gates/{gateId}.decision.json

function getSessionsPath(): string {
  // 'sessions' is a fixed segment, so resolveStatePath can never return null here.
  return resolveStatePath('sessions') as string;
}

function validateSessionId(sessionId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
}

function validateGateId(gateId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(gateId);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }));

  return results;
}

/** Coerce unknown JSON value to string with a fallback for nullish. */
function str(v: unknown, fallback: string): string {
  return v != null ? String(v) : fallback;
}

async function readGateFile(gatePath: string, decisionPath: string): Promise<Gate | null> {
  const { value, error } = await readJsonSafeAsync(gatePath);
  if (error) {
    console.error(`Failed to read gate file ${gatePath}:`, error);
    return null;
  }
  const gateData = value as Record<string, unknown>;

  const decision = (await readJsonSafeAsync(decisionPath)).value as GateDecision | null;

  return {
    gateId: str(gateData.gateId, ''),
    sessionId: str(gateData.sessionId, ''),
    type: str(gateData.type, 'user-approval'),
    stage: str(gateData.stage, 'unknown'),
    description: str(gateData.description, ''),
    status: decision ? (decision.decision === 'approved' ? 'approved' : 'rejected') : 'pending',
    triggeredAt: str(gateData.triggeredAt, ''),
    resolvedAt: decision?.resolvedAt,
    resolvedBy: decision ? 'human' : undefined,
    reason: decision?.reason,
  };
}

async function listSessionGates(sessionsDir: string, sessionId: string): Promise<Gate[]> {
  if (!validateSessionId(sessionId)) return [];

  const gatesDir = path.join(sessionsDir, sessionId, 'gates');

  let files: string[];
  try {
    files = await fs.readdir(gatesDir);
  } catch {
    return [];
  }

  const gateFiles = files.filter(f => f.endsWith('.gate.json'));
  const gates = await mapWithConcurrency(gateFiles, 16, async (file) => {
    const gateId = file.replace('.gate.json', '');
    const gatePath = path.join(gatesDir, file);
    const decisionPath = path.join(gatesDir, `${gateId}.decision.json`);

    return readGateFile(gatePath, decisionPath);
  });

  return gates.filter((gate): gate is Gate => gate !== null);
}

export async function listGates(filters: GateFilters = {}): Promise<Gate[]> {
  const sessionsDir = getSessionsPath();

  try {
    await fs.access(sessionsDir);
  } catch {
    return [];
  }

  const gates: Gate[] = [];
  const sessionDirs = filters.sessionId
    ? [filters.sessionId]
    : await fs.readdir(sessionsDir);

  const sessionGates = await mapWithConcurrency(sessionDirs, 32, (sessionId) =>
    listSessionGates(sessionsDir, sessionId)
  );
  gates.push(...sessionGates.flat());

  // Apply status filter
  let filtered = gates;
  if (filters.status && filters.status !== 'all') {
    filtered = gates.filter(g => g.status === filters.status);
  }

  // Sort by triggered time (newest first)
  return filtered.sort((a, b) =>
    new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
  );
}

export async function getGate(sessionId: string, gateId: string): Promise<Gate | null> {
  if (!validateSessionId(sessionId)) {
    throw new Error('Invalid session ID');
  }
  if (!validateGateId(gateId)) {
    throw new Error('Invalid gate ID');
  }

  const sessionsDir = getSessionsPath();
  const gatePath = path.resolve(sessionsDir, sessionId, 'gates', `${gateId}.gate.json`);
  const decisionPath = path.resolve(sessionsDir, sessionId, 'gates', `${gateId}.decision.json`);

  // Verify paths are within sessionsDir (prevent path traversal)
  if (!gatePath.startsWith(sessionsDir) || !decisionPath.startsWith(sessionsDir)) {
    throw new Error('Invalid path');
  }

  try {
    await fs.access(gatePath);
  } catch {
    return null;
  }

  return readGateFile(gatePath, decisionPath);
}

export async function writeGateDecision(
  sessionId: string,
  gateId: string,
  decision: 'approved' | 'rejected',
  reason?: string
): Promise<void> {
  if (!validateSessionId(sessionId)) {
    throw new Error('Invalid session ID');
  }
  if (!validateGateId(gateId)) {
    throw new Error('Invalid gate ID');
  }

  const sessionsDir = getSessionsPath();
  const gatesDir = path.resolve(sessionsDir, sessionId, 'gates');
  const decisionPath = path.resolve(gatesDir, `${gateId}.decision.json`);

  // Verify path is within sessionsDir
  if (!decisionPath.startsWith(sessionsDir)) {
    throw new Error('Invalid path');
  }

  // Check if gate exists
  const gatePath = path.resolve(gatesDir, `${gateId}.gate.json`);
  try {
    await fs.access(gatePath);
  } catch {
    throw new Error('Gate not found');
  }

  // Check if already resolved
  try {
    await fs.access(decisionPath);
    throw new Error('Gate already resolved');
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Gate already resolved') {
      throw error;
    }
    // File doesn't exist, proceed
  }

  const decisionData: GateDecision = {
    decision,
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'human',
    reason,
  };

  // Atomic write: write to temp file, then rename
  const tempPath = `${decisionPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(decisionData, null, 2));
  await fs.rename(tempPath, decisionPath);
}

export async function approveGate(sessionId: string, gateId: string, reason?: string): Promise<void> {
  return writeGateDecision(sessionId, gateId, 'approved', reason);
}

export async function rejectGate(sessionId: string, gateId: string, reason?: string): Promise<void> {
  return writeGateDecision(sessionId, gateId, 'rejected', reason);
}
