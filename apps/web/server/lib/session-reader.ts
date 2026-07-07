import fs from 'fs';
import path from 'path';
import { resolveStatePath, readJsonSafe } from './artifact-store';
import type { SessionEvent } from '../types/session-events';

export interface Session {
  id: string;
  goal: string;
  status: string;
  route: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt?: string;
  budget?: {
    maxTokens: number;
    tokensUsed?: number;
  };
}

export interface SessionDetail extends Session {
  manifest: Record<string, unknown>;
  timelineEvents: number;
  worktree?: {
    path: string;
    active: boolean;
  };
}

function toSession(id: string, manifest: Record<string, unknown>): Session {
  return {
    id,
    goal: (manifest.goal as string) || 'Unknown goal',
    status: (manifest.status as string) || 'unknown',
    route: (manifest.route as Session['route']) || { id: 'unknown', name: 'Unknown' },
    createdAt: (manifest.createdAt as string) || new Date().toISOString(),
    updatedAt: manifest.updatedAt as string | undefined,
    budget: manifest.budget as Session['budget'],
  };
}

export function readSessionList(): Session[] {
  const sessionsDir = resolveStatePath('sessions');

  if (!sessionsDir || !fs.existsSync(sessionsDir)) {
    return [];
  }

  const dirs = fs.readdirSync(sessionsDir);

  const sessions = dirs
    .map(id => {
      const manifestPath = path.join(sessionsDir, id, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return null;
      }

      const { value: manifest, error } = readJsonSafe(manifestPath);
      if (error) {
        console.error(`Failed to read session ${id}:`, error);
        return null;
      }
      return toSession(id, manifest as Record<string, unknown>);
    })
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return sessions;
}

export function readSessionById(id: string): SessionDetail | null {
  // `id` arrives from the tRPC input (z.string(), unconstrained), so the
  // traversal guard inside resolveStatePath treats a malicious id exactly
  // like a missing session.
  const sessionDir = resolveStatePath('sessions', id);
  if (!sessionDir) {
    return null;
  }
  const manifestPath = path.join(sessionDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const { value, error } = readJsonSafe(manifestPath);
  if (error) {
    console.error(`Failed to read session ${id}:`, error);
    return null;
  }
  const manifest = value as Record<string, unknown>;

  // Count timeline events
  const timelinePath = path.join(sessionDir, 'timeline.jsonl');
  let timelineEvents = 0;
  if (fs.existsSync(timelinePath)) {
    const content = fs.readFileSync(timelinePath, 'utf8');
    timelineEvents = content.trim().split('\n').length;
  }

  return {
    ...toSession(id, manifest),
    manifest,
    timelineEvents,
    worktree: manifest.worktree as SessionDetail['worktree'],
  };
}

function normalizeEvent(raw: unknown): SessionEvent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const event = raw as Record<string, unknown>;
  const data = typeof event.data === 'object' && event.data !== null
    ? event.data as Record<string, unknown>
    : {};

  return {
    ...event,
    ...data,
    data: undefined,
  } as SessionEvent;
}

export function readTimelineEvents(sessionId: string, limit?: number): SessionEvent[] {
  const sessionDir = resolveStatePath('sessions', sessionId);
  if (!sessionDir) {
    return [];
  }
  const timelinePath = path.join(sessionDir, 'timeline.jsonl');

  if (!fs.existsSync(timelinePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(timelinePath, 'utf8');
    const lines = content.trim().split('\n');
    const events = lines
      .map(line => {
        try {
          return normalizeEvent(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((e): e is SessionEvent => e !== null);

    if (limit) {
      return events.slice(0, limit);
    }

    return events;
  } catch (error) {
    console.error(`Failed to read timeline for session ${sessionId}:`, error);
    return [];
  }
}
