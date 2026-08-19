import { describe, it, expect } from 'vitest';
import { extractFailures } from '../server/lib/claude-transcript-reader';

// tool_use blocks carry an id; the matching tool_result references it via
// tool_use_id and may set is_error. A failed call links the two.
const JSONL_WITH_FAILURE = [
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'running the build' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm run build' } },
      ],
    },
    timestamp: '2026-06-17T10:00:00Z',
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          is_error: true,
          content: 'error TS2345: type mismatch',
        },
      ],
    },
    timestamp: '2026-06-17T10:00:01Z',
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: 'ok.ts' } }],
    },
    timestamp: '2026-06-17T10:00:02Z',
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'file contents' }],
    },
    timestamp: '2026-06-17T10:00:03Z',
  }),
].join('\n');

describe('extractFailures', () => {
  it('returns only the failed tool calls, linked to their tool name and input', () => {
    const failures = extractFailures(JSONL_WITH_FAILURE, { redact: false });
    expect(failures).toHaveLength(1);
    expect(failures[0].tool).toBe('Bash');
    expect(failures[0].input).toContain('npm run build');
    expect(failures[0].error).toContain('TS2345');
  });

  it('ignores successful tool calls', () => {
    const failures = extractFailures(JSONL_WITH_FAILURE, { redact: false });
    expect(failures.some((f) => f.tool === 'Read')).toBe(false);
  });

  it('redacts secrets in failure input and error by default', () => {
    const jsonl = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'x',
              name: 'Bash',
              input: {
                command: 'curl -H "Authorization: Bearer sk-ant-secret000111222333444" url',
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: 'failed' }],
        },
      }),
    ].join('\n');

    const failures = extractFailures(jsonl);
    expect(JSON.stringify(failures)).not.toContain('sk-ant-secret000111222333444');
  });

  it('returns an empty array when there are no failures', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'no tools here' }] },
    });
    expect(extractFailures(jsonl)).toEqual([]);
  });
});
