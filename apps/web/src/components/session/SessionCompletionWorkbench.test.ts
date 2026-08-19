import { describe, expect, it } from 'vitest';
import {
  buildCompletionSummary,
  formatVerificationOutcome,
  includesApprovalGap,
  isInPageApprovalAction,
  isInPageVerificationAction,
  isTerminalVerificationJobStatus,
  localizeBackendValue,
  localizeCompletionText,
  normalizeCompletionNextActions,
  normalizeLifecycleChecklist,
  resolveVerificationProgress,
  resolveVerificationSubmission,
  type CompletionSummary,
} from './SessionCompletionWorkbench';

const echoT = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return key.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
};

describe('SessionCompletionWorkbench view model', () => {
  it('normalizes strict completion gaps and detects missing approval', () => {
    const summary = buildCompletionSummary({
      status: 'fail',
      strict: true,
      reasons: ['Gate approval required'],
      missing: [{ label: 'Decision file', reason: 'pending gate' }, 'Verification evidence'],
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

  // Regression: affirmative backend reasons ("approval present") must not be
  // reported as a missing approval on completed sessions.
  it('does not flag approval as missing when reasons are affirmative (pass state)', () => {
    const summary = buildCompletionSummary({
      status: 'pass',
      strict: true,
      reasons: [
        'goal present',
        'timeline present',
        'verification present',
        'approval present',
        'work present',
        'handoff present',
        'no open blockers',
      ],
      missing: [],
      text: 'Completion check status: pass',
    });

    expect(summary.status).toBe('complete');
    expect(summary.tone).toBe('success');
    expect(summary.approvalMissing).toBe(false);
    expect(includesApprovalGap([], ['approval present', 'gate passed'])).toBe(false);
  });

  it('flags approval gaps only on missing semantics (fail state)', () => {
    expect(includesApprovalGap(['approval'], ['goal present'])).toBe(true);
    expect(includesApprovalGap([], ['Gate approval required'])).toBe(true);
    expect(includesApprovalGap([], ['approval missing'])).toBe(true);
    expect(includesApprovalGap([], ['no open blockers', 'work present'])).toBe(false);

    const failing = buildCompletionSummary({
      status: 'fail',
      reasons: ['goal present'],
      missing: ['approval', 'verification'],
    });
    expect(failing.approvalMissing).toBe(true);
  });

  it('keeps verification denial and failure details visible', () => {
    expect(
      formatVerificationOutcome({
        status: 'denied',
        reason: 'Command is not allowed by verify policy',
      }),
    ).toBe('Status: denied\nReason: Command is not allowed by verify policy');

    expect(
      formatVerificationOutcome({
        status: 'failed',
        exitCode: 3,
        stdoutTail: 'stdout line',
        stderrTail: 'stderr line',
      }),
    ).toBe('Status: failed\nExit code: 3\nStdout: stdout line\nStderr: stderr line');
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

  // Regression: evaluateLifecycleNext emits { id, label, done } — the
  // normalizer must read `done` instead of rendering every row as pending.
  it('maps the backend { id, label, done } lifecycle rows to checklist states', () => {
    const checklist = normalizeLifecycleChecklist([
      { id: 'verify', label: 'Record session verification', done: true },
      { id: 'approve', label: 'Approve the session', done: false },
      { id: 'handoff', label: 'Regenerate session handoff', done: false },
    ]);

    expect(checklist.map((item) => item.status)).toEqual(['complete', 'pending', 'pending']);
    expect(checklist[0]?.key).toBe('verify');
  });
});

describe('backend copy localization', () => {
  it('maps known backend enums onto i18n keys and degrades unknown strings', () => {
    expect(localizeBackendValue('approval present', echoT)).toBe(
      'sessions.completion.backend.reason.approvalPresent',
    );
    expect(localizeBackendValue('Approval', echoT)).toBe(
      'sessions.completion.backend.missing.approval',
    );
    expect(localizeBackendValue('Record session verification', echoT)).toBe(
      'sessions.completion.backend.step.verify',
    );
    expect(localizeBackendValue('Some custom evidence', echoT)).toBe('Some custom evidence');
  });

  it('re-renders the Completion check report from structured data and falls back to raw text', () => {
    const failing = buildCompletionSummary({
      status: 'fail',
      reasons: ['goal present'],
      missing: ['approval'],
      text: 'Completion check status: fail\nReasons: goal present\nMissing: approval',
    });
    expect(localizeCompletionText(failing, echoT)).toBe(
      // echoT returns keys verbatim (the {status} placeholder lives in the
      // dictionary value, exercised by the render tests with the real i18n).
      'sessions.completion.backend.text.status\n' +
        'sessions.completion.backend.text.reasons: sessions.completion.backend.reason.goalPresent\n' +
        'sessions.completion.backend.text.missing: sessions.completion.backend.missing.approval',
    );

    // No structured rows → degrade to the original backend text.
    const bare: CompletionSummary = {
      status: 'unknown',
      strict: false,
      tone: 'neutral',
      reasons: [],
      missing: [],
      text: 'Unrecognized backend report',
      approvalMissing: false,
    };
    expect(localizeCompletionText(bare, echoT)).toBe('Unrecognized backend report');
  });
});

describe('completion next-actions mapping', () => {
  it('normalizes missing-item guidance into actionable rows', () => {
    const view = normalizeCompletionNextActions({
      status: 'fail',
      missing: ['verification', 'approval', 'handoff'],
      actions: [
        {
          item: 'verification',
          action: 'in-page',
          hint: 'Run verification from the console evidence runner.',
        },
        { item: 'approval', action: 'in-page', hint: 'Approve via the gates view (/gates).' },
        {
          item: 'handoff',
          action: 'cli-command',
          command: 'amber handoff --target .',
          hint: 'Regenerate the live session-handoff.md.',
        },
      ],
    });

    expect(view.status).toBe('fail');
    expect(view.actions.map((action) => action.item)).toEqual([
      'verification',
      'approval',
      'handoff',
    ]);
    expect(view.actions[0] && isInPageVerificationAction(view.actions[0])).toBe(true);
    expect(view.actions[1] && isInPageApprovalAction(view.actions[1])).toBe(true);
    expect(view.actions[2]?.action).toBe('cli-command');
    expect(view.actions[2]?.command).toBe('amber handoff --target .');
  });

  it('exposes the closing session-complete command when everything passes', () => {
    const view = normalizeCompletionNextActions({
      status: 'pass',
      actions: [
        {
          item: 'session-complete',
          action: 'cli-command',
          command: 'amber session complete --session s1',
        },
      ],
    });

    expect(view.status).toBe('pass');
    expect(view.actions[0]?.command).toBe('amber session complete --session s1');
  });

  it('degrades unknown payloads instead of throwing', () => {
    expect(normalizeCompletionNextActions(null)).toEqual({ status: 'unknown', actions: [] });
    expect(normalizeCompletionNextActions({ status: 'weird', actions: [42, 'x'] })).toEqual({
      status: 'unknown',
      actions: [],
    });
  });
});

describe('async verification state machine', () => {
  it('parses the synchronous denial contract shape', () => {
    const submission = resolveVerificationSubmission({
      status: 'denied',
      sessionId: 's1',
      reason: 'Command is not allowed by verify policy',
    });
    expect(submission?.kind).toBe('denied');
  });

  it('parses the accepted job contract shape', () => {
    const submission = resolveVerificationSubmission({
      status: 'accepted',
      jobId: 'job-1',
      sessionId: 's1',
    });
    expect(submission).toEqual({ kind: 'job', jobId: 'job-1' });
    expect(resolveVerificationSubmission({ status: 'accepted' })).toBeNull();
    expect(resolveVerificationSubmission(null)).toBeNull();
  });

  it('stays idle before submission and submitting while the mutation is in flight', () => {
    expect(resolveVerificationProgress({ isSubmitting: false, submission: null }).phase).toBe(
      'idle',
    );
    expect(resolveVerificationProgress({ isSubmitting: true, submission: null }).phase).toBe(
      'submitting',
    );
  });

  it('settles immediately on a synchronous denial with the historical result shape', () => {
    const denied = { status: 'denied', reason: 'Command is not allowed by verify policy' };
    const progress = resolveVerificationProgress({ isSubmitting: false, submission: denied });
    expect(progress.phase).toBe('settled');
    expect(progress.jobStatus).toBe('denied');
    expect(progress.result).toEqual(denied);
  });

  it('runs while the job query is pending or missing, then settles on a terminal job', () => {
    const accepted = { status: 'accepted', jobId: 'job-1' };

    const running = resolveVerificationProgress({ isSubmitting: false, submission: accepted });
    expect(running.phase).toBe('running');
    expect(running.jobId).toBe('job-1');

    const pending = resolveVerificationProgress({
      isSubmitting: false,
      submission: accepted,
      job: { jobId: 'job-1', status: 'pending' },
    });
    expect(pending.phase).toBe('running');
    expect(pending.jobStatus).toBe('pending');

    const completed = resolveVerificationProgress({
      isSubmitting: false,
      submission: accepted,
      job: { jobId: 'job-1', status: 'completed', result: { status: 'passed', exitCode: 0 } },
    });
    expect(completed.phase).toBe('settled');
    expect(completed.jobStatus).toBe('completed');
    expect(completed.result).toEqual({ status: 'passed', exitCode: 0 });
    expect(completed.error).toBeNull();

    const failed = resolveVerificationProgress({
      isSubmitting: false,
      submission: accepted,
      job: { jobId: 'job-1', status: 'failed', error: 'exit 3' },
    });
    expect(failed.phase).toBe('settled');
    expect(failed.error).toBe('exit 3');
    expect(failed.result).toEqual({ status: 'failed', reason: 'exit 3' });
  });

  it('recognizes terminal job statuses for the polling fallback', () => {
    expect(isTerminalVerificationJobStatus('completed')).toBe(true);
    expect(isTerminalVerificationJobStatus('timeout')).toBe(true);
    expect(isTerminalVerificationJobStatus('running')).toBe(false);
    expect(isTerminalVerificationJobStatus('unknown')).toBe(false);
  });
});
