import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { SessionStatusSchema } from '@server/types/session-events';

// The web session-status enum MUST accept every status the CLI state machine can
// write to a manifest — otherwise a CLI-written status fails Zod validation on
// read and the session silently vanishes from the UI (see the comment in
// session-events.ts). The CLI is the source of truth for the canonical statuses;
// the web adds exactly two legacy display-only values on top. This guard goes red
// the moment the CLI adds/renames a state, forcing a deliberate web update rather
// than a silent drift.
const requireCli = createRequire(import.meta.url);
const { STATES } = requireCli('../../../../scripts/lib/session-state-machine.js') as {
  STATES: Record<string, string>;
};

// Legacy display values the web UI used before the CLI vocabulary landed. Kept
// deliberately; if this list changes, it should be a conscious edit here.
const WEB_ONLY_LEGACY = ['idle', 'running'];

describe('SessionStatusSchema parity with CLI state machine', () => {
  it('accepts every canonical CLI status', () => {
    const webStatuses = new Set(SessionStatusSchema.options);
    for (const status of Object.values(STATES)) {
      expect(webStatuses.has(status), `web schema must accept CLI status '${status}'`).toBe(true);
    }
  });

  it('adds only the documented legacy values beyond the CLI set', () => {
    const cliStatuses = new Set(Object.values(STATES));
    const extras = SessionStatusSchema.options.filter((s) => !cliStatuses.has(s)).sort();
    expect(extras).toEqual([...WEB_ONLY_LEGACY].sort());
  });
});
