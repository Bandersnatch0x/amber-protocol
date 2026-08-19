import { describe, expect, it } from 'vitest';
import {
  classifyTurn,
  collapseWhitespace,
  extractTag,
  stripAnsi,
  SUMMARY_LIMIT_LONG,
  SUMMARY_LIMIT_SHORT,
  TRANSCRIPT_NOISE_RULES,
} from './transcript-denoise';

describe('stripAnsi (R4)', () => {
  it('removes SGR styling sequences', () => {
    expect(stripAnsi('\u001b[1mFable 5\u001b[22m')).toBe('Fable 5');
  });

  it('removes screen-control sequences entirely', () => {
    expect(stripAnsi('\u001b[H\u001b[2J\u001b[3J')).toBe('');
  });

  it('removes OSC sequences terminated by BEL', () => {
    expect(stripAnsi('\u001b]0;window title\u0007rest')).toBe('rest');
  });

  it('removes private-mode sequences such as hook stdout markers', () => {
    expect(stripAnsi('\u001b[?9001hok\u001b[?9001l')).toBe('ok');
  });
});

describe('extractTag / collapseWhitespace (R9)', () => {
  it('extracts the inner content of a tag block', () => {
    expect(extractTag('<command-name>/model</command-name>', 'command-name')).toBe('/model');
  });

  it('returns undefined when the tag is absent', () => {
    expect(extractTag('no tags here', 'command-name')).toBeUndefined();
  });

  it('collapses multi-line whitespace into single spaces', () => {
    expect(collapseWhitespace('  a\n\n  b\tc ')).toBe('a b c');
  });
});

describe('R1 local-command-caveat (hidden)', () => {
  it('hides a fully wrapped caveat message', () => {
    const result = classifyTurn({
      text: '<local-command-caveat>\nCaveat: command output is local only.\n</local-command-caveat>',
    });
    expect(result.kind).toBe('hidden');
    expect(result.hiddenGroup).toBe('localCommand');
  });

  it('hides even with trailing whitespace', () => {
    const result = classifyTurn({
      text: '<local-command-caveat>hidden</local-command-caveat>\n\n',
    });
    expect(result.kind).toBe('hidden');
    expect(result.hiddenGroup).toBe('localCommand');
  });

  it('does not hide user text that merely quotes the tag', () => {
    const result = classifyTurn({
      text: 'Why does Claude wrap output in <local-command-caveat> tags? Explain.',
    });
    expect(result.kind).toBe('plain');
  });
});

describe('R6 system-reminder (hidden)', () => {
  it('hides a fully wrapped system reminder', () => {
    const result = classifyTurn({
      text: '<system-reminder>\nThis session is being continued.\n</system-reminder>',
    });
    expect(result.kind).toBe('hidden');
    expect(result.hiddenGroup).toBe('systemReminder');
  });

  it('does not hide text that only mentions the tag', () => {
    const result = classifyTurn({
      text: 'The <system-reminder> block is injected context, not my words.',
    });
    expect(result.kind).toBe('plain');
  });
});

describe('R2 slash command (folded chip)', () => {
  it('uses command-message when args are empty (/model)', () => {
    const result = classifyTurn({
      text: [
        '<command-name>/model</command-name>',
        '<command-message>model</command-message>',
        '<command-args></command-args>',
      ].join('\n'),
    });
    expect(result.kind).toBe('slashCommand');
    expect(result.chipParam).toBe('/model');
    expect(result.summary).toBe('model');
  });

  it('folds multi-line Chinese args into a single line <= 80 chars', () => {
    const args = '请帮我审查\n这个分支的\n所有改动，重点关注 i18n 与时间轴';
    const result = classifyTurn({
      text: `<command-name>/ask-matt</command-name>\n<command-message>ask-matt</command-message>\n<command-args>${args}</command-args>`,
    });
    expect(result.kind).toBe('slashCommand');
    expect(result.chipParam).toBe('/ask-matt');
    expect(result.summary).toBe(collapseWhitespace(args));
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT_SHORT);
    expect(result.summary).not.toContain('\n');
  });

  it('keeps plugin-prefixed command names', () => {
    const result = classifyTurn({
      text: '<command-name>/mattpocock-skills:code-review</command-name><command-args></command-args>',
    });
    expect(result.chipParam).toBe('/mattpocock-skills:code-review');
  });

  it('attaches the stdout chip as secondary when both R2 and R3 match', () => {
    const result = classifyTurn({
      text: [
        '<command-name>/run-tests</command-name>',
        '<local-command-stdout>ok</local-command-stdout>',
      ].join('\n'),
    });
    expect(result.kind).toBe('slashCommand');
    expect(result.secondaryChip).toBe('commandStdout');
  });

  it('keeps the original tags in raw for the raw viewer', () => {
    const result = classifyTurn({
      text: '<command-name>/model</command-name>\n<command-args></command-args>',
    });
    expect(result.raw).toContain('<command-name>');
  });
});

