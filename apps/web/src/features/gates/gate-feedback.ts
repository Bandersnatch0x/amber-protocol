import type { I18nKey } from '@/lib/i18n';
import type { GateStatus } from '@/lib/types/gate';

export type GateDecisionGuidance = 'completion' | 'rework';

export type GateActionFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  sessionId?: string;
  guidance?: GateDecisionGuidance;
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

/**
 * Parses the `?status=` search param of the gates page. Only the known gate
 * statuses are accepted; anything else (missing, typo, stale value) degrades to
 * the empty string so the page falls back to "all gates".
 */
export function parseStatusFilter(value: unknown): GateStatus | '' {
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : '';
}

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
  sessionId: string,
  t: Translate,
): GateActionFeedback {
  const warning = warningMessage(result, t);
  const status = result.sessionStatus ?? t('gates.feedback.unknownReason');
  const guidance = { sessionId, guidance: 'completion' as const };

  if (result.resumeConfirmed && result.resumeRequested) {
    return {
      tone: warning ? 'warning' : 'success',
      message: appendWarning(
        t('gates.feedback.resumeConfirmed', { gate: gateId, status }),
        warning,
      ),
      ...guidance,
    };
  }

  if (result.resumeConfirmed) {
    return {
      tone: warning ? 'warning' : 'success',
      message: appendWarning(
        t('gates.feedback.resumeAlreadyRunning', { gate: gateId, status }),
        warning,
      ),
      ...guidance,
    };
  }

  if (result.resumeRequested) {
    return {
      tone: 'warning',
      message: appendWarning(
        t('gates.feedback.resumeConfirmFailed', {
          reason: result.message ?? t('gates.feedback.unknownReason'),
        }),
        warning,
      ),
      ...guidance,
    };
  }

  return {
    tone: 'warning',
    message: appendWarning(t('gates.feedback.approvedNoResume', { status }), warning),
    ...guidance,
  };
}

export function buildRejectFeedback(
  result: RejectResult,
  gateId: string,
  sessionId: string,
  t: Translate,
): GateActionFeedback {
  const warning = result.eventWarning
    ? t('gates.feedback.auditWarning', { warning: result.eventWarning })
    : undefined;
  return {
    tone: warning ? 'warning' : 'success',
    message: appendWarning(t('gates.feedback.rejected', { gate: gateId }), warning),
    sessionId,
    guidance: 'rework',
  };
}
