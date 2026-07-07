/**
 * Session artifact writer — atomic persistence for session manifest state.
 *
 * Intentionally separate from session-reader (names should reveal what they
 * do, not mix read and write concerns in one module).
 */

import fsp from 'fs/promises';
import path from 'path';
import { resolveStatePath, readJsonSafe } from './artifact-store';
import type { SessionStatus } from '../types/session-events';
import type { SessionDetail } from './session-reader';

export async function persistSessionStatus(id: string, status: SessionStatus): Promise<SessionDetail> {
  const sessionDir = resolveStatePath('sessions', id);
  if (!sessionDir) {
    throw new Error('Session not found');
  }

  const manifestPath = path.join(sessionDir, 'manifest.json');
  const { value, error } = readJsonSafe(manifestPath);
  if (error || typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(error?.message ?? 'Invalid session manifest');
  }

  const updatedManifest = {
    ...(value as Record<string, unknown>),
    status,
    updatedAt: new Date().toISOString(),
  };

  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, 'utf8');
  await fsp.rename(tempPath, manifestPath);

  // Re-read via session-reader to get a consistent SessionDetail back.
  const { readSessionById } = require('./session-reader');
  const confirmed = readSessionById(id);

  if (!confirmed) {
    throw new Error('Session status could not be confirmed after persistence');
  }

  return confirmed;
}
