import { describe, it, expect } from 'vitest';
import { resolveHost } from '../../server/lib/server-host';

describe('resolveHost', () => {
  it('defaults to loopback (not all interfaces) when HOST is unset', () => {
    expect(resolveHost({})).toBe('127.0.0.1');
  });

  it('treats a blank/whitespace HOST as unset', () => {
    expect(resolveHost({ HOST: '   ' })).toBe('127.0.0.1');
  });

  it('honors an explicit HOST opt-in (e.g. LAN access)', () => {
    expect(resolveHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveHost({ HOST: '192.168.1.5' })).toBe('192.168.1.5');
  });
});
