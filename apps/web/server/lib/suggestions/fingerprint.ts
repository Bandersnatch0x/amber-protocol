import crypto from 'crypto';
import { redactSecrets } from '../redaction';

export function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  );
}

export function normalizeError(error: string): string {
  return firstLine(error)
    .replace(/[A-Fa-f0-9]{8,}/g, '#')
    .replace(/\d+/g, '#')
    .replace(/\\/g, '/')
    .replace(/[A-Za-z]:\/[^\s]*/g, '<path>')
    .replace(/\/(?:home|Users|tmp|var)\/[^\s]*/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/**
 * Tool names come from host transcript records — untrusted text that ends up in
 * YAML frontmatter, headings, and prose on an agent-facing knowledge surface. A
 * newline in the name would otherwise close the frontmatter block early and let
 * the remainder land as top-level keys or as instructions to the next agent.
 */
export function safeToolName(tool: string): string {
  const cleaned = firstLine(tool)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`$<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'unknown';
}

export function frictionFingerprint(tool: string, error: string): string {
  const key = `tool-failure:${tool.trim().toLowerCase()}:${normalizeError(error)}`;
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export function excerptOf(error: string): string {
  return redactSecrets(firstLine(error)).slice(0, 240);
}
