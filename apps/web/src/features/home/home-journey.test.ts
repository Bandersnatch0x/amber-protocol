import { describe, expect, it } from 'vitest';
import { deriveJourneyStage } from './home-journey';

const quietRepository = {
  activeSessionCount: 0,
  pendingGateCount: 0,
  recoverySessionCount: 0,
};

describe('deriveJourneyStage', () => {
  it.each([
    ['audit', 0],
    ['init', 1],
    ['feature', 2],
    ['plan', 2],
    ['gate', 2],
    ['verify', 3],
    ['approve', 3],
    ['accept', 5],
  ] as const)('maps the known %s lifecycle step to J%s', (stepId, expected) => {
    expect(deriveJourneyStage({ ...quietRepository, stepId })).toBe(expected);
  });

  it.each(['feature-evidence', 'complete-check', 'session-complete'] as const)(
    'keeps the delivery step %s in J3 instead of J5',
    (stepId) => {
      expect(deriveJourneyStage({ ...quietRepository, stepId })).toBe(3);
    },
  );

  it('keeps the conditional J7 learnings path out of core J5', () => {
    expect(deriveJourneyStage({ ...quietRepository, stepId: 'learnings' })).toBe(2);
  });

  it('lets live core pressure remain visible while J7 learnings is pending', () => {
    expect(
      deriveJourneyStage({
        ...quietRepository,
        stepId: 'learnings',
        pendingGateCount: 1,
      }),
    ).toBe(5);
  });

  it('keeps the lifecycle next step authoritative over unrelated pending Gates', () => {
    expect(
      deriveJourneyStage({
        ...quietRepository,
        stepId: 'init',
        pendingGateCount: 3,
      }),
    ).toBe(1);
  });

  it('treats a handoff as recovery only when a recovery-state session exists', () => {
    expect(deriveJourneyStage({ ...quietRepository, stepId: 'handoff' })).toBe(2);
    expect(
      deriveJourneyStage({
        ...quietRepository,
        stepId: 'handoff',
        recoverySessionCount: 1,
      }),
    ).toBe(4);
  });

  it.each([
    [{ pendingGateCount: 1 }, 5],
    [{ activeSessionCount: 1 }, 3],
    [{ recoverySessionCount: 1 }, 4],
    [{}, 2],
  ] as const)('falls back to live pressure for unknown steps', (overrides, expected) => {
    expect(
      deriveJourneyStage({
        ...quietRepository,
        ...overrides,
        stepId: 'unknown',
      }),
    ).toBe(expected);
  });
});
