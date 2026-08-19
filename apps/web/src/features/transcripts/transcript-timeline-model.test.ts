import { describe, expect, it } from 'vitest';
import { buildTranscriptTimeline } from './transcript-timeline-model';
import type { TranscriptTurnLike } from './transcripts-model';

function turn(partial: Partial<TranscriptTurnLike> & { type: string }): TranscriptTurnLike {
  return partial;
}

describe('buildTranscriptTimeline', () => {
  it('merges R1/R6 hidden records into metadata with their timestamps', () => {
    const model = buildTranscriptTimeline([
      turn({ type: 'user', role: 'user', text: 'hello', timestamp: '2026-06-20T00:00:00.000Z' }),
      turn({
        type: 'user',
        role: 'user',
        text: '<local-command-caveat>local only</local-command-caveat>',
        timestamp: '2026-06-20T00:00:05.000Z',
      }),
      turn({
        type: 'user',
        role: 'user',
        text: '<system-reminder>injected</system-reminder>',
        timestamp: '2026-06-20T00:00:06.000Z',
      }),
    ]);

    expect(model.visibleTurns).toHaveLength(1);
    expect(model.metadata.map((item) => item.label)).toEqual([
      'Local command record',
      'System reminder record',
    ]);
    expect(model.metadata[0].timestamp).toBe('2026-06-20T00:00:05.000Z');
    expect(model.entries.filter((entry) => entry.entryKind === 'turn')).toHaveLength(1);
  });

  it('keeps metadata shells hidden alongside denoise-hidden records', () => {
    const model = buildTranscriptTimeline([
      turn({ type: 'file-history-snapshot' }),
      turn({
        type: 'message',
        role: 'user',
        text: '<local-command-caveat>x</local-command-caveat>',
      }),
      turn({ type: 'message', role: 'user', text: 'visible' }),
    ]);

    expect(model.metadata.map((item) => item.label)).toEqual([
      'File history snapshot',
      'Local command record',
    ]);
    expect(model.visibleTurns).toHaveLength(1);
  });

  it('inserts a turn separator when the gap exceeds 15 minutes', () => {
    const model = buildTranscriptTimeline([
      turn({ type: 'user', role: 'user', text: 'first', timestamp: '2026-06-20T00:00:00.000Z' }),
      turn({
        type: 'assistant',
        role: 'assistant',
        text: 'quick reply',
        timestamp: '2026-06-20T00:00:30.000Z',
      }),
      turn({ type: 'user', role: 'user', text: 'later', timestamp: '2026-06-20T00:20:00.000Z' }),
    ]);

    const separators = model.entries.filter((entry) => entry.entryKind === 'turnSeparator');
    expect(separators).toHaveLength(1);
    expect(separators[0].entryKind === 'turnSeparator' && separators[0].timestamp).toBe(
      '2026-06-20T00:20:00.000Z',
    );
  });

  it('does not insert a separator for gaps at or under 15 minutes', () => {
    const model = buildTranscriptTimeline([
      turn({ type: 'user', role: 'user', text: 'first', timestamp: '2026-06-20T00:00:00.000Z' }),
      turn({
        type: 'assistant',
        role: 'assistant',
        text: 'reply',
        timestamp: '2026-06-20T00:15:00.000Z',
      }),
    ]);

    expect(model.entries.filter((entry) => entry.entryKind === 'turnSeparator')).toHaveLength(0);
  });

  it('inserts a separator before slash commands even without a time gap', () => {
    const model = buildTranscriptTimeline([
      turn({ type: 'user', role: 'user', text: 'question', timestamp: '2026-06-20T00:00:00.000Z' }),
      turn({
        type: 'user',
        role: 'user',
        text: '<command-name>/model</command-name><command-args></command-args>',
        timestamp: '2026-06-20T00:00:10.000Z',
      }),
    ]);

    expect(model.entries.filter((entry) => entry.entryKind === 'turnSeparator')).toHaveLength(1);
  });

  it('never inserts a separator before the first record', () => {
    const model = buildTranscriptTimeline([
      turn({
        type: 'user',
        role: 'user',
        text: '<command-name>/model</command-name><command-args></command-args>',
        timestamp: '2026-06-20T00:00:00.000Z',
      }),
    ]);

    expect(model.entries.filter((entry) => entry.entryKind === 'turnSeparator')).toHaveLength(0);
  });

  it('preserves record order and produces unique keys', () => {
    const model = buildTranscriptTimeline([
      turn({ type: 'user', role: 'user', text: 'a', timestamp: '2026-06-20T00:00:00.000Z' }),
      turn({
        type: 'assistant',
        role: 'assistant',
        text: 'b',
        timestamp: '2026-06-20T01:00:00.000Z',
      }),
      turn({
        type: 'user',
        role: 'user',
        text: '<local-command-stdout>ok</local-command-stdout>',
        timestamp: '2026-06-20T01:00:01.000Z',
      }),
    ]);

    const keys = model.entries.map((entry) => entry.key);
    expect(keys).toHaveLength(new Set(keys).size);

    const texts = model.entries
      .filter(
        (entry): entry is Extract<typeof entry, { entryKind: 'turn' }> =>
          entry.entryKind === 'turn',
      )
      .map((entry) => entry.turn.text);
    expect(texts).toEqual(['a', 'b', '<local-command-stdout>ok</local-command-stdout>']);
  });

  it('attaches denoise classification to each turn entry', () => {
    const model = buildTranscriptTimeline([
      turn({
        type: 'user',
        role: 'user',
        text: '<task-notification><summary>done</summary></task-notification>',
      }),
    ]);

    const first = model.entries[0];
    expect(first.entryKind).toBe('turn');
    if (first.entryKind === 'turn') {
      expect(first.denoise.kind).toBe('taskNotification');
      expect(first.denoise.summary).toBe('done');
    }
  });
});
