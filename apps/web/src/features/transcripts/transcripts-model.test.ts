import { describe, expect, it } from 'vitest';
import {
  buildTranscriptDisplayModel,
  filterTranscripts,
  getToolDisplayLabel,
  getTurnDisplayLabel,
  getTurnRoleLabel,
  isMetadataOnlyTurn,
  isToolOnlyTurn,
} from './transcripts-model';

describe('filterTranscripts', () => {
  const transcripts = [
    {
      id: 'trans_82af91',
      gitBranch: 'codex/session-ui',
      outline: 'Implement session directory overview',
      sourceDirectory: 'C:\\Users\\amsterdam\\.claude\\projects\\demo',
      turnCount: 12,
    },
    {
      id: 'trans_77bc02',
      gitBranch: 'main',
      outline: 'Fix transcript rendering',
      sourceDirectory: 'C:\\Users\\amsterdam\\.claude\\projects\\other',
      turnCount: 8,
    },
  ];

  it('returns the full list when the query is empty', () => {
    expect(filterTranscripts(transcripts, '')).toEqual(transcripts);
  });

  it('matches transcript id and branch text', () => {
    expect(filterTranscripts(transcripts, '82af').map((item) => item.id)).toEqual(['trans_82af91']);
    expect(filterTranscripts(transcripts, 'session-ui').map((item) => item.id)).toEqual(['trans_82af91']);
  });

  it('matches outline and source directory text', () => {
    expect(filterTranscripts(transcripts, 'directory overview').map((item) => item.id)).toEqual(['trans_82af91']);
    expect(filterTranscripts(transcripts, 'projects\\other').map((item) => item.id)).toEqual(['trans_77bc02']);
  });
});

describe('getTurnRoleLabel', () => {
  it('prefers the explicit role when present', () => {
    expect(getTurnRoleLabel({ type: 'message', role: 'assistant' })).toBe('assistant');
  });

  it('falls back to type when role is absent', () => {
    expect(getTurnRoleLabel({ type: 'system' })).toBe('system');
  });
});

describe('transcript display helpers', () => {
  it('maps raw role labels to readable labels', () => {
    expect(getTurnDisplayLabel({ type: 'message', role: 'assistant' })).toBe('Assistant');
    expect(getTurnDisplayLabel({ type: 'last-prompt' })).toBe('Last prompt state');
  });

  it('identifies metadata-only transcript records', () => {
    expect(isMetadataOnlyTurn({ type: 'attachment' })).toBe(true);
    expect(isMetadataOnlyTurn({ type: 'file-history-snapshot' })).toBe(true);
    expect(isMetadataOnlyTurn({ type: 'permission-mode' })).toBe(true);
    expect(isMetadataOnlyTurn({ type: 'queue-operation' })).toBe(true);
    expect(isMetadataOnlyTurn({ type: 'message', role: 'assistant' })).toBe(true);
    expect(isMetadataOnlyTurn({ type: 'message', role: 'assistant', text: 'hello' })).toBe(false);
    expect(isMetadataOnlyTurn({ type: 'message', role: 'assistant', tools: ['Read'] })).toBe(false);
  });

  it('identifies tool-only records and maps tool names', () => {
    expect(isToolOnlyTurn({ type: 'message', role: 'assistant', tools: ['Read'] })).toBe(true);
    expect(isToolOnlyTurn({ type: 'message', role: 'assistant', tools: ['Read'], text: 'done' })).toBe(false);
    expect(getToolDisplayLabel('Read')).toBe('Read file');
    expect(getToolDisplayLabel('UnknownTool')).toBe('UnknownTool');
  });

  it('separates metadata records from visible transcript turns', () => {
    const turns = [
      { type: 'file-history-snapshot' },
      { type: 'last-prompt', timestamp: '2026-07-06T03:04:13.000Z' },
      { type: 'message', role: 'assistant' },
      { type: 'queue-operation', timestamp: '2026-07-06T03:05:13.000Z' },
      { type: 'message', role: 'assistant', tools: ['Read'] },
      { type: 'message', role: 'user', text: 'Optimize display' },
    ];

    const model = buildTranscriptDisplayModel(turns);

    expect(model.metadata).toEqual([
      {
        label: 'File history snapshot',
        summaryLabel: 'file history snapshots',
        description: 'Repository file-state snapshot recorded for context continuity.',
        timestamp: undefined,
      },
      {
        label: 'Prompt snapshot',
        summaryLabel: 'prompt snapshots',
        description: 'Internal state for the latest prompt, hidden from the readable transcript.',
        timestamp: '2026-07-06T03:04:13.000Z',
      },
      {
        label: 'Empty assistant record',
        summaryLabel: 'empty assistant records',
        description: 'A message envelope with no rendered assistant text or tool call.',
        timestamp: undefined,
      },
      {
        label: 'Queue operation record',
        summaryLabel: 'queue operation records',
        description: 'Internal queue state used to coordinate session work.',
        timestamp: '2026-07-06T03:05:13.000Z',
      },
    ]);
    expect(model.visibleTurns).toEqual([
      { type: 'message', role: 'assistant', tools: ['Read'] },
      { type: 'message', role: 'user', text: 'Optimize display' },
    ]);
  });
});
