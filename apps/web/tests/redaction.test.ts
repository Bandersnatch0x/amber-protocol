import { describe, it, expect } from 'vitest';
import { redactSecrets, redactDeep } from '../server/lib/redaction';

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
    const out = redactSecrets(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
    );
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

describe('redactDeep', () => {
  it('redacts secret strings inside nested objects', () => {
    const input = {
      url: 'https://example.com',
      auth: { apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl' },
    };
    const out = redactDeep(input) as typeof input;
    expect(out.auth.apiKey).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(out.auth.apiKey).toContain('[REDACTED]');
    expect(out.url).toBe('https://example.com');
  });

  it('redacts secret strings inside arrays', () => {
    const input = { tokens: ['ghp_1234567890abcdefABCDEF1234567890abcd', 'normal'] };
    const out = redactDeep(input) as typeof input;
    expect(out.tokens[0]).not.toContain('ghp_1234567890abcdefABCDEF1234567890abcd');
    expect(out.tokens[0]).toContain('[REDACTED]');
    expect(out.tokens[1]).toBe('normal');
  });

  it('redacts secrets inside arrays of nested objects', () => {
    const input = [{ env: 'API_KEY=sup3r-s3cret-value-here' }, { ok: true }];
    const out = redactDeep(input) as typeof input;
    expect(out[0].env).not.toContain('sup3r-s3cret-value-here');
    expect(out[0].env).toContain('[REDACTED]');
    expect(out[1].ok).toBe(true);
  });

  it('preserves non-string primitive values (number, boolean, null) as-is', () => {
    const input = { count: 42, enabled: true, nothing: null, ratio: 0.5 };
    const out = redactDeep(input) as typeof input;
    expect(out.count).toBe(42);
    expect(out.enabled).toBe(true);
    expect(out.nothing).toBe(null);
    expect(out.ratio).toBe(0.5);
  });

  it('does not mutate the input object', () => {
    const input = { apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl' };
    redactDeep(input);
    expect(input.apiKey).toBe('sk-ant-api03-AbC123_def456GHI789jkl');
  });

  it('returns the redacted string unchanged for a top-level string', () => {
    const out = redactDeep('token sk-ant-api03-AbC123_def456GHI789jkl leaked');
    expect(out).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(out).toContain('[REDACTED]');
  });

  it('returns primitives (non-object) as-is', () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(true)).toBe(true);
    expect(redactDeep(null)).toBe(null);
    expect(redactDeep(undefined)).toBe(undefined);
  });
});

describe('redactDeep', () => {
  it('redacts secret strings in a nested object', () => {
    const input = {
      apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl',
      nested: { token: 'ghp_1234567890abcdefABCDEF1234567890abcd' },
    };
    const out = redactDeep(input) as Record<string, unknown>;
    expect(out.apiKey).toBe('[REDACTED]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.token).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(JSON.stringify(out)).not.toContain('ghp_1234567890abcdefABCDEF1234567890abcd');
  });

  it('redacts secret strings inside arrays', () => {
    const input = { keys: ['sk-ant-api03-AbC123_def456GHI789jkl', 'normal text'] };
    const out = redactDeep(input) as { keys: unknown[] };
    expect(out.keys[0]).toBe('[REDACTED]');
    expect(out.keys[1]).toBe('normal text');
  });

  it('preserves non-string primitives (number, boolean, null) as-is', () => {
    const input = { count: 42, enabled: true, missing: null };
    const out = redactDeep(input) as Record<string, unknown>;
    expect(out.count).toBe(42);
    expect(out.enabled).toBe(true);
    expect(out.missing).toBeNull();
  });

  it('does not mutate the input object', () => {
    const input = { apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl' };
    redactDeep(input);
    expect(input.apiKey).toBe('sk-ant-api03-AbC123_def456GHI789jkl');
  });

  it('redacts secrets inside arrays of objects', () => {
    const input = {
      events: [
        { token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig' },
        { token: 'clean' },
      ],
    };
    const out = redactDeep(input) as { events: Array<{ token: string }> };
    expect(out.events[0].token).toContain('[REDACTED]');
    expect(out.events[0].token).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(out.events[1].token).toBe('clean');
  });

  it('passes through plain strings unchanged', () => {
    expect(redactDeep('hello world')).toBe('hello world');
  });

  it('passes through non-object scalars unchanged', () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(true)).toBe(true);
    expect(redactDeep(null)).toBeNull();
  });
});

describe('redactDeep', () => {
  it('redacts secrets inside nested object values', () => {
    const out = redactDeep({
      level1: {
        apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl',
        keep: 'plain text',
      },
    }) as Record<string, unknown>;

    const level1 = out.level1 as Record<string, unknown>;
    expect(level1.apiKey).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(level1.apiKey).toContain('[REDACTED]');
    expect(level1.keep).toBe('plain text');
  });

  it('redacts secrets inside arrays', () => {
    const out = redactDeep(['sk-ant-api03-AbC123_def456GHI789jkl', 'safe']) as unknown[];
    expect(out[0]).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(out[0]).toContain('[REDACTED]');
    expect(out[1]).toBe('safe');
  });

  it('recurses through mixed nested objects and arrays', () => {
    const out = redactDeep({
      tokens: ['Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig'],
      nested: { deep: [{ env: 'DATABASE_PASSWORD=sup3r-s3cret-value-here' }] },
    }) as Record<string, unknown>;

    const tokens = out.tokens as unknown[];
    expect(String(tokens[0])).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig');
    expect(String(tokens[0])).toContain('[REDACTED]');

    const nested = out.nested as Record<string, unknown>;
    const deep = nested.deep as unknown[];
    const item = deep[0] as Record<string, unknown>;
    expect(String(item.env)).not.toContain('sup3r-s3cret-value-here');
    expect(String(item.env)).toContain('[REDACTED]');
  });

  it('preserves non-string primitives (number, boolean, null) as-is', () => {
    const out = redactDeep({ num: 42, bool: true, nil: null, arr: [1, false, null] });
    expect(out).toEqual({ num: 42, bool: true, nil: null, arr: [1, false, null] });
  });

  it('does not mutate the input object', () => {
    const input = {
      apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl',
      nested: { token: 'ghp_1234567890abcdefABCDEF1234567890abcd' },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    redactDeep(input);
    expect(input).toEqual(snapshot);
  });

  it('returns non-object values safely (string redacted, others unchanged)', () => {
    expect(redactDeep('key sk-ant-api03-AbC123_def456GHI789jkl here')).toContain('[REDACTED]');
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(true)).toBe(true);
    expect(redactDeep(null)).toBe(null);
    expect(redactDeep(undefined)).toBe(undefined);
  });
});
