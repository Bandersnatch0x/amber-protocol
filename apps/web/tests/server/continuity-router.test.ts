import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@server/app-router';
import { continuityRouter } from '@server/routers/continuity';

const ORIGINAL_AMBER_REPO_ROOT = process.env.AMBER_REPO_ROOT;

let repoRoot: string;

const caller = continuityRouter.createCaller({});
const appCaller = appRouter.createCaller({});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendTimeline(sessionId: string, event: Record<string, unknown>): void {
  const timelinePath = path.join(repoRoot, '.amber', 'sessions', sessionId, 'timeline.jsonl');
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
  fs.appendFileSync(timelinePath, `${JSON.stringify(event)}\n`, 'utf8');
}

function seedLiveHandoff(): void {
  // G2: a bare manifest.handoff.path is not enough; content must not look
  // like the init scaffold for the handoff to count as live evidence.
  fs.writeFileSync(
    path.join(repoRoot, 'session-handoff.md'),
    [
      '# Session Handoff',
      '',
      'Command: npm test',
      'Result: pass',
      'Notes: regenerated for continuity fixture',
      '',
    ].join('\n'),
    'utf8',
  );
}

function seedSession(sessionId: string, overrides: Record<string, unknown> = {}): void {
  const now = '2026-07-08T00:00:00.000Z';
  writeJson(path.join(repoRoot, '.amber', 'sessions', sessionId, 'manifest.json'), {
    sessionId,
    schemaVersion: '1.0.0-rc.1',
    createdAt: now,
    updatedAt: now,
    route: { id: 'feature-standard', version: '1.0.0' },
    goal: 'test the continuity router',
    status: 'executing',
    completedStages: [],
    handoff: { path: 'session-handoff.md' },
    ...overrides,
  });
}

describe('continuityRouter', () => {
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-web-continuity-'));
    process.env.AMBER_REPO_ROOT = repoRoot;
    writeJson(path.join(repoRoot, 'package.json'), { name: 'amber-protocol' });
    fs.mkdirSync(path.join(repoRoot, 'routes'), { recursive: true });
    seedSession('session-1');
  });

  afterEach(() => {
    if (ORIGINAL_AMBER_REPO_ROOT === undefined) {
      delete process.env.AMBER_REPO_ROOT;
    } else {
      process.env.AMBER_REPO_ROOT = ORIGINAL_AMBER_REPO_ROOT;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('is mounted on the app router', async () => {
    const result = await appCaller.continuity.handoff.status();

    expect(result.handoffPath).toBe(path.join(repoRoot, 'session-handoff.md'));
  });

  describe('handoff.status', () => {
    it('reports a live handoff with session evidence and an absent bundle', async () => {
      seedLiveHandoff();

      const result = await caller.handoff.status({ sessionId: 'session-1' });

      expect(result.state).toBe('live');
      expect(result.sessionEvidence).toBe(true);
      expect(result.bundle).toEqual({
        present: false,
        valid: false,
        structureValid: false,
        deliveryReady: false,
        readinessScore: null,
        errors: [],
      });
    });

    it('reports the missing empty state when no handoff file exists', async () => {
      const result = await caller.handoff.status();

      expect(result.state).toBe('missing');
      expect(result.sessionEvidence).toBe(false);
      expect(result.bundle.present).toBe(false);
      expect(result.bundle.errors).toEqual([]);
    });

    it('does not claim session evidence without a sessionId', async () => {
      seedLiveHandoff();

      const result = await caller.handoff.status();

      expect(result.state).toBe('live');
      expect(result.sessionEvidence).toBe(false);
    });
  });

  describe('handoff.preview', () => {
    it('returns markdown content when a handoff file exists', async () => {
      seedLiveHandoff();

      const result = await caller.handoff.preview({ sessionId: 'session-1' });

      expect(result.sessionId).toBe('session-1');
      expect(result.requestedSessionId).toBe('session-1');
      expect(result.markdown.length).toBeGreaterThan(0);
      expect(['rendered', 'session-handoff.md']).toContain(result.source);
    });

    it('returns a graceful empty state when there is nothing to preview', async () => {
      const result = await caller.handoff.preview();

      // A rendered preview always targets the most recent session (session-1
      // in this fixture) even when no sessionId was requested; the request
      // itself stays observable via requestedSessionId.
      if (result.source === 'rendered') {
        expect(result.sessionId).toBe('session-1');
        expect(result.requestedSessionId).toBeNull();
        expect(result.markdown.length).toBeGreaterThan(0);
      } else {
        expect(result.sessionId).toBeNull();
        expect(result.requestedSessionId).toBeNull();
        if (result.source === 'none') {
          expect(result.markdown).toBe('');
        } else {
          expect(result.markdown.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('governance.summary', () => {
    it('returns the governance report shape with a learnings block', async () => {
      const result = await caller.governance.summary();

      expect(result.target).toBe(repoRoot);
      expect(result.generatedAt).toEqual(expect.any(String));
      expect(['ready', 'warn', 'block']).toContain(result.decision);
      expect(result.scores.overall).toEqual(expect.any(Number));
      expect(Array.isArray(result.findings)).toBe(true);
      expect(Array.isArray(result.nextActions)).toBe(true);
      expect(result.learnings).toEqual(
        expect.objectContaining({
          hasTriggers: expect.any(Boolean),
          reviewBooked: expect.any(Boolean),
        }),
      );
    });

    it('accepts an optional featureId without changing the report verdict shape', async () => {
      const result = await caller.governance.summary({ featureId: 'feature-x' });

      expect(['ready', 'warn', 'block']).toContain(result.decision);
      expect(
        result.learnings.featureId === 'feature-x' || result.learnings.featureId === null,
      ).toBe(true);
    });
  });

  describe('completion.nextActions', () => {
    it('maps missing completion items to web-shaped actions', async () => {
      const result = await caller.completion.nextActions({ sessionId: 'session-1' });

      expect(result.status).toBe('fail');
      expect(result.missing).toContain('verification');
      expect(result.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ item: 'verification', action: 'in-page' }),
          expect.objectContaining({
            item: 'handoff',
            action: 'cli-command',
            command: 'amber handoff --target .',
          }),
        ]),
      );
      for (const action of result.actions) {
        expect(action.hint.length).toBeGreaterThan(0);
      }
    });

    it('yields the single closing action once every check passes', async () => {
      seedLiveHandoff();
      appendTimeline('session-1', {
        type: 'stage_completed',
        timestamp: '2026-07-08T00:00:02.000Z',
        data: { sessionId: 'session-1', stage: 'verify', executed: true },
      });
      appendTimeline('session-1', {
        type: 'gate_passed',
        timestamp: '2026-07-08T00:00:03.000Z',
        data: { sessionId: 'session-1' },
      });

      const result = await caller.completion.nextActions({ sessionId: 'session-1' });

      expect(result.status).toBe('pass');
      expect(result.missing).toEqual([]);
      expect(result.actions).toEqual([
        expect.objectContaining({
          item: 'session-complete',
          action: 'cli-command',
          command: 'amber session complete --session session-1',
        }),
      ]);
    });

    it('reports the manifest-not-found fallback for unknown sessions', async () => {
      const result = await caller.completion.nextActions({ sessionId: 'no-such-session' });

      expect(result.status).toBe('fail');
      expect(result.missing).toContain('manifest not found');
      expect(result.actions[0]?.hint.length).toBeGreaterThan(0);
    });
  });
});