describe('R3 local-command-stdout (folded line)', () => {
  it('extracts the first line with ANSI stripped', () => {
    const result = classifyTurn({
      text: '<local-command-stdout>\u001b[1mFable 5\u001b[22m is ready\nsecond line</local-command-stdout>',
    });
    expect(result.kind).toBe('stdout');
    expect(result.summary).toBe('Fable 5 is ready');
    expect(result.summary).not.toContain('\u001b');
  });

  it('caps very long first lines at the long limit', () => {
    const longLine = 'x'.repeat(400);
    const result = classifyTurn({
      text: `<local-command-stdout>${longLine}</local-command-stdout>`,
    });
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT_LONG);
  });
});

describe('R5 task-notification (folded line)', () => {
  it('extracts the summary tag content', () => {
    const result = classifyTurn({
      text: '<task-notification>\n<summary>Background agent finished the sweep.</summary>\n<details>long detail</details>\n</task-notification>',
    });
    expect(result.kind).toBe('taskNotification');
    expect(result.summary).toBe('Background agent finished the sweep.');
  });

  it('falls back to the collapsed first line when summary is missing', () => {
    const result = classifyTurn({
      text: '<task-notification>\nsome notification text\n</task-notification>',
    });
    expect(result.kind).toBe('taskNotification');
    expect(result.summary).toBe('some notification text');
  });
});

describe('R8 away_summary recap (folded line)', () => {
  it('hits recap via the precise subtype path even without the suffix', () => {
    const result = classifyTurn({
      subtype: 'away_summary',
      text: 'Session recap body without the standard suffix.',
    });
    expect(result.kind).toBe('recap');
    expect(result.summary).toBe('Session recap body without the standard suffix.');
  });

  it('strips the recap suffix via the heuristic fallback (no subtype, legacy data)', () => {
    const result = classifyTurn({
      text: 'While you were away: the refactor landed. (disable recaps in /config)',
    });
    expect(result.kind).toBe('recap');
    expect(result.summary).toBe('While you were away: the refactor landed.');
    expect(result.summary).not.toContain('disable recaps');
  });

  it('still folds when subtype is present and the suffix is present too', () => {
    const result = classifyTurn({
      subtype: 'away_summary',
      text: 'While you were away: tests stayed green. (disable recaps in /config)',
    });
    expect(result.kind).toBe('recap');
    expect(result.summary).not.toContain('disable recaps');
  });

  it('degrades gracefully to plain when neither subtype nor suffix is present', () => {
    const text = 'Just a normal message mentioning recaps in passing.';
    const result = classifyTurn({ text });
    expect(result.kind).toBe('plain');
    expect(result.summary).toBe('');
    expect(result.raw).toBe(text);
  });

  it('does not treat an unrelated subtype with the suffix-less body as a recap', () => {
    const result = classifyTurn({
      subtype: 'some_other_subtype',
      text: 'Session recap body without the standard suffix.',
    });
    expect(result.kind).toBe('plain');
  });
});

describe('plain fallback', () => {
  it('renders ordinary markdown text untouched and keeps raw ANSI-stripped', () => {
    const text = 'Here is **bold** analysis of the plan.';
    const result = classifyTurn({ text });
    expect(result.kind).toBe('plain');
    expect(result.summary).toBe('');
    expect(result.raw).toBe(text);
  });

  it('strips ANSI from plain text too', () => {
    const result = classifyTurn({ text: '\u001b[1mhello\u001b[22m world' });
    expect(result.kind).toBe('plain');
    expect(result.raw).toBe('hello world');
  });
});

describe('TRANSCRIPT_NOISE_RULES', () => {
  it('declares the full R1-R9 table', () => {
    expect(TRANSCRIPT_NOISE_RULES.map((rule) => rule.id)).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
      'R7',
      'R8',
      'R9',
    ]);
  });
});
