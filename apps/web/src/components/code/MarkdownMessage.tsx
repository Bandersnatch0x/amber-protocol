import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

interface MarkdownMessageProps {
  text: string;
  codeCollapseAfterLines?: number;
}

function getCodeText(children: React.ReactNode): string {
  return String(children ?? '').replace(/\n$/, '');
}

function getLanguage(className: string | undefined): string | undefined {
  const match = /language-([\w-]+)/.exec(className ?? '');
  return match?.[1];
}

type MessageSegment =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string; language?: string };

function stripLeadingLineNumber(line: string): string {
  return line.replace(/^\s*\d+(?:\s+|[|:]\s*)/, '');
}

function isProseBulletLine(line: string): boolean {
  const trimmed = stripLeadingLineNumber(line).trim();
  const match = /^[-*+]\s+(.*)$/.exec(trimmed);
  if (!match?.[1]) return false;
  const body = match[1];
  // Markdown bold is prose emphasis, never a diff hunk: real diff deletions
  // ("- foo") are bare code identifiers without emphasis markers.
  if (body.includes('**')) return true;
  // Code punctuation marks diff hunks like "-  required: [id, trigger]";
  // only punctuation-free bodies with natural-language words read as prose.
  if (/[{}()[\];=:]|=>/.test(body)) return false;
  return (
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(body) || /[A-Za-z]{2,}/.test(body)
  );
}

function codeSignal(line: string): number {
  const trimmed = stripLeadingLineNumber(line).trim();
  if (!trimmed) return 0;
  // Short stat bullets ("- **含空白** 350 文件 +10742/-10535") are Markdown
  // list items, not diff hunks: strip every diff/code signal so they never
  // qualify as bare code.
  if (isProseBulletLine(trimmed)) return 0;

  let score = 0;
  if (
    /^(import|export|const|let|var|function|class|interface|type|return|if|for|while|try|catch|throw|async|await)\b/.test(
      trimmed,
    )
  )
    score += 2;
  if (/(require\(|console\.|JSON\.|path\.|fs\.|new Error|module\.exports|=>)/.test(trimmed))
    score += 2;
  if (/[{}();=]/.test(trimmed)) score += 1;
  if (/^(diff --git|@@|\+\+\+|---|[+-]\S)/.test(trimmed)) score += 3;
  // Weak diff signal: "+/- " prefixed lines may be indented diff hunks, but
  // they are indistinguishable from Markdown list items in isolation, so the
  // natural-language guard below decides which reading wins.
  if (/^[+-]\s/.test(trimmed)) score += 1;
  if (/^[\w./-]+[\\/][\w./\\-]+\.[a-z0-9]+$/i.test(trimmed)) score += 2;
  if (/^(\$|>)?\s*(npm|pnpm|yarn|git|node|npx|cd|ls|dir|cat|rg|Get-|Set-|Invoke-)\b/.test(trimmed))
    score += 2;
  if (/^[)}\]];?,?$/.test(trimmed)) score += 1;
  if (/^["'`].*["'`],?\s*[+)]?$/.test(trimmed)) score += 1;
  return score;
}

function isCodeLikeLine(line: string): boolean {
  return codeSignal(line) > 0;
}

function stripSequentialLineNumbers(lines: string[]): string[] {
  if (!hasSequentialLineNumbers(lines)) return lines;
  return lines.map(stripLeadingLineNumber);
}

function hasSequentialLineNumbers(lines: string[]): boolean {
  const nonBlankLines = lines.filter((line) => line.trim().length > 0);
  const numbered = nonBlankLines
    .map((line) => /^\s*(\d+)(?:\s+|[|:]\s*)/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match));

  if (numbered.length < Math.max(4, Math.ceil(nonBlankLines.length * 0.7))) return false;

  const numbers = numbered.map((match) => Number(match[1]));
  return numbers.slice(1).every((value, index) => value === numbers[index] + 1);
}

