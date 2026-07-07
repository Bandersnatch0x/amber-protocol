import type { I18nKey } from '@/lib/i18n';

export type GateActionFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

interface ApproveAndResumeResult {
  resumeConfirmed?: boolean;
  resumeRequested?: boolean;
  sessionStatus?: string;
  message?: string | null;
  eventWarning?: string | null;
  resumeEventWarning?: string | null;
}

interface RejectResult {
  eventWarning?: string | null;
}

type Translate = (key: I18nKey, params?: Record<string, string | number>) => string;

function appendWarning(message: string, warning?: string): string {
  return warning ? `${message} ${warning}` : message;
}

function warningMessage(result: ApproveAndResumeResult, t: Translate): string | undefined {
  const warning = [result.eventWarning, result.resumeEventWarning].filter(Boolean).join('; ');
  return warning ? t('gates.feedback.auditWarning', { warning }) : undefined;
}

export function buildApproveAndResumeFeedback(
  result: ApproveAndResumeResult,
  gateId: string,
  t: Translate,
): GateActionFeedback {
  const warning = warningMessage(result, t);
  const status = result.sessionStatus ?? t('gates.feedback.unknownReason');

  if (result.resumeConfirmed && result.resumeRequested) {
    return {
      tone: warning ? 'warning' : 'success',
      message: appendWarning(t('gates.feedback.resumeConfirmed', { gate: gateId, status }), warning),
    };
  }

  if (result.resumeConfirmed) {
    return {
      tone: warning ? 'warning' : 'success',
      message: appendWarning(t('gates.feedback.resumeAlreadyRunning', { gate: gateId, status }), warning),
    };
  }

  if (result.resumeRequested) {
    return {
      tone: 'warning',
      message: appendWarning(
        t('gates.feedback.resumeConfirmFailed', { reason: result.message ?? t('gates.feedback.unknownReason') }),
        warning,
      ),
    };
  }

  return {
    tone: 'warning',
    message: appendWarning(t('gates.feedback.approvedNoResume', { status }), warning),
  };
}

export function buildRejectFeedback(result: RejectResult, gateId: string, t: Translate): GateActionFeedback {
  const warning = result.eventWarning ? t('gates.feedback.auditWarning', { warning: result.eventWarning }) : undefined;
  return {
    tone: warning ? 'warning' : 'success',
    message: appendWarning(t('gates.feedback.rejected', { gate: gateId }), warning),
  };
}
