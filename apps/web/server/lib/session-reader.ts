import fs from 'fs';
import path from 'path';
import { resolveWithin } from './safe-path';
import { AMBER_STATE_DIR } from './state-dir';
import { resolveRepoRoot } from './repo-root';
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

function getAmberSessionsPath(): string {
  const repoRoot = resolveRepoRoot();
  const sessionsPath = path.join(repoRoot, AMBER_STATE_DIR, 'sessions');

  // Debug logging for E2E tests
  if (process.env.AMBER_REPO_ROOT) {
    console.log('[session-reader] AMBER_REPO_ROOT:', process.env.AMBER_REPO_ROOT);
    console.log('[session-reader] Resolved repo root:', repoRoot);
    console.log('[session-reader] Sessions path:', sessionsPath);
    console.log('[session-reader] Sessions dir exists:', fs.existsSync(sessionsPath));
  }

  return sessionsPath;
}

export function readSessionList(): Session[] {
  const sessionsDir = getAmberSessionsPath();

  if (!fs.existsSync(sessionsDir)) {
    if (process.env.AMBER_REPO_ROOT) {
      console.log('[session-reader] readSessionList: sessions dir does not exist');
    }
    return [];
  }

  const dirs = fs.readdirSync(sessionsDir);

  if (process.env.AMBER_REPO_ROOT) {
    console.log('[session-reader] readSessionList: found', dirs.length, 'directories');
    console.log('[session-reader] readSessionList: dirs =', dirs);
  }

  return dirs
    .map(id => {
      const manifestPath = path.join(sessionsDir, id, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return null;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return {
          id,
          goal: manifest.goal || 'Unknown goal',
          status: manifest.status || 'unknown',
          route: manifest.route || { id: 'unknown', name: 'Unknown' },
          createdAt: manifest.createdAt || new Date().toISOString(),
          updatedAt: manifest.updatedAt,
          budget: manifest.budget,
        };
      } catch (error) {
        console.error(`Failed to read session ${id}:`, error);
        return null;
      }
    })
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function readSessionById(id: string): SessionDetail | null {
  const sessionsDir = getAmberSessionsPath();
  // `id` arrives from the tRPC input (z.string(), unconstrained), so guard
  // against path traversal before touching the filesystem — a malicious id is
  // treated as a missing session.
  const sessionDir = resolveWithin(sessionsDir, id);
  if (!sessionDir) {
    return null;
  }
  const manifestPath = path.join(sessionDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Count timeline events
    const timelinePath = path.join(sessionDir, 'timeline.jsonl');
    let timelineEvents = 0;
    if (fs.existsSync(timelinePath)) {
      const content = fs.readFileSync(timelinePath, 'utf8');
      timelineEvents = content.trim().split('\n').length;
    }

    return {
      id,
      goal: manifest.goal || 'Unknown goal',
      status: manifest.status || 'unknown',
      route: manifest.route || { id: 'unknown', name: 'Unknown' },
      createdAt: manifest.createdAt || new Date().toISOString(),
      updatedAt: manifest.updatedAt,
      budget: manifest.budget,
      manifest,
      timelineEvents,
      worktree: manifest.worktree,
    };
  } catch (error) {
    console.error(`Failed to read session ${id}:`, error);
    return null;
  }
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
  const sessionsDir = getAmberSessionsPath();
  const sessionDir = resolveWithin(sessionsDir, sessionId);
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