function isLikelyWholeCodeBlock(lines: string[]): boolean {
  const nonBlankLines = lines.filter((line) => line.trim().length > 0);
  if (nonBlankLines.length < 6) return false;
  // Long assistant Markdown (lists, prose paragraphs) must never be wrapped
  // into a code block: bail out when natural-language text dominates.
  if (naturalLanguageRatio(nonBlankLines) >= 0.5) return false;
  if (hasSequentialLineNumbers(lines)) return true;

  const signalCount = nonBlankLines.filter((line) => codeSignal(line) > 0).length;
  const structuralCount = nonBlankLines.filter((line) =>
    /[{}();=]|^\s*(\/\/|#|\/\*|\*)/.test(stripLeadingLineNumber(line).trim()),
  ).length;

  return signalCount >= 5 && structuralCount / nonBlankLines.length >= 0.35;
}

function isNaturalLanguageLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Short stat bullets carrying bold markers or natural-language words are
  // prose even when they stay under the five-word threshold.
  if (isProseBulletLine(trimmed)) return true;
  // A weak paren/dash-list signal (=1) can come from prose like "the fix
  // (see issue 42) works" or "- Fixed the login redirect bug"; anything
  // stronger means code.
  if (codeSignal(trimmed) > 1) return false;
  const body = trimmed.replace(/^(#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/, '');
  const words = body.split(/\s+/).filter(Boolean);
  return words.length >= 5;
}

function naturalLanguageRatio(lines: string[]): number {
  const nonBlank = lines.filter((line) => line.trim().length > 0);
  if (nonBlank.length === 0) return 0;
  const prose = nonBlank.filter((line) => isNaturalLanguageLine(line)).length;
  return prose / nonBlank.length;
}

function inferLanguage(lines: string[]): string | undefined {
  const source = lines.join('\n');
  const trimmed = source.trim();
  if (/^(diff --git|@@|\+\+\+|---|[+-]\S)/m.test(trimmed)) return 'diff';
  if (/^\s*[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Keep looking for a better language signal below.
    }
  }
  if (/\b(interface|type\s+\w+\s*=|tsx|React\.|JSX)\b/.test(trimmed)) return 'typescript';
  if (/\b(import|export|const|let|function|require\(|module\.exports|console\.)\b/.test(trimmed))
    return 'javascript';
  if (/^(\$|>)?\s*(npm|pnpm|yarn|git|node|npx|cd|ls|dir|cat|rg)\b/m.test(trimmed)) return 'shell';
  if (/^\s*(Get-|Set-|Invoke-|\$env:|\$\w+\s*=)/m.test(trimmed)) return 'powershell';
  if (/^\s*(def|class|import|from|print\()/m.test(trimmed)) return 'python';
  if (/^\s*[-\w]+:\s+/m.test(trimmed)) return 'yaml';
  return undefined;
}

function segmentBareText(text: string): MessageSegment[] {
  const lines = text.split('\n');
  if (isLikelyWholeCodeBlock(lines)) {
    const strippedLines = stripSequentialLineNumbers(lines);
    return [
      {
        type: 'code',
        value: strippedLines.join('\n').trim(),
        language: inferLanguage(strippedLines),
      },
    ];
  }

  const segments: MessageSegment[] = [];
  let textStart = 0;
  let index = 0;

  function pushText(end: number) {
    const value = lines.slice(textStart, end).join('\n').trim();
    if (value) segments.push({ type: 'text', value });
  }

  while (index < lines.length) {
    if (!isCodeLikeLine(lines[index])) {
      index += 1;
      continue;
    }

    const start = index;
    let end = index + 1;
    let signalCount = 1;

    while (end < lines.length) {
      const line = lines[end];
      const nextLine = lines[end + 1];
      if (isCodeLikeLine(line)) {
        signalCount += 1;
        end += 1;
        continue;
      }
      if (!line.trim() && nextLine !== undefined && isCodeLikeLine(nextLine)) {
        end += 1;
        continue;
      }
      break;
    }

    const candidate = lines.slice(start, end);
    const nonBlankCount = candidate.filter((line) => line.trim()).length;
    const qualifies =
      (signalCount >= 4 || (signalCount >= 3 && nonBlankCount >= 4)) &&
      naturalLanguageRatio(candidate) < 0.5;

    if (!qualifies) {
      index = end;
      continue;
    }

    pushText(start);
    const strippedLines = stripSequentialLineNumbers(candidate);
    segments.push({
      type: 'code',
      value: strippedLines.join('\n').trim(),
      language: inferLanguage(strippedLines),
    });
    index = end;
    textStart = end;
  }

  pushText(lines.length);
  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

function segmentMessage(text: string): MessageSegment[] {
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push(...segmentBareText(before));
    }

    const language = match[1]?.trim().split(/\s+/)[0] || undefined;
    segments.push({
      type: 'code',
      value: match[2] ?? '',
      language,
    });
    lastIndex = fencePattern.lastIndex;
  }

  const after = text.slice(lastIndex);
  if (after.trim()) {
    segments.push(...segmentBareText(after));
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

function MarkdownContent({
  text,
  codeCollapseAfterLines,
}: Required<Pick<MarkdownMessageProps, 'text' | 'codeCollapseAfterLines'>>) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const codeText = getCodeText(children);
          const language = getLanguage(className);
          const isInlineCode = !language && !codeText.includes('\n');

          if (isInlineCode) {
            return (
              <code
                className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.86em] text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                {...props}
              >
                {children}
              </code>
            );
          }

          return (
            <CodeBlock
              code={codeText}
              language={language}
              collapseAfterLines={codeCollapseAfterLines}
            />
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        p({ children }) {
          return <p className="my-2 whitespace-pre-wrap break-words">{children}</p>;
        },
        ul({ children }) {
          return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-3 border-l-2 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-400">
              {children}
            </blockquote>
          );
        },
        a({ children, href }) {
          return (
            <a
              href={href}
              className="text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-500 dark:text-blue-300"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function MarkdownMessage({ text, codeCollapseAfterLines = 18 }: MarkdownMessageProps) {
  const segments = segmentMessage(text);

  return (
    <div className="markdown-message text-sm leading-6 text-slate-700 dark:text-slate-300">
      {segments.map((segment, index) =>
        segment.type === 'code' ? (
          <CodeBlock
            key={`${segment.type}-${index}`}
            code={segment.value}
            language={segment.language}
            collapseAfterLines={codeCollapseAfterLines}
          />
        ) : (
          <MarkdownContent
            key={`${segment.type}-${index}`}
            text={segment.value}
            codeCollapseAfterLines={codeCollapseAfterLines}
          />
        ),
      )}
    </div>
  );
}
