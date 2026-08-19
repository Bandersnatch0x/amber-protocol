import { useId, useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { useI18n } from '@/lib/i18n';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  defaultCollapsed?: boolean;
  collapseAfterLines?: number;
}

type DiffLineKind = 'add' | 'remove' | 'meta' | 'context';

const DEFAULT_COLLAPSE_AFTER_LINES = 18;

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'shell',
  cmd: 'shell',
  diff: 'diff',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsonc: 'json',
  md: 'markdown',
  ps1: 'powershell',
  py: 'python',
  sh: 'shell',
  shell: 'shell',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

function normalizeCode(code: string): string {
  return code.replace(/\n$/, '');
}

function stripLeadingLineNumber(line: string): string {
  return line.replace(/^\s*\d+(?:\s+|[|:]\s*)/, '');
}

function stripSequentialLineNumbers(lines: string[]): string[] {
  const nonBlankLines = lines.filter((line) => line.trim().length > 0);
  const numbered = nonBlankLines
    .map((line) => /^\s*(\d+)(?:\s+|[|:]\s*)/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match));

  if (numbered.length < Math.max(4, Math.ceil(nonBlankLines.length * 0.7))) return lines;

  const numbers = numbered.map((match) => Number(match[1]));
  const mostlySequential = numbers.slice(1).every((value, index) => value === numbers[index] + 1);
  if (!mostlySequential) return lines;

  return lines.map(stripLeadingLineNumber);
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = language
    .toLowerCase()
    .replace(/^language-/, '')
    .trim();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function getDiffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lineClassName(kind: DiffLineKind): string {
  if (kind === 'add')
    return 'bg-emerald-50/80 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100';
  if (kind === 'remove') return 'bg-red-50/80 text-red-950 dark:bg-red-950/30 dark:text-red-100';
  if (kind === 'meta') return 'bg-blue-50/70 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200';
  return 'text-slate-800 dark:text-slate-200';
}

function markerClassName(kind: DiffLineKind): string {
  if (kind === 'add') return 'text-emerald-600 dark:text-emerald-300';
  if (kind === 'remove') return 'text-red-600 dark:text-red-300';
  if (kind === 'meta') return 'text-blue-600 dark:text-blue-300';
  return 'text-slate-300 dark:text-slate-600';
}

function highlightLine(line: string, language: string | undefined): string {
  if (!line) return '';

  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(line, { language, ignoreIllegals: true }).value;
    }
    return escapeHtml(line);
  } catch {
    return escapeHtml(line);
  }
}

export function CodeBlock({
  code,
  language,
  title,
  defaultCollapsed,
  collapseAfterLines = DEFAULT_COLLAPSE_AFTER_LINES,
}: CodeBlockProps) {
  const { t } = useI18n();
  const codeRegionId = useId();
  const normalizedCode = useMemo(
    () => stripSequentialLineNumbers(normalizeCode(code).split('\n')).join('\n'),
    [code],
  );
  const normalizedLanguage = useMemo(() => normalizeLanguage(language), [language]);
  const lines = useMemo(() => normalizedCode.split('\n'), [normalizedCode]);
  const isDiff =
    normalizedLanguage === 'diff' || lines.some((line) => /^(@@|\+\+\+|---|[-+]\S)/.test(line));
  const shouldCollapse = defaultCollapsed ?? lines.length > collapseAfterLines;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const visibleLines = expanded ? lines : lines.slice(0, collapseAfterLines);
  const hiddenCount = Math.max(lines.length - visibleLines.length, 0);
  const label = title ?? normalizedLanguage ?? 'text';
  const copyLabel =
    copyState === 'copied'
      ? t('code.copied')
      : copyState === 'failed'
        ? t('code.copyFailed')
        : t('code.copy');

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(normalizedCode);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  }

  return (
    <figure className="not-prose my-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <figcaption className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="truncate font-mono text-xs font-medium text-slate-600 dark:text-slate-300">
            {label}
          </span>
          {isDiff && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              diff
            </span>
          )}
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {t(lines.length === 1 ? 'code.linesOne' : 'code.lines', { count: lines.length })}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {shouldCollapse && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              aria-controls={codeRegionId}
              className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              {expanded ? t('code.collapse') : t('code.expand')}
            </button>
          )}
          <button
            type="button"
            onClick={copyCode}
            className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          >
            <span aria-live="polite">{copyLabel}</span>
          </button>
        </div>
      </figcaption>

      <pre
        id={codeRegionId}
        className="max-h-[32rem] overflow-auto bg-slate-950/0 text-xs leading-5"
      >
        <code className="block min-w-full py-2 font-mono">
          {visibleLines.map((line, index) => {
            const lineNumber = index + 1;
            const diffKind = isDiff ? getDiffLineKind(line) : 'context';
            const marker = isDiff && (diffKind === 'add' || diffKind === 'remove') ? line[0] : '';
            const codeLine = marker ? line.slice(1) : line;

            return (
              <span
                key={`${lineNumber}-${line}`}
                className={`grid grid-cols-[3.25rem_1.5rem_minmax(0,1fr)] px-0 ${lineClassName(diffKind)}`}
              >
                <span className="select-none border-r border-slate-200/70 pr-3 text-right text-slate-400 dark:border-slate-700/80 dark:text-slate-500">
                  {lineNumber}
                </span>
                <span
                  className={`select-none text-center font-semibold ${markerClassName(diffKind)}`}
                >
                  {marker}
                </span>
                <span
                  className="whitespace-pre px-3"
                  dangerouslySetInnerHTML={{
                    __html: highlightLine(codeLine, normalizedLanguage) || ' ',
                  }}
                />
              </span>
            );
          })}
        </code>
      </pre>

      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={expanded}
          aria-controls={codeRegionId}
          className="block w-full border-t border-slate-200 bg-gradient-to-r from-blue-50 via-slate-50 to-blue-50 px-3 py-2.5 text-center text-xs font-medium text-blue-700 hover:from-blue-100 hover:to-blue-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:border-slate-700 dark:from-slate-800 dark:via-slate-800/90 dark:to-slate-800 dark:text-blue-300 dark:hover:from-slate-700 dark:hover:to-slate-700"
        >
          {t(hiddenCount === 1 ? 'code.hiddenLinesOne' : 'code.hiddenLines', {
            count: hiddenCount,
          })}
        </button>
      )}
    </figure>
  );
}
