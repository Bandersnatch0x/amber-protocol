import { describe, expect, it } from 'vitest';
import { buildRouteMetadata, buildStageDetailLine } from './route-detail-view-model';

const route = {
  id: 'feature-standard',
  name: 'Standard Feature Development',
  description: 'Complete feature delivery with planning and review',
  trigger: {
    complexity: 'medium',
    goalPattern: '^(add|implement|create|build|support)\b',
  },
  metadata: {
    version: '1.0.0',
  },
  gates: [
    { id: 'user-approval-plan', type: 'user-approval', description: 'Approve plan before implementation?' },
    { id: 'user-approval-implement', type: 'user-approval', description: 'Proceed with implementation?' },
  ],
} as const;

describe('buildRouteMetadata', () => {
  it('uses the real route fields for the metadata panel', () => {
    const metadata = buildRouteMetadata(route);

    expect(metadata).toEqual([
      { labelKey: 'complexity', value: 'Medium' },
      { labelKey: 'version', value: '1.0.0' },
      { labelKey: 'goalPattern', value: '^(add|implement|create|build|support)\b' },
      { labelKey: 'gateCount', value: '2' },
    ]);
  });
});

describe('buildStageDetailLine', () => {
  it('joins machine-facing stage fields into one compact detail line', () => {
    expect(
      buildStageDetailLine({
        name: 'verify',
        type: 'command',
        target: 'npm test',
      }),
    ).toBe('verify \u00b7 command \u00b7 npm test');
  });

  it('omits missing fields instead of leaking separators', () => {
    expect(
      buildStageDetailLine({
        name: 'capture',
      }),
    ).toBe('capture');
  });
});
