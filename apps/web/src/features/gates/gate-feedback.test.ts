import { describe, expect, it } from 'vitest';
import { buildApproveAndResumeFeedback, buildRejectFeedback } from './gate-feedback';
import type { I18nKey } from '@/lib/i18n';

function t(key: I18nKey, params: Record<string, string | number> = {}): string {
  const templates: Record<string, string> = {
    'gates.feedback.resumeConfirmed': 'Gate {gate} confirmed as {status}.',
    'gates.feedback.resumeAlreadyRunning': 'Gate {gate} already {status}.',
    'gates.feedback.resumeConfirmFailed': 'Resume failed: {reason}',
    'gates.feedback.approvedNoResume': 'No resume for {status}.',
    'gates.feedback.rejected': 'Gate {gate} rejected.',
    'gates.feedback.auditWarning': 'Audit warning: {warning}',
    'gates.feedback.unknownReason': 'Unknown reason',
  };
  return (templates[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? `{${name}}`));
}

describe('gate feedback', () => {
  it('downgrades confirmed resume feedback to warning when durable audit has warnings', () => {
    const feedback = buildApproveAndResumeFeedback(
      {
        resumeConfirmed: true,
        resumeRequested: true,
        sessionStatus: 'executing',
        eventWarning: 'ledger locked',
        resumeEventWarning: 'timeline locked',
      },
      'gate-1',
      t,
    );

    expect(feedback).toEqual({
      tone: 'warning',
      message: 'Gate gate-1 confirmed as executing. Audit warning: ledger locked; timeline locked',
    });
  });

  it('shows audit warnings even when no resume was attempted', () => {
    const feedback = buildApproveAndResumeFeedback(
      {
        resumeConfirmed: false,
        resumeRequested: false,
        sessionStatus: 'completed',
        eventWarning: 'ledger locked',
      },
      'gate-1',
      t,
    );

    expect(feedback).toEqual({
      tone: 'warning',
      message: 'No resume for completed. Audit warning: ledger locked',
    });
  });

  it('marks rejection feedback as warning when audit evidence could not be written', () => {
    const feedback = buildRejectFeedback({ eventWarning: 'timeline locked' }, 'gate-1', t);

    expect(feedback).toEqual({
      tone: 'warning',
      message: 'Gate gate-1 rejected. Audit warning: timeline locked',
    });
  });
});
