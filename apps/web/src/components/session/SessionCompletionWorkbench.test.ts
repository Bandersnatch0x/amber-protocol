import { describe, expect, it } from 'vitest';
import {
  buildCompletionSummary,
  formatVerificationOutcome,
  normalizeLifecycleChecklist,
} from './SessionCompletionWorkbench';

describe('SessionCompletionWorkbench view model', () => {
  it('normalizes strict completion gaps and detects missing approval', () => {
    const summary = buildCompletionSummary({
      status: 'fail',
      strict: true,
      reasons: ['Gate approval required'],
      missing: [
        { label: 'Decision file', reason: 'pending gate' },
        'Verification evidence',
      ],
      text: 'Completion blocked.',
    });

    expect(summary).toMatchObject({
      status: 'missing',
      strict: true,
      tone: 'warning',
      approvalMissing: true,
      text: 'Completion blocked.',
    });
    expect(summary.reasons).toEqual(['Gate approval required']);
    expect(summary.missing).toEqual(['Decision file - pending gate', 'Verification evidence']);
  });

  it('keeps verification denial and failure details visible', () => {
    expect(formatVerificationOutcome({
      status: 'denied',
      reason: 'Command is not allowed by verify policy',
    })).toBe('Status: denied\nReason: Command is not allowed by verify policy');

    expect(formatVerificationOutcome({
      status: 'failed',
      exitCode: 3,
      stdoutTail: 'stdout line',
      stderrTail: 'stderr line',
    })).toBe('Status: failed\nExit code: 3\nStdout: stdout line\nStderr: stderr line');
  });

  it('builds a stable lifecycle checklist from mixed backend row shapes', () => {
    const checklist = normalizeLifecycleChecklist([
      { id: 'plan', label: 'Plan', complete: true },
      { stage: 'gate', status: 'blocked', reason: 'pending approval' },
      'Verify',
    ]);

    expect(checklist).toEqual([
      {
        key: 'plan',
        label: 'Plan',
        status: 'complete',
        detail: '',
      },
      {
        key: 'gate',
        label: 'gate',
        status: 'blocked',
        detail: 'pending approval',
      },
      {
        key: 'verify',
        label: 'Verify',
        status: 'pending',
        detail: '',
      },
    ]);
  });
});
