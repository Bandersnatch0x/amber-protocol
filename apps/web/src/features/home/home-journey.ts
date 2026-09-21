export type CoreJourneyIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface JourneyPressure {
  stepId: string;
  activeSessionCount: number;
  pendingGateCount: number;
  recoverySessionCount: number;
}

const deliveryStepIds = new Set([
  'feature-evidence',
  'verify',
  'approve',
  'complete-check',
  'session-complete',
]);

function derivePressureStage({
  activeSessionCount,
  pendingGateCount,
  recoverySessionCount,
}: Pick<
  JourneyPressure,
  'activeSessionCount' | 'pendingGateCount' | 'recoverySessionCount'
>): CoreJourneyIndex {
  if (pendingGateCount > 0) return 5;
  if (activeSessionCount > 0) return 3;
  if (recoverySessionCount > 0) return 4;
  return 2;
}

/**
 * Resolve repository pressure onto the six user-facing core journeys.
 * A known lifecycle step outranks aggregate session and Gate counts so the
 * highlighted Journey cannot contradict the next-action card.
 */
export function deriveJourneyStage({
  stepId,
  activeSessionCount,
  pendingGateCount,
  recoverySessionCount,
}: JourneyPressure): CoreJourneyIndex {
  if (stepId === 'audit') return 0;
  if (stepId === 'init') return 1;
  if (deliveryStepIds.has(stepId)) return 3;
  if (stepId === 'accept') return 5;
  if (['feature', 'plan', 'gate'].includes(stepId)) return 2;
  if (stepId === 'handoff') return recoverySessionCount > 0 ? 4 : 2;
  // Learnings is J7, a conditional path. Like an unknown backend signal, it
  // must defer to live core pressure instead of claiming J5 Review & Accept.
  return derivePressureStage({ activeSessionCount, pendingGateCount, recoverySessionCount });
}

export const recoverySessionStatuses = new Set(['aborted', 'blocked', 'failed', 'paused']);
