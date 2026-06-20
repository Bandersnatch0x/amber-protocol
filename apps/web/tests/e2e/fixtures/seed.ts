import fs from 'fs';
import path from 'path';

// A deterministic, valid UUIDv4-shaped id (gate-reader validates this shape).
// The trailing `e2e5` keeps it recognizable as the e2e fixture.
export const FIXTURE_SESSION_ID = '00000000-0000-4000-8000-00000000e2e5';
export const FIXTURE_GATE_ID = 'e2e-approval-gate';

const FIXED_TS = '2026-06-20T00:00:00.000Z';

/**
 * Write a minimal but reader-valid Amber session under `<repoRoot>/.amber/sessions`
 * so the web viewer's session/timeline/gate pages have real data to render during
 * e2e. Mirrors the shapes consumed by server/lib/session-reader.ts and
 * server/lib/gate-reader.ts. Idempotent: overwrites any existing fixture.
 */
export function seedFixtureSession(repoRoot: string): void {
  const sessionDir = path.join(repoRoot, '.amber', 'sessions', FIXTURE_SESSION_ID);
  const gatesDir = path.join(sessionDir, 'gates');
  fs.mkdirSync(gatesDir, { recursive: true });

  const manifest = {
    id: FIXTURE_SESSION_ID,
    goal: 'E2E fixture session',
    status: 'running',
    route: { id: 'feature-standard', name: 'Feature Standard' },
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    budget: { maxTokens: 100000, tokensUsed: 1234 },
  };
  fs.writeFileSync(
    path.join(sessionDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  const events = [
    { type: 'session_created', timestamp: FIXED_TS, data: { goal: manifest.goal } },
    { type: 'session_started', timestamp: FIXED_TS },
    { type: 'task_progress', timestamp: FIXED_TS, data: { message: 'fixture progress' } },
  ];
  fs.writeFileSync(
    path.join(sessionDir, 'timeline.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  const gate = {
    gateId: FIXTURE_GATE_ID,
    sessionId: FIXTURE_SESSION_ID,
    type: 'user-approval',
    stage: 'implement',
    description: 'E2E fixture gate awaiting approval',
    triggeredAt: FIXED_TS,
  };
  fs.writeFileSync(
    path.join(gatesDir, `${FIXTURE_GATE_ID}.gate.json`),
    JSON.stringify(gate, null, 2),
  );
}

/** Remove the fixture session (and only it) — never touches sibling sessions. */
export function removeFixtureSession(repoRoot: string): void {
  const sessionDir = path.join(repoRoot, '.amber', 'sessions', FIXTURE_SESSION_ID);
  fs.rmSync(sessionDir, { recursive: true, force: true });
}
