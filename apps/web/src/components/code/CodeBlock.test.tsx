// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CodeBlock } from './CodeBlock';
import { MarkdownMessage } from './MarkdownMessage';
import { I18nProvider } from '@/lib/i18n';

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage="en">{ui}</I18nProvider>);
}

describe('CodeBlock', () => {
  it('renders diff lines with line numbers and diff controls', () => {
    renderWithI18n(<CodeBlock code={'@@ -1 +1\n-old\n+new'} language={'diff'} />);

    expect(screen.getAllByText('diff')).toHaveLength(2);
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('-')).toBeDefined();
    expect(screen.getByText('+')).toBeDefined();
    expect(screen.getByText('old')).toBeDefined();
    expect(screen.getByText('new')).toBeDefined();
  });

  it('collapses long blocks and expands on demand', () => {
    const code = Array.from({ length: 32 }, (_, index) => `line ${index + 1}`).join('\n');
    renderWithI18n(<CodeBlock code={code} language={'text'} collapseAfterLines={5} />);

    const expandButton = screen.getByText('Expand');
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');
    expect(expandButton.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.getByText('27 hidden lines - expand full block')).toBeDefined();
    expect(screen.queryByText('line 32')).toBeNull();

    fireEvent.click(screen.getByText('27 hidden lines - expand full block'));

    expect(screen.getByText('line 32')).toBeDefined();
    expect(screen.getByText('Collapse').getAttribute('aria-expanded')).toBe('true');
  });

  it('renders highlight.js syntax tokens for supported languages', () => {
    const { container } = renderWithI18n(
      <CodeBlock code={'const value = 1;'} language={'typescript'} />,
    );

    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(container.querySelector('.hljs-number')?.textContent).toBe('1');
  });
});

describe('MarkdownMessage', () => {
  it('renders fenced code through CodeBlock', () => {
    const { container } = renderWithI18n(
      <MarkdownMessage text={'Before\n\n```tsx\nconst value = 1;\n```'} />,
    );

    expect(screen.getByText('Before')).toBeDefined();
    expect(screen.getByText('typescript')).toBeDefined();
    expect(screen.getAllByText('const').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('value = 1;');
  });

  it('auto-detects bare pasted code and collapses it', () => {
    const code = Array.from(
      { length: 22 },
      (_, index) => `${index + 1} const value${index + 1} = require('pkg');`,
    ).join('\n');
    renderWithI18n(<MarkdownMessage text={code} />);

    expect(screen.getByText('javascript')).toBeDefined();
    expect(screen.getByText('Expand')).toBeDefined();
    expect(screen.getByText('4 hidden lines - expand full block')).toBeDefined();
    expect(screen.getAllByText('const').length).toBeGreaterThan(0);
    expect(screen.queryByText(`22 const value22 = require('pkg');`)).toBeNull();
  });

  it('keeps bare diff regions out of markdown lists even when fenced code exists earlier', () => {
    const text = [
      'Command:',
      '',
      '```bash',
      'node scripts/amber.js loop validate-loop \\',
      '+  --target .',
      '```',
      '',
      '+2 -2',
      'schemas/loop-contract.schema.json',
      '@@ -3,7 +3,7 @@',
      '-  required: [id, trigger, cadence]',
      '+  required: [id, trigger, stateSpine]',
    ].join('\n');
    const { container } = renderWithI18n(<MarkdownMessage text={text} />);

    expect(screen.getByText('shell')).toBeDefined();
    expect(screen.getAllByText('diff')).toHaveLength(2);
    expect(container.textContent).toContain('schemas/loop-contract.schema.json');
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
