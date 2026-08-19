import { describe, expect, it } from 'vitest';
import {
  handoffNeedsCliAction,
  normalizeHandoffStatus,
  resolveHandoffCommand,
} from './HandoffCard';

describe('HandoffCard view model', () => {
  it('normalizes a live handoff with a delivery-ready bundle', () => {
    const status = normalizeHandoffStatus({
      handoffPath: 'amber/handoff/session-handoff.md',
      state: 'live',
      sessionEvidence: true,
      bundle: {
        present: true,
        valid: true,
        structureValid: true,
        deliveryReady: true,
        readinessScore: 92,
        errors: [],
      },
    });

    expect(status).toEqual({
      state: 'live',
      sessionEvidence: true,
      bundle: {
        present: true,
        valid: true,
        structureValid: true,
        deliveryReady: true,
        readinessScore: 92,
        errors: [],
      },
    });
    expect(status && handoffNeedsCliAction(status)).toBe(false);
    expect(resolveHandoffCommand(status, null)).toBeNull();
  });

  it('degrades unknown or partial payloads instead of throwing', () => {
    expect(normalizeHandoffStatus(null)).toBeNull();
    expect(normalizeHandoffStatus('handoff')).toBeNull();

    const status = normalizeHandoffStatus({
      state: 'unexpected-state',
      bundle: { readinessScore: 'high' },
    });
    expect(status).toEqual({
      state: 'missing',
      sessionEvidence: false,
      bundle: {
        present: false,
        valid: false,
        structureValid: false,
        deliveryReady: false,
        readinessScore: null,
        errors: [],
      },
    });
    expect(status && handoffNeedsCliAction(status)).toBe(true);
  });

  it('treats scaffold state and undelivered bundles as needing CLI remediation', () => {
    const scaffold = normalizeHandoffStatus({
      state: 'scaffold',
      sessionEvidence: false,
      bundle: {
        present: true,
        valid: true,
        structureValid: true,
        deliveryReady: true,
        readinessScore: 80,
        errors: [],
      },
    });
    expect(scaffold && handoffNeedsCliAction(scaffold)).toBe(true);

    const undelivered = normalizeHandoffStatus({
      state: 'live',
      sessionEvidence: true,
      bundle: {
        present: true,
        valid: false,
        structureValid: true,
        deliveryReady: false,
        readinessScore: 40,
        errors: ['bundle missing'],
      },
    });
    expect(undelivered && handoffNeedsCliAction(undelivered)).toBe(true);
  });

  it('prefers the completion next-action command, then falls back to the canonical handoff command', () => {
    const status = normalizeHandoffStatus({ state: 'missing', bundle: {} });

    // Authoritative command from continuity.completion.nextActions.
    expect(
      resolveHandoffCommand(status, {
        status: 'fail',
        actions: [
          { item: 'verification', action: 'in-page' },
          { item: 'handoff', action: 'cli-command', command: 'amber handoff --target .' },
        ],
      }),
    ).toBe('amber handoff --target .');

    // Any cli-command row wins over nothing...
    expect(
      resolveHandoffCommand(status, {
        status: 'fail',
        actions: [
          { item: 'work', action: 'cli-command', command: 'amber session resume --session s1' },
        ],
      }),
    ).toBe('amber session resume --session s1');

    // ...and the canonical command is the final fallback.
    expect(resolveHandoffCommand(status, null)).toBe('amber handoff --target .');
    expect(resolveHandoffCommand(status, { actions: [] })).toBe('amber handoff --target .');
  });
});
