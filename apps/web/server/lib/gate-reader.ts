import fs from 'fs/promises';
import path from 'path';
import { Gate, GateStatus, GateFilters, GateDecision } from './types/gate';

// Filesystem layout: .amber/sessions/{sessionId}/gates/{gateId}.gate.json
// Decision files: .amber/sessions/{sessionId}/gates/{gateId}.decision.json

function getSessionsPath(): string {
  return path.join(process.cwd(), '..', '..', '.amber', 'sessions');
}

function validateSessionId(sessionId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
}

function validateGateId(gateId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(gateId);
}

async function readGateFile(gatePath: string, decisionPath: string): Promise<Gate | null> {
  try {
    const gateData = JSON.parse(await fs.readFile(gatePath, 'utf8'));

    let decision: GateDecision | null = null;
    try {
      const decisionData = await fs.readFile(decisionPath, 'utf8');
      decision = JSON.parse(decisionData);
    } catch {
      // No decision file yet
    }

    return {
      gateId: gateData.gateId,
      sessionId: gateData.sessionId,
      type: gateData.type || 'user-approval',
      stage: gateData.stage || 'unknown',
      description: gateData.description || '',
      status: decision ? (decision.decision === 'approved' ? 'approved' : 'rejected') : 'pending',
      triggeredAt: gateData.triggeredAt,
      resolvedAt: decision?.resolvedAt,
      resolvedBy: decision ? 'human' : undefined,
      reason: decision?.reason,
    };
  } catch (error) {
    console.error(`Failed to read gate file ${gatePath}:`, error);
    return null;
  }
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

  for (const sessionId of sessionDirs) {
    if (!validateSessionId(sessionId)) continue;

    const gatesDir = path.join(sessionsDir, sessionId, 'gates');

    try {
      await fs.access(gatesDir);
    } catch {
      continue;
    }

    const files = await fs.readdir(gatesDir);
    const gateFiles = files.filter(f => f.endsWith('.gate.json'));

    for (const file of gateFiles) {
      const gateId = file.replace('.gate.json', '');
      const gatePath = path.join(gatesDir, file);
      const decisionPath = path.join(gatesDir, `${gateId}.decision.json`);

      const gate = await readGateFile(gatePath, decisionPath);
      if (gate) {
        gates.push(gate);
      }
    }
  }

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
  } catch (error: any) {
    if (error.message === 'Gate already resolved') {
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
