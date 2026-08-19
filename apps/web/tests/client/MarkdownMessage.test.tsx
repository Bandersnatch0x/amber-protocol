// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MarkdownMessage } from '@/components/code/MarkdownMessage';
import { I18nProvider } from '@/lib/i18n';

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage={'en'}>{ui}</I18nProvider>);
}

// Regression guard for #30/P3a: the bare-text code-block heuristic used to
// misclassify long assistant Markdown (bullet lists, prose) as a fenced code
// block labeled "diff". Plain Markdown must stay a Markdown body; only real
// fences or strong code signals may enter the code-block path.
describe('MarkdownMessage code-block heuristic', () => {
  const markdownBody = [
    'Here is a summary of the changes I made to the pipeline:',
    '',
    '- Fixed the login redirect so the session cookie survives restarts',
    '- Updated the route table to prefer the canonical host name',
    '- Added regression coverage for the token refresh path',
    '- Tightened the timeout budget for upstream calls',
    '- Reworded the empty state copy for the session list',
    '- Archived the legacy adapters behind a feature flag',
  ].join('\n');

  it('renders pure Markdown prose as a body, never as a code block', () => {
    const { container } = renderWithI18n(<MarkdownMessage text={markdownBody} />);
    // CodeBlock always renders a <figure>; a Markdown body must not.
    expect(container.querySelector('figure')).toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
    expect(
      screen.getByText('Fixed the login redirect so the session cookie survives restarts'),
    ).toBeTruthy();
  });

  it('still renders real fenced blocks as code blocks', () => {
    const text = [
      'Before the fix the config looked like this:',
      '',
      '```ts',
      'const x = 1;',
      'export function read() { return x; }',
      '```',
      '',
      'After the fix it is lazily resolved.',
    ].join('\n');

    const { container } = renderWithI18n(<MarkdownMessage text={text} />);
    expect(container.querySelector('figure')).not.toBeNull();
    expect(screen.getByText('Before the fix the config looked like this:')).toBeTruthy();
    expect(screen.getByText('After the fix it is lazily resolved.')).toBeTruthy();
  });

  it('still labels bare diff content as diff', () => {
    const diffText = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1a2b3c4..5d6e7f8 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,3 @@',
      ' const keep = true;',
      '-const removed = false;',
      '+const added = true;',
    ].join('\n');

    const { container } = renderWithI18n(<MarkdownMessage text={diffText} />);
    const figure = container.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(figure!.textContent).toContain('diff');
    expect(figure!.textContent).toContain('+const added = true;');
  });

  it('renders short stat bullet lists as Markdown lists, not code blocks', () => {
    const statList = [
      '- **含空白** 350 文件 +10742/-10535',
      '- **不含空白** 342 文件 +10690/-10512',
      '- **新增** 128 文件 +8210/-0',
      '- **删除** 96 文件 +0/-7402',
    ].join('\n');

    const { container } = renderWithI18n(<MarkdownMessage text={statList} />);
    // CodeBlock always renders a <figure>; the stat list must stay a list.
    expect(container.querySelector('figure')).toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByText('含空白')).toBeTruthy();
    expect(container.textContent).toContain('+10742/-10535');
  });

  it('keeps stat bullets and a bare diff region in separate segments', () => {
    const text = [
      'Here is the whitespace accounting for this change:',
      '',
      '- **含空白** 350 文件 +10742/-10535',
      '- **不含空白** 342 文件 +10690/-10512',
      '',
      'diff --git a/src/app.ts b/src/app.ts',
      '@@ -1,3 +1,2 @@',
      '-const removed = false;',
      '+const added = true;',
    ].join('\n');

    const { container } = renderWithI18n(<MarkdownMessage text={text} />);
    const figure = container.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(figure!.textContent).toContain('diff');
    expect(figure!.textContent).toContain('+const added = true;');
    expect(figure!.querySelector('li')).toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('不含空白');
  });
});
