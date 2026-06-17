import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../server/lib/redaction';

describe('redactSecrets', () => {
  it('redacts OpenAI/Anthropic-style sk- keys', () => {
    const out = redactSecrets('using key sk-ant-api03-AbC123_def456GHI789jkl to call the model');
    expect(out).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(out).toContain('[REDACTED');
  });

  it('redacts AWS access key IDs', () => {
    const out = redactSecrets('aws_access_key_id = AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[REDACTED');
  });

  it('redacts GitHub personal access tokens', () => {
    const secret = 'ghp_1234567890abcdefABCDEF1234567890abcd';
    const out = redactSecrets(`git remote set-url origin https://${secret}@github.com/x/y`);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED');
  });

  it('redacts Bearer tokens in authorization headers', () => {
    const out = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig');
    expect(out).toContain('[REDACTED');
  });

  it('redacts secret-looking environment assignments', () => {
    const out = redactSecrets('export DATABASE_PASSWORD=sup3r-s3cret-value-here');
    expect(out).not.toContain('sup3r-s3cret-value-here');
    expect(out).toContain('[REDACTED');
  });

  it('preserves ordinary text without secrets', () => {
    const text = 'The function reads docs/wiki/index.md and returns a summary of the components.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('does not redact ordinary lowercase words that merely contain "key"', () => {
    const text = 'The keyboard layout maps each key to a glyph in the monkey demo.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('returns an empty string for non-string input', () => {
    expect(redactSecrets(undefined as unknown as string)).toBe('');
    expect(redactSecrets(null as unknown as string)).toBe('');
  });
});
