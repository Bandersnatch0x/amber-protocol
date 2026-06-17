/**
 * Redact secrets from free text before it is persisted or rendered.
 *
 * Claude Code transcripts can contain API keys, tokens, and environment
 * values (R2 CRITICAL in the Session Lens spec). This module is deliberately
 * conservative: it prefers over-redaction to leaking a credential.
 */

const PLACEHOLDER = '[REDACTED]';

interface RedactionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const RULES: readonly RedactionRule[] = [
  // OpenAI / Anthropic style keys: sk-..., sk-ant-api03-...
  { pattern: /sk-[A-Za-z0-9_-]{16,}/g, replacement: PLACEHOLDER },
  // AWS access key id
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: PLACEHOLDER },
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_
  { pattern: /gh[pousr]_[A-Za-z0-9]{30,}/g, replacement: PLACEHOLDER },
  // Authorization: Bearer <token> — keep the scheme, redact the token
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, replacement: `$1${PLACEHOLDER}` },
  // Secret-looking environment assignments: FOO_PASSWORD=..., API_KEY: ...
  // Case-sensitive on the secret word so ordinary lowercase "key" is untouched.
  {
    pattern:
      /(\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|KEY|PWD|CREDENTIAL)[A-Z0-9_]*\s*[=:]\s*)(\S+)/g,
    replacement: `$1${PLACEHOLDER}`,
  },
];

export function redactSecrets(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  return RULES.reduce((acc, rule) => acc.replace(rule.pattern, rule.replacement), text);
}
